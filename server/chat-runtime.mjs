import { EventEmitter } from 'node:events';

export class ChatRuntime extends EventEmitter {
  constructor(bridge, local) {
    super();
    this.bridge = bridge;
    this.local = local;
    this.closed = false;
    bridge.on('changed', () => this.emit('changed'));
    local?.on('changed', () => this.emit('changed'));
  }

  get allowSelectedChats() {
    return this.bridge.allowSelectedChats;
  }

  get chatCreator() {
    return this.bridge.chatCreator;
  }

  get createLocalChat() {
    return this.local?.writable ? this.localCreate.bind(this) : undefined;
  }

  async connect() {
    await Promise.all([
      this.bridge.connect(),
      this.local?.autoConnect() || Promise.resolve(),
    ]);
  }

  async localIds() {
    if (!this.local) return new Set();
    return new Set((await this.local.catalog()).map(row => row.id));
  }

  async isLocalThread(threadId) {
    if (!this.local) return false;
    await this.local.load();
    return !!this.local.fileRoot(threadId);
  }

  async catalog() {
    const [desktop, local, ids] = await Promise.all([
      this.bridge.catalog(),
      this.local?.catalog() || [],
      this.localIds(),
    ]);
    return [...desktop.filter(row => !ids.has(row.id)), ...local];
  }

  snapshot() {
    const local = this.local?.snapshot() || [];
    const ids = new Set(local.map(row => row.id));
    return [...this.bridge.snapshot().filter(row => !ids.has(row.id)), ...local];
  }

  async history(threadId, options) {
    if (await this.isLocalThread(threadId)) return this.local.history(threadId);
    return this.bridge.history(threadId, options);
  }

  async openThread(threadId) {
    if (await this.isLocalThread(threadId)) return this.local.openThread(threadId);
    return this.bridge.openThread(threadId);
  }

  async command(threadId, command, serialized = false) {
    if (await this.isLocalThread(threadId)) return this.local.command(threadId, command);
    return this.bridge.command(threadId, command, serialized);
  }

  async modelOptions(threadId) {
    if (await this.isLocalThread(threadId)) return this.local.modelOptions(threadId);
    return this.bridge.modelOptions(threadId);
  }

  async usage() {
    return this.bridge.usage();
  }

  async models() {
    return this.bridge.models();
  }

  fileRoot(threadId) {
    return this.local?.fileRoot(threadId) || this.bridge.fileRoot(threadId);
  }

  async threadDirectory(threadId) {
    if (await this.isLocalThread(threadId)) return this.local.fileRoot(threadId);
    return this.bridge.threadDirectory(threadId);
  }

  async createThread(input) {
    return this.bridge.createThread(input);
  }

  async localCreate({ baseThreadId, name, model }) {
    if (!this.local?.writable) throw Error('请先在电脑允许手机选择和新建会话');
    if (typeof baseThreadId !== 'string' || !baseThreadId) throw Error('请选择一个已有会话作为新对话的项目');
    const catalog = await this.catalog();
    const base = catalog.find(row => row.id === baseThreadId);
    if (!base) throw Error('请先选择一个已有会话作为新对话的项目');
    const cwd = await this.threadDirectory(baseThreadId);
    if (!cwd) throw Error('当前会话工作目录未就绪，请先同步该会话或选择其他项目');
    const groupId = typeof base.groupId === 'string' && base.groupId.startsWith('project:') ? base.groupId : 'codex-chats';
    const groupName = groupId.startsWith('project:') && typeof base.groupName === 'string' ? base.groupName : 'Codex 对话';
    const row = await this.local.createThread({
      cwd,
      name,
      model: typeof model === 'string' ? model : undefined,
      groupId,
      groupName,
      groupOrder: Number.isInteger(base.groupOrder) ? base.groupOrder : 2,
    });
    return row;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.local?.close();
    this.bridge.close();
    this.removeAllListeners();
  }
}
