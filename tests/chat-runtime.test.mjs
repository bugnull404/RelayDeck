import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { ChatRuntime } from '../server/chat-runtime.mjs';

class Fixture extends EventEmitter {
  constructor() {
    super();
    this.calls = [];
  }
}

function fixture() {
  const bridge = new Fixture();
  const local = new Fixture();
  local.loaded = false;
  local.load = async () => {
    local.loaded = true;
  };
  local.fileRoot = id => local.loaded && id === 'local-chat' ? 'C:\\project' : undefined;
  local.history = async id => {
    local.calls.push(['history', id]);
    return { id, mode: 'codex-chat' };
  };
  local.openThread = async id => {
    local.calls.push(['open', id]);
  };
  local.command = async (id, command) => {
    local.calls.push(['command', id, command.op]);
    return { accepted: true };
  };
  local.modelOptions = async id => {
    local.calls.push(['models', id]);
    return { models: [], current: {} };
  };

  bridge.catalog = async () => [{ id: 'desktop-chat' }];
  bridge.snapshot = () => [{ id: 'desktop-chat' }];
  bridge.history = async id => {
    bridge.calls.push(['history', id]);
    return { id, mode: 'work' };
  };
  bridge.openThread = async id => {
    bridge.calls.push(['open', id]);
  };
  bridge.command = async (id, command) => {
    bridge.calls.push(['command', id, command.op]);
    return { accepted: true };
  };
  bridge.modelOptions = async id => {
    bridge.calls.push(['models', id]);
    return { models: [], current: {} };
  };
  bridge.threadDirectory = async id => {
    bridge.calls.push(['directory', id]);
    return 'C:\\desktop';
  };
  return { bridge, local, runtime: new ChatRuntime(bridge, local) };
}

test('local chat routing loads the persisted registry before the first operation', async () => {
  const { bridge, local, runtime } = fixture();
  assert.equal(local.loaded, false);

  assert.deepEqual(await runtime.history('local-chat'), { id: 'local-chat', mode: 'codex-chat' });
  assert.equal(local.loaded, true);
  await runtime.openThread('local-chat');
  await runtime.command('local-chat', { op: 'start' });
  await runtime.modelOptions('local-chat');
  assert.equal(await runtime.threadDirectory('local-chat'), 'C:\\project');

  assert.deepEqual(local.calls, [
    ['history', 'local-chat'],
    ['open', 'local-chat'],
    ['command', 'local-chat', 'start'],
    ['models', 'local-chat'],
  ]);
  assert.deepEqual(bridge.calls, []);
});

test('desktop chats still route to the desktop bridge', async () => {
  const { bridge, local, runtime } = fixture();
  assert.deepEqual(await runtime.history('desktop-chat'), { id: 'desktop-chat', mode: 'work' });
  await runtime.openThread('desktop-chat');
  await runtime.command('desktop-chat', { op: 'start' });
  await runtime.modelOptions('desktop-chat');
  assert.equal(await runtime.threadDirectory('desktop-chat'), 'C:\\desktop');
  assert.deepEqual(local.calls, []);
  assert.deepEqual(bridge.calls, [
    ['history', 'desktop-chat'],
    ['open', 'desktop-chat'],
    ['command', 'desktop-chat', 'start'],
    ['models', 'desktop-chat'],
    ['directory', 'desktop-chat'],
  ]);
});
