# TRACKORA — Staff Portal

Maintenance planning and coordination portal. Separate from Admin and Worker
portals, with staff-only access. No mock data — every screen reads live
Firestore collections and shows **“Data unavailable in database”** when data
is missing.

## Stack

React 19 · JavaScript · React Router · Firebase Auth + Firestore · Recharts ·
styled-components (login card only) · Vite.

## Quick start

```bash
cd staff-portal
# .env is already filled (same trackora-9969 project)
npm install
npm run dev            # http://localhost:5173
```

## Firebase setup

1. Authentication → Email/Password enabled → create the staff user.
2. Firestore → `users` → document id = staff UID:
   ```json
   { "email": "staff@trackora.in", "role": "staff", "name": "S. Rao",
     "department": "Track", "section": "CBE-SLM" }
   ```
3. Rules: staff can read assets/tasks/blocks/assignments/updates, create
   `maintenance_tasks` + draft `block_plans`, create/update
   `work_assignments`, append `audit_logs`. **No block approval** — enforce
   in Security Rules, not just in this UI.

## AI pipeline (display + trigger only)

```
Firestore tasks → Module1 RF → priority_score/risk_level (stored on tasks)
→ Module2 XGBRanker → ranked candidate_windows
→ Module3 CP-SAT → block_plans → Admin approval → assignment → execution
```

- Models live in `../ML_pipeline/` (`module1_rf_model.joblib`,
  `module2_xgb_ranker.joblib`, `CP-SAT algorithm/`).
- The React app NEVER runs models. `services/aiService.js` only reads stored
  results and POSTs to the FastAPI backend (`VITE_API_BASE_URL`) when
  configured. Without a backend, “Run pipeline” stays disabled with an
  explanation — no fake scores anywhere.

## Flow

`/login` → Auth → `users/{uid}.role === 'staff'` → `/dashboard` →
Assets / Tasks (raise) / AI / Blocks (requirement) / Assignments /
Progress / Calendar / Profile.

## Structure

```
src/
  firebase.js                 env-based Firebase init
  context/AuthContext.jsx     staff-only session + role verification
  services/firestoreService.js tolerant reads + create/update + audit
  services/aiService.js       backend trigger (no in-browser ML)
  pages/                      Login Dashboard Assets Tasks AIRecommendations
                              BlockPlans Assignments Progress CalendarPage
                              Profile Notifications
```

## Build

```bash
npm run build
npm run preview
```
