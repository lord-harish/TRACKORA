"""
TRACKORA AI backend — FastAPI service exposing the ML/optimization engine.

  Random Forest (module1_rf_model.joblib)   -> task prioritization
  XGBoost XGBRanker (module2_xgb_ranker.joblib) -> candidate-window ranking
  OR-Tools CP-SAT (Python API)              -> final block optimization

Run:
    cd backend
    .venv/Scripts/activate        (Windows)
    uvicorn main:app --host 0.0.0.0 --port 8000

Then set VITE_API_BASE_URL=http://localhost:8000 in staff-portal/.env.
"""

import os
import sys
import warnings

warnings.filterwarnings("ignore", message=".*unpickle estimator.*")

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# ML_pipeline lives next to backend/
sys.path.insert(0, os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "ML_pipeline")))
from ml_service import MLService  # noqa: E402

import pipeline as pipe  # noqa: E402

app = FastAPI(title="TRACKORA AI Backend", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # dev: portals run on various localhost ports
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

try:
    ml = MLService()
    print("[TRACKORA] Module1 + Module2 loaded.")
except Exception as e:
    ml = None
    print(f"[TRACKORA] WARNING: models not loaded: {e}")


def need_ml():
    if ml is None:
        raise HTTPException(status_code=503, detail="ML models are not loaded on the server.")
    return ml


# --------------------------------------------------------------------------
# Schemas
# --------------------------------------------------------------------------

class PrioritizeBody(BaseModel):
    tasks: list = Field(..., description="Module1 input rows (task_id + 9 features)")


class RankBody(BaseModel):
    candidates: list = Field(..., description="Module2 input rows (task_id + window_id + 7 features)")


class OptimizeBody(BaseModel):
    ranked: list = Field(..., description="Module2 outputs: task_id, window_id, xgb_score, xgb_rank")
    windows: list = Field(default_factory=list, description="window_id, section, start/end_time, duration_min, block_id")
    priorities: dict = Field(default_factory=dict, description="task_id -> priority_score")
    top_k: int = 3
    capacity_min_per_section_day: int = 480
    time_limit_s: int = 30


class RunBody(BaseModel):
    task_ids: list = Field(default_factory=list, description="Empty = all open maintenance_tasks")
    dry_run: bool = False
    top_k: int = 3
    capacity_min_per_section_day: int = 480
    tasks: list = Field(default_factory=list, description="Optional client-provided maintenance_tasks")
    assets: list = Field(default_factory=list, description="Optional client-provided assets")
    corridor_blocks: list = Field(default_factory=list, description="Optional client-provided corridor_blocks")
    weather: list = Field(default_factory=list, description="Optional client-provided weather")
    goods_forecasts: list = Field(default_factory=list, description="Optional client-provided goods_forecasts")
    candidate_windows: list = Field(default_factory=list, description="Optional client-provided candidate_windows")
    block_plans: list = Field(default_factory=list, description="Optional client-provided block_plans to prevent double-scheduling")


# --------------------------------------------------------------------------
# Routes
# --------------------------------------------------------------------------

@app.get("/api/health")
def health():
    return {
        "status": "ok" if ml else "degraded",
        "models_loaded": ml is not None,
        "firestore": pipe.firestore_status(),
    }


@app.post("/api/module1/prioritize")
def prioritize(body: PrioritizeBody):
    try:
        return {"results": need_ml().predict_priority(body.tasks)}
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


@app.post("/api/module2/rank-windows")
def rank_windows(body: RankBody):
    try:
        return {"results": need_ml().predict_ranking(body.candidates)}
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


@app.post("/api/module3/optimize")
def optimize(body: OptimizeBody):
    try:
        meta = {w.get("window_id"): w for w in body.windows if w.get("window_id")}
        selected, info = pipe.optimize_with_cpsat(
            body.ranked, meta, body.priorities,
            top_k=body.top_k,
            capacity_min_per_section_day=body.capacity_min_per_section_day,
            time_limit_s=body.time_limit_s,
        )
        return {"selected": selected, **info}
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))


@app.post("/api/pipeline/run")
def pipeline_run(body: RunBody):
    try:
        return pipe.run_chain(
            need_ml(),
            task_ids=body.task_ids,
            dry_run=body.dry_run,
            top_k=body.top_k,
            capacity_min_per_section_day=body.capacity_min_per_section_day,
            tasks=body.tasks if body.tasks else None,
            assets_in=body.assets if body.assets else None,
            corridor_in=body.corridor_blocks if body.corridor_blocks else None,
            weather_in=body.weather if body.weather else None,
            goods_in=body.goods_forecasts if body.goods_forecasts else None,
            candidates_in=body.candidate_windows if body.candidate_windows else None,
            block_plans_in=body.block_plans if body.block_plans else None,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Pipeline failed: {e}")


@app.get("/")
def root():
    return {"service": "TRACKORA AI Backend", "docs": "/docs"}
