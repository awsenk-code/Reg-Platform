// Persistent app state backed by localStorage. Everything stays on the device.
import { normalizeBackup } from './logic.js';

const STORAGE_KEY = 'eisenhower.v1';
const SETTINGS_KEY = 'eisenhower.settings.v1';

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

const PROJECT_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#14b8a6'];

function safeParse(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function load() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    /* storage blocked */
  }
  const data = safeParse(raw, null);
  if (!data) return { version: 1, projects: [], tasks: [] };
  try {
    return normalizeBackup(data);
  } catch {
    return { version: 1, projects: [], tasks: [] };
  }
}

const listeners = new Set();
let state = load();
let settings = {
  theme: 'auto',
  notifications: false,
  notified: {},
  ...safeParse((() => { try { return localStorage.getItem(SETTINGS_KEY); } catch { return null; } })(), {}),
};

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Saving failed', e);
  }
  listeners.forEach((fn) => fn(state));
}

export const store = {
  get state() {
    return state;
  },
  get settings() {
    return settings;
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
      createdAt: new Date().toISOString(),
      completedAt: null,
      ...fields,
    };
    state = { ...state, tasks: [...state.tasks, task] };
    persist();
    return task;
  },
  updateTask(id, patch) {
    state = { ...state, tasks: state.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) };
    persist();
  },
  setStatus(id, status) {
    this.updateTask(id, { status, completedAt: status === 'done' ? new Date().toISOString() : null });
  },
  deleteTask(id) {
    state = { ...state, tasks: state.tasks.filter((t) => t.id !== id) };
    persist();
  },

  // Projects
  project(id) {
    return state.projects.find((p) => p.id === id);
  },
  addProject(name) {
    const project = { id: uid(), name, color: PROJECT_COLORS[state.projects.length % PROJECT_COLORS.length], createdAt: new Date().toISOString(), archived: false };
    state = { ...state, projects: [...state.projects, project] };
    persist();
    return project;
  },
  updateProject(id, patch) {
    state = { ...state, projects: state.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)) };
    persist();
  },
  // Removes the project; its tasks are kept but become unassigned.
  deleteProject(id) {
    state = {
      ...state,
      projects: state.projects.filter((p) => p.id !== id),
      tasks: state.tasks.map((t) => (t.projectId === id ? { ...t, projectId: null } : t)),
    };
    persist();
  },

  // Backup
  exportData() {
    return { app: 'eisenhower-matrix', version: 1, exportedAt: new Date().toISOString(), projects: state.projects, tasks: state.tasks };
  },
  importData(data, mode = 'replace') {
    const incoming = normalizeBackup(data);
    if (mode === 'merge') {
      const projectIds = new Set(state.projects.map((p) => p.id));
      const taskIds = new Set(state.tasks.map((t) => t.id));
      state = {
        version: 1,
        projects: [...state.projects, ...incoming.projects.filter((p) => !projectIds.has(p.id))],
        tasks: [...state.tasks, ...incoming.tasks.filter((t) => !taskIds.has(t.id))],
      };
    } else {
      state = incoming;
    }
    persist();
  },
  clearAll() {
    state = { version: 1, projects: [], tasks: [] };
    persist();
  },
};

export { PROJECT_COLORS };
