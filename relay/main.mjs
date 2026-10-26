import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createRelayServer } from './server.mjs';

const arg = name => { const index = process.argv.indexOf(name); return index < 0 ? '' : process.argv[index + 1] || ''; };
const data = resolve(arg('--data') || '.local/relay');
const configPath = resolve(arg('--config') || `${data}/relay.local.json`);
await mkdir(dirname(configPath), { recursive:true });
let config;
try { config = JSON.parse(await readFile(configPath, 'utf8')); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  config = {
    host: arg('--host') || '127.0.0.1',
    port: Number(arg('--port') || 19647),
    adminToken: randomBytes(32).toString('hex'),
    registrationSecret: randomBytes(32).toString('hex'),
    publicUrl: arg('--public-url') || '',
  };
  const temporary = configPath + '.tmp';
  await writeFile(temporary, JSON.stringify(config, null, 2), { mode:0o600 }); await rename(temporary, configPath);
}
const relay = await createRelayServer(config);
console.log(JSON.stringify({ listening: `ws://${config.host}:${relay.port}/v1/relay`, health: `http://${config.host}:${relay.port}/health`, publicUrl: relay.publicUrl }));
const close = async () => { await relay.close(); process.exit(0); };
process.once('SIGINT', close); process.once('SIGTERM', close);
