# TRACKORA — Worker Portal

Field-execution portal for railway workers. Separate from Admin and Staff
portals, with strict worker-only access. No mock data — every screen reads
live Firestore collections and shows **“Data unavailable in database”** when
data is missing.

## Stack

React 19 · JavaScript · React Router · Firebase Auth + Firestore ·
styled-components (login card only) · Vite.

## Quick start

```bash
cd worker-portal
# .env is already filled (same trackora-9969 project as Admin portal)
npm install
npm run dev            # http://localhost:5173
```

## Firebase setup

1. Authentication → Email/Password enabled → create the worker user.
2. Firestore → `users` → document id = worker UID:
   ```json
   { "email": "worker@trackora.in", "role": "worker", "name": "R. Kumar",
     "department": "Track", "section": "CBE-SLM" }
   ```
3. Rules must restrict workers to: read own `work_assignments` (+ linked
   tasks/assets/blocks), write own `status_updates`, append `audit_logs`.
   **Enforce scoping in Security Rules, not just in this UI.**

## Worker scoping

`services/workerScope.js` matches assignments to the signed-in worker by UID
or email across common field names, then derives visible tasks/blocks only
from those links. Unlinked records are never shown.

## Flow

`/login` → Auth → `users/{uid}.role === 'worker'` → `/dashboard` →
Assigned Tasks → detail → Start Work → Update Progress → Complete Work →
`status_updates` (+ task patch + `audit_logs`), visible to Staff/Admin via
the shared database.

## Structure

```
src/
  firebase.js                 env-based Firebase init
  context/AuthContext.jsx     worker-only session + role verification
  services/firestoreService.js tolerant reads + status/audit writes
  services/workerScope.js     UID/email scoping, buckets
  components/StatusUpdate.jsx Start/Progress/Complete/Delayed actions
  pages/                      Login Dashboard Tasks Blocks Progress
                              Notifications Profile
```

## Build

```bash
npm run build
npm run preview
```
