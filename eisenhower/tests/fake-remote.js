// In-memory stand-in (server.read/write may be sync or async) for SharePoint/OneDrive used by the tests. Implements the same interface as
// js/team/graph.js. The browser tests inject it through window.__EISENHOWER_REMOTE__.

export function memoryStorage() {
  let data = null;
  return { get: () => data, set: (d) => { data = JSON.parse(JSON.stringify(d)); } };
}

export class MemoryServer {
  constructor(storage = memoryStorage()) {
    this.storage = storage;
  }
  read() {
    return this.storage.get() || { seq: 0, items: { project: {}, task: {}, member: {} }, private: {} };
  }
  write(d) {
    this.storage.set(d);
  }
}

export class MemoryRemote {
  constructor(server, user) {
    this.server = server;
    this.user = user;
    this.offline = false;
    this.signedIn = true;
  }
  check() {
    if (this.offline) throw new TypeError('Failed to fetch');
  }
  // Auth surface used by app.js
  async init() {
    return this.signedIn ? this.user : null;
  }
  account() {
    return this.signedIn ? this.user : null;
  }
  async login() {
    this.signedIn = true;
  }
  async logout() {
    this.signedIn = false;
  }
  async ensureSetup() {
    this.check();
  }
  // Data surface used by js/team/sync.js
  async fetchAll() {
    this.check();
    const d = await this.server.read();
    const list = (kind) => Object.entries(d.items[kind]).map(([sp, json]) => ({ ...JSON.parse(json), _sp: sp }));
    return { projects: list('project'), tasks: list('task'), members: list('member') };
  }
  async upsert(kind, record) {
    this.check();
    const d = await this.server.read();
    const { _sp, ...data } = record;
    let sp = _sp && d.items[kind][_sp] ? _sp : null;
    if (!sp) sp = String(++d.seq);
    d.items[kind][sp] = JSON.stringify(data);
    await this.server.write(d);
    return sp;
  }
  async remove(kind, sp) {
    this.check();
    const d = await this.server.read();
    delete d.items[kind][sp];
    await this.server.write(d);
  }
  async loadPrivate() {
    this.check();
    return JSON.parse((await this.server.read()).private[this.user.id] || '[]');
  }
  async savePrivate(tasks) {
    this.check();
    const d = await this.server.read();
    d.private[this.user.id] = JSON.stringify(tasks);
    await this.server.write(d);
  }
}
