import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveDesktopBinary } from './desktop-binary.mjs';
import { activeTurn, getTurns } from './thread-state.mjs';
import { taskFailure } from './task-failure.mjs';
import { turnInput, turnTimeline } from './turn-timeline.mjs';

const THREAD_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const MAX_PENDING_REQUESTS = 64;
const REQUEST_TIMEOUT_MS = 30000;

function errorWithCode(message, code) {
  return Object.assign(Error(message), { code });
}

function desktopPayload(value, key) {
  return value && typeof value === 'object' && value[key] && typeof value[key] === 'object'
    ? value[key]
    : value;
}

function validThreadId(value) {
  return typeof value === 'string' && THREAD_ID.test(value);
}

function publicSettings(value = {}) {
  return {
    model: typeof value.model === 'string' ? value.model : '',
    effort: typeof value.effort === 'string' ? value.effort : '',
    serviceTier: typeof value.serviceTier === 'string' ? value.serviceTier : 'default',
  };
}

function boundedName(value, fallback = '新对话') {
  const name = typeof value === 'string' ? value.trim().slice(0, 80) : '';
  return name || fallback;
}

function appendItemDelta(item, method, message) {
  const delta = typeof message.delta === 'string' ? message.delta : '';
  if (!delta) return;
  if (method === 'item/agentMessage/delta') {
    item.text = String(item.text || '') + delta;
  } else if (method === 'item/plan/delta') {
    item.text = String(item.text || '') + delta;
  } else if (method === 'item/commandExecution/outputDelta') {
    item.aggregatedOutput = String(item.aggregatedOutput || '') + delta;
  } else if (method === 'item/reasoning/summaryTextDelta') {
    const index = Number.isInteger(message.summaryIndex) ? message.summaryIndex : 0;
    if (!Array.isArray(item.summary)) item.summary = [];
    item.summary[index] = String(item.summary[index] || '') + delta;
  } else if (method === 'item/reasoning/textDelta') {
    if (!Array.isArray(item.content)) item.content = [];
    item.content[0] = String(item.content[0] || '') + delta;
  }
}

function deltaItem(method) {
  if (method === 'item/agentMessage/delta') return { type: 'agentMessage', text: '' };
  if (method === 'item/plan/delta') return { type: 'plan', text: '' };
  if (method === 'item/commandExecution/outputDelta') return { type: 'commandExecution', status: 'inProgress', aggregatedOutput: '' };
  if (method === 'item/reasoning/summaryTextDelta' || method === 'item/reasoning/textDelta') {
    return { type: 'reasoning', summary: [], content: [] };
  }
  return null;
}

function activityFor(turn, pendingRequests) {
  if (!turn || turn.status !== 'inProgress') return undefined;
  const items = turn.items || [];
  const last = items.at(-1);
  const reasoning = items.findLast(item => item.type === 'reasoning');
  const visible = reasoning?.summary;
  const summary = (typeof visible === 'string'
    ? visible
    : Array.isArray(visible)
      ? visible.map(part => typeof part === 'string' ? part : typeof part?.text === 'string' ? part.text : '').join('\n')
      : '').slice(0, 2400);
  return {
    label: pendingRequests ? '等待处理审批或输入…' : last?.type === 'commandExecution' && last.status === 'inProgress'
      ? '正在执行工具…'
      : '正在思考…',
    summary,
  };
}

export class LocalChatRuntime extends EventEmitter {
  constructor(binary, {
    registryPath,
    writable = false,
    models = async () => [],
    spawnProcess = spawn,
    resolveBinary = resolveDesktopBinary,
    now = Date.now,
    requestTimeoutMs = REQUEST_TIMEOUT_MS,
  } = {}) {
    super();
    this.binary = binary;
    this.registryPath = registryPath;
    this.writable = writable;
    this.models = models;
    this.spawnProcess = spawnProcess;
    this.resolveBinary = resolveBinary;
    this.now = now;
    this.requestTimeoutMs = requestTimeoutMs;
    this.rows = new Map();
    this.entries = new Map();
    this.pending = new Map();
    this.serverRequests = new Map();
    this.sequence = 0;
    this.generation = 0;
    this.closed = false;
    this.loading = null;
    this.connecting = null;
    this.child = null;
    this.lines = null;
    this.initialized = false;
  }

  async load() {
    if (this.registryLoaded) return;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      let value = null;
      try {
        value = JSON.parse((await readFile(this.registryPath, 'utf8')).replace(/^\uFEFF/, ''));
      } catch (error) {
        if (error.code !== 'ENOENT' && error.name !== 'SyntaxError') throw error;
      }
      const chats = Array.isArray(value?.chats) ? value.chats : [];
      for (const chat of chats) {
        if (!chat || !validThreadId(chat.id) || typeof chat.cwd !== 'string' || !chat.cwd) continue;
        const row = {
          id: chat.id,
          name: boundedName(chat.name),
          cwd: chat.cwd,
          createdAt: Number(chat.createdAt) || this.now(),
          updatedAt: Number(chat.updatedAt) || Number(chat.createdAt) || this.now(),
          groupId: typeof chat.groupId === 'string' && chat.groupId ? chat.groupId : 'codex-chats',
          groupName: typeof chat.groupName === 'string' && chat.groupName ? chat.groupName : 'Codex 对话',
          groupOrder: Number.isInteger(chat.groupOrder) ? chat.groupOrder : 2,
          settings: publicSettings(chat.settings),
        };
        this.rows.set(row.id, row);
      }
      this.registryLoaded = true;
    })();
    try { await this.loading; } finally { this.loading = null; }
  }

  async persist() {
    const chats = [...this.rows.values()].map(row => ({
      id: row.id,
      name: row.name,
      cwd: row.cwd,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      groupId: row.groupId,
      groupName: row.groupName,
      groupOrder: row.groupOrder,
      settings: publicSettings(row.settings),
    }));
    await mkdir(dirname(this.registryPath), { recursive: true, mode: 0o700 });
    const temporary = this.registryPath + '.tmp';
    await writeFile(temporary, JSON.stringify({ version: 1, chats }, null, 2), { mode: 0o600 });
    await rename(temporary, this.registryPath);
  }

  async catalog() {
    await this.load();
    return [...this.rows.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(row => this.rowMetadata(row));
  }

  rowMetadata(row) {
    return {
      id: row.id,
      name: row.name,
      updatedAt: Math.floor(row.updatedAt / 1000),
      mode: 'codex-chat',
      runtime: 'app-server',
      localOnly: true,
      groupId: row.groupId,
      groupName: row.groupName,
      groupOrder: row.groupOrder,
      order: row.updatedAt,
    };
  }

  async createThread({ cwd, name, model, groupId, groupName, groupOrder } = {}) {
    if (!this.writable) throw errorWithCode('请先在电脑允许手机选择和新建会话', 'CHAT_CREATE_DISABLED');
    await this.load();
    await this.connect();
    const title = boundedName(name);
    const result = await this.request('thread/start', {
      cwd,
      ephemeral: false,
      historyMode: 'paginated',
      threadSource: 'relaydeck',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
      ...(typeof model === 'string' && model ? { model } : {}),
    });
    const thread = desktopPayload(result, 'thread');
    if (!validThreadId(thread?.id)) throw Error('Codex 未返回有效的本地会话编号');
    await this.request('thread/name/set', { threadId: thread.id, name: title });
    const timestamp = this.now();
    const row = {
      id: thread.id,
      name: title,
      cwd,
      createdAt: timestamp,
      updatedAt: timestamp,
      groupId: typeof groupId === 'string' && groupId ? groupId : 'codex-chats',
      groupName: typeof groupName === 'string' && groupName ? groupName : 'Codex 对话',
      groupOrder: Number.isInteger(groupOrder) ? groupOrder : 2,
      settings: publicSettings({
        model: result?.model || thread.model || model || '',
        effort: result?.reasoningEffort || thread.reasoningEffort || '',
        serviceTier: result?.serviceTier || thread.serviceTier || 'default',
      }),
    };
    this.rows.set(row.id, row);
    const entry = this.ensureEntry(row);
    entry.ready = true;
    entry.historyReady = true;
    entry.loaded = true;
    entry.turns = [];
    entry.revision++;
    await this.persist();
    this.emit('changed');
    return { id: row.id, name: row.name, mode: 'codex-chat' };
  }

  ensureEntry(row) {
    let entry = this.entries.get(row.id);
    if (!entry) {
      entry = {
        row,
        ready: false,
        loaded: false,
        historyReady: false,
        turns: [],
        activeTurnId: '',
        questions: new Map(),
        approvals: new Map(),
        settings: publicSettings(row.settings),
        revision: 0,
        lastError: '',
      };
      this.entries.set(row.id, entry);
    }
    entry.row = row;
    return entry;
  }

  async connect() {
    if (this.closed) throw Error('Codex 本地对话已关闭');
    if (this.initialized && this.child) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.open();
    try { await this.connecting; } finally { this.connecting = null; }
  }

  async autoConnect() {
    if (this.closed) return;
    try {
      await this.load();
    } catch (error) {
      this.lastError = String(error.message || '').slice(0, 1000);
      return;
    }
    if (!this.rows.size && !this.writable) return;
    if (!this.rows.size && !this.binary) return;
    try {
      await this.connect();
    } catch (error) {
      this.lastError = String(error.message || '').slice(0, 1000);
    }
  }

  async open() {
    const binary = await this.resolveBinary(this.binary);
    const generation = ++this.generation;
    const child = this.spawnProcess(binary, ['app-server', '--listen', 'stdio://'], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    child.stdin.on('error', () => {});
    child.stderr.on('data', () => {});
    this.lines = createInterface({ input: child.stdout });
    this.lines.on('line', line => this.onLine(line, child, generation));
    const failed = error => this.onExit(child, generation, error);
    child.on('error', failed);
    child.on('exit', code => this.onExit(child, generation, Error(`Codex 本地对话连接已退出${code == null ? '' : ` (${code})`}`)));
    await this.request('initialize', {
      clientInfo: { name: 'relaydeck_chat', version: '0.1.0' },
      capabilities: { experimentalApi: true },
    });
    this.write({ method: 'initialized' });
    this.initialized = true;
  }

  onExit(child, generation, error) {
    if (this.child !== child) return;
    this.child = null;
    this.initialized = false;
    this.lines?.close();
    this.lines = null;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error || Error('Codex 本地对话连接中断'));
    }
    this.pending.clear();
    this.serverRequests.clear();
    for (const entry of this.entries.values()) {
      entry.ready = false;
      entry.loaded = false;
      entry.activeTurnId = '';
      entry.questions.clear();
      entry.approvals.clear();
      entry.revision++;
    }
    if (!this.closed) this.emit('changed');
  }

  onLine(line, child, generation) {
    if (this.child !== child || generation !== this.generation) return;
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (!message || typeof message !== 'object') return;
    if (message.method && message.id !== undefined) {
      this.onServerRequest(message);
      return;
    }
    if (message.method) {
      this.onNotification(message.method, message.params || {});
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) {
      const text = typeof message.error.message === 'string' ? message.error.message : 'Codex 拒绝了本地会话操作';
      pending.reject(errorWithCode(text, /busy|active|locked|writer/i.test(text) ? 'THREAD_BUSY' : 'RPC_ERROR'));
    } else {
      pending.resolve(message.result);
    }
  }

  onNotification(method, params) {
    const threadId = params.threadId || params.thread?.id;
    const row = threadId ? this.rows.get(threadId) : null;
    if (!row) return;
    const entry = this.ensureEntry(row);
    if (method === 'thread/started' && params.thread) {
      if (params.thread.name) row.name = boundedName(params.thread.name, row.name);
      if (params.thread.updatedAt) row.updatedAt = Number(params.thread.updatedAt) * 1000;
    } else if (method === 'thread/settings/updated') {
      entry.settings = publicSettings({
        model: params.threadSettings?.model,
        effort: params.threadSettings?.effort,
        serviceTier: params.threadSettings?.serviceTier,
      });
      row.settings = entry.settings;
    } else if (method === 'turn/started' && params.turn) {
      this.upsertTurn(entry, params.turn);
      entry.activeTurnId = params.turn.status === 'inProgress' ? params.turn.id : '';
      entry.ready = true;
      this.touch(row);
    } else if (method === 'turn/completed' && params.turn) {
      this.upsertTurn(entry, params.turn);
      if (entry.activeTurnId === params.turn.id) entry.activeTurnId = '';
      this.touch(row);
    } else if (method === 'item/started' && params.item) {
      this.upsertItem(entry, params.turnId, params.item);
    } else if (method === 'item/completed' && params.item) {
      this.upsertItem(entry, params.turnId, params.item);
    } else if (deltaItem(method)) {
      const turn = this.findTurn(entry, params.turnId);
      if (!turn) return;
      let item = (turn.items || []).find(value => value.id === params.itemId);
      if (!item) {
        item = { id: params.itemId, ...deltaItem(method) };
        turn.items = [...(turn.items || []), item];
      }
      appendItemDelta(item, method, params);
    } else if (method === 'thread/name/updated') {
      if (typeof params.name === 'string' && params.name.trim()) row.name = boundedName(params.name, row.name);
      this.touch(row);
    } else if (method === 'serverRequest/resolved') {
      const id = String(params.requestId ?? params.id ?? '');
      if (id) {
        entry.questions.delete(id);
        entry.approvals.delete(id);
        this.serverRequests.delete(id);
      }
    } else if (method === 'thread/closed') {
      entry.ready = false;
      entry.loaded = false;
      entry.activeTurnId = '';
      entry.questions.clear();
      entry.approvals.clear();
    } else if (method === 'error' && params.message) {
      entry.lastError = String(params.message).slice(0, 1000);
    } else {
      return;
    }
    entry.revision++;
    this.emit('changed');
  }

  onServerRequest(message) {
    const id = String(message.id);
    const params = message.params || {};
    const row = this.rows.get(params.threadId);
    if (!row) {
      this.write({ id: message.id, error: { code: -32601, message: 'Unknown RelayDeck thread' } });
      return;
    }
    const entry = this.ensureEntry(row);
    if (this.serverRequests.size >= MAX_PENDING_REQUESTS) {
      this.write({ id: message.id, error: { code: -32000, message: 'Too many pending requests' } });
      return;
    }
    const kind = message.method === 'item/commandExecution/requestApproval'
      ? 'command'
      : message.method === 'item/fileChange/requestApproval'
        ? 'file'
        : message.method === 'item/tool/requestUserInput'
          ? 'question'
          : '';
    if (!kind) {
      this.write({ id: message.id, error: { code: -32601, message: 'Unsupported RelayDeck request' } });
      return;
    }
    const request = { id, rpcId: message.id, method: message.method, params };
    this.serverRequests.set(id, request);
    if (kind === 'question') {
      entry.questions.set(id, request);
    } else {
      entry.approvals.set(id, request);
    }
    entry.revision++;
    this.emit('changed');
  }

  write(value) {
    if (!this.child?.stdin?.writable) throw Error('Codex 本地对话连接不可用');
    this.child.stdin.write(JSON.stringify(value) + '\n');
  }

  request(method, params) {
    if (!this.child?.stdin?.writable) return Promise.reject(Error('Codex 本地对话连接不可用'));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error('Codex 本地对话响应超时'));
      }, this.requestTimeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.write({ id, method, params });
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  findTurn(entry, turnId) {
    return entry.turns.find(turn => turn.id === turnId);
  }

  upsertTurn(entry, turn) {
    if (!turn || !validThreadId(turn.id)) return;
    const index = entry.turns.findIndex(value => value.id === turn.id);
    if (index >= 0) entry.turns[index] = turn;
    else entry.turns.push(turn);
    entry.turns.sort((a, b) => (Number(a.startedAt) || 0) - (Number(b.startedAt) || 0));
    while (entry.turns.length > 80) entry.turns.shift();
  }

  upsertItem(entry, turnId, item) {
    if (!item || !validThreadId(item.id)) return;
    let turn = this.findTurn(entry, turnId);
    if (!turn) {
      turn = { id: turnId, status: 'inProgress', startedAt: Math.floor(this.now() / 1000), items: [] };
      this.upsertTurn(entry, turn);
    }
    const index = (turn.items || []).findIndex(value => value.id === item.id);
    if (index >= 0) turn.items[index] = item;
    else turn.items = [...(turn.items || []), item];
  }

  touch(row) {
    row.updatedAt = this.now();
    void this.persist().catch(() => {});
  }

  async resume(threadId) {
    await this.connect();
    const entry = this.ensureEntry(this.rows.get(threadId));
    if (entry.loaded && entry.ready) return entry;
    try {
      const result = await this.request('thread/resume', { threadId, excludeTurns: true });
      const resumed = desktopPayload(result, 'thread');
      entry.loaded = true;
      entry.ready = true;
      entry.lastError = '';
      entry.settings = publicSettings({
        model: result?.model || resumed?.model,
        effort: result?.reasoningEffort || resumed?.reasoningEffort,
        serviceTier: result?.serviceTier || resumed?.serviceTier,
      });
      entry.row.settings = entry.settings;
      entry.turns = await this.readTurns(threadId);
      entry.historyReady = true;
      entry.activeTurnId = this.turnInProgress(entry);
      entry.revision++;
      this.emit('changed');
      return entry;
    } catch (error) {
      entry.lastError = String(error.message || '').slice(0, 1000);
      if (error.code === 'THREAD_BUSY') throw errorWithCode('该 Codex 本地对话正在电脑端使用；请先在电脑端关闭它或切换为只读查看', 'THREAD_BUSY');
      if (/not found|does not exist|unknown thread/i.test(error.message || '')) throw errorWithCode('本地 Codex 对话已不存在', 'THREAD_NOT_FOUND');
      throw error;
    }
  }

  turnInProgress(entry) {
    const state = { turns: entry.turns.map(turn => ({ turnId: turn.id, ...turn })) };
    return activeTurn(state)?.turnId || '';
  }

  async openThread(threadId) {
    await this.load();
    if (!this.rows.has(threadId)) throw errorWithCode('聊天不在 RelayDeck 本地对话列表中', 'THREAD_NOT_FOUND');
    await this.resume(threadId);
  }

  async readTurns(threadId) {
    await this.connect();
    const values = [];
    let cursor = '';
    const seen = new Set();
    do {
      const page = await this.request('thread/turns/list', {
        threadId,
        limit: 50,
        sortDirection: 'desc',
        itemsView: 'full',
        ...(cursor ? { cursor } : {}),
      });
      values.push(...(page?.data || []));
      cursor = page?.nextCursor || '';
      if (cursor && seen.has(cursor)) throw Error('Codex 历史分页游标重复');
      if (cursor) seen.add(cursor);
    } while (cursor && values.length < 50);
    return values.reverse().slice(-50);
  }

  async history(threadId) {
    await this.load();
    const row = this.rows.get(threadId);
    if (!row) throw errorWithCode('聊天不在 RelayDeck 本地对话列表中', 'THREAD_NOT_FOUND');
    const turns = await this.readTurns(threadId);
    return {
      ...this.rowMetadata(row),
      ready: false,
      writable: this.writable,
      queueSupported: false,
      historyReady: true,
      historyUpdatedAt: Math.floor(row.updatedAt / 1000),
      turns: turns.map(turn => this.projectTurn(turn)),
      questions: [],
      approvals: [],
      activeTurnId: '',
    };
  }

  projectTurn(turn) {
    const items = Array.isArray(turn.items) ? turn.items : [];
    return {
      id: turn.id,
      status: turn.status,
      startedAtMs: turn.startedAt ? Number(turn.startedAt) * 1000 : undefined,
      durationMs: turn.durationMs,
      failureReason: taskFailure(turn),
      input: turnInput(turn),
      agentMessages: items.filter(item => item.type === 'agentMessage').map(item => item.text).slice(0, 8),
      timeline: turnTimeline(items),
      itemTypes: items.map(item => item.type),
      toolResults: items.filter(item => ['commandExecution', 'fileChange'].includes(item.type)).map(item => ({
        id: item.id,
        type: item.type,
        status: item.status,
        exitCode: item.exitCode,
        ...(item.type === 'fileChange' ? { changeCount: item.changes?.length ?? 0 } : {}),
      })),
    };
  }

  snapshot() {
    const rows = [];
    for (const row of this.rows.values()) {
      const entry = this.entries.get(row.id);
      const turns = entry?.turns || [];
      const active = entry?.ready ? turns.find(turn => turn.id === entry.activeTurnId && turn.status === 'inProgress') : null;
      rows.push({
        ...this.rowMetadata(row),
        ready: !!entry?.ready,
        writable: this.writable,
        historyReady: !!entry?.historyReady,
        queueSupported: false,
        queuedMessages: [],
        model: entry?.settings?.model || row.settings?.model || '',
        reasoningEffort: entry?.settings?.effort || row.settings?.effort || '',
        serviceTier: entry?.settings?.serviceTier || row.settings?.serviceTier || 'default',
        activity: active ? activityFor(active, entry.questions.size + entry.approvals.size > 0) : undefined,
        activeTurnId: active?.id || '',
        revision: entry?.revision || 0,
        runtimeStatus: active ? 'active' : entry?.ready ? 'idle' : 'notLoaded',
        turns: turns.slice(-50).map(turn => this.projectTurn(turn)),
        questions: entry?.ready ? this.publicQuestions(entry) : [],
        approvals: entry?.ready ? this.publicApprovals(entry) : [],
        ...(entry?.lastError ? { error: entry.lastError } : {}),
      });
    }
    return rows;
  }

  publicQuestions(entry) {
    return [...entry.questions.values()].map(request => {
      const params = request.params || {};
      return {
        id: request.id,
        kind: 'native',
        turnId: params.turnId,
        questions: (params.questions || []).map(question => ({
          id: question.id,
          title: question.question,
          header: question.header,
          isOther: !!question.isOther,
          isSecret: !!question.isSecret,
          options: (question.options || []).map(option => ({ label: option.label, description: option.description || '' })),
        })),
      };
    }).filter(row => row.questions.length);
  }

  approvalTurn(entry, turnId) {
    return entry.turns.find(turn => turn.id === turnId);
  }

  publicApprovals(entry) {
    return [...entry.approvals.values()].flatMap(request => {
      const params = request.params || {};
      const kind = request.method === 'item/commandExecution/requestApproval' ? 'command' : 'file';
      const turn = this.approvalTurn(entry, params.turnId);
      const item = (turn?.items || []).find(value => value.id === params.itemId);
      const decisions = (params.availableDecisions || ['accept', 'decline', 'cancel'])
        .filter(value => typeof value === 'string' && ['accept', 'decline', 'cancel'].includes(value));
      return [{
        id: request.id,
        kind,
        turnId: params.turnId,
        decisions,
        command: params.command ?? item?.command ?? null,
        cwd: params.cwd ?? null,
        reason: params.reason ?? null,
        changes: kind === 'file' ? (item?.changes || []) : [],
        submitting: false,
      }];
    });
  }

  async modelOptions(threadId) {
    await this.load();
    const row = this.rows.get(threadId);
    if (!row) throw errorWithCode('聊天不在 RelayDeck 本地对话列表中', 'THREAD_NOT_FOUND');
    const models = await this.models();
    const settings = this.entries.get(threadId)?.settings || row.settings || publicSettings();
    return {
      models,
      current: {
        model: settings.model,
        effort: settings.effort,
        serviceTier: settings.serviceTier || 'default',
      },
    };
  }

  async command(threadId, command) {
    await this.load();
    const row = this.rows.get(threadId);
    if (!row) throw errorWithCode('聊天不在 RelayDeck 本地对话列表中', 'THREAD_NOT_FOUND');
    if (!this.writable) throw Error('此 Codex 本地对话仅允许读取，请在电脑授权后操作');
    const entry = this.ensureEntry(row);
    if (!entry.ready || !this.initialized) throw Error('Codex 本地对话尚未就绪，请等待重新连接');
    if (command.op === 'model') return this.updateModel(entry, command);
    if (command.op === 'start') {
      if (entry.activeTurnId) throw Error('对话正在执行，请等待完成或使用追加指令');
      const result = await this.request('turn/start', {
        threadId,
        input: [{ type: 'text', text: command.text }],
        clientUserMessageId: randomUUID(),
      });
      if (result?.turn) {
        this.upsertTurn(entry, result.turn);
        entry.activeTurnId = result.turn.status === 'inProgress' ? result.turn.id : '';
      }
      this.touch(row);
      this.emit('changed');
      return { accepted: true };
    }
    if (command.op === 'steer') {
      if (!entry.activeTurnId) throw Error('没有正在执行的 Codex 任务');
      await this.request('turn/steer', {
        threadId,
        expectedTurnId: entry.activeTurnId,
        input: [{ type: 'text', text: command.text }],
        clientUserMessageId: randomUUID(),
      });
      this.emit('changed');
      return { accepted: true };
    }
    if (command.op === 'interrupt') {
      if (!entry.activeTurnId || command.turnId !== entry.activeTurnId) throw Error('任务已变化，请刷新后重试');
      await this.request('turn/interrupt', { threadId, turnId: entry.activeTurnId });
      this.emit('changed');
      return { accepted: true };
    }
    if (command.op === 'approve') {
      const request = entry.approvals.get(String(command.requestId));
      if (!request) throw Error('审批已处理或任务已变化，请刷新');
      if (command.turnId && request.params?.turnId !== command.turnId) throw Error('审批轮次已变化，请刷新后操作');
      const available = (request.params?.availableDecisions || ['accept', 'decline', 'cancel'])
        .filter(value => typeof value === 'string' && ['accept', 'decline', 'cancel'].includes(value));
      if (!available.includes(command.decision)) throw Error('不支持该审批选项');
      entry.approvals.delete(String(command.requestId));
      this.serverRequests.delete(String(command.requestId));
      this.write({ id: request.rpcId, result: { decision: command.decision } });
      entry.revision++;
      this.emit('changed');
      return { accepted: true };
    }
    if (command.op === 'answer') {
      const request = entry.questions.get(String(command.requestId));
      if (!request) throw Error('问题已处理或任务已变化，请刷新');
      if (command.turnId && request.params?.turnId !== command.turnId) throw Error('问题轮次已变化，请刷新');
      const normalized = this.publicQuestions({ questions: new Map([[request.id, request]]) })[0];
      const answers = this.validateAnswers(normalized, command.answers);
      entry.questions.delete(String(command.requestId));
      this.serverRequests.delete(String(command.requestId));
      this.write({ id: request.rpcId, result: { answers } });
      entry.revision++;
      this.emit('changed');
      return { accepted: true };
    }
    if (['queue', 'queue-remove'].includes(command.op)) throw Error('Codex 本地对话暂不支持排队，请使用立即插话');
    throw Error('不支持的操作');
  }

  validateAnswers(request, answers) {
    if (!answers || typeof answers !== 'object' || Array.isArray(answers) || Object.keys(answers).length !== request.questions.length) throw Error('请回答全部问题');
    for (const question of request.questions) {
      const values = answers[question.id]?.answers;
      if (!Array.isArray(values) || values.length !== 1 || typeof values[0] !== 'string' || !values[0].trim() || values[0].length > 16000) throw Error('回答不能为空或过长');
      if (question.options.length && !question.isOther && !question.options.some(option => option.label === values[0])) throw Error('回答不在可选项中');
    }
    return Object.fromEntries(request.questions.map(question => [question.id, { answers: [...answers[question.id].answers] }]));
  }

  async updateModel(entry, command) {
    const models = await this.models();
    const model = models.find(row => row.model === command.model);
    if (!model || !Array.isArray(model.efforts) || !model.efforts.includes(command.effort)) throw Error('模型或思考强度不在电脑可用列表中，请刷新后选择');
    if (command.serviceTier !== undefined && command.serviceTier !== 'default' &&
      !(model.serviceTiers || []).some(tier => tier.id === command.serviceTier && tier.id === 'priority')) {
      throw Error('此模型未提供所选速度');
    }
    const params = {
      threadId: entry.row.id,
      model: command.model,
      effort: command.effort,
      ...(command.serviceTier !== undefined ? { serviceTier: command.serviceTier } : {}),
    };
    await this.request('thread/settings/update', params);
    entry.settings = publicSettings({
      model: command.model,
      effort: command.effort,
      serviceTier: command.serviceTier ?? entry.settings.serviceTier,
    });
    entry.row.settings = entry.settings;
    this.touch(entry.row);
    entry.revision++;
    this.emit('changed');
    return { accepted: true };
  }

  fileRoot(threadId) {
    return this.rows.get(threadId)?.cwd;
  }

  close() {
    this.closed = true;
    ++this.generation;
    this.lines?.close();
    this.lines = null;
    const child = this.child;
    this.child = null;
    this.initialized = false;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(Error('Codex 本地对话已关闭'));
    }
    this.pending.clear();
    this.serverRequests.clear();
    try { child?.stdin?.end(); } catch {}
    if (child) {
      const timer = setTimeout(() => {
        try { child.kill(); } catch {}
      }, 750);
      timer.unref?.();
    }
  }
}
