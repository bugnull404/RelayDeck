import { spawn } from 'node:child_process';
import { ensureManager, adminCall } from './client.mjs';
const endpoint = await ensureManager(); const { url } = await adminCall(endpoint, '/api/settings-url');
if (process.argv.includes('--print')) console.log(url);
else { const child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { windowsHide: true, stdio: 'ignore' }); child.unref(); }
