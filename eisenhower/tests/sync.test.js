import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Minimal localStorage for the store module.
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const { store } = await import('../js/store.js');
const { TeamSync, mergeRemote } = await import('../js/team/sync.js');
const { buildActionPlan } = await import('../js/logic.js');
const { MemoryServer, MemoryRemote } = await import('./fake-remote.js');

const alice = { id: 'alice', name: 'Alice Doe', email: 'alice@example.com', tenantId: 't' };
const bob = { id: 'bob', name: 'Bob Roe', email: 'bob@example.com', tenantId: 't' };

let server;
const as = (user) => {
  store.useTeam({ meId: user.id, storageKey: `test.${user.id}` });
  return new TeamSync(new MemoryRemote(server, user));
};

beforeEach(() => {
  mem.clear();
  server = new MemoryServer();
});

test('changes from one member reach the other', async () => {
  let sync = as(alice);
  const p = store.addProject('Launch');
  store.addTask({ title: 'Write spec', projectId: p.id });
  await sync.syncNow();
  assert.deepEqual(store.state.pending, {});
  assert.ok(store.state.tasks[0]._sp, 'server id recorded');

  sync = as(bob);
  await sync.syncNow();
  assert.equal(store.state.projects.length, 1);
  assert.equal(store.state.tasks[0].title, 'Write spec');
  assert.equal(store.state.tasks[0].ownerId, 'alice');

  store.updateTask(store.state.tasks[0].id, { title: 'Write spec v2' });
  await sync.syncNow();

  sync = as(alice);
  await sync.syncNow();
  assert.equal(store.state.tasks[0].title, 'Write spec v2');
});

test('deletions propagate and are not resurrected', async () => {
  let sync = as(alice);
  const t = store.addTask({ title: 'Temp' });
  await sync.syncNow();

  sync = as(bob);
  await sync.syncNow();
  store.deleteTask(t.id);
  assert.equal(Object.keys(store.state.tombstones).length, 1);
  await sync.syncNow();
  assert.equal(store.state.tasks.length, 0);

  sync = as(alice);
  await sync.syncNow();
  assert.equal(store.state.tasks.length, 0, 'deleted on the server, so dropped locally');
});

test('offline edits are kept and pushed later', async () => {
  const sync = as(alice);
  sync.remote.offline = true;
  store.addTask({ title: 'On the train' });
  await sync.syncNow();
  assert.equal(sync.status.state, 'offline');
  assert.equal(Object.keys(store.state.pending).length, 1);
  assert.equal(store.state.tasks.length, 1);

  sync.remote.offline = false;
  await sync.syncNow();
  assert.equal(sync.status.state, 'ok');
  assert.deepEqual(store.state.pending, {});
  assert.equal(Object.keys(server.read().items.task).length, 1);
});

test('private tasks go to the personal store only', async () => {
  let sync = as(alice);
  const t = store.addTask({ title: 'Salary talk', private: true });
  store.addTask({ title: 'Shared thing' });
  await sync.syncNow();
  assert.equal(Object.keys(server.read().items.task).length, 1);
  assert.match(server.read().private.alice, /Salary talk/);

  sync = as(bob);
  await sync.syncNow();
  assert.deepEqual(store.state.tasks.map((x) => x.title), ['Shared thing']);

  // Making it shared moves it to SharePoint.
  sync = as(alice);
  await sync.syncNow();
  assert.equal(store.state.tasks.length, 2);
  store.updateTask(t.id, { private: false });
  await sync.syncNow();
  assert.equal(Object.keys(server.read().items.task).length, 2);
  assert.doesNotMatch(server.read().private.alice, /Salary talk/);
});

test('delegating to a teammate moves the task to their matrix', async () => {
  let sync = as(alice);
  const t = store.addTask({ title: 'Book flights', importance: 2, urgency: 4 });
  store.updateTask(t.id, { ownerId: 'bob', delegatedById: 'alice', followUpDate: '2026-10-08' });
  await sync.syncNow();
  const today = new Date(2026, 9, 7);
  let plan = buildActionPlan(store.state.tasks, today, 'alice');
  assert.deepEqual(plan.waiting.map((x) => x.title), ['Book flights']);
  assert.equal(plan.toDelegate.length, 0);

  sync = as(bob);
  await sync.syncNow();
  plan = buildActionPlan(store.state.tasks, today, 'bob');
  assert.deepEqual(plan.toDelegate.map((x) => x.title), ['Book flights'], 'Bob sees it as his own Q3 task');
  assert.equal(plan.waiting.length, 0);
});

test('local pending edits win over an older server copy', () => {
  const local = {
    projects: [], members: [], tombstones: {}, privateDirty: false,
    pending: { 'task:1': true },
    tasks: [{ id: '1', title: 'mine', updatedAt: '2026-10-07T10:00:00Z', _sp: '5' }],
  };
  const remote = { projects: [], members: [], tasks: [{ id: '1', title: 'server', updatedAt: '2026-10-07T09:00:00Z', _sp: '5' }] };
  assert.equal(mergeRemote(local, remote).tasks[0].title, 'mine');
  assert.equal(mergeRemote({ ...local, pending: {} }, remote).tasks[0].title, 'server');
});

test('duplicate server rows for one record keep the newest', () => {
  const local = { projects: [], members: [], tasks: [], tombstones: {}, privateDirty: false, pending: {} };
  const remote = {
    projects: [], members: [],
    tasks: [{ id: '1', title: 'old', updatedAt: '2026-01-01', _sp: '1' }, { id: '1', title: 'new', updatedAt: '2026-02-01', _sp: '2' }],
  };
  assert.deepEqual(mergeRemote(local, remote).tasks.map((t) => t.title), ['new']);
});

test('starting to poll keeps a scheduled push', async () => {
  const sync = as(alice);
  store.addTask({ title: 'Queued' });
  sync.schedulePush(10);
  sync.startPolling();
  await new Promise((r) => setTimeout(r, 50));
  sync.stopPolling();
  await sync.running;
  assert.equal(Object.keys(server.read().items.task).length, 1);
});
