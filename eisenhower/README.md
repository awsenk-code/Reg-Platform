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
- Light and dark mode. Without team mode all data stays on the device (localStorage).

## Team mode (Microsoft 365)

Optional. When `js/config.js` is filled in (see [TEAM-SETUP.md](TEAM-SETUP.md)), team members sign in with their Microsoft work account:

- **Shared projects, own matrix:** projects are visible to the whole team. Every task has an owner and everyone sees their own matrix by default. The person filter switches to a teammate's matrix or to *Everyone*.
- **Colors:** each member has a color and initials badge (choose yours in Settings), and cards in team views get a colored edge. Project colors stay as before.
- **Delegate to a teammate:** delegating a Q3 task to a member (Actions view or editor) moves it into their matrix. It stays in your *Waiting for* list with a follow-up date.
- **Private tasks** (🔒) are stored in your own OneDrive app folder and are never visible to others.
- **Offline first:** everything works offline. Changes are queued and synced when online (on change, on resume, and every 30 s). The dot on your avatar shows the sync state.
- **Team overview** in Insights: open tasks per quadrant, completed in 7 days and open delegations per member.
- All members have equal rights. Only the creator can delete a project.

Data is stored in three SharePoint lists (`EisenhowerProjects`, `EisenhowerTasks`, `EisenhowerMembers`) as JSON per row, using Microsoft Graph with delegated permissions. Sign-in uses MSAL.js (bundled in `vendor/`, MIT license) with the redirect flow, which works in installed iOS home-screen apps.

## Run locally

```bash
cd eisenhower
npm start          # serves on http://localhost:8080 (python3 -m http.server)
npm test           # unit tests for domain logic and sync (Node ≥ 20)
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
├── js/store.js           persistence (localStorage), CRUD, outbox of unsynced changes
├── js/config.js          team mode settings (Microsoft 365)
├── js/team/sync.js       offline-first sync engine (push outbox, pull, merge)
├── js/team/graph.js      Microsoft Graph backend (MSAL sign-in, SharePoint lists, OneDrive)
├── vendor/               MSAL.js
├── js/app.js             UI rendering, drag & drop, reminders
├── sw.js                 offline cache
├── manifest.webmanifest  PWA manifest
├── icons/                app icons
└── tests/                node:test unit tests
```

When you change cached files, bump `CACHE` in `sw.js` so installed apps pick up the new version.
