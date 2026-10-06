import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classify,
  moveToQuadrant,
  deadlineUrgency,
  buildActionPlan,
  nextAction,
  recommendations,
  projectProgress,
  dueReminders,
  tasksToCSV,
  tasksToICS,
  normalizeBackup,
  addDays,
} from '../js/logic.js';

const TODAY = new Date(2026, 9, 6); // 2026-10-06
const d = (n) => addDays('2026-10-06', n);
const task = (fields = {}) => ({ id: 't1', title: 'Task', importance: 3, urgency: 2, status: 'open', subtasks: [], override: null, ...fields });

test('classifies by importance and urgency scores', () => {
  assert.equal(classify(task({ importance: 5, urgency: 5 }), TODAY).quadrant, 1);
  assert.equal(classify(task({ importance: 4, urgency: 1 }), TODAY).quadrant, 2);
  assert.equal(classify(task({ importance: 2, urgency: 4 }), TODAY).quadrant, 3);
  assert.equal(classify(task({ importance: 1, urgency: 1 }), TODAY).quadrant, 4);
  assert.equal(classify(task({ importance: 3, urgency: 3 }), TODAY).quadrant, 1, 'threshold is inclusive');
});

test('deadline raises urgency', () => {
  assert.equal(deadlineUrgency(d(-3), TODAY), 5);
  assert.equal(deadlineUrgency(d(0), TODAY), 5);
  assert.equal(deadlineUrgency(d(2), TODAY), 4);
  assert.equal(deadlineUrgency(d(7), TODAY), 3);
  assert.equal(deadlineUrgency(d(30), TODAY), 1);
  assert.equal(deadlineUrgency(null, TODAY), 0);
  const c = classify(task({ importance: 4, urgency: 1, dueDate: d(5) }), TODAY);
  assert.equal(c.quadrant, 1);
  assert.equal(c.escalated, true);
  assert.equal(classify(task({ importance: 4, urgency: 1, dueDate: d(20) }), TODAY).quadrant, 2);
});

test('manual placement overrides scores but not an imminent deadline', () => {
  const t = moveToQuadrant(task({ importance: 5, urgency: 5 }), 4, TODAY);
  assert.deepEqual(t.override, { important: false, urgent: false });
  assert.equal(classify(t, TODAY).quadrant, 4);
  assert.equal(classify(t, TODAY).pinned, true);

  const critical = moveToQuadrant(task({ importance: 5, urgency: 1, dueDate: d(1) }), 2, TODAY);
  assert.equal(classify(critical, TODAY).quadrant, 1, 'deadline within 2 days forces urgency');
});

test('moving to the quadrant the scores already give clears the override', () => {
  const pinned = { ...task({ importance: 5, urgency: 5 }), override: { important: false, urgent: false } };
  assert.equal(moveToQuadrant(pinned, 1, TODAY).override, null);
});

test('builds the action plan per quadrant', () => {
  const tasks = [
    task({ id: 'a', importance: 5, urgency: 5 }),
    task({ id: 'b', importance: 5, urgency: 1 }),
    task({ id: 'c', importance: 5, urgency: 1, scheduledDate: d(0) }),
    task({ id: 'd', importance: 5, urgency: 1, scheduledDate: d(4) }),
    task({ id: 'e', importance: 1, urgency: 5 }),
    task({ id: 'f', importance: 1, urgency: 5, delegatedTo: 'Sam', followUpDate: d(-1) }),
    task({ id: 'g', importance: 1, urgency: 5, delegatedTo: 'Sam', followUpDate: d(3) }),
    task({ id: 'h', importance: 1, urgency: 1 }),
    task({ id: 'i', importance: 5, urgency: 5, status: 'done' }),
  ];
  const plan = buildActionPlan(tasks, TODAY);
  const ids = (list) => list.map((t) => t.id);
  assert.deepEqual(ids(plan.doNow), ['a']);
  assert.deepEqual(ids(plan.toSchedule), ['b']);
  assert.deepEqual(ids(plan.scheduledToday), ['c']);
  assert.deepEqual(ids(plan.upcoming), ['d']);
  assert.deepEqual(ids(plan.toDelegate), ['e']);
  assert.deepEqual(ids(plan.followUps), ['f']);
  assert.deepEqual(ids(plan.waiting), ['g']);
  assert.deepEqual(ids(plan.toEliminate), ['h']);
});

test('next action labels', () => {
  assert.match(nextAction(task({ importance: 5, urgency: 1, dueDate: d(-2) }), TODAY).label, /Overdue by 2 days/);
  assert.equal(nextAction(task({ importance: 5, urgency: 1 }), TODAY).missing, true);
  assert.match(nextAction(task({ importance: 1, urgency: 5, delegatedTo: 'Kim', followUpDate: d(0) }), TODAY).label, /Follow up with Kim/);
  assert.equal(nextAction(task({ importance: 1, urgency: 1 }), TODAY).type, 'eliminate');
});

test('recommendations flag firefighting and overdue work', () => {
  const tasks = [task({ id: '1', importance: 5, urgency: 5, dueDate: d(-1) }), task({ id: '2', importance: 5, urgency: 5 })];
  const texts = recommendations(tasks, TODAY).map((r) => r.text).join(' ');
  assert.match(texts, /overdue/);
  assert.match(texts, /Firefighting/);
  assert.match(texts, /Nothing in Q2/);
});

test('project progress ignores archived tasks', () => {
  const tasks = [
    task({ id: '1', projectId: 'p', status: 'done' }),
    task({ id: '2', projectId: 'p' }),
    task({ id: '3', projectId: 'p', status: 'archived' }),
    task({ id: '4', projectId: 'q' }),
  ];
  assert.deepEqual(projectProgress(tasks, 'p'), { total: 2, done: 1, ratio: 0.5 });
});

test('reminders for due, overdue, follow-up and scheduled tasks', () => {
  const kinds = dueReminders([
    task({ id: '1', dueDate: d(0) }),
    task({ id: '2', dueDate: d(-1) }),
    task({ id: '3', delegatedTo: 'X', followUpDate: d(0) }),
    task({ id: '4', scheduledDate: d(0) }),
    task({ id: '5', dueDate: d(3) }),
  ], TODAY).map((r) => r.kind);
  assert.deepEqual(kinds, ['due', 'overdue', 'followup', 'scheduled']);
});

test('CSV escapes special characters', () => {
  const csv = tasksToCSV([task({ title: 'Say "hi", then go', projectId: 'p', notes: 'line1\nline2' })], [{ id: 'p', name: 'Proj' }], TODAY);
  const [header, row] = csv.split('\n');
  assert.ok(header.startsWith('title,project,quadrant'));
  assert.ok(row.startsWith('"Say ""hi"", then go",Proj,Q2'));
});

test('ICS contains all-day events', () => {
  const ics = tasksToICS([task({ title: 'Plan, review', scheduledDate: '2026-10-08', dueDate: '2026-10-10' })], TODAY);
  assert.match(ics, /DTSTART;VALUE=DATE:20261008/);
  assert.match(ics, /DTEND;VALUE=DATE:20261009/);
  assert.match(ics, /SUMMARY:Deadline: Plan\\, review/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
});

test('normalizeBackup validates and clamps input', () => {
  assert.throws(() => normalizeBackup({ foo: 1 }));
  const out = normalizeBackup({ projects: [{ id: 'p', name: 'P' }, { name: 'no id' }], tasks: [{ id: 't', title: 'T', importance: 9, urgency: -2, status: 'weird' }, { id: 'x' }] });
  assert.equal(out.projects.length, 1);
  assert.equal(out.tasks.length, 1);
  assert.equal(out.tasks[0].importance, 5);
  assert.equal(out.tasks[0].urgency, 1);
  assert.equal(out.tasks[0].status, 'open');
});
