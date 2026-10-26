import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { adminCall } from '../desktop/client.mjs';
const plugin = process.argv[2]; if (!plugin) throw Error('Pass the installed plugin directory');
const dataDirectory = await mkdtemp(join(tmpdir(), 'relaydeck-verify-'));
const manifest = JSON.parse(await readFile(join(plugin, '.codex-plugin', 'plugin.json'), 'utf8'));
const hashes = JSON.parse((await readFile(join(plugin, 'dependency-hashes.json'), 'utf8')).replace(/^\uFEFF/, ''));
const report = { checkedAt: new Date().toISOString(), scope: 'installed local plugin, MCP stdio, loopback settings and bundled versions; no model task', checks: {} };
report.checks.manifest = manifest.name === 'relaydeck-desktop';
report.checks.settingsQuickAction = manifest.interface?.defaultPrompt?.some(prompt=>/打开\s*RelayDeck\s*设置/.test(prompt)) === true;
report.checks.settingsSetupEntry = manifest.extensions?.['com.openai']?.onboardingSkill === './skills/phone-settings/SKILL.md';
report.checks.packagedSettingsSkill = (await readFile(join(plugin,'skills/phone-settings/SKILL.md'),'utf8')).includes('open_phone_settings');
for (const [name, expected] of Object.entries(hashes)) {
  const path = join(plugin, name === 'node.exe' ? 'runtime' : 'vendor/easytier', name);
  report.checks['hash:' + name] = createHash('sha256').update(await readFile(path)).digest('hex') === expected;
}
const child = spawn(join(plugin, 'runtime', 'node.exe'), [join(plugin, 'desktop', 'mcp.mjs')], {
  windowsHide: true,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, RELAYDECK_DATA_DIR: dataDirectory, RELAYDECK_MANAGER_PORT: '0' },
});
child.stderr.resume(); const pending = new Map(); let sequence = 0;
const lines = createInterface({ input: child.stdout });
lines.on('line', line => { const value = JSON.parse(line), entry = pending.get(value.id); if (!entry) return; clearTimeout(entry.timer); pending.delete(value.id); value.error ? entry.reject(Error(value.error.message)) : entry.resolve(value.result); });
function request(method, params) { return new Promise((resolve, reject) => { const id = ++sequence; const timer = setTimeout(() => { pending.delete(id); reject(Error('MCP timeout')); }, 30000); pending.set(id, { resolve, reject, timer }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); }); }
try {
  const initialized = await request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'local-plugin-test', version: '1' } });
  report.checks.initialize = initialized.serverInfo.name === 'relaydeck-desktop';
  const list = await request('tools/list', {}); report.checks.fourBoundedTools = list.tools.length === 4;
  const opened = await request('tools/call', { name: 'open_phone_settings', arguments: {} });
  if (opened.isError) throw Error(opened.content[0].text);
  const openedValue = JSON.parse(opened.content[0].text); const url = new URL(openedValue.settingsUrl);
  report.checks.loopbackSettings = url.hostname === '127.0.0.1' && url.protocol === 'http:';
  const endpoint = { origin: url.origin, token: url.hash.slice(1) };
  const status = await adminCall(endpoint, '/api/status'); report.checks.managerIdentity = status.kind === 'relaydeck-manager';
  report.checks.noSecretInPublicConfig = !Object.hasOwn(status.config || {}, 'secretCipher') && !Object.hasOwn(status.config || {}, 'networkSecret');
  report.checks.noExternalEasyTierOwnership = status.easytier.owned === false;
  const html = await fetch(url.origin); report.checks.settingsPage = html.status === 200 && (await html.text()).includes('RelayDeck');
  const qr = await fetch(url.origin + '/qrcode.js'); report.checks.qrAsset = qr.status === 200;
  await adminCall(endpoint, '/api/shutdown', {});
} catch (error) { report.error = error.message; }
finally {
  child.stdin.end(); lines.close(); child.kill();
  for (const entry of pending.values()) clearTimeout(entry.timer);
  await new Promise(resolve => setTimeout(resolve, 300));
  await rm(dataDirectory, { recursive: true, force: true }).catch(() => {});
}
report.passed = !report.error && Object.values(report.checks).every(Boolean);
await writeFile('.local/verification/desktop-plugin.local.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); if (!report.passed) process.exitCode = 1;

