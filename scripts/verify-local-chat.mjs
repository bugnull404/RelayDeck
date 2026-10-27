// Real app-server verification for RelayDeck's local Codex chat path.
// Creates one clearly named persistent test thread in a temporary directory.
// There is no public thread/delete method, so the report includes its ID.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const [binary, output] = process.argv.slice(2);
if (!binary) throw new Error('Usage: node scripts/verify-local-chat.mjs <desktop codex.exe> [output.json]');

class Client {
  constructor(file) {
    this.child = spawn(file, ['app-server', '--listen', 'stdio://'], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.sequence = 0;
    this.pending = new Map();
    this.notifications = [];
    this.lines = createInterface({ input: this.child.stdout });
    this.child.stdin.on('error', () => {});
    this.child.stderr.on('data', () => {});
    this.child.on('error', error => this.rejectAll(error));
    this.child.on('exit', () => this.rejectAll(new Error('app-server exited')));
    this.lines.on('line', line => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.method && message.id !== undefined) {
        this.child.stdin.write(JSON.stringify({
          id: message.id,
          error: { code: -32601, message: 'Read-only verification client' },
        }) + '\n');
        return;
      }
      if (message.method) {
        this.notifications.push(message.method);
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        const error = new Error(typeof message.error.message === 'string' ? message.error.message : 'request failed');
        error.code = message.error.code;
        pending.reject(error);
      } else {
        pending.resolve(message.result);
      }
    });
  }

  rejectAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  request(method, params = {}) {
    return new Promise((resolveRequest, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('request timeout'));
      }, 30000);
      this.pending.set(id, { resolve: resolveRequest, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }

  notify(method) {
    this.child.stdin.write(JSON.stringify({ method }) + '\n');
  }

  async close() {
    if (this.child.exitCode !== null) return;
    this.child.stdin.end();
    this.lines.close();
    await new Promise(resolveClose => {
      const timer = setTimeout(() => { this.child.kill(); resolveClose(); }, 1500);
      this.child.once('exit', () => { clearTimeout(timer); resolveClose(); });
    });
  }
}

function text(input) {
  return (Array.isArray(input) ? input : [])
    .flatMap(item => item?.type === 'text' ? [String(item.text || '')] : [])
    .join('');
}

function waitForRun(client, threadId) {
  return new Promise((resolveRun, reject) => {
    const timer = setTimeout(() => {
      client.child.stdout.removeListener('data', check);
      reject(new Error('turn completion timeout'));
    }, 120000);
    let raw = '';
    const check = chunk => {
      raw += chunk.toString();
      const lines = raw.split('\n');
      raw = lines.pop() || '';
      for (const line of lines) {
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.id !== undefined) continue;
        if (message.method === 'turn/completed' && message.params?.threadId === threadId) {
          clearTimeout(timer);
          client.child.stdout.removeListener('data', check);
          resolveRun({ turnId: message.params.turn?.id, status: message.params.turn?.status });
        }
        if (message.method === 'error' && message.params?.threadId === threadId) {
          clearTimeout(timer);
          client.child.stdout.removeListener('data', check);
          reject(new Error(String(message.params.message || 'turn failed')));
        }
      }
    };
    client.child.stdout.on('data', check);
  });
}

const report = {
  checkedAt: new Date().toISOString(),
  scope: 'one persistent RelayDeck test thread in a temporary cwd; no existing threads modified',
  ok: false,
};
let client;
try {
  const cwd = await mkdtemp(join(tmpdir(), 'relaydeck-local-chat-verify-'));
  report.temporaryCwd = cwd;
  client = new Client(binary);
  const initialized = await client.request('initialize', {
    clientInfo: { name: 'relaydeck_local_chat_verify', version: '0.1.0' },
    capabilities: { experimentalApi: true },
  });
  report.server = initialized.userAgent;
  client.notify('initialized');

  const created = await client.request('thread/start', {
    cwd,
    ephemeral: false,
    historyMode: 'paginated',
    threadSource: 'relaydeck',
    approvalPolicy: 'never',
    approvalsReviewer: 'user',
  });
  const threadId = created.thread?.id;
  if (!/^[a-f0-9-]{36}$/.test(threadId || '')) throw new Error('invalid thread id');
  report.threadId = threadId;
  await client.request('thread/name/set', {
    threadId,
    name: 'RelayDeck verification (temporary)',
  });

  const completion = waitForRun(client, threadId);
  const started = await client.request('turn/start', {
    threadId,
    input: [{ type: 'text', text: 'Reply with exactly OK. Do not use tools.' }],
  });
  report.turnId = started.turn?.id;
  const completed = await completion;
  report.turnCompleted = completed.status === 'completed';
  report.notifications = [...new Set(client.notifications)].filter(name => [
    'turn/started',
    'turn/completed',
    'item/started',
    'item/completed',
    'item/agentMessage/delta',
  ].includes(name));

  const turns = await client.request('thread/turns/list', {
    threadId,
    limit: 50,
    sortDirection: 'asc',
    itemsView: 'full',
  });
  const turn = (turns.data || []).find(value => value.id === completed.turnId);
  report.historyFound = !!turn;
  report.inputPersisted = text(turn?.items?.find(item => item.type === 'userMessage')?.content) ===
    'Reply with exactly OK. Do not use tools.';
  report.agentReplyFound = (turn?.items || []).some(item => item.type === 'agentMessage' && item.text);

  await client.request('thread/unsubscribe', { threadId });
  const resumed = await client.request('thread/resume', { threadId, excludeTurns: true });
  report.resumed = resumed.thread?.id === threadId;
  await client.request('thread/unsubscribe', { threadId });
  report.ok = report.turnCompleted && report.historyFound && report.inputPersisted &&
    report.agentReplyFound && report.resumed;
} catch (error) {
  report.errorCode = error.code ?? null;
  report.errorMessage = String(error.message || '').slice(0, 1000);
} finally {
  await client?.close();
}

if (output) {
  const path = resolve(output);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
