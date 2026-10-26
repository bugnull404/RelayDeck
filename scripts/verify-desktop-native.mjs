import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createServer } from 'node:https';
import { GatewayRuntime } from '../desktop/runtime.mjs';
import { run } from '../desktop/config.mjs';
const root = resolve('.local/verification/plugin-certificate-smoke'); await mkdir(root, { recursive: true });
const runtime = new GatewayRuntime(root);
await runtime.prepareIdentity();
const server = createServer(runtime.tls);
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
await new Promise(resolve => server.close(resolve));
const release = JSON.parse(await readFile(new URL('../release.json', import.meta.url), 'utf8'));
const bin = resolve(`.local/releases/relaydeck-desktop-${release.version}/plugins/relaydeck-desktop/vendor/easytier`);
const { stdout: version } = await run(join(bin, 'easytier-core.exe'), ['--version'], { windowsHide: true });
// Check a separate local-only config without creating any TUN, listeners,
// managed instances, or contacting the user's existing EasyTier RPC.
const config = join(root, 'easytier-check.toml');
await writeFile(config, 'instance_name = "relaydeck-static-check"\nipv4 = "192.168.253.2/24"\nlisteners = []\nrpc_portal = "127.0.0.1:15899"\n[network_identity]\nnetwork_name = "relaydeck-static-check"\nnetwork_secret = ""\n');
await run(join(bin, 'easytier-core.exe'), ['--config-file', config, '--check-config', '--instance-name', 'relaydeck-static-check', '--hostname', 'relaydeck-static-check', '--network-name', 'relaydeck-static-check', '--ipv4', '192.168.253.2/24', '--dev-name', 'relaydeck-et', '--listeners', 'tcp://127.0.0.1:11011', '--rpc-portal', '127.0.0.1:15899', '--peers', 'tcp://127.0.0.1:11012', '--console-log-level', 'error', '--file-log-level', 'off'], { windowsHide: true, timeout: 15000 });
const report = { checkedAt: new Date().toISOString(), newWindowsCertificateAndNodeTls: true, easytierVersion: version.trim(), easytierConfigCheck: true, existingNetworkModified: false, actualBundledTunOrUserPeeringTested: false };
await writeFile('.local/verification/desktop-native.local.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
