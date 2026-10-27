import { randomBytes, randomUUID, X509Certificate } from 'node:crypto';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, appendFile } from 'node:fs/promises';
import { DesktopBridge } from '../server/desktop-bridge.mjs';
import { HistoryReader } from '../server/history-reader.mjs';
import { ChatCreator } from '../server/chat-creator.mjs';
import { createGateway } from '../server/gateway.mjs';
import { atomicJson, readJson, addresses, dpapi } from './config.mjs';
import { createRelayServer } from '../relay/server.mjs';
import { createMachineIdentity, exportPublicKey } from '../relay/protocol.mjs';
import { createRelayAgent } from './relay-agent.mjs';
import { desktopVersion } from './version.mjs';
const here = dirname(fileURLToPath(import.meta.url));
async function createCertificate(input) {
  return new Promise((resolve, reject) => {
    const windowsPowerShell = join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0');
    const child = spawn(join(windowsPowerShell, 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(here, 'create-certificate.ps1')],
      { windowsHide: true, env: { ...process.env, PSModulePath: join(windowsPowerShell, 'Modules') }, stdio: ['pipe', 'ignore', 'pipe'] });
    let stage = ''; child.stderr.on('data', bytes => { const match = /CERTIFICATE_ERROR:([a-z-]+):([a-zA-Z0-9_.,:-]+)/.exec(bytes.toString()); if (match) stage = match[1] + ':' + match[2]; });
    child.stdin.on('error', () => {});
    const timer = setTimeout(() => { child.kill(); reject(Error('证书生成超时')); }, 30000);
    child.on('error', () => { clearTimeout(timer); reject(Error('无法启动 Windows 证书工具')); });
    child.on('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(Error('Windows 证书生成失败' + (stage ? '（' + stage + '）' : ''))); });
    child.stdin.end(JSON.stringify(input));
  });
}
export class GatewayRuntime {
  constructor(root) { this.root = root; this.active = null; this.localRelay = null; }
  async prepareIdentity() {
    const secrets = join(this.root, 'secrets'); await mkdir(secrets, { recursive: true, mode: 0o700 });
    const identityPath = join(secrets, 'gateway-identity.local.json');
    let identity = await readJson(identityPath, null);
    const pfx = join(secrets, 'gateway.p12'), certificate = join(secrets, 'gateway.crt');
    if (!identity) {
      // Do not silently replace a partial pre-existing identity.
      if (await readFile(pfx).then(() => true, () => false)) throw Error('证书存在但身份配置缺失，请先修复数据目录');
      identity = { deviceId: randomUUID(), password: randomBytes(32).toString('hex') };
      await createCertificate({ pfx, certificate, password: identity.password }); await atomicJson(identityPath, identity);
    }
    const cert = new X509Certificate(await readFile(certificate));
    this.identity = { ...identity, fingerprint: cert.fingerprint256.replaceAll(':', '').toLowerCase() };
    this.tls = { pfx: await readFile(pfx), passphrase: identity.password };
  }
  async prepareRelayIdentity() {
    const secrets = join(this.root, 'secrets');
    const identityPath = join(secrets, 'relay-machine.local.json');
    let stored = await readJson(identityPath, null);
    if (!stored) {
      const created = createMachineIdentity();
      const machineId = created.fingerprint.slice(0, 32);
      stored = { machineId, publicKey:created.publicKey, privateKeyCipher:await dpapi(created.privateKey), fingerprint:created.fingerprint };
      await atomicJson(identityPath, stored);
    }
    if (!/^[a-f0-9]{64}$/.test(String(stored.fingerprint || '')) || !/^[A-Za-z0-9_-]{16,80}$/.test(String(stored.machineId || ''))) throw Error('Relay 机器身份配置无效');
    const privateKey = await dpapi(stored.privateKeyCipher, true);
    if (exportPublicKey(privateKey) !== stored.publicKey) throw Error('Relay 机器私钥与公钥不匹配');
    this.relayMachine = { machineId:stored.machineId, publicKey:stored.publicKey, privateKey, fingerprint:stored.fingerprint };
    return this.relayMachine;
  }
  async candidate(config) {
    const relay = config.mode === 'relay';
    if (!relay && !addresses().some(row => row.address === config.host)) throw Error('远控 IP 尚未出现在本机网卡；请先连接组网或调整地址');
    const devicesPath = join(this.root, 'secrets', 'devices.local.json');
    const devices = await readJson(devicesPath, []);
    const historyReader = config.codexBinary ? new HistoryReader(config.codexBinary) : undefined;
    const bridge = new DesktopBridge(config.threads, { historyReader,backgroundHistoryReader:config.codexBinary?new HistoryReader(config.codexBinary):undefined, allowSelectedChats: config.allowSelectedChats,chatCreator:config.codexBinary?new ChatCreator(config.codexBinary):undefined });
    const connectionAddresses = relay
      ? { primary:config.relay.publicUrl, relay:config.relay.publicUrl }
      : { primary:`https://${config.host}:${config.port}`, ...(config.lanHost ? {lan:`https://${config.lanHost}:${config.port}`} : {}) };
    const gateway = createGateway({ tls: this.tls, bridge, desktopVersion, deviceId: this.identity.deviceId, deviceName: config.name, connectionAddresses, devices, saveDevices: value => atomicJson(devicesPath, value) });
    const servers=[gateway.server];
    gateway.server.on('controlAction', event => { void appendFile(join(this.root, 'actions.local.jsonl'), JSON.stringify(event) + '\n', { mode: 0o600 }).catch(() => {}); });
    try {
      await new Promise((resolve, reject) => { gateway.server.once('error', reject); gateway.server.listen(config.port, config.host, resolve); });
      if(config.lanHost && config.lanHost!==config.host){const lan=gateway.createListener();servers.push(lan);await new Promise((resolve,reject)=>{lan.once('error',reject);lan.listen(config.port,config.lanHost,resolve);});}
    } catch (error) {
      bridge.close();
      for (const server of servers) { server.closeAllConnections(); server.close(); }
      const detail = error.code === 'EADDRINUSE'
        ? `端口 ${config.host}:${config.port} 已被其他程序占用，请改用其他端口`
        : error.code === 'EADDRNOTAVAIL'
          ? `地址 ${config.host} 已不在本机网卡上，请重新选择网卡`
          : error.code === 'EACCES'
            ? `没有权限监听 ${config.host}:${config.port}，请改用 1024 以上端口或授予权限`
            : '无法监听远控地址，请检查端口占用和网卡状态';
      throw Error(detail);
    }
    let relayAgent = null;
    if (relay) {
      try {
        const machine = await this.prepareRelayIdentity();
        const registrationSecret = config.relayRegistrationSecret;
        if (!registrationSecret) throw Error('缺少 Relay 注册密钥，请重新保存 Relay 配置');
        relayAgent = createRelayAgent({
          relayUrl:config.relay.url,
          registrationSecret,
          machine,
          runtimeId:this.identity.deviceId.replaceAll('-', ''),
          gatewayBase:`https://${config.host}:${config.port}`,
          upstreamCa:new X509Certificate(await readFile(join(this.root, 'secrets', 'gateway.crt'))).toString(),
        });
        relayAgent.connect();
        if (config.autoStart) {
          const waitUntil = Date.now() + 12000;
          while (!relayAgent.status().connected && Date.now() < waitUntil) await new Promise(resolve => setTimeout(resolve, 100));
          if (!relayAgent.status().connected && relayAgent.status().state !== 'reconnecting') throw Error(relayAgent.status().error || '无法连接 Relay');
        }
      } catch (error) {
        bridge.close();
        for(const server of servers){server.closeAllConnections();server.close();}
        throw error;
      }
    }
    void bridge.connect();
    return { config, gateway, bridge, servers, relayAgent };
  }
  async start(config) {
    if (!this.identity) await this.prepareIdentity();
    const prior = this.active;
    if (prior && JSON.stringify(prior.config) === JSON.stringify(config)) return this.status();
    const needsLocalRelay = config.mode === 'relay' && config.relay.local === true;
    const ensureLocalRelay = async () => {
      if (!needsLocalRelay || this.localRelay) return;
      const localConfig = await readJson(join(this.root, 'relay', 'relay.local.json'), null);
      if (!localConfig) throw Error('本机 Relay 尚未初始化；请先生成并保存 Relay 配置');
      localConfig.registrationSecret = localConfig.registrationSecret || config.relayRegistrationSecret;
      this.localRelay = await createRelayServer(localConfig);
    };
    await ensureLocalRelay();
    // Keep the current gateway alive until the replacement is fully listening.
    // candidate() requires a free port, so any same-port change must stop the
    // old gateway first. stop() also closes the local relay, so recreate it.
    if (prior && prior.config.port === config.port) {
      await this.stop();
      await ensureLocalRelay();
      try { this.active = await this.candidate(config); }
      catch (error) {
        this.active = await this.candidate(prior.config).catch(() => null);
        throw error;
      }
    } else {
      const next = await this.candidate(config); await this.stop(); this.active = next;
    }
    return this.status();
  }
  status() {
    const active = this.active;
    return { running: !!active, mode: active?.config.mode || null,
      address: active ? (active.config.mode === 'relay' ? active.config.relay.publicUrl : `https://${active.config.host}:${active.config.port}`) : null,
      lanAddress: active?.config.lanHost ? `https://${active.config.lanHost}:${active.config.port}` : null,
      fingerprint: this.identity?.fingerprint, deviceId: this.identity?.deviceId,
      relay: active?.relayAgent?.status?.() || null,
      localRelay: this.localRelay ? { running:true, machineId:this.relayMachine?.machineId || null, machineFingerprint:this.relayMachine?.fingerprint || null } : { running:false },
      chats: active?.bridge.snapshot().map(row => ({ id: row.id, name: row.name, ready: row.ready, writable: row.writable })) || [],
      devices: active?.gateway.listDevices() || [] };
  }
  async pairing(rotate = false) {
    if (!this.active) throw Error('请先启动 RelayDeck 服务');
    const gateway = this.active.gateway; if (rotate) gateway.rotatePairing();
    const base = { address: this.status().address, fingerprint: this.identity.fingerprint, code: gateway.pairingCode, expiresAt: new Date(gateway.pairingUntil).toISOString() };
    if (this.active.config.mode !== 'relay') return base;
    const agent = this.active.relayAgent;
    if (!agent) throw Error('Relay Agent 尚未启动');
    const issued = await agent.requestTicket(120000);
    return {
      ...base,
      expiresAt:issued.expiresAt,
      networkMode:'relay',
      relay:{
        url:this.active.config.relay.publicUrl,
        machineId:agent.machineId,
        machinePublicKey:agent.machine.publicKey,
        machineFingerprint:agent.machine.fingerprint,
        ticket:issued.ticket,
        ticketExpiresAt:issued.expiresAt,
      },
    };
  }
  async stop() {
    const active = this.active; if (!active) return;
    this.active = null; active.relayAgent?.close(); active.bridge.close();
    await Promise.all(active.servers.map(server=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));}));
    if (this.localRelay) { const local = this.localRelay; this.localRelay = null; await local.close(); }
  }
}

