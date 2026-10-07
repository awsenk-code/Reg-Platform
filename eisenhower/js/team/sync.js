// Offline-first sync between the local store and a remote (SharePoint via Graph, or a test double).
//
// Remote interface:
//   fetchAll()               -> { projects, tasks, members } (records carry `_sp`, the server item id)
//   upsert(kind, record)     -> server item id (creates when record._sp is missing or gone)
//   remove(kind, spId)       -> void (missing items are ignored)
//   loadPrivate()            -> private tasks array ([] when none)
//   savePrivate(tasks)       -> void
//
// Conflict policy: local unsynced changes win until pushed, after that the server copy is the
// source of truth (last write wins per record).
import { store } from '../store.js';

const LISTS = { project: 'projects', task: 'tasks', member: 'members' };

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Keeps the newest copy when the same record exists twice on the server (e.g. a retried create).
export function dedupe(records) {
  const byId = new Map();
  for (const r of records) {
    const prev = byId.get(r.id);
    if (!prev || (r.updatedAt || '') > (prev.updatedAt || '')) byId.set(r.id, r);
  }
  return [...byId.values()];
}

// Pure merge of a server snapshot into the local state.
// `privateTasks` is null when the private file was not (re)loaded.
export function mergeRemote(local, remote, privateTasks = null) {
  const out = { ...local };
  for (const [kind, list] of Object.entries(LISTS)) {
    const remoteList = dedupe(remote[list] || []);
    const localById = new Map(local[list].map((r) => [r.id, r]));
    const remoteIds = new Set(remoteList.map((r) => r.id));
    const merged = [];
    for (const r of remoteList) {
      const key = `${kind}:${r.id}`;
      if (local.tombstones[key]) continue; // deleted here, delete not pushed yet
      const mine = localById.get(r.id);
      if (local.pending[key] && mine) merged.push({ ...mine, _sp: r._sp });
      else merged.push(r);
    }
    for (const l of local[list]) {
      if (remoteIds.has(l.id)) continue;
      if (kind === 'task' && l.private) continue;
      // New here and not pushed yet: keep. Otherwise it was deleted on the server: drop.
      if (local.pending[`${kind}:${l.id}`]) merged.push(l);
    }
    out[list] = merged;
  }
  const localPrivate = local.tasks.filter((t) => t.private);
  const priv = local.privateDirty || privateTasks === null ? localPrivate : privateTasks.map((t) => ({ ...t, private: true }));
  out.tasks = [...out.tasks.filter((t) => !t.private), ...priv];
  return out;
}

export class TeamSync {
  constructor(remote, { onStatus = () => {}, interval = 30000 } = {}) {
    this.remote = remote;
    this.onStatus = onStatus;
    this.interval = interval;
    this.running = null;
    this.again = false;
    this.pushTimer = null;
    this.pollTimer = null;
    this.status = { state: 'idle', lastSync: store.state.lastSync, error: null };
  }

  setStatus(patch) {
    this.status = { ...this.status, ...patch };
    this.onStatus(this.status);
  }

  hasLocalChanges() {
    const s = store.state;
    return Object.keys(s.pending).length > 0 || Object.keys(s.tombstones).length > 0 || s.privateDirty;
  }

  // Runs a full push + pull. Concurrent calls coalesce into one follow-up run.
  syncNow() {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.again = false;
          await this.runOnce();
        } while (this.again);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  // Debounced push after local edits.
  schedulePush(delay = 1500) {
    clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => this.syncNow(), delay);
  }

  startPolling() {
    clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') this.syncNow();
    }, this.interval);
  }

  stopPolling() {
    clearInterval(this.pollTimer);
    clearTimeout(this.pushTimer);
  }

  async runOnce() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.setStatus({ state: 'offline' });
      return;
    }
    this.setStatus({ state: 'syncing', error: null });
    try {
      await this.push();
      const remote = await this.remote.fetchAll();
      const privateTasks = store.state.privateDirty ? null : await this.remote.loadPrivate();
      const merged = mergeRemote(store.state, remote, privateTasks);
      const lastSync = new Date().toISOString();
      const changed = !same(merged.projects, store.state.projects) || !same(merged.tasks, store.state.tasks) || !same(merged.members, store.state.members);
      store.replaceState({ ...merged, lastSync }, { silent: !changed });
      this.setStatus({ state: 'ok', lastSync });
    } catch (e) {
      console.warn('Sync failed', e);
      const offline = e?.name === 'TypeError' || (typeof navigator !== 'undefined' && navigator.onLine === false);
      this.setStatus({ state: offline ? 'offline' : 'error', error: e?.message || String(e) });
    }
  }

  async push() {
    for (const [key, spId] of Object.entries(store.state.tombstones)) {
      await this.remote.remove(key.split(':')[0], spId);
      const { [key]: _, ...tombstones } = store.state.tombstones;
      store.replaceState({ ...store.state, tombstones }, { silent: true });
    }
    for (const key of Object.keys(store.state.pending)) {
      const sep = key.indexOf(':');
      const kind = key.slice(0, sep);
      const id = key.slice(sep + 1);
      const list = LISTS[kind];
      const record = store.state[list].find((r) => r.id === id);
      if (!record || (kind === 'task' && record.private)) {
        const { [key]: _, ...pending } = store.state.pending;
        store.replaceState({ ...store.state, pending }, { silent: true });
        continue;
      }
      const spId = await this.remote.upsert(kind, record);
      // Edits made while the request was in flight stay pending for the next round.
      const current = store.state[list].find((r) => r.id === id);
      const pending = { ...store.state.pending };
      if (current && current.updatedAt === record.updatedAt) delete pending[key];
      store.replaceState({ ...store.state, pending, [list]: store.state[list].map((r) => (r.id === id ? { ...r, _sp: spId } : r)) }, { silent: true });
    }
    if (store.state.privateDirty) {
      const snapshot = store.state.tasks.filter((t) => t.private);
      await this.remote.savePrivate(snapshot.map(({ _sp, ...t }) => t));
      const stillSame = same(snapshot, store.state.tasks.filter((t) => t.private));
      store.replaceState({ ...store.state, privateDirty: !stillSame }, { silent: true });
    }
  }
}
