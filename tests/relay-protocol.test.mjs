import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authToken,
  createHandshake,
  createMachineIdentity,
  deriveSessionKeys,
  handshakeProof,
  machineFingerprint,
  openJson,
  parsePublicKey,
  sealJson,
  verifyHandshakeProof,
} from '../relay/protocol.mjs';

const machineId = 'a'.repeat(32);
const runtimeId = 'b'.repeat(32);

function sessionFixture() {
  const machine = createMachineIdentity();
  const machineHandshake = createHandshake(machine.publicKey, machineId, runtimeId);
  const deviceEphemeral = createHandshake('placeholder', machineId, runtimeId);
  const machineKeys = deriveSessionKeys(
    machineHandshake.privateKey,
    deviceEphemeral.ephemeralPublicKey,
    machineId,
    machineHandshake.nonce,
    deviceEphemeral.nonce,
    'machine',
  );
  const deviceKeys = deriveSessionKeys(
    deviceEphemeral.privateKey,
    machineHandshake.ephemeralPublicKey,
    machineId,
    machineHandshake.nonce,
    deviceEphemeral.nonce,
    'device',
  );
  return { machineHandshake, deviceEphemeral, machineKeys, deviceKeys };
}

test('relay handshake is bound to the machine key and exact fields', () => {
  const machine = createMachineIdentity();
  const handshake = createHandshake(machine.publicKey, machineId, runtimeId);
  const proof = handshakeProof(handshake, machine.privateKey);
  assert.equal(machineFingerprint(machine.publicKey), machine.fingerprint);
  assert.equal(verifyHandshakeProof(handshake, proof), true);
  assert.equal(verifyHandshakeProof({ ...handshake, runtimeId: 'c'.repeat(32) }, proof), false);
  assert.throws(() => parsePublicKey('not-a-public-key'));
});

test('device and machine derive reciprocal session keys', () => {
  const { machineKeys, deviceKeys } = sessionFixture();
  assert.deepEqual(machineKeys.send, deviceKeys.receive);
  assert.deepEqual(machineKeys.receive, deviceKeys.send);
});

test('AES-GCM frames use directionality and sequence as authenticated data', () => {
  const { machineKeys, deviceKeys } = sessionFixture();
  const request = { method: 'GET', path: '/v1/state?delta=1' };
  const frame = sealJson(deviceKeys, request, 0);
  assert.deepEqual(openJson(machineKeys, frame, 0), request);
  assert.equal(openJson(machineKeys, frame, 1), null);
  assert.equal(openJson(deviceKeys, frame, 0), null);
  assert.equal(openJson(machineKeys, frame.subarray(0, 20), 0), null);
});

test('machine registration auth changes with machine ID and never exposes the secret', () => {
  const secret = 'registration-secret';
  const first = authToken(secret, machineId);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, authToken(secret, 'c'.repeat(32)));
  assert.notEqual(first, authToken('other-secret', machineId));
  assert.equal(first.includes(secret), false);
});
