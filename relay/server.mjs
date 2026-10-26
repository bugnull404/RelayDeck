import http from 'node:http';
import https from 'node:https';
import { WebSocket, WebSocketServer } from 'ws';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  authToken,
  encode,
  MAX_FRAME_BYTES,
  MAX_STREAM_BYTES,
  MAX_STREAMS_PER_CONNECTION,
  parse,
  PROTOCOL_VERSION,
  randomId,
  RELAY_PATH,
  STREAM_IDLE_MS,
} from './protocol.mjs';

const fail = (status, message) => Object.assign(Error(message), { status });
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function createRelayServer({
  host = '127.0.0.1',
  port = 19647,
  tls = null,
  adminToken = randomBytes(32).toString('hex'),
  registrationSecret = randomBytes(32).toString('hex'),
  publicUrl = '',
  dataFile = '',
  now = Date.now,
  heartbeatMs = 25000,
  staleMs = 90000,
} = {}) {
  const machines = new Map();
  const pendingTickets = new Map();
  const deviceCredentials = new Map();
  const streams = new Map();
  const hash = value => createHash('sha256').update(String(value)).digest('hex');
  if (dataFile) {
    try {
      const stored = JSON.parse(await readFile(dataFile, 'utf8'));
      for (const row of Array.isArray(stored.devices) ? stored.devices : []) {
        if (typeof row.hash === 'string' && /^[a-f0-9]{64}$/.test(row.hash) && typeof row.machineId === 'string') deviceCredentials.set(row.hash, row.machineId);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const persist = async () => {
    if (!dataFile) return;
    await mkdir(dirname(dataFile), { recursive:true });
    const temporary = dataFile + '.tmp';
    await writeFile(temporary, JSON.stringify({ devices:[...deviceCredentials].map(([hashValue,machineId]) => ({ hash:hashValue, machineId })) }), { mode:0o600 });
    await rename(temporary, dataFile);
  };
  const maintenance = setInterval(() => prune(), 15000); maintenance.unref();
  const handler = (request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ ok: true, protocol: PROTOCOL_VERSION, machines: machines.size }));
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'Not found' }));
  };
  const server = tls ? https.createServer(tls, handler) : http.createServer(handler);
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES + 4096, clientTracking: true });

  const send = (socket, value) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(encode(value));
  };
  const machineFor = socket => {
    for (const machine of machines.values()) if (machine.socket === socket) return machine;
    return null;
  };
  const closeStream = (stream, code) => {
    if (!stream || streams.get(stream.id) !== stream) return;
    streams.delete(stream.id);
    const device = stream.device.socket;
    const machine = machines.get(stream.machineId);
    if (device.readyState === WebSocket.OPEN) send(device, { type:'stream-close', streamId:stream.id, code });
    if (machine?.socket.readyState === WebSocket.OPEN && machine.session?.socket !== device) {
      send(machine.socket, { type:'stream-close', streamId:stream.id, code });
    }
  };
  const clearStreams = (owner, role, code) => {
    for (const stream of [...streams.values()]) {
      if (role === 'device' ? stream.device.socket === owner : stream.machineId === owner.machineId) {
        if (role === 'device') {
          const machine = machines.get(stream.machineId);
          if (machine?.socket.readyState === WebSocket.OPEN) send(machine.socket, { type:'stream-close', streamId:stream.id, code });
        } else {
          closeStream(stream, code);
        }
        streams.delete(stream.id);
      }
    }
  };
  const closeMachine = (machine, reason = 'relay replaced this connection') => {
    if (!machine) return;
    if (machines.get(machine.machineId) === machine) machines.delete(machine.machineId);
    clearStreams(machine, 'machine', 'machine-offline');
    try { machine.socket.close(4001, reason); } catch {}
  };
  function prune() {
    const current = now();
    for (const [id, ticket] of pendingTickets) if (ticket.expiresAt <= current) pendingTickets.delete(id);
    for (const [id, machine] of machines) if (machine.lastSeen + staleMs < current) closeMachine(machine, 'machine timed out');
  }
  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.ping(); send(socket, { type: 'ping', at: now() });
      }
    }
  }, heartbeatMs); heartbeat.unref();

  wss.on('connection', (socket, request, url) => {
    socket.isAlive = true;
    socket.on('pong', () => { socket.isAlive = true; });
    let role = '';
    let machineId = '';
    socket.on('message', (raw, binary) => {
      if (binary || raw.length > MAX_FRAME_BYTES) { socket.close(1009, 'frame too large'); return; }
      const message = parse(raw);
      if (!message || typeof message.type !== 'string') { socket.close(1008, 'invalid frame'); return; }
      socket.isAlive = true;
      if (message.type === 'register-machine') {
        if (role) { socket.close(1008, 'already registered'); return; }
        if (message.version !== PROTOCOL_VERSION) { send(socket, { type:'error', code:'protocol-mismatch' }); socket.close(1002); return; }
        const expected = authToken(registrationSecret, String(message.machineId || ''));
        if (!equal(expected, String(message.auth || ''))) { send(socket, { type:'error', code:'unauthorized' }); socket.close(1008); return; }
        if (!/^[A-Za-z0-9_-]{16,80}$/.test(String(message.machineId || '')) || !/^[A-Za-z0-9_-]{16,80}$/.test(String(message.runtimeId || ''))) { socket.close(1008); return; }
        const hello = message.hello && typeof message.hello === 'object' ? message.hello : null;
        if (!hello || typeof hello.machinePublicKey !== 'string' || typeof hello.ephemeralPublicKey !== 'string' || typeof hello.nonce !== 'string' || typeof hello.signature !== 'string') {
          send(socket, { type:'error', code:'invalid-handshake' }); socket.close(1008); return;
        }
        const machine = { machineId: message.machineId, runtimeId: message.runtimeId, socket, lastSeen: now(), hello: { ...hello, runtimeId: message.runtimeId }, session: null };
        const previous = machines.get(machine.machineId);
        if (previous && previous.socket !== socket) {
          closeMachine(previous);
        }
        machines.set(machine.machineId, machine);
        role = 'machine'; machineId = machine.machineId;
        send(socket, { type: 'machine-ready', machineId, protocol: PROTOCOL_VERSION });
        return;
      }
      if (message.type === 'register-device') {
        if (role) { socket.close(1008, 'already registered'); return; }
        if (message.version !== PROTOCOL_VERSION) { send(socket, { type:'error', code:'protocol-mismatch' }); socket.close(1002); return; }
        const requestedMachine = String(message.machineId || '');
        let selectedMachine = requestedMachine;
        let credential = '';
        if (typeof message.credential === 'string' && message.credential) {
          selectedMachine = deviceCredentials.get(hash(message.credential)) || '';
          if (!selectedMachine || selectedMachine !== requestedMachine) { send(socket, { type:'error', code:'credential-invalid' }); socket.close(1008); return; }
        } else {
          const ticket = pendingTickets.get(String(message.ticket || ''));
          if (!ticket || ticket.expiresAt <= now() || ticket.used) { send(socket, { type:'error', code:'ticket-expired' }); socket.close(1008); return; }
          if (ticket.machineId !== requestedMachine) {
            // A ticket is a bearer secret. Do not disclose whether it belongs
            // to a different machine after it has already been redeemed.
            send(socket, { type:'error', code:ticket.used ? 'ticket-expired' : 'ticket-mismatch' });
            socket.close(1008);
            return;
          }
          ticket.used = true; pendingTickets.delete(String(message.ticket));
          credential = randomId(32);
          deviceCredentials.set(hash(credential), ticket.machineId);
          void persist().catch(() => {});
        }
        const machine = machines.get(selectedMachine);
        if (!machine) { send(socket, { type:'error', code:'machine-offline' }); socket.close(4004); return; }
        if (machine.session?.socket && machine.session.socket !== socket) {
          const prior = machine.session.socket;
          machine.session = null;
          clearStreams({ socket:prior }, 'device', 'device-offline');
          try { prior.close(4001, 'replaced by a newer device session'); } catch {}
        }
        machine.session = { socket, id:String(message.sessionId || randomId(16)) };
        role = 'device'; machineId = selectedMachine;
        send(socket, { type: 'device-ready', machineId, online: true, protocol: PROTOCOL_VERSION, machineHello: machine.hello, credential });
        send(machine.socket, { type:'device-ready', sessionId:machine.session.id });
        return;
      }
      if (message.type === 'mint-ticket' && role === 'machine') {
        const ticket = randomId(24);
        const expiresAt = now() + Math.max(30000, Math.min(600000, Number(message.ttlMs) || 600000));
        pendingTickets.set(ticket, { machineId, expiresAt, used:false });
        send(socket, { type:'ticket-issued', ticket, expiresAt:new Date(expiresAt).toISOString() });
        return;
      }
      if (message.type === 'device-hello' && role === 'device') {
        const machine = machines.get(machineId);
        const session = machine?.session;
        const sessionId = String(message.sessionId || '');
        if (!session || session.socket !== socket || !sessionId
          || typeof message.ephemeralPublicKey !== 'string' || typeof message.nonce !== 'string') return;
        session.id = sessionId;
        send(machine.socket, { type:'device-hello', sessionId, ephemeralPublicKey:message.ephemeralPublicKey, nonce:message.nonce });
        return;
      }
      if (message.type === 'device-hello' && role === 'machine') {
        const machine = machines.get(machineId);
        if (!machine || typeof message.ephemeralPublicKey !== 'string' || typeof message.nonce !== 'string') return;
        const session = machine.session;
        if (!session?.socket || session.socket.readyState !== WebSocket.OPEN || String(message.sessionId || '') !== session.id) return;
        send(session.socket, { type:'device-hello', sessionId:session.id, ephemeralPublicKey:message.ephemeralPublicKey, nonce:message.nonce });
        return;
      }
      if ((message.type === 'machine-alive' || message.type === 'device-ping') && role === 'machine') {
        const machine = machines.get(machineId); if (machine) machine.lastSeen = now(); send(socket, { type:'alive', at: now() }); return;
      }
      if (message.type === 'device-ping' && role === 'device') {
        const machine = machines.get(machineId);
        if (machine) machine.lastSeen = now();
        send(socket, { type:'alive', at:now() }); return;
      }
      if (message.type === 'stream-ready') {
        if (role !== 'machine') return;
        const id = String(message.streamId || '');
        const stream = streams.get(id);
        if (!stream || stream.machineId !== machineId || stream.machine.socket !== socket) return;
        if (stream.device.socket.readyState === WebSocket.OPEN) send(stream.device.socket, { type:'stream-ready', streamId:id });
        return;
      }
      if (message.type === 'stream-open') {
        if (role !== 'device') { send(socket, { type:'error', code:'device-required' }); return; }
        const id = String(message.streamId || '');
        if (!/^[A-Za-z0-9_-]{22,64}$/.test(id) || streams.has(id)) return;
        const machine = machines.get(machineId);
        if (!machine || machine.socket.readyState !== WebSocket.OPEN) { send(socket, { type:'stream-close', streamId:id, code:'machine-offline' }); return; }
        const deviceCount = [...streams.values()].filter(stream => stream.device.socket === socket).length;
        if (deviceCount >= MAX_STREAMS_PER_CONNECTION) { send(socket, { type:'stream-close', streamId:id, code:'machine-busy' }); return; }
        const stream = { id, machineId, device:{ socket }, machine, at: now(), bytes: 0 };
        streams.set(id, stream);
        send(machine.socket, { type:'stream-open', streamId:id, sessionId:machine.session?.id || '' });
        send(socket, { type:'stream-open', streamId:id });
        return;
      }
      if (!['stream-data','stream-end','stream-close'].includes(message.type)) {
        if (role !== 'device') send(socket, { type:'error', code:'device-required' });
        return;
      }
      const id = String(message.streamId || '');
      const machine = machines.get(machineId);
      const stream = streams.get(id);
      if (role === 'machine' && !stream) {
        send(socket, { type:'stream-close', streamId:id, code:'unknown-stream' });
        return;
      }
      if (role === 'machine' && stream.machine.socket !== socket) return;
      if (role === 'device' && stream && stream.device.socket !== socket) return;
      if (message.type === 'stream-end' && role === 'device') {
        if (!stream) { send(socket, { type:'stream-close', streamId:id, code:'unknown-stream' }); return; }
        if (machine?.socket.readyState === WebSocket.OPEN) send(machine.socket, { type:'stream-end', streamId:id, seq:message.seq });
        return;
      }
      if (message.type === 'stream-data' && role === 'device' && stream && machine?.socket.readyState === WebSocket.OPEN) {
        if (!Number.isInteger(message.seq) || message.seq < 0 || !Number.isInteger(message.bytes) || message.bytes < 0 || message.bytes > MAX_FRAME_BYTES) return;
        const data = String(message.data || '');
        if (!data || Buffer.byteLength(data, 'base64url') !== message.bytes) {
          send(socket, { type:'stream-close', streamId:id, code:'invalid-frame' });
          streams.delete(id);
          return;
        }
        stream.bytes += message.bytes; stream.at = now();
        if (stream.bytes > MAX_STREAM_BYTES) {
          send(machine.socket, { type:'stream-close', streamId:id, code:'too-large' });
          send(socket, { type:'stream-close', streamId:id, code:'too-large' });
          streams.delete(id);
          return;
        }
        send(machine.socket, { type:'stream-data', streamId:id, seq:message.seq, bytes:message.bytes, data:message.data });
        return;
      }
      if (!machine || machine.socket.readyState !== WebSocket.OPEN) { send(socket, { type:'stream-close', streamId:id, code:'machine-offline' }); return; }
      if (role === 'device' && !stream) { send(socket, { type:'stream-close', streamId:id, code:'unknown-stream' }); return; }
      if (message.type === 'stream-data' && (!Number.isInteger(message.bytes) || message.bytes < 0 || message.bytes > MAX_FRAME_BYTES)) return;
      if (stream) {
        stream.bytes += message.bytes || 0; stream.at = now();
        if (stream.bytes > MAX_STREAM_BYTES) {
          send(machine.socket, {type:'stream-close',streamId:id,code:'too-large'});
          send(stream.device.socket,{type:'stream-close',streamId:id,code:'too-large'});
          streams.delete(id); return;
        }
      }
      if (role === 'machine') {
        if (stream?.device.socket.readyState === WebSocket.OPEN) send(stream.device.socket, message.type === 'stream-data'
          ? { type: message.type, streamId:id, bytes:message.bytes, data:message.data, seq:message.seq }
          : message.type === 'stream-end'
            ? { type:message.type, streamId:id, seq:message.seq }
            : { type:message.type, streamId:id, code:message.code });
        if ((message.type === 'stream-close' || message.type === 'stream-end') && stream) streams.delete(id);
        return;
      }
      send(machine.socket, message.type === 'stream-data'
        ? { type: message.type, streamId:id, bytes:message.bytes, data:message.data, seq:message.seq }
        : { type:message.type, streamId:id, code:message.code });
      if (message.type === 'stream-close') streams.delete(id);
      return;
    });
    socket.on('close', () => {
      const machine = machineFor(socket);
      if (machine) {
        if (machines.get(machine.machineId) === machine) machines.delete(machine.machineId);
        clearStreams(machine, 'machine', 'machine-offline');
      }
      const owner = machines.get(machineId);
      if (role === 'device' && owner?.session?.socket === socket) owner.session = null;
      if (role === 'device') clearStreams({ socket }, 'device', 'device-offline');
    });
    socket.on('error', () => {});
  });

  server.on('upgrade', (request, socket, head) => {
    let url;
    try { url = new URL(request.url, tls ? 'https://localhost' : 'http://localhost'); } catch { socket.destroy(); return; }
    if (url.pathname !== RELAY_PATH) { socket.write('HTTP/1.1 404 Not Found\r\n\r\n'); socket.destroy(); return; }
    if (request.headers.origin) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request, url));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => { server.off('error', reject); resolve(); });
  });
  const actualPort = server.address().port;
  const base = publicUrl || `ws://${host === '127.0.0.1' || host === '0.0.0.0' ? 'localhost' : host}:${actualPort}${RELAY_PATH}`;
  return {
    server, wss, adminToken, registrationSecret, publicUrl: base, port: actualPort,
    issueTicket(machineId, ttlMs = 120000) {
      const id = randomId(24); pendingTickets.set(id, { machineId, expiresAt: now() + ttlMs, used: false }); return { ticket:id, expiresAt:new Date(now()+ttlMs).toISOString() };
    },
    status() { return { running:true, protocol:PROTOCOL_VERSION, machines:[...machines.values()].map(machine => ({ machineId:machine.machineId, online:machine.socket.readyState===WebSocket.OPEN })), pendingTickets:pendingTickets.size }; },
    async close() {
      clearInterval(maintenance); clearInterval(heartbeat);
      for (const socket of wss.clients) socket.close(1001, 'server shutdown');
      wss.close();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

export { RELAY_PATH };
