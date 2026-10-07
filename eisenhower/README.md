# Eisenhower Matrix (PWA)

A mobile-first, offline-capable Progressive Web App to sort projects and tasks into the Eisenhower matrix and derive concrete actions from them.

## Features

- **Matrix**: four quadrants (Do, Schedule, Delegate, Eliminate) with a filter by project.
- **Rating**: importance and urgency on a 1–5 scale (scores ≥ 3 count as high). The quadrant is shown live while editing.
- **Deadlines escalate automatically**: due in ≤ 7 days raises urgency, and a deadline within ≤ 2 days or overdue *always* makes a task urgent, even after manual placement.
- **Drag & drop** with the ⋮⋮ handle (touch, mouse, pen) or the Q1–Q4 buttons in the editor. Manually placed tasks show 📌, and "Use scores" restores automatic placement.
- **Actions view** shows the next step for every task:
  - Q1: *Do now* (sorted by deadline)
  - Q2: *Needs a date* (one tap for tomorrow, next week, or a picked date), *Planned for today*, *Coming up*
  - Q3: *Delegate* (person + follow-up in 3 days), *Follow up*, *Waiting for*
  - Q4: *Eliminate* (drop/archive or re-rate)
- **Projects** with color, progress bar, distribution per quadrant, and a task list. Tasks have subtasks.
- **Insights**: distribution, coaching recommendations (e.g. "firefighting mode"), completed and archived tasks.
- **Reminders**: system notification when the app is opened or resumed, for tasks that are due, overdue, planned today, or need a follow-up (once per task and day), plus app icon badge.
- **Backup**: JSON export/import (merge or replace), CSV export, calendar export (.ics).
- Light and dark mode. All data stays on the device (localStorage).

## Run locally

```bash
cd eisenhower
npm start          # serves on http://localhost:8080 (python3 -m http.server)
npm test           # unit tests for the domain logic (Node ≥ 20)
```

Service workers and installation need `localhost` or HTTPS.

## Install on a phone

Deploy the `eisenhower/` folder to any static HTTPS host (GitHub Pages, Netlify, Cloudflare Pages, …), open it in the phone browser, and choose **Add to Home screen** / **Install app**. After the first load it works offline.

> Notifications on iOS require the app to be installed to the Home Screen (iOS 16.4+). Reminders appear when the app is opened; true background push would need a server.

## Structure

```
eisenhower/
├── index.html            app shell and dialogs
├── css/styles.css        mobile-first styles, light/dark theme
├── js/logic.js           pure domain logic (classification, action plan, exports), unit-tested
├── js/store.js           persistence (localStorage) and CRUD
├── js/app.js             UI rendering, drag & drop, reminders
├── sw.js                 offline cache
├── manifest.webmanifest  PWA manifest
├── icons/                app icons
└── tests/                node:test unit tests
```

When you change cached files, bump `CACHE` in `sw.js` so installed apps pick up the new version.
