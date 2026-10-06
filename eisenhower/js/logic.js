// Pure domain logic for the Eisenhower matrix. No DOM access here so it can be unit-tested in Node.

export const SCORE_THRESHOLD = 3; // scores >= 3 (on a 1–5 scale) count as "high"
export const CRITICAL_DAYS = 2; // deadlines this close always make a task urgent

export const QUADRANTS = {
  1: { id: 1, key: 'do', name: 'Do', subtitle: 'Urgent & important', verb: 'Do it now', important: true, urgent: true },
  2: { id: 2, key: 'schedule', name: 'Schedule', subtitle: 'Important, not urgent', verb: 'Plan a time', important: true, urgent: false },
  3: { id: 3, key: 'delegate', name: 'Delegate', subtitle: 'Urgent, not important', verb: 'Hand it off', important: false, urgent: true },
  4: { id: 4, key: 'eliminate', name: 'Eliminate', subtitle: 'Neither urgent nor important', verb: 'Drop it', important: false, urgent: false },
};

export function quadrantFor(important, urgent) {
  if (important) return urgent ? 1 : 2;
  return urgent ? 3 : 4;
}

// --- Dates (all handled as local "YYYY-MM-DD" strings) ---

export function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseISODate(str) {
  if (!str) return null;
  const [y, m, d] = str.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export function addDays(isoDate, days) {
  const d = parseISODate(isoDate);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

// Whole days from `today` until `isoDate` (negative = past). null when no date.
export function daysUntil(isoDate, today = new Date()) {
  const target = parseISODate(isoDate);
  if (!target) return null;
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target - base) / 86400000);
}

// Urgency implied by a deadline alone, on the same 1–5 scale.
export function deadlineUrgency(dueDate, today = new Date()) {
  const days = daysUntil(dueDate, today);
  if (days === null) return 0;
  if (days <= 0) return 5;
  if (days <= CRITICAL_DAYS) return 4;
  if (days <= 7) return 3;
  if (days <= 14) return 2;
  return 1;
}

export function isDeadlineCritical(dueDate, today = new Date()) {
  const days = daysUntil(dueDate, today);
  return days !== null && days <= CRITICAL_DAYS;
}

// --- Classification ---

export function effectiveUrgency(task, today = new Date()) {
  return Math.max(task.urgency ?? 1, deadlineUrgency(task.dueDate, today));
}

// Returns { quadrant, important, urgent, escalated, pinned }.
// `override` ({important, urgent}) is set by drag & drop; an imminent deadline still forces urgency.
export function classify(task, today = new Date()) {
  const critical = isDeadlineCritical(task.dueDate, today);
  let important;
  let urgent;
  const pinned = Boolean(task.override);
  if (pinned) {
    important = task.override.important;
    urgent = task.override.urgent || critical;
  } else {
    important = (task.importance ?? 1) >= SCORE_THRESHOLD;
    urgent = effectiveUrgency(task, today) >= SCORE_THRESHOLD;
  }
  const baseUrgent = pinned ? task.override.urgent : (task.urgency ?? 1) >= SCORE_THRESHOLD;
  return {
    quadrant: quadrantFor(important, urgent),
    important,
    urgent,
    escalated: urgent && !baseUrgent,
    pinned,
  };
}

// Applies a drop into a quadrant. Clears the override when the scores already land there.
export function moveToQuadrant(task, quadrantId, today = new Date()) {
  const q = QUADRANTS[quadrantId];
  const auto = classify({ ...task, override: null }, today);
  if (auto.quadrant === quadrantId) return { ...task, override: null };
  return { ...task, override: { important: q.important, urgent: q.urgent } };
}

// Sort key inside a quadrant: overdue/soonest deadline first, then combined score.
export function priorityScore(task, today = new Date()) {
  const days = daysUntil(task.dueDate, today);
  const deadlineWeight = days === null ? 0 : Math.max(0, 30 - days);
  return (task.importance ?? 1) * 10 + effectiveUrgency(task, today) * 8 + deadlineWeight;
}

export function sortTasks(tasks, today = new Date()) {
  return [...tasks].sort((a, b) => priorityScore(b, today) - priorityScore(a, today));
}

// --- Derived actions ("Maßnahmen") ---

// Returns the concrete next step for a task given its quadrant and state.
export function nextAction(task, today = new Date()) {
  const { quadrant } = classify(task, today);
  const due = daysUntil(task.dueDate, today);
  switch (quadrant) {
    case 1:
      if (due !== null && due < 0) return { type: 'do', label: `Overdue by ${-due} day${due === -1 ? '' : 's'} – do it now` };
      if (due === 0) return { type: 'do', label: 'Due today – do it now' };
      return { type: 'do', label: 'Block time today and finish it' };
    case 2:
      if (!task.scheduledDate) return { type: 'schedule', label: 'Pick a date to work on it', missing: true };
      return { type: 'schedule', label: `Planned for ${task.scheduledDate}` };
    case 3: {
      if (!task.delegatedTo) return { type: 'delegate', label: 'Choose someone to hand this to', missing: true };
      const fu = daysUntil(task.followUpDate, today);
      if (fu !== null && fu <= 0) return { type: 'followup', label: `Follow up with ${task.delegatedTo}` };
      return { type: 'waiting', label: `Waiting for ${task.delegatedTo}` };
    }
    default:
      return { type: 'eliminate', label: 'Drop it or archive it', missing: true };
  }
}

// Groups open tasks into the action lists shown on the Actions screen.
export function buildActionPlan(tasks, today = new Date()) {
  const todayISO = toISODate(today);
  const plan = { doNow: [], toSchedule: [], scheduledToday: [], upcoming: [], toDelegate: [], followUps: [], waiting: [], toEliminate: [] };
  for (const task of openTasks(tasks)) {
    const { quadrant } = classify(task, today);
    if (quadrant === 1) plan.doNow.push(task);
    else if (quadrant === 2) {
      if (!task.scheduledDate) plan.toSchedule.push(task);
      else if (task.scheduledDate <= todayISO) plan.scheduledToday.push(task);
      else plan.upcoming.push(task);
    } else if (quadrant === 3) {
      if (!task.delegatedTo) plan.toDelegate.push(task);
      else if (task.followUpDate && task.followUpDate <= todayISO) plan.followUps.push(task);
      else plan.waiting.push(task);
    } else plan.toEliminate.push(task);
  }
  plan.doNow = sortTasks(plan.doNow, today);
  plan.upcoming.sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));
  plan.waiting.sort((a, b) => (a.followUpDate || '9999').localeCompare(b.followUpDate || '9999'));
  return plan;
}

export function openTasks(tasks) {
  return tasks.filter((t) => t.status === 'open');
}

export function distribution(tasks, today = new Date()) {
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const t of openTasks(tasks)) counts[classify(t, today).quadrant]++;
  return counts;
}

// Coaching hints derived from the current distribution.
export function recommendations(tasks, today = new Date()) {
  const open = openTasks(tasks);
  const counts = distribution(tasks, today);
  const total = open.length;
  const recs = [];
  if (total === 0) {
    recs.push({ level: 'info', text: 'No open tasks. Capture what is on your mind and rate it.' });
    return recs;
  }
  const share = (q) => counts[q] / total;
  const overdue = open.filter((t) => (daysUntil(t.dueDate, today) ?? 1) < 0).length;
  if (overdue) recs.push({ level: 'warn', text: overdue === 1 ? '1 task is overdue. Clear it first or renegotiate the deadline.' : `${overdue} tasks are overdue. Clear them first or renegotiate the deadlines.` });
  if (share(1) > 0.4) recs.push({ level: 'warn', text: 'Firefighting mode: over 40% of your tasks are urgent & important. Spend more time in Q2 so fewer things become crises.' });
  if (counts[2] > 0 && share(2) < 0.25) recs.push({ level: 'info', text: 'Q2 is where the long-term value is. Aim to have at least a quarter of your work there.' });
  if (counts[2] === 0) recs.push({ level: 'info', text: 'Nothing in Q2. Add goals, prevention, learning, and relationship work.' });
  const unscheduled = open.filter((t) => classify(t, today).quadrant === 2 && !t.scheduledDate).length;
  if (unscheduled) recs.push({ level: 'info', text: `${unscheduled} Q2 task${unscheduled === 1 ? ' has' : 's have'} no date yet. Put them on the calendar, or they will slip.` });
  const undelegated = open.filter((t) => classify(t, today).quadrant === 3 && !t.delegatedTo).length;
  if (undelegated) recs.push({ level: 'info', text: `${undelegated} Q3 task${undelegated === 1 ? '' : 's'} could be handed off. Find someone or automate it.` });
  if (counts[4] >= 3) recs.push({ level: 'info', text: `${counts[4]} tasks in Q4. Be ruthless: archive what does not matter.` });
  if (recs.length === 0) recs.push({ level: 'ok', text: 'Well balanced. Keep protecting your Q2 time.' });
  return recs;
}

export function projectProgress(tasks, projectId) {
  const list = tasks.filter((t) => t.projectId === projectId && t.status !== 'archived');
  const done = list.filter((t) => t.status === 'done').length;
  return { total: list.length, done, ratio: list.length ? done / list.length : 0 };
}

// Tasks needing a reminder: due today/overdue, or a follow-up is due.
export function dueReminders(tasks, today = new Date()) {
  const todayISO = toISODate(today);
  const out = [];
  for (const t of openTasks(tasks)) {
    if (t.dueDate && t.dueDate <= todayISO) out.push({ task: t, kind: t.dueDate < todayISO ? 'overdue' : 'due' });
    if (t.delegatedTo && t.followUpDate && t.followUpDate <= todayISO) out.push({ task: t, kind: 'followup' });
    if (t.scheduledDate === todayISO) out.push({ task: t, kind: 'scheduled' });
  }
  return out;
}

// --- Import / export ---

const CSV_COLUMNS = ['title', 'project', 'quadrant', 'importance', 'urgency', 'dueDate', 'scheduledDate', 'delegatedTo', 'followUpDate', 'status', 'notes'];

function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function tasksToCSV(tasks, projects, today = new Date()) {
  const names = Object.fromEntries(projects.map((p) => [p.id, p.name]));
  const rows = tasks.map((t) => [
    t.title,
    names[t.projectId] || '',
    `Q${classify(t, today).quadrant}`,
    t.importance,
    t.urgency,
    t.dueDate || '',
    t.scheduledDate || '',
    t.delegatedTo || '',
    t.followUpDate || '',
    t.status,
    t.notes || '',
  ]);
  return [CSV_COLUMNS, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
}

function icsEscape(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

// All-day calendar events for scheduled dates, deadlines, and follow-ups.
export function tasksToICS(tasks, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Eisenhower Matrix//EN', 'CALSCALE:GREGORIAN'];
  const event = (uid, date, summary, description) => {
    const start = date.replace(/-/g, '');
    const end = addDays(date, 1).replace(/-/g, '');
    lines.push('BEGIN:VEVENT', `UID:${uid}@eisenhower-matrix`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${start}`, `DTEND;VALUE=DATE:${end}`, `SUMMARY:${icsEscape(summary)}`);
    if (description) lines.push(`DESCRIPTION:${icsEscape(description)}`);
    lines.push('END:VEVENT');
  };
  for (const t of openTasks(tasks)) {
    if (t.scheduledDate) event(`${t.id}-scheduled`, t.scheduledDate, t.title, t.notes);
    if (t.dueDate) event(`${t.id}-due`, t.dueDate, `Deadline: ${t.title}`, t.notes);
    if (t.delegatedTo && t.followUpDate) event(`${t.id}-followup`, t.followUpDate, `Follow up with ${t.delegatedTo}: ${t.title}`, t.notes);
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

// Validates and normalizes an imported backup. Throws on invalid input.
export function normalizeBackup(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.tasks) || !Array.isArray(data.projects)) {
    throw new Error('Not a valid Eisenhower backup file.');
  }
  const clamp = (n, d) => {
    const v = Number(n);
    return Number.isFinite(v) ? Math.min(5, Math.max(1, Math.round(v))) : d;
  };
  const projects = data.projects
    .filter((p) => p && p.id && p.name)
    .map((p) => ({ id: String(p.id), name: String(p.name), color: p.color || '#6366f1', createdAt: p.createdAt || new Date().toISOString(), archived: Boolean(p.archived) }));
  const tasks = data.tasks
    .filter((t) => t && t.id && t.title)
    .map((t) => ({
      id: String(t.id),
      title: String(t.title),
      notes: t.notes ? String(t.notes) : '',
      projectId: t.projectId ? String(t.projectId) : null,
      importance: clamp(t.importance, 3),
      urgency: clamp(t.urgency, 2),
      dueDate: t.dueDate || null,
      scheduledDate: t.scheduledDate || null,
      delegatedTo: t.delegatedTo || '',
      followUpDate: t.followUpDate || null,
      override: t.override && typeof t.override === 'object' ? { important: Boolean(t.override.important), urgent: Boolean(t.override.urgent) } : null,
      subtasks: Array.isArray(t.subtasks) ? t.subtasks.filter((s) => s && s.title).map((s) => ({ id: String(s.id || Math.random().toString(36).slice(2)), title: String(s.title), done: Boolean(s.done) })) : [],
      status: ['open', 'done', 'archived'].includes(t.status) ? t.status : 'open',
      createdAt: t.createdAt || new Date().toISOString(),
      completedAt: t.completedAt || null,
    }));
  return { version: 1, projects, tasks };
}
