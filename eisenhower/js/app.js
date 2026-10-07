import {
  QUADRANTS,
  classify,
  moveToQuadrant,
  sortTasks,
  nextAction,
  buildActionPlan,
  distribution,
  recommendations,
  projectProgress,
  dueReminders,
  daysUntil,
  toISODate,
  addDays,
  tasksToCSV,
  tasksToICS,
  openTasks,
} from './logic.js';
import { store, uid } from './store.js';

// ---------- Helpers ----------

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

const today = () => new Date();
const todayISO = () => toISODate(today());

function formatDate(iso) {
  if (!iso) return '';
  const days = daysUntil(iso);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days < 0) return `${-days}d overdue`;
  if (days < 7) return `in ${days}d`;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(y !== today().getFullYear() && { year: 'numeric' }) });
}

function dueClass(iso) {
  const days = daysUntil(iso);
  if (days === null) return '';
  if (days < 0) return 'overdue';
  if (days <= 2) return 'soon';
  return '';
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

let toastTimer;
function toast(message, action) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(message)}</span>${action ? `<button class="btn small ghost">${esc(action.label)}</button>` : ''}`;
  el.hidden = false;
  if (action) $('button', el).onclick = () => { action.run(); el.hidden = true; };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, action ? 6000 : 2500);
}

// In-app replacement for confirm()/prompt(), which are unreliable in iOS home-screen apps.
// Resolves to true/false, or to the entered string (null when cancelled) when `input` is given.
function ask({ title, message = '', input = null, okLabel = 'OK', danger = false }) {
  const dlg = $('#ask-dialog');
  const field = $('#ask-form').elements.value;
  $('#ask-title').textContent = title;
  $('#ask-message').textContent = message;
  $('#ask-message').hidden = !message;
  $('#ask-field').hidden = input === null;
  field.value = input ?? '';
  const ok = $('#ask-ok');
  ok.textContent = okLabel;
  ok.classList.toggle('danger', danger);
  ok.classList.toggle('primary', !danger);
  dlg.returnValue = '';
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => {
      const confirmed = dlg.returnValue === 'ok';
      resolve(input === null ? confirmed : confirmed ? field.value : null);
    }, { once: true });
    dlg.showModal();
    if (input !== null) {
      field.focus();
      field.select();
    } else ok.focus();
  });
}

$('#ask-form').addEventListener('submit', (e) => {
  e.preventDefault();
  $('#ask-dialog').close('ok');
});
$('#ask-cancel').addEventListener('click', () => $('#ask-dialog').close('cancel'));

const projectName = (id) => store.project(id)?.name || '';
const projectColor = (id) => store.project(id)?.color || 'var(--muted)';

// ---------- App state ----------

const ui = {
  view: 'matrix',
  projectFilter: 'all', // 'all' | 'none' | project id
  expandedProject: null,
};

function filteredOpenTasks() {
  let tasks = openTasks(store.state.tasks);
  if (ui.projectFilter === 'none') tasks = tasks.filter((t) => !t.projectId);
  else if (ui.projectFilter !== 'all') tasks = tasks.filter((t) => t.projectId === ui.projectFilter);
  return tasks;
}

// ---------- Rendering ----------

function render() {
  for (const v of $$('.view')) v.hidden = v.id !== `view-${ui.view}`;
  for (const t of $$('.tab')) t.classList.toggle('active', t.dataset.view === ui.view);
  $('#view-title').textContent = $(`#view-${ui.view}`).dataset.title;
  ({ matrix: renderMatrix, actions: renderActions, projects: renderProjects, insights: renderInsights })[ui.view]();
  renderBadge();
}

function renderBadge() {
  const plan = buildActionPlan(store.state.tasks, today());
  const n = plan.doNow.length + plan.scheduledToday.length + plan.followUps.length;
  const badge = $('#actions-badge');
  badge.hidden = n === 0;
  badge.textContent = n > 99 ? '99+' : n;
  if ('setAppBadge' in navigator) (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
}

function taskCard(task, { draggable = true } = {}) {
  const c = classify(task, today());
  const subDone = task.subtasks.filter((s) => s.done).length;
  const meta = [];
  if (task.projectId) meta.push(`<span class="tag"><i class="dot" style="background:${esc(projectColor(task.projectId))}"></i>${esc(projectName(task.projectId))}</span>`);
  if (task.dueDate) meta.push(`<span class="tag due ${dueClass(task.dueDate)}" title="Deadline ${esc(task.dueDate)}">⏰ ${esc(formatDate(task.dueDate))}</span>`);
  if (task.scheduledDate && c.quadrant === 2) meta.push(`<span class="tag" title="Planned for ${esc(task.scheduledDate)}">📅 ${esc(formatDate(task.scheduledDate))}</span>`);
  if (task.delegatedTo) meta.push(`<span class="tag" title="Delegated">👤 ${esc(task.delegatedTo)}</span>`);
  if (task.subtasks.length) meta.push(`<span class="tag">☑ ${subDone}/${task.subtasks.length}</span>`);
  if (c.pinned) meta.push('<span class="tag" title="Placed manually">📌</span>');
  if (c.escalated) meta.push('<span class="tag soon" title="Escalated by deadline">⬆ deadline</span>');
  return `<li class="card" data-id="${esc(task.id)}">
    ${draggable ? '<button class="handle" aria-label="Drag to another quadrant" title="Drag to move"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg></button>' : ''}
    <input type="checkbox" class="complete" aria-label="Mark done" ${task.status === 'done' ? 'checked' : ''}>
    <button class="card-body" data-edit="${esc(task.id)}">
      <span class="card-title">${esc(task.title)}</span>
      ${meta.length ? `<span class="card-meta">${meta.join('')}</span>` : ''}
    </button>
  </li>`;
}

function renderMatrix() {
  const projects = store.state.projects.filter((p) => !p.archived);
  if (ui.projectFilter !== 'all' && ui.projectFilter !== 'none' && !store.project(ui.projectFilter)) ui.projectFilter = 'all';
  const chip = (value, label, color) => `<button class="chip ${ui.projectFilter === value ? 'active' : ''}" data-filter="${esc(value)}">${color ? `<i class="dot" style="background:${esc(color)}"></i>` : ''}${esc(label)}</button>`;
  $('#matrix-filters').innerHTML = [chip('all', 'All'), ...projects.map((p) => chip(p.id, p.name, p.color)), chip('none', 'No project')].join('');

  const byQ = { 1: [], 2: [], 3: [], 4: [] };
  for (const t of filteredOpenTasks()) byQ[classify(t, today()).quadrant].push(t);

  $('#matrix').innerHTML = [1, 2, 3, 4].map((q) => {
    const Q = QUADRANTS[q];
    const list = sortTasks(byQ[q], today());
    return `<section class="quadrant q${q}" data-q="${q}" aria-label="${esc(Q.name)}">
      <header class="q-head">
        <div>
          <h2><span class="q-num">Q${q}</span> ${esc(Q.name)} <span class="count">${list.length}</span></h2>
          <p>${esc(Q.subtitle)} · <em>${esc(Q.verb)}</em></p>
        </div>
        <button class="icon-btn small" data-add-q="${q}" aria-label="Add task to ${esc(Q.name)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>
      </header>
      <ul class="cards">${list.map((t) => taskCard(t)).join('') || '<li class="empty">Nothing here</li>'}</ul>
    </section>`;
  }).join('');
}

function actionItem(task, buttons, extra = '') {
  const na = nextAction(task, today());
  return `<li class="action-item" data-id="${esc(task.id)}">
    <button class="card-body" data-edit="${esc(task.id)}">
      <span class="card-title">${esc(task.title)}</span>
      <span class="card-meta">
        ${task.projectId ? `<span class="tag"><i class="dot" style="background:${esc(projectColor(task.projectId))}"></i>${esc(projectName(task.projectId))}</span>` : ''}
        ${task.dueDate ? `<span class="tag due ${dueClass(task.dueDate)}">⏰ ${esc(formatDate(task.dueDate))}</span>` : ''}
        <span class="tag next">→ ${esc(na.label)}</span>
      </span>
    </button>
    ${extra}
    <div class="action-btns">${buttons}</div>
  </li>`;
}

function actionSection(id, title, q, hint, items) {
  if (!items.length) return '';
  return `<section class="action-group q${q}" id="${id}">
    <h2><span class="q-num">Q${q}</span> ${esc(title)} <span class="count">${items.length}</span></h2>
    <p class="muted">${esc(hint)}</p>
    <ul>${items.join('')}</ul>
  </section>`;
}

function renderActions() {
  const plan = buildActionPlan(filteredOpenTasks(), today());
  const done = '<button class="btn small primary" data-act="done">Done</button>';
  const tomorrow = addDays(todayISO(), 1);
  const nextWeek = addDays(todayISO(), 7);

  const sections = [
    actionSection('a-do', 'Do now', 1, 'Urgent and important. Deal with these today, ideally first thing.', plan.doNow.map((t) => actionItem(t, done))),
    actionSection('a-today', 'Planned for today', 2, 'You set aside time for these. Protect it.', plan.scheduledToday.map((t) => actionItem(t, `${done}<button class="btn small" data-act="plan" data-date="${tomorrow}">Tomorrow</button>`))),
    actionSection('a-followup', 'Follow up', 3, 'Delegated work that is due for a check-in.', plan.followUps.map((t) => actionItem(t, `${done}<button class="btn small" data-act="followup-later">Check again in 3d</button>`))),
    actionSection('a-schedule', 'Needs a date', 2, 'Important but not urgent. Give each one a time, or it will slip.', plan.toSchedule.map((t) => actionItem(t,
      `<button class="btn small" data-act="plan" data-date="${tomorrow}">Tomorrow</button><button class="btn small" data-act="plan" data-date="${nextWeek}">Next week</button><input type="date" class="inline-date" data-act="plan-date" aria-label="Pick a date" min="${todayISO()}">`))),
    actionSection('a-delegate', 'Delegate', 3, 'Urgent but not important to you. Who can take it over?', plan.toDelegate.map((t) => actionItem(t,
      `<input class="inline-input" placeholder="Hand off to…" list="people-list" aria-label="Delegate to" maxlength="100"><button class="btn small primary" data-act="delegate">Delegate</button>`))),
    actionSection('a-eliminate', 'Eliminate', 4, 'Neither urgent nor important. Drop it, or keep it only if it truly matters.', plan.toEliminate.map((t) => actionItem(t,
      '<button class="btn small danger" data-act="archive">Drop</button><button class="btn small" data-act="edit">Re-rate</button>'))),
    actionSection('a-waiting', 'Waiting for', 3, 'Delegated and in progress.', plan.waiting.map((t) => actionItem(t,
      `${done}`, t.followUpDate ? `<span class="muted small">Follow-up ${esc(formatDate(t.followUpDate))}</span>` : ''))),
    actionSection('a-upcoming', 'Coming up', 2, 'Planned for later.', plan.upcoming.map((t) => actionItem(t, `<span class="tag">📅 ${esc(formatDate(t.scheduledDate))}</span>`))),
  ].filter(Boolean);

  updatePeopleList();
  $('#view-actions').innerHTML = sections.length
    ? `${filterNotice()}${sections.join('')}`
    : `${filterNotice()}<div class="empty-state"><h2>All clear 🎉</h2><p>No actions pending. Add tasks with the + button.</p></div>`;
}

function filterNotice() {
  if (ui.projectFilter === 'all') return '';
  const label = ui.projectFilter === 'none' ? 'No project' : projectName(ui.projectFilter);
  return `<p class="filter-notice">Filtered by <b>${esc(label)}</b> <button class="btn small ghost" data-filter="all">Show all</button></p>`;
}

function renderProjects() {
  const tasks = store.state.tasks;
  const projects = store.state.projects;
  const card = (p) => {
    const prog = projectProgress(tasks, p.id);
    const open = tasks.filter((t) => t.projectId === p.id && t.status === 'open');
    const dist = distribution(open, today());
    const expanded = ui.expandedProject === p.id;
    const list = sortTasks(tasks.filter((t) => t.projectId === p.id && t.status !== 'archived'), today())
      .sort((a, b) => (a.status === 'done') - (b.status === 'done'));
    return `<li class="project ${expanded ? 'expanded' : ''}" data-project="${esc(p.id)}">
      <div class="project-head">
        <input type="color" value="${esc(p.color)}" class="color" aria-label="Project color" data-act="color">
        <button class="project-name" data-act="toggle" aria-expanded="${expanded}">${esc(p.name)} <span class="chev" aria-hidden="true">${expanded ? '▾' : '▸'}</span></button>
        <span class="muted small">${prog.done}/${prog.total}</span>
        <button class="icon-btn small" data-act="rename" aria-label="Rename project" title="Rename"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>
        <button class="icon-btn small danger" data-act="delete" aria-label="Delete project" title="Delete"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg></button>
      </div>
      <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(prog.ratio * 100)}"><span style="width:${prog.ratio * 100}%;background:${esc(p.color)}"></span></div>
      <div class="mini-dist">${[1, 2, 3, 4].map((q) => `<span class="mini q${q}" title="${esc(QUADRANTS[q].name)}">Q${q} ${dist[q]}</span>`).join('')}</div>
      ${expanded ? `<ul class="cards plain">${list.map((t) => taskCard(t, { draggable: false })).join('') || '<li class="empty">No tasks yet</li>'}</ul>
      <div class="btn-row">
        <button class="btn small primary" data-act="add">Add task</button>
        <button class="btn small" data-act="show">Show in matrix</button>
      </div>` : ''}
    </li>`;
  };
  const unassigned = tasks.filter((t) => !t.projectId && t.status === 'open').length;
  $('#view-projects').innerHTML = `
    <form class="add-project" id="add-project">
      <input name="name" placeholder="New project name" maxlength="80" required autocomplete="off" aria-label="New project name">
      <button class="btn primary">Add</button>
    </form>
    ${projects.length ? `<ul class="projects">${projects.map(card).join('')}</ul>` : '<div class="empty-state"><p>No projects yet. Group related tasks into projects to track progress.</p></div>'}
    ${unassigned ? `<p class="muted">${unassigned} open task${unassigned === 1 ? '' : 's'} without a project. <button class="btn small ghost" data-filter="none">Show</button></p>` : ''}`;
}

function renderInsights() {
  const tasks = store.state.tasks;
  const open = openTasks(tasks);
  const dist = distribution(tasks, today());
  const total = open.length || 1;
  const weekAgo = Date.now() - 7 * 86400000;
  const doneWeek = tasks.filter((t) => t.status === 'done' && t.completedAt && Date.parse(t.completedAt) >= weekAgo).length;
  const overdue = open.filter((t) => (daysUntil(t.dueDate) ?? 1) < 0).length;
  const archived = tasks.filter((t) => t.status === 'archived');
  const done = tasks.filter((t) => t.status === 'done').sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));

  $('#view-insights').innerHTML = `
    <div class="stats">
      <div class="stat"><b>${open.length}</b><span>Open</span></div>
      <div class="stat"><b>${doneWeek}</b><span>Done in 7 days</span></div>
      <div class="stat ${overdue ? 'warn' : ''}"><b>${overdue}</b><span>Overdue</span></div>
    </div>
    <section class="panel">
      <h2>Distribution</h2>
      <ul class="bars">${[1, 2, 3, 4].map((q) => `
        <li class="q${q}"><span class="bar-label">Q${q} ${esc(QUADRANTS[q].name)}</span>
          <span class="bar"><span style="width:${(dist[q] / total) * 100}%"></span></span>
          <span class="bar-val">${dist[q]} · ${Math.round((dist[q] / total) * 100)}%</span></li>`).join('')}
      </ul>
    </section>
    <section class="panel">
      <h2>Recommendations</h2>
      <ul class="recs">${recommendations(tasks, today()).map((r) => `<li class="rec ${r.level}">${esc(r.text)}</li>`).join('')}</ul>
    </section>
    <details class="panel">
      <summary><h2>Completed (${done.length})</h2></summary>
      <ul class="simple-list">${done.slice(0, 100).map((t) => `<li data-id="${esc(t.id)}"><span>${esc(t.title)}</span><button class="btn small ghost" data-act="reopen">Reopen</button></li>`).join('') || '<li class="muted">Nothing yet</li>'}</ul>
    </details>
    <details class="panel">
      <summary><h2>Archived (${archived.length})</h2></summary>
      <ul class="simple-list">${archived.map((t) => `<li data-id="${esc(t.id)}"><span>${esc(t.title)}</span><span><button class="btn small ghost" data-act="reopen">Restore</button><button class="btn small danger ghost" data-act="purge">Delete</button></span></li>`).join('') || '<li class="muted">Nothing archived</li>'}</ul>
    </details>`;
}

function updatePeopleList() {
  const people = [...new Set(store.state.tasks.map((t) => t.delegatedTo).filter(Boolean))].sort();
  $('#people-list').innerHTML = people.map((p) => `<option value="${esc(p)}">`).join('');
}

// ---------- Task editor ----------

const sheet = $('#task-sheet');
const form = $('#task-form');
const editor = { id: null, override: null, subtasks: [] };

function draftFromForm() {
  const f = form.elements;
  return {
    importance: Number(f.importance.value),
    urgency: Number(f.urgency.value),
    dueDate: f.dueDate.value || null,
    override: editor.override,
  };
}

function updatePreview() {
  const f = form.elements;
  f.importanceOut.value = f.importance.value;
  f.urgencyOut.value = f.urgency.value;
  const draft = draftFromForm();
  const c = classify(draft, today());
  const Q = QUADRANTS[c.quadrant];
  $('#quadrant-preview').className = `preview q${c.quadrant}`;
  $('#quadrant-preview').innerHTML = `
    <div><b>Q${c.quadrant} · ${esc(Q.name)}</b> <span class="muted">${esc(Q.verb)}</span>
      ${c.escalated ? '<span class="tag soon">⬆ deadline makes it urgent</span>' : ''}
      ${c.pinned ? '<span class="tag">📌 placed manually</span>' : ''}</div>
    <div class="q-pick" role="group" aria-label="Place in quadrant">
      ${[1, 2, 3, 4].map((q) => `<button type="button" class="q-btn q${q} ${q === c.quadrant ? 'active' : ''}" data-pick="${q}" title="${esc(QUADRANTS[q].name)}">Q${q}</button>`).join('')}
    </div>`;
  for (const el of $$('.q-fields', form)) el.hidden = Number(el.dataset.q) !== c.quadrant;
  $('#task-reset-pin').hidden = !editor.override;
}

function renderSubtasks() {
  $('#subtask-list').innerHTML = editor.subtasks.map((s) => `
    <li data-sub="${esc(s.id)}">
      <label><input type="checkbox" ${s.done ? 'checked' : ''}> <span>${esc(s.title)}</span></label>
      <button type="button" class="icon-btn small" data-remove-sub aria-label="Remove subtask"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
    </li>`).join('');
}

function openEditor(id = null, presets = {}) {
  const task = id ? store.task(id) : null;
  const t = task || { title: '', notes: '', projectId: null, importance: 3, urgency: 2, dueDate: null, scheduledDate: null, delegatedTo: '', followUpDate: null, override: null, subtasks: [], ...presets };
  editor.id = id;
  editor.override = t.override ? { ...t.override } : null;
  editor.subtasks = t.subtasks.map((s) => ({ ...s }));

  const f = form.elements;
  $('#task-sheet-title').textContent = task ? 'Edit task' : 'New task';
  f.projectId.innerHTML = `<option value="">No project</option>${store.state.projects.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}`;
  f.title.value = t.title;
  f.projectId.value = t.projectId || '';
  f.importance.value = t.importance;
  f.urgency.value = t.urgency;
  f.dueDate.value = t.dueDate || '';
  f.scheduledDate.value = t.scheduledDate || '';
  f.delegatedTo.value = t.delegatedTo || '';
  f.followUpDate.value = t.followUpDate || '';
  f.notes.value = t.notes || '';
  $('#task-delete').hidden = !task;
  $('#subtask-input').value = '';
  updatePeopleList();
  renderSubtasks();
  updatePreview();
  sheet.showModal();
  if (!task) f.title.focus();
}

form.addEventListener('input', (e) => {
  if (e.target.name === 'importance' || e.target.name === 'urgency') editor.override = null; // re-rating replaces a manual placement
  if (['importance', 'urgency', 'dueDate'].includes(e.target.name)) updatePreview();
});

$('#quadrant-preview').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-pick]');
  if (!btn) return;
  const moved = moveToQuadrant({ ...draftFromForm(), override: null }, Number(btn.dataset.pick), today());
  editor.override = moved.override;
  updatePreview();
});

$('#task-reset-pin').addEventListener('click', () => {
  editor.override = null;
  updatePreview();
});

function addSubtask() {
  const input = $('#subtask-input');
  const title = input.value.trim();
  if (!title) return;
  editor.subtasks.push({ id: uid(), title, done: false });
  input.value = '';
  renderSubtasks();
  input.focus();
}
$('#subtask-add-btn').addEventListener('click', addSubtask);
$('#subtask-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addSubtask();
  }
});
$('#subtask-list').addEventListener('click', (e) => {
  const li = e.target.closest('[data-sub]');
  if (!li) return;
  const sub = editor.subtasks.find((s) => s.id === li.dataset.sub);
  if (e.target.closest('[data-remove-sub]')) editor.subtasks = editor.subtasks.filter((s) => s !== sub);
  else if (e.target.matches('input[type=checkbox]')) sub.done = e.target.checked;
  renderSubtasks();
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = form.elements;
  const title = f.title.value.trim();
  if (!title) {
    f.title.focus();
    f.title.setCustomValidity('Please enter a title');
    f.title.reportValidity();
    f.title.setCustomValidity('');
    return;
  }
  const delegatedTo = f.delegatedTo.value.trim();
  const fields = {
    title,
    projectId: f.projectId.value || null,
    importance: Number(f.importance.value),
    urgency: Number(f.urgency.value),
    dueDate: f.dueDate.value || null,
    scheduledDate: f.scheduledDate.value || null,
    delegatedTo,
    followUpDate: f.followUpDate.value || (delegatedTo ? addDays(todayISO(), 3) : null),
    notes: f.notes.value.trim(),
    override: editor.override,
    subtasks: editor.subtasks,
  };
  if (editor.id) store.updateTask(editor.id, fields);
  else store.addTask(fields);
  sheet.close();
  const q = classify(fields, today()).quadrant;
  toast(`Saved to Q${q} · ${QUADRANTS[q].name}`);
});

$('#task-delete').addEventListener('click', () => {
  const task = store.task(editor.id);
  if (!task) return;
  store.deleteTask(task.id);
  sheet.close();
  toast('Task deleted', { label: 'Undo', run: () => store.addTask(task) });
});

for (const dlg of $$('dialog')) {
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg || e.target.closest('[data-close]')) dlg.close();
  });
}

// ---------- Task actions ----------

function completeTask(id, done = true) {
  const prev = store.task(id);
  if (!prev) return;
  store.setStatus(id, done ? 'done' : 'open');
  if (done) toast(`Done: ${prev.title}`, { label: 'Undo', run: () => store.updateTask(id, { status: prev.status, completedAt: prev.completedAt }) });
}

function handleAction(act, id, el) {
  const task = store.task(id);
  if (!task) return;
  switch (act) {
    case 'done':
      completeTask(id);
      break;
    case 'plan':
      store.updateTask(id, { scheduledDate: el.dataset.date });
      toast(`Planned for ${formatDate(el.dataset.date)}`);
      break;
    case 'followup-later':
      store.updateTask(id, { followUpDate: addDays(todayISO(), 3) });
      toast('Follow-up moved by 3 days');
      break;
    case 'delegate': {
      const input = $('.inline-input', el.closest('li'));
      const who = input.value.trim();
      if (!who) {
        input.focus();
        return;
      }
      store.updateTask(id, { delegatedTo: who, followUpDate: task.followUpDate || addDays(todayISO(), 3) });
      toast(`Delegated to ${who}. Follow-up in 3 days.`);
      break;
    }
    case 'archive':
      store.setStatus(id, 'archived');
      toast('Dropped', { label: 'Undo', run: () => store.setStatus(id, 'open') });
      break;
    case 'reopen':
      store.setStatus(id, 'open');
      break;
    case 'purge':
      store.deleteTask(id);
      toast('Deleted', { label: 'Undo', run: () => store.addTask(task) });
      break;
    case 'edit':
      openEditor(id);
      break;
  }
}

document.addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (tab) {
    ui.view = tab.dataset.view;
    render();
    window.scrollTo({ top: 0 });
    return;
  }
  const filter = e.target.closest('[data-filter]');
  if (filter) {
    ui.projectFilter = filter.dataset.filter;
    if (ui.view === 'projects') ui.view = 'matrix';
    render();
    return;
  }
  const addQ = e.target.closest('[data-add-q]');
  if (addQ) {
    const Q = QUADRANTS[addQ.dataset.addQ];
    openEditor(null, {
      importance: Q.important ? 4 : 2,
      urgency: Q.urgent ? 4 : 2,
      projectId: ['all', 'none'].includes(ui.projectFilter) ? null : ui.projectFilter,
    });
    return;
  }
  const edit = e.target.closest('[data-edit]');
  if (edit && !dragState) {
    openEditor(edit.dataset.edit);
    return;
  }
  const act = e.target.closest('[data-act]');
  if (act && act.tagName === 'BUTTON') {
    const projectEl = act.closest('[data-project]');
    if (projectEl) return handleProjectAction(act.dataset.act, projectEl.dataset.project);
    const li = act.closest('[data-id]');
    if (li) handleAction(act.dataset.act, li.dataset.id, act);
  }
});

document.addEventListener('change', (e) => {
  if (e.target.matches('.card .complete')) {
    completeTask(e.target.closest('[data-id]').dataset.id, e.target.checked);
  } else if (e.target.matches('[data-act="plan-date"]') && e.target.value) {
    const id = e.target.closest('[data-id]').dataset.id;
    store.updateTask(id, { scheduledDate: e.target.value });
    toast(`Planned for ${formatDate(e.target.value)}`);
  } else if (e.target.matches('[data-act="color"]')) {
    store.updateProject(e.target.closest('[data-project]').dataset.project, { color: e.target.value });
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('.inline-input')) {
    e.preventDefault();
    handleAction('delegate', e.target.closest('[data-id]').dataset.id, e.target);
  }
});

// ---------- Projects ----------

function handleProjectAction(act, id) {
  const p = store.project(id);
  if (!p) return;
  switch (act) {
    case 'toggle':
      ui.expandedProject = ui.expandedProject === id ? null : id;
      render();
      break;
    case 'add':
      openEditor(null, { projectId: id });
      break;
    case 'show':
      ui.projectFilter = id;
      ui.view = 'matrix';
      render();
      break;
    case 'rename':
      ask({ title: 'Rename project', input: p.name, okLabel: 'Save' }).then((name) => {
        if (name && name.trim()) store.updateProject(id, { name: name.trim() });
      });
      break;
    case 'delete':
      ask({ title: 'Delete project?', message: `"${p.name}" will be removed. Its tasks are kept without a project.`, okLabel: 'Delete', danger: true }).then((ok) => {
        if (!ok) return;
        const taskIds = store.state.tasks.filter((t) => t.projectId === id).map((t) => t.id);
        store.deleteProject(id);
        toast(`Project "${p.name}" deleted`, {
          label: 'Undo',
          run: () => {
            store.importData({ projects: [...store.state.projects, p], tasks: store.state.tasks.map((t) => (taskIds.includes(t.id) ? { ...t, projectId: id } : t)) });
          },
        });
      });
      break;
  }
}

document.addEventListener('submit', (e) => {
  if (e.target.id !== 'add-project') return;
  e.preventDefault();
  const name = e.target.elements.name.value.trim();
  if (!name) return;
  const p = store.addProject(name);
  ui.expandedProject = p.id;
  render();
  toast(`Project "${name}" created`);
});

// ---------- Drag & drop (pointer based, works with touch, mouse, and pen) ----------

let dragState = null;

document.addEventListener('pointerdown', (e) => {
  const handle = e.target.closest('.matrix .handle');
  if (!handle || e.button > 0) return;
  e.preventDefault();
  const card = handle.closest('.card');
  const rect = card.getBoundingClientRect();
  const ghost = card.cloneNode(true);
  ghost.classList.add('ghost');
  Object.assign(ghost.style, { width: `${rect.width}px`, left: `${rect.left}px`, top: `${rect.top}px` });
  document.body.append(ghost);
  card.classList.add('dragging');
  dragState = { id: card.dataset.id, card, ghost, dx: e.clientX - rect.left, dy: e.clientY - rect.top, target: null, pointerId: e.pointerId };
  handle.setPointerCapture(e.pointerId);
  navigator.vibrate?.(10);
});

document.addEventListener('pointermove', (e) => {
  if (!dragState || e.pointerId !== dragState.pointerId) return;
  dragState.ghost.style.left = `${e.clientX - dragState.dx}px`;
  dragState.ghost.style.top = `${e.clientY - dragState.dy}px`;
  const under = document.elementFromPoint(e.clientX, e.clientY)?.closest('.quadrant');
  if (under !== dragState.target) {
    dragState.target?.classList.remove('drop-target');
    under?.classList.add('drop-target');
    dragState.target = under;
  }
  // Auto-scroll near the viewport edges.
  if (e.clientY < 80) window.scrollBy(0, -8);
  else if (e.clientY > window.innerHeight - 100) window.scrollBy(0, 8);
});

function endDrag(e, cancelled = false) {
  if (!dragState || e.pointerId !== dragState.pointerId) return;
  const { id, card, ghost, target } = dragState;
  ghost.remove();
  card.classList.remove('dragging');
  target?.classList.remove('drop-target');
  setTimeout(() => { dragState = null; }, 0);
  if (cancelled || !target) return;
  const task = store.task(id);
  const q = Number(target.dataset.q);
  if (!task || classify(task, today()).quadrant === q) return;
  const moved = moveToQuadrant(task, q, today());
  store.updateTask(id, { override: moved.override });
  const result = classify(moved, today()).quadrant;
  if (result !== q) toast(`Deadline is close, so it stays urgent (Q${result})`);
  else toast(`Moved to Q${q} · ${QUADRANTS[q].name}`, { label: 'Undo', run: () => store.updateTask(id, { override: task.override }) });
}

document.addEventListener('pointerup', (e) => endDrag(e));
document.addEventListener('pointercancel', (e) => endDrag(e, true));

// ---------- Settings, backup, reminders ----------

const settingsSheet = $('#settings-sheet');
$('#btn-settings').addEventListener('click', () => {
  updateNotificationButton();
  settingsSheet.showModal();
});

function applyTheme() {
  const t = store.settings.theme;
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  $('meta[name=theme-color]').content = dark ? '#111827' : '#4f46e5';
}

$('#btn-theme').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  store.saveSettings({ theme: dark ? 'light' : 'dark' });
  applyTheme();
});

const stamp = () => todayISO();
$('#btn-export-json').addEventListener('click', () => download(`eisenhower-backup-${stamp()}.json`, JSON.stringify(store.exportData(), null, 2), 'application/json'));
$('#btn-export-csv').addEventListener('click', () => download(`eisenhower-tasks-${stamp()}.csv`, '﻿' + tasksToCSV(store.state.tasks, store.state.projects, today()), 'text/csv;charset=utf-8'));
$('#btn-export-ics').addEventListener('click', () => download(`eisenhower-${stamp()}.ics`, tasksToICS(store.state.tasks), 'text/calendar;charset=utf-8'));

$('#import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const merge = $('#import-merge').checked;
    if (!merge && !(await ask({ title: 'Replace all data?', message: 'All current projects and tasks on this device will be replaced by the backup.', okLabel: 'Replace', danger: true }))) return;
    store.importData(data, merge ? 'merge' : 'replace');
    toast(`Imported ${data.tasks.length} tasks`);
    settingsSheet.close();
  } catch (err) {
    toast(`Import failed: ${err.message}`);
  }
});

$('#btn-clear').addEventListener('click', async () => {
  if (!(await ask({ title: 'Delete all data?', message: 'All projects and tasks on this device will be deleted. Export a backup first if you might need them.', okLabel: 'Delete all', danger: true }))) return;
  store.clearAll();
  settingsSheet.close();
  toast('All data deleted');
});

$('#btn-sample').addEventListener('click', () => {
  loadSampleData();
  settingsSheet.close();
});

function loadSampleData() {
  const d = (n) => addDays(todayISO(), n);
  const launch = store.addProject('Product launch');
  const home = store.addProject('Home & personal');
  const team = store.addProject('Team');
  const add = (t) => store.addTask(t);
  add({ title: 'Fix payment bug reported by customers', projectId: launch.id, importance: 5, urgency: 5, dueDate: d(0) });
  add({ title: 'Prepare launch presentation', projectId: launch.id, importance: 4, urgency: 3, dueDate: d(2), subtasks: [{ id: uid(), title: 'Outline', done: true }, { id: uid(), title: 'Slides', done: false }, { id: uid(), title: 'Rehearse', done: false }] });
  add({ title: 'Define Q3 product strategy', projectId: launch.id, importance: 5, urgency: 2, dueDate: d(30) });
  add({ title: 'Write onboarding documentation', projectId: launch.id, importance: 4, urgency: 1, scheduledDate: d(3) });
  add({ title: 'Book flights for trade fair', projectId: launch.id, importance: 2, urgency: 4, dueDate: d(5), delegatedTo: 'Alex', followUpDate: d(0) });
  add({ title: 'Collect expense receipts', projectId: team.id, importance: 2, urgency: 4 });
  add({ title: 'Answer routine meeting invites', projectId: team.id, importance: 1, urgency: 3 });
  add({ title: '1:1 career talks with team', projectId: team.id, importance: 4, urgency: 2 });
  add({ title: 'Annual health check-up', projectId: home.id, importance: 4, urgency: 2 });
  add({ title: 'Reorganize photo library', projectId: home.id, importance: 1, urgency: 1 });
  add({ title: 'Scroll through newsletter backlog', importance: 1, urgency: 2 });
  add({ title: 'Renew passport', projectId: home.id, importance: 4, urgency: 2, dueDate: d(-1) });
  toast('Sample data loaded');
}

function updateNotificationButton() {
  const btn = $('#btn-notifications');
  if (!('Notification' in window)) {
    btn.disabled = true;
    btn.textContent = 'Notifications not supported';
    return;
  }
  const on = Notification.permission === 'granted' && store.settings.notifications;
  btn.textContent = on ? 'Notifications on: tap to turn off' : Notification.permission === 'denied' ? 'Notifications blocked in browser settings' : 'Enable notifications';
  btn.disabled = Notification.permission === 'denied';
}

$('#btn-notifications').addEventListener('click', async () => {
  if (store.settings.notifications && Notification.permission === 'granted') {
    store.saveSettings({ notifications: false });
  } else {
    const perm = await Notification.requestPermission();
    store.saveSettings({ notifications: perm === 'granted' });
    if (perm === 'granted') {
      toast('Reminders enabled');
      checkReminders(true);
    }
  }
  updateNotificationButton();
});

async function notify(title, body) {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) return reg.showNotification(title, { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'eisenhower-daily' });
    new Notification(title, { body, icon: 'icons/icon-192.png' });
  } catch (e) {
    console.warn('Notification failed', e);
  }
}

// Notifies once per task, reason, and day while the app is opened or resumed.
function checkReminders(force = false) {
  if (!store.settings.notifications || !('Notification' in window) || Notification.permission !== 'granted') return;
  const key = todayISO();
  const notified = store.settings.notified?.[key] || [];
  const fresh = dueReminders(store.state.tasks, today()).filter((r) => force || !notified.includes(`${r.task.id}:${r.kind}`));
  if (!fresh.length) return;
  const label = { overdue: 'Overdue', due: 'Due today', followup: 'Follow up', scheduled: 'Planned today' };
  const body = fresh.slice(0, 5).map((r) => `${label[r.kind]}: ${r.task.title}`).join('\n') + (fresh.length > 5 ? `\n+${fresh.length - 5} more` : '');
  notify(fresh.length === 1 ? '1 task needs attention' : `${fresh.length} tasks need attention`, body);
  store.saveSettings({ notified: { [key]: [...new Set([...notified, ...fresh.map((r) => `${r.task.id}:${r.kind}`)])] } });
}

// ---------- Boot ----------

$('#fab').addEventListener('click', () => {
  openEditor(null, { projectId: ['all', 'none'].includes(ui.projectFilter) ? null : ui.projectFilter });
});

store.subscribe(() => render());
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

let lastDay = todayISO();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (todayISO() !== lastDay) {
    lastDay = todayISO();
    render(); // deadlines may have escalated overnight
  }
  checkReminders();
});

const params = new URLSearchParams(location.search);
if (['matrix', 'actions', 'projects', 'insights'].includes(params.get('view'))) ui.view = params.get('view');

// Keep dialogs inside the visible area when the on-screen keyboard opens (iOS does not resize the layout viewport).
function updateViewportVars() {
  const vv = window.visualViewport;
  if (!vv) return;
  const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
  document.documentElement.style.setProperty('--vvh', `${vv.height}px`);
  document.documentElement.style.setProperty('--kb', `${kb}px`);
}
window.visualViewport?.addEventListener('resize', updateViewportVars);
window.visualViewport?.addEventListener('scroll', updateViewportVars);
updateViewportVars();

// Bring the focused field into view inside a sheet once the keyboard is up.
document.addEventListener('focusin', (e) => {
  if (e.target.matches('dialog input, dialog textarea, dialog select')) {
    setTimeout(() => e.target.scrollIntoView({ block: 'nearest' }), 300);
  }
});

applyTheme();
render();
checkReminders();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.register('sw.js').then((reg) => reg.update()).catch((e) => console.warn('SW registration failed', e));
  // Reload once when an updated service worker takes over, so fixes show up without reinstalling.
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    location.reload();
  });
}
navigator.storage?.persist?.().catch(() => {});
