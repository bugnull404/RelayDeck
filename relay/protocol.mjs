import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  sign,
  verify,
} from 'node:crypto';

export const PROTOCOL_VERSION = 1;
export const RELAY_PATH = '/v1/relay';
export const MAX_FRAME_BYTES = 1024 * 1024;
// File responses are base64 encoded inside the encrypted JSON envelope. Keep
// enough room for a 32 MiB gateway file plus envelope and Base64 overhead.
export const MAX_STREAM_BYTES = 48 * 1024 * 1024;
export const MAX_STREAMS_PER_CONNECTION = 6;
export const STREAM_IDLE_MS = 40000;

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const CURVE = 'prime256v1';

export function randomId(bytes = 16) {
  return randomBytes(bytes).toString('base64url');
}

export function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function encode(value) {
  return JSON.stringify(value);
}

export function parse(value) {
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function createMachineIdentity() {
  const pair = generateKeyPairSync('ec', { namedCurve: CURVE });
  const publicKey = pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url');
  const privateKey = pair.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64url');
  return { publicKey, privateKey, fingerprint: digest(pair.publicKey.export({ format: 'der', type: 'spki' })) };
}

export function machineFingerprint(publicKey) {
  const value = String(publicKey);
  const bytes = /^[a-f0-9]{64}$/i.test(value) ? Buffer.from(value, 'hex') : Buffer.from(value, 'base64url');
  if (!bytes.length || bytes.length > 256) throw Error('电脑公钥格式无效');
  return digest(bytes);
}

export function createHandshake(machinePublicKey, machineId, runtimeId) {
  const ephemeral = generateKeyPairSync('ec', { namedCurve: CURVE });
  const publicKey = ephemeral.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url');
  return {
    version: PROTOCOL_VERSION,
    machineId,
    runtimeId,
    machinePublicKey,
    machineFingerprint: machineFingerprint(machinePublicKey),
    ephemeralPublicKey: publicKey,
    nonce: randomBytes(24).toString('base64url'),
    privateKey: ephemeral.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64url'),
  };
}

export function handshakeProof(handshake, privateKey) {
  const key = typeof privateKey === 'string' ? createPrivateKey({
    key: Buffer.from(privateKey, 'base64url'), format:'der', type:'pkcs8',
  }) : privateKey;
  return sign('sha256', Buffer.from(handshakeMessage(handshake)), {
    key,
    ...(typeof privateKey === 'string' ? { format:'der', type:'pkcs8' } : {}),
  }).toString('base64url');
}

export function verifyHandshakeProof(handshake, proof) {
  try {
    return verify('sha256', Buffer.from(handshakeMessage(handshake)), {
      key: Buffer.from(handshake.machinePublicKey, 'base64url'),
      format: 'der',
      type: 'spki',
    }, Buffer.from(proof, 'base64url'));
  } catch {
    return false;
  }
}

export function exportPublicKey(privateKey) {
  try {
    return createPublicKey(Buffer.from(String(privateKey), 'base64url'), { format:'der', type:'pkcs8' })
      .export({ format:'der', type:'spki' }).toString('base64url');
  } catch {
    return '';
  }
}

export function parsePublicKey(publicKey) {
  return createPublicKey({
    key: Buffer.from(String(publicKey), 'base64url'),
    format: 'der',
    type: 'spki',
  });
}

function handshakeMessage(handshake) {
  return [
    'relaydeck-relay-v1',
    handshake.version,
    handshake.machineId,
    handshake.runtimeId,
    handshake.machinePublicKey,
    handshake.ephemeralPublicKey,
    handshake.nonce,
  ].join('\n');
}

export function sessionKeys(privateKey, peerPublicKey, machineId, nonce, side, sideNonce = '') {
  const secret = diffieHellman({
    privateKey: Buffer.from(privateKey, 'base64url'),
    format: 'der',
    type: 'pkcs8',
  }, {
    publicKey: Buffer.from(peerPublicKey, 'base64url'),
    format: 'der',
    type: 'spki',
  });
  const material = Buffer.from(hkdfSync('sha256', secret, Buffer.from(nonce, 'base64url'), encoder.encode('relaydeck-relay:' + machineId + ':' + sideNonce), 64));
  const deviceToMachine = material.subarray(0, 32);
  const machineToDevice = material.subarray(32, 64);
  return side === 'machine'
    ? { send: machineToDevice, receive: deviceToMachine }
    : { send: deviceToMachine, receive: machineToDevice };
}

export function deriveSessionKeys(privateKey, peerPublicKey, machineId, machineNonce, deviceNonce, side) {
  const secret = diffieHellman({
    privateKey: typeof privateKey === 'string' ? createPrivateKey({
      key:Buffer.from(privateKey, 'base64url'), format:'der', type:'pkcs8',
    }) : privateKey,
    publicKey: createPublicKey({ key:Buffer.from(peerPublicKey, 'base64url'), format:'der', type:'spki' }),
  });
  const order = machineNonce < deviceNonce;
  const first = order ? machineNonce : deviceNonce;
  const second = order ? deviceNonce : machineNonce;
  const material = Buffer.from(hkdfSync('sha256', secret, Buffer.from(first + ':' + second), encoder.encode('relaydeck-relay:' + machineId), 64));
  const deviceToMachine = material.subarray(0, 32), machineToDevice = material.subarray(32, 64);
  return side === 'machine'
    ? { send:machineToDevice, receive:deviceToMachine }
    : { send:deviceToMachine, receive:machineToDevice };
}

export function seal(keys, plaintext, sequence) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keys.send, nonce);
  cipher.setAAD(Buffer.from(`relaydeck-relay-v1:${sequence}`));
  const body = Buffer.concat([cipher.update(Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext)), cipher.final()]);
  return Buffer.concat([Buffer.from([1]), nonce, body, cipher.getAuthTag()]);
}

export function open(keys, frame, sequence) {
  if (!Buffer.isBuffer(frame) || frame.length < 1 + 12 + 16 || frame[0] !== 1) throw Error('Relay 数据帧格式无效');
  const nonce = frame.subarray(1, 13);
  const decipher = createDecipheriv('aes-256-gcm', keys.receive, nonce);
  decipher.setAAD(Buffer.from(`relaydeck-relay-v1:${sequence}`));
  decipher.setAuthTag(frame.subarray(frame.length - 16));
  try {
    return Buffer.concat([decipher.update(frame.subarray(13, frame.length - 16)), decipher.final()]);
  } catch {
    throw Error('Relay 数据帧校验失败');
  }
}

export function sealJson(keys, value, sequence) {
  return seal(keys, encoder.encode(encode(value)), sequence);
}

export function openJson(keys, frame, sequence) {
  try {
    return parse(decoder.decode(open(keys, frame, sequence)));
  } catch {
    return null;
  }
}

export function authToken(secret, machineId) {
  return machineFingerprint(Buffer.from(String(secret) + ':' + machineId));
}
