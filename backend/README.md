# TRACKORA AI Backend (FastAPI)

Runs the real ML/optimization chain and persists results to Firestore:

```
maintenance_tasks → Module1 RF → priority_score, risk_level (on tasks)
                → Module2 XGBRanker → ranked candidate_windows
                → Module3 OR-Tools CP-SAT → block_plans + plan_versions
```

Models are loaded from `../ML_pipeline/` (`module1_rf_model.joblib`,
`module2_xgb_ranker.joblib`). Module 3 uses the **OR-Tools CP-SAT solver via
its Python API** (same solver family as `ML_pipeline/CP-SAT algorithm/`,
which is a C++ project and is not built here).

## Setup

```bat
cd backend
py -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
```

## Firestore access (required for `/api/pipeline/run`)

The endpoints `/api/module1/*`, `/api/module2/*`, `/api/module3/*` need no
credentials. The full chain reads/writes Firestore, so it needs the
service-account key:

1. Firebase Console → Project Settings → Service accounts → Generate new
   private key (keep this file SECRET, never commit it).
2. Save it as `D:\TRACKORA\trackora-9969-firebase-adminsdk-fbsvc-2efa975886.json`
   (default path), or set `FIREBASE_SERVICE_ACCOUNT_JSON` to its location.

## Run

```bat
cd backend
run.bat
REM  or: .venv\Scripts\python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

Then in `staff-portal/.env`: `VITE_API_BASE_URL=http://localhost:8000`
and restart the portal dev server. The AI Recommendations page shows a
live connection status.

## Endpoints

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health` | models loaded? firestore reachable? |
| POST | `/api/module1/prioritize` | `{tasks:[...]}` → scores (no DB writes) |
| POST | `/api/module2/rank-windows` | `{candidates:[...]}` → ranking (no writes) |
| POST | `/api/module3/optimize` | `{ranked, windows, priorities}` → CP-SAT selection (no writes) |
| POST | `/api/pipeline/run` | `{task_ids:[], dry_run, top_k, capacity_min_per_section_day}` → full chain with Firestore writes |

`dry_run: true` computes everything and returns it without writing —
use it to preview before touching the database.

## Missing-data policy

Task features come from `maintenance_tasks` (+ linked `assets`) first,
are derived from other DB fields second (e.g. `overdue_days` from due
dates), and only then fall back to documented neutral defaults. Every
fallback is listed per task in `assumptions`, stored on the task
(`ai_assumptions`) and returned in the response. Tasks with no
severity/criticality signal are skipped with an explicit reason —
the backend never silently invents inputs.
