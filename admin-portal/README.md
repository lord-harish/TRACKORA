# TRACKORA — Admin Portal

Production-style React admin portal for railway operations. Separate from the
future Staff and Worker portals (each has its own auth + permissions).

## Stack

React 19 · JavaScript · React Router · Firebase Auth + Firestore · Recharts ·
Vite. No mock data anywhere — every panel reads live Firestore collections and
shows **“Data unavailable in database”** when a collection/field is missing.

## Quick start

```bash
cd admin-portal
cp .env.example .env   # then fill Firebase keys
npm install
npm run dev            # http://localhost:5173
```

## Firebase setup

1. Firebase Console → Project Settings → add a Web app → copy keys into `.env`.
2. Authentication → Sign-in method → enable **Email/Password** → create the admin user.
3. Firestore → create collection `users` → document id = admin UID:
   ```json
   { "email": "admin@trackora.in", "role": "admin", "name": "Ops Admin" }
   ```
4. Firestore rules must allow an admin to read operational collections and
   update `block_plans` (approve/reject) + write `audit_logs`.

## Collections used (only if they exist)

`users · assets · maintenance_tasks · train_movements · goods_forecasts ·
corridor_blocks · weather · candidate_windows · block_plans · plan_versions ·
work_assignments · status_updates · audit_logs`

## Flow

`/login` → Firebase Auth → `users/{uid}.role === 'admin'` check →
`/dashboard` → Block Plans / Work / Trains / Assets / Reports / Calendar / Audit.

## AI / backend integration (ready, not faked)

The UI is structured to consume the TRACKORA pipeline
**Random Forest → XGBoost XGBRanker → OR-Tools CP-SAT** via Firestore fields
(`optimization_score`, `conflicts`, versions) or a future FastAPI backend
(`VITE_API_BASE_URL`, see `services/firestoreService.js`). No fake AI values
are rendered.

## Structure

```
src/
  firebase.js                 env-based Firebase init
  context/AuthContext.jsx     admin-only session + role verification
  services/firestoreService.js tolerant reads, approve/reject writes, audit writes
  hooks/useCollection.js      { rows, loading, unavailable } per collection
  components/ui.jsx           Card/Kpi/Badge/Loading/EmptyState/Unavailable
  components/layout/Layout.jsx sidebar + header
  pages/                      Login Dashboard BlockPlans WorkCompletion
                              TrainMovements Assets Reports CalendarPage AuditLogs
  utils/format.js             field-tolerant pick/format helpers
```

## Build

```bash
npm run build   # outputs dist/
npm run preview
```
