import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalChatRuntime } from '../server/local-chat.mjs';

const THREAD_ID = '11111111-1111-4111-8111-111111111111';

class FakeChild extends EventEmitter {
  constructor(server, { failInitialize = false, exitAfterInitialize = false } = {}) {
    super();
    this.server = server;
    this.failInitialize = failInitialize;
    this.exitAfterInitialize = exitAfterInitialize;
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.stdin = new PassThrough();
    this.stdin.setEncoding('utf8');
    this.stdin.on('data', chunk => this.consume(chunk));
  }

  send(value) {
    this.stdout.write(JSON.stringify(value) + '\n');
  }

  consume(chunk) {
    for (const line of chunk.split('\n')) {
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      this.server.receive(this, message);
    }
  }

  kill() {
    this.exitCode = 0;
    this.emit('exit', 0);
  }
}

function fakeServer({ failInitialize = false, failResume = false, exitAfterInitialize = false } = {}) {
  const calls = [];
  const children = [];
  const spawn = () => {
    const child = new FakeChild(server, { failInitialize, exitAfterInitialize });
    children.push(child);
    return child;
  };
  const server = {
    calls,
    children,
    spawn,
    receive(child, message) {
      calls.push(message);
      if (message.method === 'initialize') {
        if (failInitialize) {
          child.send({ id: message.id, error: { code: -32000, message: 'initialize failed' } });
          return;
        }
        child.send({ id: message.id, result: { userAgent: 'fake-codex' } });
        if (exitAfterInitialize) queueMicrotask(() => child.kill());
        return;
      }
      if (message.method === 'thread/start') {
        child.send({ id: message.id, result: { thread: { id: THREAD_ID, status: { type: 'idle' } }, model: 'gpt-test', reasoningEffort: 'high', serviceTier: 'default' } });
        return;
      }
      if (message.method === 'thread/name/set') {
        child.send({ id: message.id, result: {} });
        return;
      }
      if (message.method === 'thread/resume') {
        if (failResume) {
          child.send({ id: message.id, error: { code: -32000, message: 'active writer conflict' } });
          return;
        }
        child.send({ id: message.id, result: { thread: { id: THREAD_ID }, model: 'gpt-test', reasoningEffort: 'high', serviceTier: 'default' } });
        return;
      }
      if (message.method === 'thread/turns/list') {
        child.send({ id: message.id, result: { data: [{
          id: 'turn-old',
          status: 'completed',
          startedAt: 100,
          items: [{ id: 'user-old', type: 'userMessage', content: [{ type: 'text', text: 'Earlier question' }] },
            { id: 'reply-old', type: 'agentMessage', text: 'Earlier answer' }],
        }] } });
        return;
      }
      if (message.method === 'thread/settings/update') {
        child.send({ id: message.id, result: {} });
        return;
      }
      if (message.method === 'turn/start') {
        child.send({ id: message.id, result: { turn: { id: 'turn-new', status: 'inProgress', startedAt: 200, items: [] } } });
        setTimeout(() => {
          child.send({ method: 'turn/started', params: { threadId: THREAD_ID, turn: { id: 'turn-new', status: 'inProgress', startedAt: 200, items: [] } } });
          child.send({ method: 'item/started', params: { threadId: THREAD_ID, turnId: 'turn-new', item: { id: 'reply-new', type: 'agentMessage', text: '' } } });
          child.send({ method: 'item/agentMessage/delta', params: { threadId: THREAD_ID, turnId: 'turn-new', itemId: 'reply-new', delta: 'Hello ' } });
          child.send({ method: 'item/agentMessage/delta', params: { threadId: THREAD_ID, turnId: 'turn-new', itemId: 'reply-new', delta: 'from Codex' } });
          child.send({ method: 'item/completed', params: { threadId: THREAD_ID, turnId: 'turn-new', item: { id: 'reply-new', type: 'agentMessage', text: 'Hello from Codex' } } });
          child.send({ method: 'turn/completed', params: { threadId: THREAD_ID, turn: { id: 'turn-new', status: 'completed', startedAt: 200, durationMs: 50,
            items: [{ id: 'user-new', type: 'userMessage', content: [{ type: 'text', text: message.params.input[0].text }] },
              { id: 'reply-new', type: 'agentMessage', text: 'Hello from Codex' }] } } });
        }, 20);
        return;
      }
      if (message.method === 'turn/steer') {
        child.send({ id: message.id, result: {} });
        return;
      }
      if (message.method === 'turn/interrupt') {
        child.send({ id: message.id, result: {} });
        return;
      }
      child.send({ id: message.id, error: { code: -32601, message: 'unsupported fake method' } });
    },
  };
  return server;
}

async function runtimeFixture(t, serverOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), 'relaydeck-local-chat-'));
  const server = fakeServer(serverOptions);
  const runtime = new LocalChatRuntime('fake-codex.exe', {
    registryPath: join(root, 'chats.local.json'),
    writable: true,
    spawnProcess: server.spawn,
    resolveBinary: async () => 'fake-codex.exe',
    models: async () => [{ model: 'gpt-test', efforts: ['high', 'low'], serviceTiers: [{ id: 'priority' }] }],
  });
  t.after(() => runtime.close());
  return { root, server, runtime };
}

async function createChat(runtime) {
  await runtime.load();
  const created = await runtime.createThread({ cwd: 'C:\\project', name: 'Phone chat' });
  return created;
}

test('creates a persistent local chat and streams agent output', async t => {
  const { root, server, runtime } = await runtimeFixture(t);
  const created = await createChat(runtime);
  assert.equal(created.id, THREAD_ID);
  const started = runtime.snapshot()[0];
  assert.equal(started.mode, 'codex-chat');
  assert.equal(started.runtime, 'app-server');
  assert.equal(started.localOnly, true);
  assert.equal(started.writable, true);
  assert.equal(started.queueSupported, false);
  assert.equal(started.ready, true);

  await runtime.command(THREAD_ID, { op: 'start', text: 'Say hello' });
  for (let i = 0; i < 100; i++) {
    const current = runtime.entries.get(THREAD_ID);
    if (!current?.activeTurnId && current?.turns.find(value => value.id === 'turn-new')?.status === 'completed') break;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  const row = runtime.snapshot()[0];
  const turn = row.turns.find(value => value.id === 'turn-new');
  assert.equal(turn.status, 'completed');
  assert.equal(turn.input, 'Say hello');
  assert.deepEqual(turn.agentMessages, ['Hello from Codex']);
  assert.equal(row.activeTurnId, '');

  const turnStart = server.calls.find(value => value.method === 'turn/start');
  assert.deepEqual(turnStart.params.input, [{ type: 'text', text: 'Say hello' }]);
  assert.match(turnStart.params.clientUserMessageId, /^[a-f0-9-]{36}$/);
  const saved = JSON.parse(await readFile(join(root, 'chats.local.json'), 'utf8'));
  assert.equal(saved.chats[0].id, THREAD_ID);
  assert.equal(JSON.stringify(saved).includes('Say hello'), false);
  assert.equal(JSON.stringify(saved).includes('token'), false);
});

test('a persisted local chat is routable immediately after a runtime restart', async t => {
  const { root, server, runtime } = await runtimeFixture(t);
  await createChat(runtime);
  runtime.close();

  const restarted = new LocalChatRuntime('fake-codex.exe', {
    registryPath: join(root, 'chats.local.json'),
    writable: true,
    spawnProcess: server.spawn,
    resolveBinary: async () => 'fake-codex.exe',
    models: async () => [{ model: 'gpt-test', efforts: ['high'] }],
  });
  t.after(() => restarted.close());
  await restarted.load();
  assert.equal(restarted.fileRoot(THREAD_ID), 'C:\\project');
  assert.equal(restarted.snapshot()[0].mode, 'codex-chat');
  assert.equal(restarted.snapshot()[0].ready, false);
  const history = await restarted.history(THREAD_ID);
  assert.equal(history.historyReady, true);
  assert.equal(history.turns[0].input, 'Earlier question');
});

test('autoConnect prewarms a persisted local chat without opening or resuming it', async t => {
  const { server, runtime } = await runtimeFixture(t);
  await createChat(runtime);
  runtime.close();

  const restarted = new LocalChatRuntime('fake-codex.exe', {
    registryPath: runtime.registryPath,
    writable: true,
    spawnProcess: server.spawn,
    resolveBinary: async () => 'fake-codex.exe',
  });
  t.after(() => restarted.close());
  await restarted.autoConnect();
  assert.equal(restarted.initialized, true);
  assert.equal(server.calls.filter(value => value.method === 'thread/resume').length, 0);
  assert.equal(server.calls.filter(value => value.method === 'turn/start').length, 0);
  assert.equal(restarted.snapshot()[0].ready, false);
});

test('loads history, resumes once, and preserves canonical turn order', async t => {
  const { server, runtime } = await runtimeFixture(t);
  await createChat(runtime);
  const history = await runtime.history(THREAD_ID);
  assert.equal(history.historyReady, true);
  assert.equal(history.queueSupported, false);
  assert.equal(history.turns[0].input, 'Earlier question');
  assert.deepEqual(history.turns[0].agentMessages, ['Earlier answer']);
  runtime.entries.get(THREAD_ID).loaded = false;
  await runtime.openThread(THREAD_ID);
  assert.equal(server.calls.filter(value => value.method === 'thread/resume').length, 1);
});

test('steer and interrupt require the exact active turn', async t => {
  const { server, runtime } = await runtimeFixture(t);
  await createChat(runtime);
  await assert.rejects(runtime.command(THREAD_ID, { op: 'steer', text: 'too soon' }), /没有正在执行/);
  await runtime.command(THREAD_ID, { op: 'start', text: 'long task' });
  const started = server.calls.find(value => value.method === 'turn/start');
  assert.ok(started);
  // Keep a turn active in the projection instead of using the fake completion event.
  const entry = runtime.entries.get(THREAD_ID);
  entry.activeTurnId = 'turn-new';
  entry.turns = [{ id: 'turn-new', status: 'inProgress', startedAt: 200, items: [] }];
  await runtime.command(THREAD_ID, { op: 'steer', text: 'also do this' });
  const steer = server.calls.find(value => value.method === 'turn/steer');
  assert.equal(steer.params.expectedTurnId, 'turn-new');
  await runtime.command(THREAD_ID, { op: 'interrupt', turnId: 'turn-new' });
  assert.ok(server.calls.find(value => value.method === 'turn/interrupt'));
});

test('approvals and questions are bounded and can be answered once', async t => {
  const { server, runtime } = await runtimeFixture(t);
  await createChat(runtime);
  const entry = runtime.entries.get(THREAD_ID);
  entry.ready = true;
  entry.turns = [{ id: 'turn-live', status: 'inProgress', startedAt: 200, items: [] }];
  entry.activeTurnId = 'turn-live';
  server.children[0].send({ id: 'rpc-approval', method: 'item/commandExecution/requestApproval',
    params: { threadId: THREAD_ID, turnId: 'turn-live', itemId: 'tool-1', command: 'echo safe', availableDecisions: ['accept', 'cancel'] } });
  await new Promise(resolve => setTimeout(resolve, 5));
  const approval = runtime.snapshot()[0].approvals[0];
  assert.equal(approval.command, 'echo safe');
  await assert.rejects(runtime.command(THREAD_ID, { op: 'approve', requestId: approval.id, turnId: 'old', decision: 'accept' }), /轮次/);
  await runtime.command(THREAD_ID, { op: 'approve', requestId: approval.id, turnId: 'turn-live', decision: 'accept' });
  const reply = server.calls.find(value => value.id === 'rpc-approval');
  assert.deepEqual(reply.result, { decision: 'accept' });
  await assert.rejects(runtime.command(THREAD_ID, { op: 'approve', requestId: approval.id, decision: 'accept' }), /已处理/);

  server.children[0].send({ id: 'rpc-question', method: 'item/tool/requestUserInput',
    params: { threadId: THREAD_ID, turnId: 'turn-live', questions: [{ id: 'choice', question: 'Pick one', options: [{ label: 'A' }, { label: 'B' }] }] } });
  await new Promise(resolve => setTimeout(resolve, 5));
  const question = runtime.snapshot()[0].questions[0];
  await assert.rejects(runtime.command(THREAD_ID, { op: 'answer', requestId: question.id, answers: { choice: { answers: ['C'] } } }), /可选项/);
  await runtime.command(THREAD_ID, { op: 'answer', requestId: question.id, turnId: 'turn-live', answers: { choice: { answers: ['A'] } } });
  const answer = server.calls.find(value => value.id === 'rpc-question');
  assert.deepEqual(answer.result, { answers: { choice: { answers: ['A'] } } });
});

test('model changes validate the device model catalog before writing settings', async t => {
  const { server, runtime } = await runtimeFixture(t);
  await createChat(runtime);
  await assert.rejects(runtime.command(THREAD_ID, { op: 'model', model: 'invented', effort: 'high' }), /可用列表/);
  await runtime.command(THREAD_ID, { op: 'model', model: 'gpt-test', effort: 'high', serviceTier: 'priority' });
  const update = server.calls.find(value => value.method === 'thread/settings/update');
  assert.equal(update.params.model, 'gpt-test');
  assert.equal(update.params.effort, 'high');
  assert.equal(update.params.serviceTier, 'priority');
});

test('writer conflicts and app-server exits surface explicit errors', async t => {
  const conflict = await runtimeFixture(t, { failResume: true });
  await createChat(conflict.runtime);
  conflict.runtime.entries.get(THREAD_ID).loaded = false;
  conflict.runtime.entries.get(THREAD_ID).ready = false;
  await assert.rejects(conflict.runtime.resume(THREAD_ID), error => error.code === 'THREAD_BUSY' && /电脑端使用/.test(error.message));

  const exited = await runtimeFixture(t, { exitAfterInitialize: true });
  await assert.rejects(createChat(exited.runtime), /连接(?:已退出|不可用)/);
  assert.equal(exited.runtime.snapshot()[0], undefined);
});

test('createThread is disabled for read-only runtimes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'relaydeck-local-chat-disabled-'));
  const runtime = new LocalChatRuntime('fake-codex.exe', { registryPath: join(root, 'chats.local.json'), writable: false });
  t.after(() => runtime.close());
  await assert.rejects(runtime.createThread({ cwd: 'C:\\project', name: 'No' }), /允许手机/);
});
