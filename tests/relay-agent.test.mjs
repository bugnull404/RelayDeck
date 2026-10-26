import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { X509Certificate } from 'node:crypto';
import { WebSocket } from 'ws';
import { keytoolPath } from '../scripts/tool-locator.mjs';
import { createRelayServer } from '../relay/server.mjs';
import {
  createHandshake,
  createMachineIdentity,
  deriveSessionKeys,
  open as decrypt,
  PROTOCOL_VERSION,
  randomId,
  sealJson,
} from '../relay/protocol.mjs';
import { RelayAgent } from '../desktop/relay-agent.mjs';

const run = promisify(execFile);
const registrationSecret = 'relay-agent-test-registration-secret';
const machineId = 'a'.repeat(32);
const runtimeId = 'b'.repeat(32);

async function tlsFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'codex-relay-agent-tls-'));
  const pfx = join(root, 'gateway.p12');
  const certificate = join(root, 'gateway.crt');
  const password = 'relay-agent-test-password';
  await run(keytoolPath(), [
    '-genkeypair', '-alias', 'relay-agent', '-keyalg', 'RSA', '-validity', '2',
    '-dname', 'CN=localhost', '-ext', 'SAN=ip:127.0.0.1',
    '-storetype', 'PKCS12', '-keystore', pfx, '-storepass', password,
  ], { windowsHide:true });
  await run(keytoolPath(), [
    '-exportcert', '-alias', 'relay-agent', '-keystore', pfx,
    '-storepass', password, '-file', certificate,
  ], { windowsHide:true });
  t.after(() => rm(root, { recursive:true, force:true }));
  const certificateBytes = await readFile(certificate);
  return {
    tls:{ pfx:await readFile(pfx), passphrase:password },
    ca:new X509Certificate(certificateBytes).toString(),
  };
}

async function gatewayFixture(t, tls) {
  const requests = [];
  const server = https.createServer(tls, (request, response) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      requests.push({
        method: request.method,
        path: request.url,
        headers: request.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      response.writeHead(200, { 'content-type':'application/json', 'cache-control':'no-store' });
      response.end(JSON.stringify({ ok:true, version:7 }));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    return new Promise(resolve => server.close(resolve));
  });
  return { server, requests, base:`https://127.0.0.1:${server.address().port}` };
}

function open(url) {
  const socket = new WebSocket(url, { perMessageDeflate:false });
  const messages = [];
  const waiters = new Set();
  socket.on('message', raw => {
    const value = JSON.parse(String(raw));
    messages.push(value);
    for (const waiter of [...waiters]) {
      if (!waiter.type || waiter.type === value.type || waiter.filter?.(value)) {
        waiters.delete(waiter);
        clearTimeout(waiter.timer);
        waiter.resolve(value);
      }
    }
  });
  return {
    socket, messages,
    send(value) { socket.send(JSON.stringify(value)); },
    async next(type, timeoutMs = 3000) {
      const existing = messages.find(message => message.type === type);
      if (existing) {
        messages.splice(messages.indexOf(existing), 1);
        return existing;
      }
      return new Promise((resolve, reject) => {
        const waiter = { type, resolve };
        waiter.timer = setTimeout(() => {
          waiters.delete(waiter);
          reject(Error(`timeout waiting for ${type}`));
        }, timeoutMs);
        waiters.add(waiter);
      });
    },
  };
}

test('relay agent decrypts request sequence 0, authenticates to the local gateway, and returns a decryptable response', async t => {
  const { tls, ca } = await tlsFixture(t);
  const gateway = await gatewayFixture(t, tls);
  const relay = await createRelayServer({ host:'127.0.0.1', port:0, registrationSecret });
  t.after(() => relay.close());
  const relayUrl = `ws://127.0.0.1:${relay.port}/v1/relay`;
  const machine = { ...createMachineIdentity(), machineId };
  const agent = new RelayAgent({
    relayUrl,
    registrationSecret,
    machine,
    runtimeId,
    gatewayBase:gateway.base,
    upstreamCa:ca,
    reconnectDelays:[20],
  });
  t.after(() => agent.close());
  agent.connect();
  const readyUntil = Date.now() + 3000;
  while (!agent.status().connected && Date.now() < readyUntil) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(agent.status().connected, true);

  const issued = await agent.requestTicket(60000);
  const device = open(relayUrl);
  await once(device.socket, 'open');
  const ephemeral = createHandshake('ephemeral-placeholder', machineId, runtimeId);
  const sessionId = randomId(16);
  device.send({
    type:'register-device', version:PROTOCOL_VERSION, machineId,
    ticket:issued.ticket, sessionId,
  });
  const registration = await device.next('device-ready');
  assert.equal(registration.machineHello.machinePublicKey, machine.publicKey);

  device.send({
    type:'device-hello', sessionId,
    ephemeralPublicKey:ephemeral.ephemeralPublicKey, nonce:ephemeral.nonce,
  });
  const handshake = await device.next('device-hello');
  assert.equal(handshake.sessionId, sessionId);
  const deviceKeys = deriveSessionKeys(
    ephemeral.privateKey,
    handshake.ephemeralPublicKey,
    machineId,
    handshake.nonce,
    ephemeral.nonce,
    'device',
  );

  const streamId = randomId(24);
  const bearer = 'c'.repeat(64);
  const request = {
    method:'GET',
    path:'/v1/state?delta=1',
    headers:{ authorization:`Bearer ${bearer}`, 'x-ignored':'not-forwarded' },
  };
  const requestFrame = sealJson(deviceKeys, request, 0);
  device.send({ type:'stream-open', streamId });
  device.send({
    type:'stream-data', streamId, seq:0,
    bytes:requestFrame.length, data:requestFrame.toString('base64url'),
  });
  device.send({ type:'stream-end', streamId, seq:0 });
  const ready = await device.next('stream-ready', 5000).catch(error => {
    throw Error(error.message + ': ' + JSON.stringify(device.messages));
  });
  assert.equal(ready.streamId, streamId);

  const responseData = await device.next('stream-data', 5000).catch(error => {
    throw Error(error.message + ': ' + JSON.stringify(device.messages)
      + ' gateway=' + JSON.stringify(gateway.requests)
      + ' agent=' + JSON.stringify(agent.status()));
  });
  const responseEnd = await device.next('stream-end');
  assert.equal(responseEnd.seq, 0);
  const envelope = JSON.parse(decrypt(
    deviceKeys,
    Buffer.from(responseData.data, 'base64url'),
    responseData.seq,
  ).toString('utf8'));
  assert.equal(envelope.status, 200);
  assert.deepEqual(JSON.parse(Buffer.from(envelope.body, 'base64url').toString('utf8')), {
    ok:true,
    version:7,
  });
  assert.equal(gateway.requests.length, 1);
  assert.equal(gateway.requests[0].path, '/v1/state?delta=1');
  assert.equal(gateway.requests[0].headers.authorization, `Bearer ${bearer}`);
  assert.equal(gateway.requests[0].headers['x-ignored'], undefined);
  assert.equal(JSON.stringify(registration).includes(bearer), false);
});
