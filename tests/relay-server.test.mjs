import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import {
  authToken,
  createHandshake,
  createMachineIdentity,
  deriveSessionKeys,
  handshakeProof,
  openJson,
  PROTOCOL_VERSION,
  randomId,
  sealJson,
  verifyHandshakeProof,
} from '../relay/protocol.mjs';
import { createRelayServer } from '../relay/server.mjs';

const registrationSecret = 'relay-test-registration-secret';
const machineId = '1'.repeat(32);
const runtimeId = '2'.repeat(32);

function verifyRelayProof(hello, machinePublicKey) {
  return verifyHandshakeProof({
    version:PROTOCOL_VERSION,
    machineId,
    runtimeId,
    machinePublicKey,
    machineFingerprint:hello.machineFingerprint,
    ephemeralPublicKey:hello.ephemeralPublicKey,
    nonce:hello.nonce,
  }, hello.signature);
}

async function relayFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'codex-relay-'));
  const dataFile = join(root, 'devices.json');
  const relay = await createRelayServer({ host:'127.0.0.1', port:0, registrationSecret, dataFile });
  t.after(async () => {
    await relay.close();
    await rm(root, { recursive:true, force:true });
  });
  return { relay, dataFile, url:`ws://127.0.0.1:${relay.port}/v1/relay` };
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
    async next(type, timeoutMs = 3000) {
      const found = messages.find(message => message.type === type);
      if (found) {
        messages.splice(messages.indexOf(found), 1);
        return found;
      }
      return new Promise((resolve, reject) => {
        const waiter = { type, resolve, reject };
        waiter.timer = setTimeout(() => { waiters.delete(waiter); reject(Error(`timeout waiting for ${type}`)); }, timeoutMs);
        waiters.add(waiter);
      });
    },
    async either(...types) {
      return new Promise((resolve, reject) => {
        const seen = new Set(types);
        const existing = messages.find(message => seen.has(message.type));
        if (existing) {
          messages.splice(messages.indexOf(existing), 1);
          resolve(existing);
          return;
        }
        const waiter = {
          type:'*', resolve:message => { clearTimeout(waiter.timer); resolve(message); },
          reject:error => { clearTimeout(waiter.timer); reject(error); },
          filter:message => seen.has(message.type),
        };
        waiter.timer = setTimeout(() => {
          waiters.delete(waiter);
          reject(Error(`timeout waiting for one of ${types.join(', ')}`));
        }, 3000);
        waiters.add(waiter);
      });
    },
    send(value) { socket.send(JSON.stringify(value)); },
  };
}

async function waitForFile(path, timeoutMs = 1500) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      await readFile(path);
      return;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  throw Error(`timed out waiting for ${path}`);
}

function waitForClose(socket, timeoutMs = 3000) {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('timed out waiting for websocket close')), timeoutMs);
    socket.once('close', () => { clearTimeout(timer); resolve(); });
  });
}

async function registerMachine(url, machine = createMachineIdentity()) {
  const client = open(url);
  await once(client.socket, 'open');
  const handshake = createHandshake(machine.publicKey, machineId, runtimeId);
  const ready = client.next('machine-ready');
  client.send({
    type:'register-machine', version:PROTOCOL_VERSION, machineId, runtimeId,
    auth:authToken(registrationSecret, machineId),
    hello:{
      ...handshake, privateKey:undefined,
      signature:handshakeProof(handshake, machine.privateKey),
    },
  });
  assert.equal((await ready).machineId, machineId);
  return { client, machine, handshake };
}

async function registerDevice(url, { ticket, credential = '', onMachineHello }) {
  const client = open(url);
  await once(client.socket, 'open');
  const response = client.either('device-ready', 'error');
  client.send({ type:'register-device', version:PROTOCOL_VERSION, machineId, ticket, credential });
  const ready = await response;
  if (onMachineHello && ready.type === 'device-ready') await onMachineHello(client, ready);
  return { client, ready };
}

async function openEncryptedSession(device, machine) {
  const ephemeral = createHandshake('ephemeral-placeholder', machineId, runtimeId);
  const sessionId = randomId(16);
  device.client.send({
    type:'device-hello', sessionId,
    ephemeralPublicKey:ephemeral.ephemeralPublicKey, nonce:ephemeral.nonce,
  });
  const relayed = await machine.client.next('device-hello');
  const activeSession = relayed.sessionId;
  assert.equal(activeSession, sessionId);
  machine.client.send({
    type:'device-hello', sessionId:activeSession,
    ephemeralPublicKey:machine.handshake.ephemeralPublicKey, nonce:machine.handshake.nonce,
  });
  const machineHello = await device.client.next('device-hello');
  assert.equal(machineHello.sessionId, activeSession);
  return {
    sessionId,
    deviceKeys:deriveSessionKeys(ephemeral.privateKey, machine.handshake.ephemeralPublicKey, machineId, machine.handshake.nonce, ephemeral.nonce, 'device'),
    machineKeys:deriveSessionKeys(machine.handshake.privateKey, ephemeral.ephemeralPublicKey, machineId, machine.handshake.nonce, ephemeral.nonce, 'machine'),
  };
}

test('relay health reports protocol without credentials', async t => {
  const f = await relayFixture(t);
  const response = await fetch(`http://127.0.0.1:${f.relay.port}/health`);
  const value = await response.json();
  assert.deepEqual(value, { ok:true, protocol:PROTOCOL_VERSION, machines:0 });
  assert.equal(JSON.stringify(value).includes(registrationSecret), false);
});

test('machine and device reach an encrypted session through a one-use ticket', async t => {
  const f = await relayFixture(t);
  const machine = await registerMachine(f.url);
  machine.client.send({ type:'mint-ticket', ttlMs:60000 });
  const issued = await machine.client.next('ticket-issued');
  assert.match(issued.ticket, /^[A-Za-z0-9_-]{24,80}$/);
  assert.ok(Date.parse(issued.expiresAt) > Date.now());

  const device = await registerDevice(f.url, { ticket:issued.ticket });
  assert.equal(device.ready.machineId, machineId);
  assert.match(device.ready.credential, /^[A-Za-z0-9_-]{24,80}$/);
  assert.equal(device.ready.machineHello.machinePublicKey, machine.machine.publicKey);
  assert.equal(verifyRelayProof(device.ready.machineHello, machine.machine.publicKey), true);
  const session = await openEncryptedSession(device, machine);
  const frame = sealJson(session.deviceKeys, { method:'GET', path:'/v1/state' }, 0);
  assert.deepEqual(openJson(session.machineKeys, frame, 0), { method:'GET', path:'/v1/state' });
  assert.equal(openJson(session.machineKeys, frame, 1), null);
  await waitForFile(f.dataFile);
  await rm(f.dataFile);
});

test('tickets are bound to one machine and single use; credentials persist by hash', async t => {
  const f = await relayFixture(t);
  const machine = await registerMachine(f.url);
  machine.client.send({ type:'mint-ticket', ttlMs:60000 });
  const issued = await machine.client.next('ticket-issued');
  const first = await registerDevice(f.url, { ticket:issued.ticket });
  assert.match(first.ready.credential, /^[A-Za-z0-9_-]{24,80}$/);
  await new Promise(resolve => setTimeout(resolve, 20));
  const stored = JSON.parse(await readFile(f.dataFile, 'utf8'));
  assert.equal(JSON.stringify(stored).includes(first.ready.credential), false);
  assert.equal(stored.devices.length, 1);

  const reused = await registerDevice(f.url, { ticket:issued.ticket });
  assert.equal(reused.ready.code, 'ticket-expired');
  const restored = await registerDevice(f.url, { credential:first.ready.credential });
  assert.equal(restored.ready.machineId, machineId);
});

test('ticket expiry and wrong machine are rejected', async t => {
  let current = 1_000_000;
  const relay = await createRelayServer({ host:'127.0.0.1', port:0, registrationSecret, now:() => current });
  t.after(() => relay.close());
  const url = `ws://127.0.0.1:${relay.port}/v1/relay`;
  const machine = await registerMachine(url);
  machine.client.send({ type:'mint-ticket', ttlMs:30000 });
  const issued = await machine.client.next('ticket-issued');
  current += 30_001;
  const expired = await registerDevice(url, { ticket:issued.ticket });
  assert.equal(expired.ready.code, 'ticket-expired');
  current += 1;
  const denied = open(url);
  await once(denied.socket, 'open');
  denied.send({
    type:'register-machine', version:PROTOCOL_VERSION,
    machineId:'3'.repeat(32), runtimeId:'4'.repeat(32),
    auth:authToken('wrong-secret', '3'.repeat(32)),
    hello:{},
  });
  assert.equal((await denied.next('error')).code, 'unauthorized');
  denied.socket.close();
  const mismatched = open(url);
  await once(mismatched.socket, 'open');
  const mismatchedResponse = mismatched.next('error');
  const crossMachineTicket = relay.issueTicket(machineId, 30000).ticket;
  mismatched.send({ type:'register-device', version:PROTOCOL_VERSION, machineId:'9'.repeat(32), ticket:crossMachineTicket });
  assert.equal((await mismatchedResponse).code, 'ticket-mismatch');
});

test('stream frames route only through the bound session and cleanup on close', async t => {
  const f = await relayFixture(t);
  const machine = await registerMachine(f.url);
  machine.client.send({ type:'mint-ticket' });
  const issued = await machine.client.next('ticket-issued');
  const device = await registerDevice(f.url, { ticket:issued.ticket });
  const session = await openEncryptedSession(device, machine);
  const id = randomId(24);
  device.client.send({ type:'stream-open', streamId:id });
  assert.equal((await machine.client.next('stream-open')).streamId, id);
  const frame = sealJson(session.deviceKeys, { method:'GET', path:'/v1/state' }, 0);
  device.client.send({ type:'stream-data', streamId:id, seq:0, bytes:frame.length, data:frame.toString('base64url') });
  assert.equal((await machine.client.next('stream-data')).seq, 0);
  device.client.send({ type:'stream-end', streamId:id, seq:0 });
  assert.equal((await machine.client.next('stream-end')).seq, 0);
  device.client.socket.close();
  machine.client.socket.close();
  await Promise.all([waitForClose(device.client.socket), waitForClose(machine.client.socket)]);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(f.relay.status().machines.length, 0);
});

test('unauthenticated and oversized websocket messages close the connection', async t => {
  const f = await relayFixture(t);
  const client = open(f.url);
  await once(client.socket, 'open');
  client.send({ type:'stream-open', streamId:randomId(24) });
  assert.equal((await client.next('error')).code, 'device-required');
  client.socket.send('x'.repeat(1024 * 1024 + 8192));
  await once(client.socket, 'close');
});
