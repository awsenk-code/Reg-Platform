// App state backed by localStorage. In team mode it is a cache of the SharePoint data plus an
// outbox of unsynced changes (`pending` / `tombstones`) that js/team/sync.js pushes to the server.
import { normalizeBackup } from './logic.js';

const LOCAL_KEY = 'eisenhower.v1';
const SETTINGS_KEY = 'eisenhower.settings.v1';

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

const PROJECT_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#14b8a6'];
export const MEMBER_COLORS = ['#e11d48', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d'];

const KINDS = { project: 'projects', task: 'tasks', member: 'members' };
const now = () => new Date().toISOString();

function safeParse(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // storage blocked
  }
}

const emptyState = () => ({ version: 1, projects: [], tasks: [], members: [], pending: {}, tombstones: {}, privateDirty: false, lastSync: null });

function load(key) {
  const data = safeParse(read(key), null);
  if (!data) return emptyState();
  try {
    return {
      ...emptyState(),
      ...normalizeBackup(data),
      pending: data.pending || {},
      tombstones: data.tombstones || {},
      privateDirty: Boolean(data.privateDirty),
      lastSync: data.lastSync || null,
    };
  } catch {
    return emptyState();
  }
}

const listeners = new Set();
let storageKey = LOCAL_KEY;
let state = load(storageKey);
let team = null; // { meId } while signed in to team mode
let settings = {
  theme: 'auto',
  notifications: false,
  notified: {},
  ...safeParse(read(SETTINGS_KEY), {}),
};

function persist({ silent = false } = {}) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
  } catch (e) {
    console.error('Saving failed', e);
  }
  if (!silent) listeners.forEach((fn) => fn(state));
}

// Records a local change so the sync engine pushes it. No-op in local mode.
function touch(kind, record) {
  if (!team) return;
  if (kind === 'task' && record.private) {
    state.privateDirty = true;
    return;
  }
  state.pending = { ...state.pending, [`${kind}:${record.id}`]: true };
}

function removeRecord(kind, id) {
  const list = KINDS[kind];
  const record = state[list].find((r) => r.id === id);
  if (!record) return null;
  state = { ...state, [list]: state[list].filter((r) => r.id !== id) };
  if (team) {
    const key = `${kind}:${id}`;
    const { [key]: _, ...pending } = state.pending;
    state.pending = pending;
    if (record._sp) state.tombstones = { ...state.tombstones, [key]: record._sp };
    if (kind === 'task' && record.private) state.privateDirty = true;
  }
  return record;
}

export const store = {
  get state() {
    return state;
  },
  get settings() {
    return settings;
  },
  get team() {
    return team;
  },
  get meId() {
    return team?.meId || null;
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  saveSettings(patch) {
    settings = { ...settings, ...patch };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* ignore */
    }
  },

  // Switches to the team cache of the signed-in user (or back to the local data with null).
  useTeam(teamInfo) {
    team = teamInfo ? { meId: teamInfo.meId } : null;
    storageKey = teamInfo ? teamInfo.storageKey : LOCAL_KEY;
    state = load(storageKey);
    listeners.forEach((fn) => fn(state));
  },
  // Local (single-device) data, used to offer moving it into the team space.
  localData() {
    return load(LOCAL_KEY);
  },

  // Tasks
  task(id) {
    return state.tasks.find((t) => t.id === id);
  },
  addTask(fields) {
    const task = {
      id: uid(),
      title: '',
      notes: '',
      projectId: null,
      importance: 3,
      urgency: 2,
      dueDate: null,
      scheduledDate: null,
      delegatedTo: '',
      followUpDate: null,
      override: null,
      subtasks: [],
      status: 'open',
      createdAt: now(),
      completedAt: null,
      ownerId: team?.meId || null,
      delegatedById: null,
      private: false,
      ...fields,
      updatedAt: now(),
    };
    delete task._sp;
    state = { ...state, tasks: [...state.tasks, task] };
    touch('task', task);
    persist();
    return task;
  },
  updateTask(id, patch) {
    const prev = this.task(id);
    if (!prev) return;
    let next = { ...prev, ...patch, updatedAt: now() };
    // Moving a task between shared (SharePoint) and private (OneDrive) storage.
    if (team && Boolean(prev.private) !== Boolean(next.private)) {
      state.privateDirty = true;
      if (next.private && prev._sp) {
        state.tombstones = { ...state.tombstones, [`task:${id}`]: prev._sp };
        const { [`task:${id}`]: _, ...pending } = state.pending;
        state.pending = pending;
        next = { ...next };
        delete next._sp;
      }
    }
    state = { ...state, tasks: state.tasks.map((t) => (t.id === id ? next : t)) };
    touch('task', next);
    persist();
  },
  setStatus(id, status) {
    this.updateTask(id, { status, completedAt: status === 'done' ? now() : null });
  },
  deleteTask(id) {
    removeRecord('task', id);
    persist();
  },
  // Re-adds a deleted task (undo). In team mode it is created again on the server.
  restoreTask(task) {
    const copy = { ...task, updatedAt: now() };
    delete copy._sp;
    state = { ...state, tasks: [...state.tasks.filter((t) => t.id !== task.id), copy] };
    const key = `task:${task.id}`;
    const { [key]: _, ...tombstones } = state.tombstones;
    state.tombstones = tombstones;
    touch('task', copy);
    persist();
  },

  // Projects
  project(id) {
    return state.projects.find((p) => p.id === id);
  },
  addProject(name) {
    const project = { id: uid(), name, color: PROJECT_COLORS[state.projects.length % PROJECT_COLORS.length], createdAt: now(), createdBy: team?.meId || null, archived: false, updatedAt: now() };
    state = { ...state, projects: [...state.projects, project] };
    touch('project', project);
    persist();
    return project;
  },
  updateProject(id, patch) {
    let updated = null;
    state = { ...state, projects: state.projects.map((p) => (p.id === id ? (updated = { ...p, ...patch, updatedAt: now() }) : p)) };
    if (updated) touch('project', updated);
    persist();
  },
  // Removes the project; its tasks are kept but become unassigned.
  deleteProject(id) {
    removeRecord('project', id);
    const affected = new Set(state.tasks.filter((t) => t.projectId === id).map((t) => t.id));
    state = { ...state, tasks: state.tasks.map((t) => (affected.has(t.id) ? { ...t, projectId: null, updatedAt: now() } : t)) };
    state.tasks.filter((t) => affected.has(t.id)).forEach((t) => touch('task', t));
    persist();
  },
  // Restores a deleted project and re-links the given tasks (undo).
  restoreProject(project, taskIds) {
    const copy = { ...project, updatedAt: now() };
    delete copy._sp;
    const key = `project:${project.id}`;
    const { [key]: _, ...tombstones } = state.tombstones;
    state = {
      ...state,
      tombstones,
      projects: [...state.projects, copy],
      tasks: state.tasks.map((t) => (taskIds.includes(t.id) ? { ...t, projectId: project.id, updatedAt: now() } : t)),
    };
    touch('project', copy);
    state.tasks.filter((t) => taskIds.includes(t.id)).forEach((t) => touch('task', t));
    persist();
  },

  // Members (team mode)
  member(id) {
    return state.members.find((m) => m.id === id);
  },
  upsertMember(member) {
    const existing = this.member(member.id);
    const next = { ...existing, ...member, updatedAt: now() };
    state = { ...state, members: existing ? state.members.map((m) => (m.id === member.id ? next : m)) : [...state.members, next] };
    touch('member', next);
    persist();
    return next;
  },

  // Sync engine hook. `silent` skips re-rendering for bookkeeping-only changes.
  replaceState(next, { silent = false } = {}) {
    state = next;
    persist({ silent });
  },

  // Backup
  exportData() {
    const strip = (r) => {
      const { _sp, ...rest } = r;
      return rest;
    };
    return { app: 'eisenhower-matrix', version: 1, exportedAt: now(), projects: state.projects.map(strip), tasks: state.tasks.map(strip), members: state.members.map(strip) };
  },
  importData(data, mode = 'replace') {
    const incoming = normalizeBackup(data);
    // Imported records are new to the server: drop server ids, claim ownerless tasks, queue them for upload.
    const fresh = (r) => {
      const copy = { ...r, updatedAt: now() };
      delete copy._sp;
      return copy;
    };
    incoming.projects = incoming.projects.map(fresh);
    incoming.tasks = incoming.tasks.map((t) => ({ ...fresh(t), ownerId: t.ownerId || team?.meId || null }));
    if (mode === 'merge') {
      const projectIds = new Set(state.projects.map((p) => p.id));
      const taskIds = new Set(state.tasks.map((t) => t.id));
      const newProjects = incoming.projects.filter((p) => !projectIds.has(p.id));
      const newTasks = incoming.tasks.filter((t) => !taskIds.has(t.id));
      state = { ...state, projects: [...state.projects, ...newProjects], tasks: [...state.tasks, ...newTasks] };
      newProjects.forEach((p) => touch('project', p));
      newTasks.forEach((t) => touch('task', t));
    } else {
      if (team) {
        for (const p of state.projects) if (p._sp) state.tombstones[`project:${p.id}`] = p._sp;
        for (const t of state.tasks) if (t._sp) state.tombstones[`task:${t.id}`] = t._sp;
        state.pending = {};
        state.privateDirty = true;
      }
      state = { ...state, projects: incoming.projects, tasks: incoming.tasks };
      incoming.projects.forEach((p) => touch('project', p));
      incoming.tasks.forEach((t) => touch('task', t));
    }
    persist();
  },
  clearAll() {
    if (team) {
      // Shared projects and teammates' tasks stay; only my own tasks are removed.
      const mine = (t) => t.ownerId === team.meId || t.private;
      for (const t of state.tasks) if (mine(t) && t._sp) state.tombstones[`task:${t.id}`] = t._sp;
      const pending = Object.fromEntries(Object.entries(state.pending).filter(([k]) => !k.startsWith('task:') || !mine(this.task(k.slice(5)) || {})));
      state = { ...state, tasks: state.tasks.filter((t) => !mine(t)), pending, privateDirty: true };
    } else {
      state = emptyState();
    }
    persist();
  },
};

export { PROJECT_COLORS };
