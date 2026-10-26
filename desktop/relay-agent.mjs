import { WebSocket } from 'ws';
import https from 'node:https';
import { authToken, createHandshake, deriveSessionKeys, handshakeProof, MAX_STREAM_BYTES, openJson, parsePublicKey, PROTOCOL_VERSION, RELAY_PATH, sealJson } from '../relay/protocol.mjs';

const fail = (message, status = 502) => Object.assign(Error(message), { status });
const safeUrl = value => {
  let url;
  try { url = new URL(value); } catch { throw Error('Relay 地址格式无效'); }
  if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw Error('Relay 地址必须是 ws:// 或 wss://，且不能带凭据或查询参数');
  if (!url.pathname || url.pathname === '/') url.pathname = RELAY_PATH;
  return url;
};

export class RelayAgent {
  constructor({ relayUrl, registrationSecret, machine, runtimeId, gatewayBase, upstreamCa, deviceId = '', allowPrivateLoopback = true, reconnectDelays = [1000, 2000, 5000, 10000, 30000] }) {
    this.url = safeUrl(relayUrl);
    this.registrationSecret = registrationSecret;
    this.machine = machine;
    this.runtimeId = runtimeId;
    this.gatewayBase = new URL(gatewayBase);
    if (this.gatewayBase.protocol !== 'https:' && !(allowPrivateLoopback && this.gatewayBase.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(this.gatewayBase.hostname))) throw Error('Relay 上游必须是本机 HTTPS 网关');
    this.upstreamCa = upstreamCa;
    this.deviceId = deviceId;
    this.reconnectDelays = reconnectDelays;
    this.socket = null; this.keys = null; this.ticketWaiter = null; this.ticket = '';
    this.sessions = new Map(); this.activeSession = '';
    this.streams = new Map(); this.closed = false; this.reconnectIndex = 0; this.reconnectTimer = null;
    this.state = 'idle'; this.lastError = '';
  }

  get machineId() { return this.machine.machineId; }
  get statusText() { return this.state === 'online' ? '已连接 Relay' : this.state === 'reconnecting' ? 'Relay 重连中' : this.state === 'error' ? 'Relay 连接失败' : 'Relay 尚未连接'; }

  status() {
    return { enabled: true, state: this.state, relayUrl: this.url.toString(), machineId: this.machineId, fingerprint: this.machine.fingerprint,
      connected: this.state === 'online', streams: this.streams.size, error: this.lastError || null };
  }

  connect() {
    if (this.closed || this.socket) return;
    this.state = this.reconnectIndex ? 'reconnecting' : 'connecting';
    const socket = new WebSocket(this.url, { handshakeTimeout: 12000, perMessageDeflate: false, maxPayload: 1024 * 1024 + 4096 });
    this.socket = socket;
    socket.on('open', () => this.register(socket));
    socket.on('message', (raw, binary) => { if (!binary) this.message(socket, raw); });
    socket.on('error', error => { this.lastError = error.message || 'Relay 连接失败'; });
    socket.on('close', () => {
      if (this.socket !== socket) return;
      this.socket = null; this.keys = null; this.state = this.closed ? 'closed' : 'reconnecting';
      if (this.ticketWaiter) { const reject = this.ticketWaiter.reject; this.ticketWaiter = null; reject(Error('Relay 连接已断开')); }
      for (const stream of this.streams.values()) stream.abort(Error('Relay 连接已断开'));
      this.streams.clear();
      if (!this.closed) this.scheduleReconnect();
    });
  }

  register(socket) {
    const handshake = createHandshake(this.machine.publicKey, this.machineId, this.runtimeId);
    socket.send(JSON.stringify({
      type: 'register-machine', version: PROTOCOL_VERSION, machineId: this.machineId, runtimeId: this.runtimeId,
      auth: authToken(this.registrationSecret, this.machineId), hello: {
        machinePublicKey: handshake.machinePublicKey, machineFingerprint: handshake.machineFingerprint,
        ephemeralPublicKey: handshake.ephemeralPublicKey, nonce: handshake.nonce, signature: handshakeProof(handshake, this.machine.privateKey),
      },
    }));
    this.handshake = handshake;
  }

  scheduleReconnect() {
    clearTimeout(this.reconnectTimer); if (this.closed) return;
    const delay = this.reconnectDelays[Math.min(this.reconnectIndex++, this.reconnectDelays.length - 1)];
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.connect(); }, delay);
    this.reconnectTimer.unref?.();
  }

  message(socket, raw) {
    let message; try { message = JSON.parse(raw); } catch { return; }
    if (!message || typeof message.type !== 'string') return;
    if (message.type === 'machine-ready') {
      this.state = 'online'; this.reconnectIndex = 0; this.lastError = '';
      return;
    }
    if (message.type === 'device-hello') {
      try {
        if (!this.handshake || typeof message.ephemeralPublicKey !== 'string' || typeof message.nonce !== 'string' || typeof message.sessionId !== 'string' || !message.sessionId) throw Error('Relay 设备握手缺少字段');
        for (const [sessionId, session] of this.sessions) {
          if (sessionId === message.sessionId) continue;
          const streamOpen = [...this.streams.values()].some(stream => stream.sessionId === sessionId);
          if (!streamOpen) this.sessions.delete(sessionId);
        }
        parsePublicKey(message.ephemeralPublicKey);
        this.sessions.set(message.sessionId, {
          keys:deriveSessionKeys(this.handshake.privateKey, message.ephemeralPublicKey, this.machineId, this.handshake.nonce, message.nonce, 'machine'),
        });
        this.activeSession = message.sessionId;
        this.send(socket, { type:'device-hello', sessionId:message.sessionId, ephemeralPublicKey:this.handshake.ephemeralPublicKey, nonce:this.handshake.nonce });
      } catch (error) { this.lastError = error.message; this.send(socket, { type:'error', code:'handshake-failed' }); }
      return;
    }
    if (message.type === 'device-ready') {
      if (typeof message.sessionId === 'string' && message.sessionId) this.activeSession = message.sessionId;
      return;
    }
    if (message.type === 'ticket-error') {
      if (this.ticketWaiter) { const reject = this.ticketWaiter.reject; this.ticketWaiter = null; reject(Error(String(message.code || 'Relay 未生成配对票据'))); }
      return;
    }
    if (message.type === 'ticket-issued') {
      if (this.ticketWaiter) { const resolve = this.ticketWaiter.resolve; this.ticketWaiter = null; resolve({ ticket:message.ticket, expiresAt:message.expiresAt }); }
      return;
    }
    if (message.type === 'error') {
      const text = String(message.code || message.message || 'Relay 拒绝连接');
      this.lastError = text;
      if (this.ticketWaiter) { const reject = this.ticketWaiter.reject; this.ticketWaiter = null; reject(Error(text)); }
      return;
    }
    if (message.type === 'ping') { socket.send(JSON.stringify({ type: 'machine-alive', at: Date.now() })); return; }
    if (message.type === 'stream-open') {
      if (this.streams.has(message.streamId)) return;
      const stream = new StreamHandler(this, socket, message.streamId, message.sessionId || this.activeSession);
      this.activeSession = stream.sessionId;
      this.streams.set(message.streamId, stream);
      return;
    }
    if (message.type === 'stream-data') {
      const stream = this.streams.get(message.streamId); if (!stream) return;
      try {
        stream.data(Buffer.from(String(message.data || ''), 'base64url'), message.seq);
      } catch (error) {
        stream.abort(error);
        this.send(socket, { type:'stream-close', streamId:message.streamId, code:'crypto-error' });
      }
      return;
    }
    if (message.type === 'stream-end') {
      const stream = this.streams.get(message.streamId); if (!stream) return;
      stream.end(message.seq); return;
    }
    if (message.type === 'stream-close') {
      const stream = this.streams.get(message.streamId); if (!stream) return;
      stream.abort(Error(String(message.code || 'Relay 数据流已关闭'))); this.streams.delete(message.streamId); return;
    }
  }

  send(socket = this.socket, value) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
  }

  requestTicket(ttlMs = 600000) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || this.state !== 'online') return Promise.reject(Error('Relay 尚未连接'));
    if (this.ticketWaiter) return Promise.reject(Error('正在生成 Relay 配对票据'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.ticketWaiter = null; reject(Error('Relay 配对票据生成超时')); }, 10000);
      this.ticketWaiter = { resolve:value => { clearTimeout(timer); resolve(value); }, reject:error => { clearTimeout(timer); reject(error); } };
      this.send(this.socket, { type:'mint-ticket', ttlMs });
    });
  }

  close(reason = '关闭 Relay') {
    this.closed = true; clearTimeout(this.reconnectTimer);
    for (const stream of this.streams.values()) stream.abort(Error(reason));
    this.streams.clear(); this.state = 'closed';
    try { this.socket?.close(1000, reason.slice(0, 100)); } catch {}
    this.socket = null; this.keys = null;
  }
}

class StreamHandler {
  constructor(agent, socket, id, sessionId) {
    this.agent = agent; this.socket = socket; this.id = id;
    this.sessionId = sessionId;
    this.request = null; this.response = null; this.chunks = []; this.bytes = 0;
    this.requestSequence = 0;
    this.timer = setTimeout(() => this.abort(Error('Relay 数据流超时')), 65000);
    this.timer.unref?.();
  }

  data(bytes, sequence) {
    if (!Number.isSafeInteger(sequence) || sequence !== this.requestSequence) throw Error('Relay 数据帧顺序错误');
    this.requestSequence++;
    if (!bytes.length || this.bytes + bytes.length > 1024 * 1024 + 4096) throw Error('Relay 请求过大');
    this.bytes += bytes.length; this.chunks.push(bytes);
  }

  end(sequence) {
    if (!Number.isSafeInteger(sequence) || sequence !== this.requestSequence - 1) return this.abort(Error('Relay 请求结束帧无效'));
    clearTimeout(this.timer);
    let request;
    try {
      const session = this.agent.sessions.get(this.sessionId) || [...this.agent.sessions.values()].at(-1);
      if (!session) throw Error('Relay 加密会话尚未建立');
      const frame = Buffer.concat(this.chunks);
      // The device seals the complete request with the sequence carried by
      // stream-end. requestSequence has already advanced past that frame.
      request = openJson(session.keys, frame, sequence);
      if (!request || typeof request.method !== 'string' || typeof request.path !== 'string') throw Error('Relay 请求格式无效');
      this.requestSequence++;
      this.agent.send(this.socket, { type:'stream-ready', streamId:this.id });
    } catch (error) { this.abort(error); return; }
    void this.forward(request);
  }

  async forward(request) {
    try {
      const method = request.method.toUpperCase();
      if (!['GET','POST','DELETE'].includes(method) || !request.path.startsWith('/v1/')) throw Error('Relay 请求不允许');
      if (request.path.includes('..') || request.path.includes('\\') || request.path.length > 2048) throw Error('Relay 路径不允许');
      const url = new URL(request.path, this.agent.gatewayBase);
      if (url.origin !== this.agent.gatewayBase.origin) throw Error('Relay 路径越界');
      const body = request.body === undefined ? null : Buffer.from(JSON.stringify(request.body), 'utf8');
      if (body && body.length > 65536) throw Error('Relay 请求过大');
      const headers = { accept: 'application/json', ...(body ? { 'content-type':'application/json', 'content-length':body.length } : {}), ...(request.headers || {}) };
      for (const key of Object.keys(headers)) if (!['authorization','idempotency-key','content-type','content-length','accept','accept-encoding','origin','sec-fetch-site'].includes(key.toLowerCase())) delete headers[key];
      headers['user-agent'] = 'relaydeck-relay-agent';
      this.request = https.request(url, { method, headers, ...(this.agent.upstreamCa ? { ca: this.agent.upstreamCa } : {}), timeout: 65000 }, response => {
        this.response = response; this.chunks = []; this.bytes = 0; this.responseStatus = response.statusCode || 502; this.responseHeaders = response.headers;
        response.on('data', chunk => {
          this.chunks.push(chunk); this.bytes += chunk.length;
          if (this.bytes > MAX_STREAM_BYTES) this.abort(Error('Relay 响应过大'));
        });
        response.on('end', () => this.respond());
        response.on('error', error => this.abort(error));
      });
      this.request.on('timeout', () => this.abort(Error('Relay 上游超时')));
      this.request.on('error', error => this.abort(error));
      this.request.end(body || undefined);
    } catch (error) { this.abort(error); }
  }

  respond() {
    const session = this.agent.sessions.get(this.sessionId) || [...this.agent.sessions.values()].at(-1);
    if (!session) return this.abort(Error('Relay 加密会话已断开'));
    const payload = {
      status: this.responseStatus,
      headers: Object.fromEntries(Object.entries(this.responseHeaders || {}).filter(([key]) => ['content-type','content-encoding','cache-control','vary'].includes(key))),
      body: Buffer.concat(this.chunks).toString('base64url'),
    };
    const responseSequence = 0;
    const frame = sealJson(session.keys, payload, responseSequence);
    this.sendData(frame, responseSequence);
    this.agent.send(this.socket, { type:'stream-end', streamId:this.id, seq:responseSequence });
    this.finish();
  }

  sendData(bytes, seq) {
    let count = 0;
    for (let offset = 0; offset < bytes.length; offset += 256 * 1024) {
      const chunk = bytes.subarray(offset, Math.min(offset + 256 * 1024, bytes.length));
      this.agent.send(this.socket, { type:'stream-data', streamId:this.id, seq, bytes:chunk.length, data:chunk.toString('base64url') });
      count++;
    }
    return count;
  }

  abort(error) {
    clearTimeout(this.timer);
    try { this.request?.destroy(error); } catch {}
    try { this.response?.destroy(); } catch {}
    this.agent.streams.delete(this.id);
    this.agent.send(this.socket, { type:'stream-close', streamId:this.id, code:(error?.message || 'stream-error').slice(0,80) });
  }

  finish() {
    clearTimeout(this.timer);
    this.agent.streams.delete(this.id);
  }
}

export function createRelayAgent(options) { return new RelayAgent(options); }
