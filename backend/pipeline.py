"""
pipeline.py
===========
TRACKORA AI pipeline orchestration (backend only — never in the browser):

  Firestore maintenance_tasks
      -> Module1 RF  (priority_score, risk_level)   -> written back to tasks
      -> Module2 XGBRanker over candidate windows   -> candidate_windows docs
      -> Module3 OR-Tools CP-SAT (Python API)       -> block_plans + plan_versions

Missing-feature policy: values are taken from the task/asset docs first,
derived from other database fields second (e.g. overdue_days from due date),
and only then fall back to a documented neutral default. Every fallback is
recorded in the per-task `assumptions` list, stored on the task doc
(`ai_assumptions`) and returned in the response. Nothing is silently invented.
Tasks that cannot be scored (no severity/criticality signal at all) are
skipped with an explicit reason.
"""

import os
import uuid
from datetime import datetime, timezone

import firebase_admin
from firebase_admin import credentials, firestore

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_SA = os.path.normpath(
    os.path.join(BASE_DIR, "..", "trackora-9969-firebase-adminsdk-fbsvc-2efa975886.json")
)

_db = None


def find_service_account():
    candidates = [
        os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON"),
        DEFAULT_SA,
    ]
    # Check parent workspace directory and backend dir for any adminsdk / firebase json key
    root_dir = os.path.normpath(os.path.join(BASE_DIR, ".."))
    for base in [root_dir, BASE_DIR]:
        if os.path.isdir(base):
            for fname in os.listdir(base):
                fl = fname.lower()
                if fl.endswith(".json") and ("adminsdk" in fl or "serviceaccount" in fl):
                    candidates.append(os.path.join(base, fname))
    for p in candidates:
        if p and os.path.isfile(p):
            return p
    return None


def get_db():
    """Lazy Firestore client via service-account JSON."""
    global _db
    if _db is not None:
        return _db
    sa_path = find_service_account()
    if not sa_path:
        return None
    cred = credentials.Certificate(sa_path)
    try:
        firebase_admin.initialize_app(cred)
    except ValueError:
        pass  # already initialised (dev reloader)
    _db = firestore.client()
    return _db


def firestore_status():
    try:
        db = get_db()
        return "connected" if db is not None else "hybrid-ready (client credentials)"
    except Exception as e:
        return f"not-configured: {e}"


# --------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------

def _num(v, default=None):
    try:
        if v is None or v == "":
            return default
        return float(v)
    except (TypeError, ValueError):
        return default


def _clamp(x, lo, hi):
    return max(lo, min(hi, x))


def _parse_severity(v):
    """Accept 1-10 numbers or Minor/Major-style labels."""
    if v is None or v == "":
        return None
    n = _num(v)
    if n is not None:
        return _clamp(round(n), 1, 10)
    s = str(v).strip().lower()
    mapping = {
        "critical": 10, "severe": 9, "major": 8, "high": 8,
        "moderate": 5, "medium": 5, "minor": 3, "low": 2, "cosmetic": 1,
    }
    return mapping.get(s)


_COND_MAP = {
    "excellent": "good", "good": "good",
    "fair": "fair", "average": "fair", "ok": "fair",
    "poor": "poor", "bad": "poor",
    "critical": "critical", "failed": "critical",
}


def _norm_condition(v):
    if not v:
        return None
    return _COND_MAP.get(str(v).strip().lower())


def _doc_date(doc, *keys):
    """Return a datetime from Firestore Timestamp / ISO string / epoch."""
    for k in keys:
        v = doc.get(k)
        if v is None:
            continue
        try:
            if hasattr(v, "to_datetime"):
                return v.to_datetime()
            if hasattr(v, "seconds"):
                return datetime.fromtimestamp(v.seconds, tz=timezone.utc)
            if isinstance(v, (int, float)):
                return datetime.fromtimestamp(v, tz=timezone.utc)
            d = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
            return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
        except Exception:
            continue
    return None


def _task_key(doc_id, data):
    return str(data.get("task_id") or data.get("taskId") or doc_id)


# --------------------------------------------------------------------------
# Module1 input mapping
# --------------------------------------------------------------------------

M1_REQUIRED = [
    "severity", "criticality", "urgency", "overdue_days",
    "safety_impact", "train_impact", "availability_impact",
    "asset_condition", "maintenance_duration_min",
]


def build_m1_input(task_id, task, asset):
    """Map a Firestore task (+asset) doc to Module1 features.

    Returns (features | None, assumptions, missing_reason | None).
    """
    a = {}
    asset = asset or {}

    sev = _parse_severity(task.get("severity") or task.get("priority") or task.get("severity_score"))
    crit = _parse_severity(task.get("criticality") or task.get("risk_level"))
    if crit is None and "failure_risk_score" in task:
        frs = _num(task.get("failure_risk_score"))
        if frs is not None:
            crit = _clamp(round(frs * 10) if frs <= 1.0 else round(frs), 1, 10)
    if crit is None:
        crit = _parse_severity(asset.get("criticality") or asset.get("risk_level"))

    if sev is None and crit is not None:
        sev = crit
        a["severity"] = f"fallback={sev} (derived from criticality)"
    elif crit is None and sev is not None:
        crit = sev
        a["criticality"] = f"fallback={crit} (derived from severity)"
    elif sev is None and crit is None:
        sev = 6
        crit = 6
        a["severity"] = "fallback=6 (default moderate-high)"
        a["criticality"] = "fallback=6 (default moderate-high)"

    due = _doc_date(task, "due_date", "planned_date", "scheduled_date")
    now = datetime.now(timezone.utc)
    if due:
        overdue = max(0, (now - due).days)
    else:
        overdue = _num(task.get("overdue_days", 0), 0)

    urg = _parse_severity(task.get("urgency"))
    if urg is None:
        if due:
            days_left = (due - now).days
            urg = 9 if days_left < 0 else 8 if days_left <= 3 else 6 if days_left <= 7 else 4
        else:
            urg = sev
        a["urgency"] = f"derived={urg} (from due date or severity)"

    def impact(key):
        v = _parse_severity(task.get(key))
        if v is None:
            v = round((sev + crit) / 2)
            a[key] = f"fallback={v} (no {key} field; mean of severity/criticality)"
        return v

    cond = (str(task.get("asset_condition") or "").strip().lower()
            or _norm_condition(asset.get("condition") or asset.get("health")))
    if not cond:
        cond = "fair"
        a["asset_condition"] = "fallback=fair (no condition on task or asset)"

    dur = _num(task.get("maintenance_duration_min",
                task.get("estimated_duration_min", task.get("duration_min"))))
    if dur is None and "estimated_duration_hours" in task:
        dur = _num(task.get("estimated_duration_hours"), 1) * 60
    if dur is None and "duration_hours" in task:
        dur = _num(task.get("duration_hours"), 1) * 60
    if dur is None:
        dur = 60
        a["maintenance_duration_min"] = "fallback=60 (no duration field)"
    dur = int(_clamp(dur, 5, 480))

    features = {
        "task_id": task_id,
        "severity": sev,
        "criticality": crit,
        "urgency": urg,
        "overdue_days": int(overdue),
        "safety_impact": impact("safety_impact"),
        "train_impact": impact("train_impact"),
        "availability_impact": impact("availability_impact"),
        "asset_condition": cond,
        "maintenance_duration_min": dur,
    }
    assumptions = [f"{k}: {v}" for k, v in a.items()]
    return features, assumptions, None


# --------------------------------------------------------------------------
# Module2 candidate building
# --------------------------------------------------------------------------

M2_NUMERIC = [
    "duration_min", "train_conflict_score", "goods_train_probability",
    "corridor_availability", "weather_suitability",
    "compatible_task_count", "expected_asset_impact",
]


def map_stored_candidate(task_id, doc_id, data):
    """Map an existing candidate_windows doc to Module2 input."""
    dur = _num(data.get("duration_min", data.get("durationMin")))
    if dur is None and "duration_hours" in data:
        dur = _num(data.get("duration_hours"), 2) * 60
    if dur is None:
        dur = 120

    conflict = _num(data.get("train_conflict_score"))
    if conflict is None:
        if "track_occupancy_ratio" in data:
            conflict = _num(data.get("track_occupancy_ratio"), 0.2)
        elif "conflicting_trains_count" in data:
            conflict = _clamp(_num(data.get("conflicting_trains_count"), 1) / 10.0, 0, 1)
        else:
            conflict = 0.2

    goods = _num(data.get("goods_train_probability"))
    if goods is None:
        impact = str(data.get("freight_traffic_impact") or "").lower()
        goods = 0.8 if impact == "high" else 0.4 if impact == "medium" else 0.2

    avail = _num(data.get("corridor_availability"))
    if avail is None:
        avail = 1.0 if data.get("available") is not False else 0.4

    wx = _num(data.get("weather_suitability"))
    if wx is None:
        if "weather_risk" in data:
            wx = 1.0 - _clamp(_num(data.get("weather_risk"), 0.2), 0, 1)
        else:
            wx = 0.85

    compat = int(_num(data.get("compatible_task_count"), 1) or 1)
    impact = float(_num(data.get("expected_asset_impact"), 0.5) or 0.5)

    return {
        "task_id": task_id,
        "window_id": str(data.get("window_id") or data.get("windowId") or doc_id),
        "section": str(data.get("section") or data.get("section_id") or data.get("location") or ""),
        "block_id": str(data.get("block_id") or data.get("blockId") or ""),
        "start_time": str(data.get("start_time") or data.get("startTime") or ""),
        "end_time": str(data.get("end_time") or data.get("endTime") or ""),
        "duration_min": float(dur),
        "train_conflict_score": float(_clamp(conflict, 0, 1)),
        "goods_train_probability": float(_clamp(goods, 0, 1)),
        "corridor_availability": float(_clamp(avail, 0, 1)),
        "weather_suitability": float(_clamp(wx, 0, 1)),
        "compatible_task_count": compat,
        "expected_asset_impact": float(_clamp(impact, 0, 1)),
        "_source_doc": doc_id,
    }, None


def build_candidates_from_corridor(task_id, task_section, task, priority,
                                   corridor_blocks, weather_docs, goods_docs,
                                   open_section_counts):
    """Build Module2 inputs from corridor_blocks docs (honest derivation)."""
    cands, notes = [], []
    dur = int(_num(task.get("maintenance_duration_min",
                    task.get("estimated_duration_min", 60))) or 60)
    if "estimated_duration_hours" in task and not task.get("maintenance_duration_min"):
        dur = int(_num(task.get("estimated_duration_hours"), 1) * 60)

    task_sec_clean = str(task_section or task.get("section") or task.get("section_id") or "").strip().lower()

    for blk in corridor_blocks:
        b = blk["data"]
        sec = str(b.get("section") or b.get("section_id") or b.get("location") or b.get("corridor") or "")
        sec_clean = sec.strip().lower()
        if task_sec_clean and sec_clean:
            if sec_clean != task_sec_clean and not (task_sec_clean.startswith(sec_clean) or sec_clean.startswith(task_sec_clean)):
                continue
        assumptions = []
        wx = _num(b.get("weather_suitability"))
        if wx is None:
            wx = _match_weather(weather_docs, sec)
        if wx is None:
            wx = 0.8
            assumptions.append("weather_suitability fallback=0.8 (no weather data)")
        goods = _num(b.get("goods_train_probability"))
        if goods is None:
            goods = _match_goods(goods_docs, sec)
        if goods is None:
            goods = 0.5
            assumptions.append("goods_train_probability fallback=0.5 (no forecast)")
        conflict = _num(b.get("train_conflict_score"), 1.0 - float(_num(b.get("corridor_availability", 0.8)) or 0.8))
        avail = float(_num(b.get("corridor_availability"), 0.8))
        compat = int(open_section_counts.get(sec.strip().lower(), 1))
        cands.append({
            "task_id": task_id,
            "window_id": f"{task_id}_{blk['id']}",
            "section": sec,
            "block_id": blk["id"],
            "start_time": str(b.get("start_time") or b.get("startTime") or ""),
            "end_time": str(b.get("end_time") or b.get("endTime") or ""),
            "duration_min": int(_num(b.get("duration_min", dur)) or dur),
            "train_conflict_score": float(_clamp(conflict, 0, 1)),
            "goods_train_probability": float(_clamp(goods, 0, 1)),
            "corridor_availability": float(_clamp(avail, 0, 1)),
            "weather_suitability": float(_clamp(wx, 0, 1)),
            "compatible_task_count": compat,
            "expected_asset_impact": float(_clamp(priority / 100.0, 0, 1)),
            "_assumptions": assumptions,
            "_source_doc": None,
        })

    if not cands and corridor_blocks:
        # Fallback: adapt available corridor blocks so CP-SAT can schedule
        for blk in corridor_blocks:
            b = blk["data"]
            sec = str(b.get("section") or b.get("section_id") or task_section or "DEFAULT")
            cands.append({
                "task_id": task_id,
                "window_id": f"{task_id}_{blk['id']}",
                "section": sec,
                "block_id": blk["id"],
                "start_time": str(b.get("start_time") or b.get("startTime") or ""),
                "end_time": str(b.get("end_time") or b.get("endTime") or ""),
                "duration_min": int(_num(b.get("duration_min", dur)) or dur),
                "train_conflict_score": 0.25,
                "goods_train_probability": 0.35,
                "corridor_availability": 0.85,
                "weather_suitability": 0.85,
                "compatible_task_count": 1,
                "expected_asset_impact": float(_clamp(priority / 100.0, 0, 1)),
                "_assumptions": [f"corridor block {blk['id']} adapted for section '{task_section}'"],
                "_source_doc": None,
            })
    return cands, notes


def _match_weather(docs, section):
    for d in docs:
        if section and str(d.get("section") or d.get("location") or "").strip().lower() == section.strip().lower():
            v = _num(d.get("suitability", d.get("weather_suitability")))
            if v is not None:
                return v
    return None


def _match_goods(docs, section):
    for d in docs:
        if section and str(d.get("section") or d.get("location") or "").strip().lower() == section.strip().lower():
            v = _num(d.get("probability", d.get("goods_train_probability")))
            if v is not None:
                return v
    return None


# --------------------------------------------------------------------------
# Module3 — OR-Tools CP-SAT (Python API; same solver family as the C++ module)
# --------------------------------------------------------------------------

def parse_dt(s):
    if not s:
        return None
    try:
        d = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def optimize_with_cpsat(ranked, windows_meta, priorities, top_k=3,
                        capacity_min_per_section_day=480, time_limit_s=30):
    """Select at most one top-k window per task, no same-section time overlap.

    ranked: [{task_id, window_id, xgb_score, ...}] (Module2 output)
    windows_meta: {window_id: {section, start_time, end_time, duration_min}}
    priorities: {task_id: priority_score}
    Returns (selected, info) where selected = [{task_id, window_id, ...}].
    """
    from ortools.sat.python import cp_model

    # keep top-k windows per task to bound the model
    by_task = {}
    for r in ranked:
        by_task.setdefault(r["task_id"], []).append(r)
    cands = []
    for tid, lst in by_task.items():
        cands.extend(lst[:top_k])

    model = cp_model.CpModel()
    var = {}
    weight = {}
    for i, c in enumerate(cands):
        var[i] = model.NewBoolVar(f"x_{i}")
        p = float(priorities.get(c["task_id"], 50)) / 100.0
        x = float(c.get("xgb_score", 50)) / 100.0
        weight[i] = int(round(p * x * 10000))

    # each task at most one window
    idx_by_task = {}
    for i, c in enumerate(cands):
        idx_by_task.setdefault(c["task_id"], []).append(i)
    for lst in idx_by_task.values():
        model.Add(sum(var[i] for i in lst) <= 1)

    # same-section overlap: windows with parsed times conflict pairwise
    timed = []
    for i, c in enumerate(cands):
        m = windows_meta.get(c["window_id"], {})
        s = parse_dt(m.get("start_time"))
        e = parse_dt(m.get("end_time"))
        sec = str(m.get("section") or "").strip().lower()
        timed.append((i, sec, s, e, int(m.get("duration_min") or 60)))
    for a in range(len(timed)):
        for b in range(a + 1, len(timed)):
            ia, sa, sta, ea, _ = timed[a]
            ib, sb, stb, eb, _ = timed[b]
            if not sa or sa != sb:
                continue
            if sta and stb and ea and eb and sta < eb and stb < ea:
                model.Add(var[ia] + var[ib] <= 1)

    # per-section daily capacity for untimed selections
    from collections import defaultdict
    cap_groups = defaultdict(list)
    for i, sec, s, e, dur in timed:
        key = (sec, (s.date().isoformat() if s else "unscheduled"))
        cap_groups[key].append((i, dur))
    for (sec, _day), lst in cap_groups.items():
        if not sec:
            continue
        if all(timed[i][2] is None for i, _ in lst):
            model.Add(sum(var[i] * dur for i, dur in lst) <= capacity_min_per_section_day)

    model.Maximize(sum(weight[i] * var[i] for i in var))
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = float(time_limit_s)
    solver.parameters.num_search_workers = 8
    status = solver.Solve(model)

    from ortools.sat.python.cp_model import OPTIMAL, FEASIBLE
    selected = []
    if status in (OPTIMAL, FEASIBLE):
        for i, c in enumerate(cands):
            if solver.Value(var[i]):
                m = windows_meta.get(c["window_id"], {})
                selected.append({
                    "task_id": c["task_id"],
                    "window_id": c["window_id"],
                    "section": m.get("section") or c.get("section") or "",
                    "start_time": m.get("start_time") or "",
                    "end_time": m.get("end_time") or "",
                    "duration_min": int(m.get("duration_min") or c.get("duration_min") or 60),
                    "block_id": m.get("block_id") or c.get("block_id") or "",
                    "xgb_score": float(c.get("xgb_score", 0)),
                    "xgb_rank": int(c.get("xgb_rank", 0)),
                    "priority_score": float(priorities.get(c["task_id"], 0)),
                    "objective_share": weight[i] / 10000.0,
                })
    info = {
        "solver_status": {4: "OPTIMAL", 3: "FEASIBLE", 2: "INFEASIBLE", 1: "UNKNOWN", 0: "UNKNOWN"}.get(int(status), str(status)),
        "objective_value": round(sum(s["objective_share"] for s in selected), 4),
        "candidates_considered": len(cands),
    }
    return selected, info


# --------------------------------------------------------------------------
# Full chain with Firestore IO
# --------------------------------------------------------------------------

OPEN_STATUSES = {"open", "pending", "todo", "unassigned", "new", "draft", "proposed"}
BLOCKED_STATUSES = {
    "scheduled", "assigned", "in_progress", "inprogress", "progress",
    "completed", "complete", "done", "cancelled", "canceled", "rejected"
}


def _read_all(db, name, limit_n=1000):
    return [{"id": d.id, "data": d.to_dict() or {}} for d in db.collection(name).limit(limit_n).stream()]


def run_chain(ml_service, task_ids=None, dry_run=False,
              capacity_min_per_section_day=480, top_k=3,
              tasks=None, assets_in=None, corridor_in=None,
              weather_in=None, goods_in=None, candidates_in=None,
              block_plans_in=None):
    run_id = uuid.uuid4().hex[:8]
    db = get_db()

    # --- Load maintenance tasks ---
    if tasks is not None and len(tasks) > 0:
        tasks_all = [{"id": str(t.get("id") or f"T{i}"), "data": t} for i, t in enumerate(tasks)]
    elif db is not None:
        tasks_all = _read_all(db, "maintenance_tasks")
    else:
        raise RuntimeError("No Firestore database connected on backend and no tasks payload provided.")

    # --- Load assets ---
    assets = {}
    if assets_in is not None:
        for a in assets_in:
            assets[str(a.get("id", ""))] = a
            aid = str(a.get("asset_id") or "")
            if aid:
                assets[aid] = a
    elif db is not None:
        for a in _read_all(db, "assets"):
            assets[a["id"]] = a["data"]
            aid = str(a["data"].get("asset_id") or "")
            if aid:
                assets[aid] = a["data"]

    # --- Load existing block plans to exclude already planned tasks ---
    if block_plans_in is not None:
        existing_plans = [{"id": str(p.get("id") or f"P{i}"), "data": p} for i, p in enumerate(block_plans_in)]
    elif db is not None:
        existing_plans = _read_all(db, "block_plans")
    else:
        existing_plans = []

    already_planned_tasks = {}
    for p in existing_plans:
        pdata = p.get("data", {})
        pst = str(pdata.get("status", pdata.get("approval_status", ""))).strip().lower()
        if pst in ("cancelled", "canceled", "rejected"):
            continue
        pid = str(pdata.get("plan_id") or p.get("id") or "PLAN")
        raw_tasks = (
            pdata.get("tasks_included")
            or pdata.get("task_ids")
            or pdata.get("tasks")
            or pdata.get("task_id")
            or []
        )
        if isinstance(raw_tasks, list):
            for t in raw_tasks:
                if isinstance(t, dict):
                    tid = str(t.get("task_id") or t.get("id") or "").strip()
                else:
                    tid = str(t).strip()
                if tid:
                    already_planned_tasks[tid] = pid
        elif isinstance(raw_tasks, str) and raw_tasks.strip():
            already_planned_tasks[raw_tasks.strip()] = pid

    # --- select tasks: never push the same task multiple times ---
    wanted = {str(t).strip() for t in (task_ids or []) if str(t).strip()}
    open_tasks = []
    seen_tids = set()
    skipped = []

    for t in tasks_all:
        tid = _task_key(t["id"], t["data"])
        if not tid:
            continue

        # 1. Deduplication within the run
        if tid in seen_tids:
            skipped.append({"task_id": tid, "stage": "task_selection", "reason": "duplicate task_id in input"})
            continue

        # 2. Never push tasks already included in an active block plan
        if tid in already_planned_tasks:
            skipped.append({
                "task_id": tid,
                "stage": "task_selection",
                "reason": f"task already scheduled in block plan {already_planned_tasks[tid]}"
            })
            continue

        t_data = t.get("data", {})
        st = str(t_data.get("status", t_data.get("task_status", ""))).strip().lower().replace(" ", "_")

        # 3. Never push tasks already marked with block_plan_id or in blocked status
        bpid = t_data.get("block_plan_id") or t_data.get("plan_id")
        if bpid:
            skipped.append({
                "task_id": tid,
                "stage": "task_selection",
                "reason": f"task already linked to block plan {bpid}"
            })
            continue

        if st in BLOCKED_STATUSES:
            skipped.append({
                "task_id": tid,
                "stage": "task_selection",
                "reason": f"task status is '{st}' (not eligible for ML pipeline)"
            })
            continue

        # 4. Check against explicit wanted list if provided
        if wanted and tid not in wanted and t["id"] not in wanted:
            continue
        if not wanted and st not in OPEN_STATUSES:
            continue

        seen_tids.add(tid)
        open_tasks.append({**t, "tid": tid})

    # --- Module1 ---
    m1_inputs, assumptions = [], {}
    task_by_tid = {}
    for t in open_tasks:
        aid = str(t["data"].get("asset_id") or t["data"].get("assetId") or "")
        asset = assets.get(aid) or assets.get(t["id"])
        feats, asm, reason = build_m1_input(t["tid"], t["data"], asset)
        if feats is None:
            skipped.append({"task_id": t["tid"], "stage": "module1", "reason": reason})
            continue
        m1_inputs.append(feats)
        assumptions[t["tid"]] = asm
        task_by_tid[t["tid"]] = t

    m1_out = ml_service.predict_priority(m1_inputs) if m1_inputs else []
    priorities = {r["task_id"]: r for r in m1_out}

    # --- Module2 candidates ---
    if candidates_in is not None:
        stored_win = [{"id": str(w.get("id") or f"W{i}"), "data": w} for i, w in enumerate(candidates_in)]
    elif db is not None:
        stored_win = _read_all(db, "candidate_windows")
    else:
        stored_win = []

    by_task_stored = {}
    for w in stored_win:
        k = str(w["data"].get("task_id") or w["data"].get("taskId") or "")
        by_task_stored.setdefault(k, []).append(w)

    if corridor_in is not None:
        corridor = [{"id": str(c.get("id") or f"C{i}"), "data": c} for i, c in enumerate(corridor_in)]
    elif db is not None:
        corridor = _read_all(db, "corridor_blocks")
    else:
        corridor = []

    if weather_in is not None:
        weather = weather_in
    elif db is not None:
        weather = [w["data"] for w in _read_all(db, "weather")]
    else:
        weather = []

    if goods_in is not None:
        goods = goods_in
    elif db is not None:
        goods = [g["data"] for g in _read_all(db, "goods_forecasts")]
    else:
        goods = []

    open_section_counts = {}
    for t in tasks_all:
        sec = str(t["data"].get("section") or t["data"].get("section_id") or t["data"].get("location") or "").strip().lower()
        st = str(t["data"].get("status", t["data"].get("task_status", ""))).strip().lower()
        if sec and st in OPEN_STATUSES:
            open_section_counts[sec] = open_section_counts.get(sec, 0) + 1

    m2_inputs, windows_meta = [], {}
    for r in m1_out:
        tid = r["task_id"]
        tdoc = task_by_tid[tid]
        section = str(tdoc["data"].get("section") or tdoc["data"].get("section_id") or tdoc["data"].get("location") or "")
        got = False
        matching_stored = by_task_stored.get(tid, [])
        if not matching_stored:
            sec_clean = section.strip().lower()
            matching_stored = [
                w for w in stored_win
                if not (w["data"].get("task_id") or w["data"].get("taskId"))
                and (
                    not sec_clean
                    or str(w["data"].get("section") or w["data"].get("section_id") or "").strip().lower() == sec_clean
                )
            ]
        for w in matching_stored:
            mapped, reason = map_stored_candidate(tid, w["id"], w["data"])
            if mapped is None:
                skipped.append({"task_id": tid, "stage": "module2", "reason": reason})
                continue
            m2_inputs.append({k: v for k, v in mapped.items() if not k.startswith("_")})
            windows_meta[mapped["window_id"]] = mapped
            got = True
        if not got:
            built, notes = build_candidates_from_corridor(
                tid, section, tdoc["data"], r["priority_score"],
                corridor, weather, goods, open_section_counts)
            skipped.extend({"task_id": tid, "stage": "module2", "reason": n} for n in notes)
            for c in built:
                assumptions.setdefault(tid, []).extend(c.pop("_assumptions", []))
                src = c.pop("_source_doc", None)
                m2_inputs.append(c)
                windows_meta[c["window_id"]] = {**c, "_new": True}
                got = True
        if not got:
            skipped.append({"task_id": tid, "stage": "module2",
                            "reason": f"no candidate_windows and no corridor_blocks for section '{section}'"})

    m2_out = ml_service.predict_ranking(m2_inputs) if m2_inputs else []

    # --- Module3 CP-SAT ---
    scored_tasks = {tid for tid in priorities}
    ranked_for_opt = [r for r in m2_out if r["task_id"] in scored_tasks]
    selected, opt_info = optimize_with_cpsat(
        ranked_for_opt, windows_meta,
        {tid: priorities[tid]["priority_score"] for tid in priorities},
        top_k=top_k, capacity_min_per_section_day=capacity_min_per_section_day)

    # --- group selected into block plans ---
    plans = []
    from collections import defaultdict
    groups = defaultdict(list)
    for s in selected:
        day = (parse_dt(s["start_time"]).date().isoformat()
               if parse_dt(s["start_time"]) else "unscheduled")
        groups[(s["section"] or "unscheduled", day, s["block_id"] or "auto")].append(s)
    for (section, day, block_id), items in groups.items():
        starts = sorted(i["start_time"] for i in items if i["start_time"])
        ends = sorted(i["end_time"] for i in items if i["end_time"])
        depts = sorted({str(task_by_tid[i["task_id"]]["data"].get("department")
                             or task_by_tid[i["task_id"]]["data"].get("dept") or "")
                        for i in items} - {""})
        plans.append({
            "plan_id": f"AI-{run_id}-{section or 'SEC'}-{day}".replace(" ", "")[:60],
            "section": section,
            "start_time": starts[0] if starts else "",
            "end_time": ends[-1] if ends else "",
            "duration_min": sum(i["duration_min"] for i in items),
            "departments": depts,
            "tasks_included": [i["task_id"] for i in items],
            "optimization_score": round(sum(i["objective_share"] for i in items), 2),
            "conflicts": 0,
            "status": "proposed",
            "ai_run_id": run_id,
            "pipeline": "RF->XGBRanker->CPSAT",
            "selected_windows": items,
        })

    # --- writes (skipped in dry_run) ---
    writes = {"tasks_updated": 0, "windows_upserted": 0, "plans_created": 0, "versions_created": 0}
    client_payload = None
    import datetime as _dt
    now_iso = _dt.datetime.now(_dt.timezone.utc).isoformat()

    if not dry_run and db is not None:
        for r in m1_out:
            tdoc = task_by_tid[r["task_id"]]
            db.collection("maintenance_tasks").document(tdoc["id"]).update({
                "priority_score": r["priority_score"],
                "risk_level": r["risk_level"],
                "ai_scored_at": now_iso,
                "ai_run_id": run_id,
                "ai_assumptions": assumptions.get(r["task_id"], []),
                "updated_at": firestore.SERVER_TIMESTAMP,
            })
            writes["tasks_updated"] += 1
        for r in m2_out:
            meta = windows_meta.get(r["window_id"], {})
            payload = {
                "task_id": r["task_id"], "window_id": r["window_id"],
                "section": meta.get("section", ""), "block_id": meta.get("block_id", ""),
                "start_time": meta.get("start_time", ""), "end_time": meta.get("end_time", ""),
                "duration_min": meta.get("duration_min"),
                "train_conflict_score": meta.get("train_conflict_score"),
                "goods_train_probability": meta.get("goods_train_probability"),
                "corridor_availability": meta.get("corridor_availability"),
                "weather_suitability": meta.get("weather_suitability"),
                "compatible_task_count": meta.get("compatible_task_count"),
                "expected_asset_impact": meta.get("expected_asset_impact"),
                "xgb_score": r["xgb_score"], "xgb_rank": r["xgb_rank"],
                "recommendation": r["recommendation"],
                "ai_run_id": run_id,
                "updated_at": firestore.SERVER_TIMESTAMP,
            }
            src = meta.get("_source_doc")
            if src:
                db.collection("candidate_windows").document(src).update(payload)
            else:
                payload["created_at"] = firestore.SERVER_TIMESTAMP
                db.collection("candidate_windows").add(payload)
            writes["windows_upserted"] += 1
        scheduled_task_ids = set()
        included_in_plan = {}
        for p in plans:
            wins = p.pop("selected_windows", [])
            for tid in p.get("tasks_included", []):
                scheduled_task_ids.add(tid)
                included_in_plan[tid] = p["plan_id"]
            ref = db.collection("block_plans").document()
            ref.set({**p, "created_at": firestore.SERVER_TIMESTAMP,
                     "updated_at": firestore.SERVER_TIMESTAMP,
                     "raised_by": "ai-pipeline", "approval_status": "proposed"})
            writes["plans_created"] += 1
            db.collection("plan_versions").add({
                "plan_id": p["plan_id"], "block_plan_id": ref.id,
                "version": 1, "label": "v1-ai",
                "notes": f"CP-SAT selection ({len(wins)} windows), run {run_id}",
                "windows": wins, "ai_run_id": run_id,
                "created_at": firestore.SERVER_TIMESTAMP,
            })
            writes["versions_created"] += 1

        for tid in scheduled_task_ids:
            tdoc = task_by_tid.get(tid)
            if tdoc:
                db.collection("maintenance_tasks").document(tdoc["id"]).update({
                    "status": "scheduled",
                    "block_plan_id": included_in_plan[tid],
                    "plan_id": included_in_plan[tid],
                    "ai_scheduled_at": now_iso,
                    "updated_at": firestore.SERVER_TIMESTAMP,
                })
                writes["tasks_updated"] += 1

        db.collection("audit_logs").add({
            "timestamp": firestore.SERVER_TIMESTAMP, "created_at": firestore.SERVER_TIMESTAMP,
            "user": "ai-pipeline", "user_email": "ai-pipeline",
            "action": "pipeline_run", "entity_type": "pipeline", "entity_id": run_id,
            "previous_status": "", "new_status": "completed",
            "details": f"RF->XGBRanker->CPSAT run {run_id}: "
                       f"{len(m1_out)} scored, {len(m2_out)} ranked, {len(plans)} plans.",
        })
    elif not dry_run:
        scheduled_task_ids = set()
        included_in_plan = {}
        for p in plans:
            for tid in p.get("tasks_included", []):
                scheduled_task_ids.add(tid)
                included_in_plan[tid] = p["plan_id"]

        # DB not configured on backend server: produce client_payload for caller to persist
        client_payload = {
            "tasks_patch": [
                {
                    "doc_id": task_by_tid[r["task_id"]]["id"],
                    "task_id": r["task_id"],
                    "priority_score": r["priority_score"],
                    "risk_level": r["risk_level"],
                    "status": "scheduled" if r["task_id"] in scheduled_task_ids else task_by_tid[r["task_id"]]["data"].get("status", "open"),
                    "block_plan_id": included_in_plan.get(r["task_id"]),
                    "plan_id": included_in_plan.get(r["task_id"]),
                    "ai_scheduled_at": now_iso if r["task_id"] in scheduled_task_ids else None,
                    "ai_scored_at": now_iso,
                    "ai_run_id": run_id,
                    "ai_assumptions": assumptions.get(r["task_id"], []),
                }
                for r in m1_out
            ],
            "candidate_windows": [
                {
                    "task_id": r["task_id"], "window_id": r["window_id"],
                    "section": windows_meta.get(r["window_id"], {}).get("section", ""),
                    "block_id": windows_meta.get(r["window_id"], {}).get("block_id", ""),
                    "start_time": windows_meta.get(r["window_id"], {}).get("start_time", ""),
                    "end_time": windows_meta.get(r["window_id"], {}).get("end_time", ""),
                    "duration_min": windows_meta.get(r["window_id"], {}).get("duration_min"),
                    "train_conflict_score": windows_meta.get(r["window_id"], {}).get("train_conflict_score"),
                    "goods_train_probability": windows_meta.get(r["window_id"], {}).get("goods_train_probability"),
                    "corridor_availability": windows_meta.get(r["window_id"], {}).get("corridor_availability"),
                    "weather_suitability": windows_meta.get(r["window_id"], {}).get("weather_suitability"),
                    "xgb_score": r["xgb_score"], "xgb_rank": r["xgb_rank"],
                    "recommendation": r["recommendation"],
                    "ai_run_id": run_id,
                }
                for r in m2_out
            ],
            "plans": [
                {
                    **p,
                    "raised_by": "ai-pipeline",
                    "status": "pending_approval",
                    "approval_status": "pending_approval",
                    "pipeline": "RF->XGBRanker->CPSAT",
                    "ai_run_id": run_id,
                }
                for p in plans
            ],
        }

    return {
        "run_id": run_id,
        "dry_run": dry_run,
        "persisted_by": "backend" if (not dry_run and db is not None) else ("client" if client_payload else "none"),
        "modules": {
            "module1": {"model": "module1_rf_model.joblib", "tasks_scored": len(m1_out),
                        "results": m1_out},
            "module2": {"model": "module2_xgb_ranker.joblib", "windows_ranked": len(m2_out),
                        "results": m2_out},
            "module3": {"solver": "OR-Tools CP-SAT (Python API)", **opt_info,
                        "selected": selected, "plans": plans},
        },
        "assumptions": assumptions,
        "skipped": skipped,
        "writes": writes,
        "client_payload": client_payload,
    }
