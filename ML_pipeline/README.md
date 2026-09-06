# ML Pipeline — Module1 (Random Forest) + Module2 (XGBoost Ranker)

Implements the two models specified in `ML_pipeline_IO.md`, ready to be
imported into an application backend (Flask/FastAPI/Django/etc.).

## Files

| File | Purpose |
|---|---|
| `data_generator.py` | Generates synthetic training data matching the exact feature schema/ranges from the I/O spec (labels derived from a scoring function reverse-engineered from the 5 sample rows) |
| `module1_random_forest.py` | Trains `RandomForestRegressor` → `priority_score`, derives `risk_level` from fixed thresholds. Includes evaluation + `predict()` |
| `module2_xgb_ranker.py` | Trains `xgboost.XGBRanker` (learning-to-rank) → `xgb_score` / `xgb_rank` / `recommendation` per task's candidate windows. Includes evaluation + `predict()` |
| `ml_service.py` | **Backend entry point.** Loads both trained models once and exposes `predict_priority()` / `predict_ranking()` with input validation |
| `module1_rf_model.joblib` | Trained Module1 artifact |
| `module2_xgb_ranker.joblib` | Trained Module2 artifact |

## Why synthetic training data?

The 5 rows in `ML_pipeline_IO.md` are an **I/O contract** (what fields go in,
what fields come out), not a training set — 5 rows can't train a Random
Forest or a ranker. `data_generator.py` creates thousands of realistic
records in the same feature ranges, labeled by a weighted scoring formula
reverse-engineered to reproduce the relative ordering/values in your sample
(e.g. TASK001's high severity/safety/criticality → CRITICAL, TASK005's low
values → LOW). **When real historical data becomes available, swap
`generate_module1_data()` / `generate_module2_data()` for a loader that
reads your actual logged tasks/outcomes** — everything downstream (training,
evaluation, serving) stays the same.

## Setup

```bash
pip install -r requirements.txt
```

## Train (run once, or whenever retraining)

```bash
python ml_service.py --train
```

This prints full evaluation metrics for both models and saves:
- `module1_rf_model.joblib`
- `module2_xgb_ranker.joblib`

## Use in your backend

```python
from ml_service import MLService

ml_service = MLService()  # load once at app startup, reuse across requests

# --- Module1: task prioritization ---
tasks = [
    {"task_id": "TASK001", "severity": 10, "criticality": 10, "urgency": 9,
     "overdue_days": 8, "safety_impact": 10, "train_impact": 9,
     "availability_impact": 10, "asset_condition": "poor",
     "maintenance_duration_min": 120},
]
result = ml_service.predict_priority(tasks)
# -> [{"task_id": "TASK001", "priority_score": 85.99, "risk_level": "CRITICAL"}]

# --- Module2: maintenance window ranking ---
candidates = [
    {"task_id": "TASK001", "window_id": "TASK001_CW1", "section": "CBE-SLM",
     "block_id": "BLK001", "duration_min": 120, "train_conflict_score": 0.10,
     "goods_train_probability": 0.20, "corridor_availability": 1.0,
     "weather_suitability": 1.0, "compatible_task_count": 3,
     "expected_asset_impact": 1.0},
    # ... more candidate windows for the same or other task_ids
]
result = ml_service.predict_ranking(candidates)
# -> ranked list per task_id, rank 1 = "BEST"
```

### FastAPI example

```python
from fastapi import FastAPI
from ml_service import MLService

app = FastAPI()
ml_service = MLService()

@app.post("/api/module1/prioritize")
def prioritize(tasks: list[dict]):
    return ml_service.predict_priority(tasks)

@app.post("/api/module2/rank-windows")
def rank_windows(candidates: list[dict]):
    return ml_service.predict_ranking(candidates)
```

## Evaluation metrics (on synthetic held-out test data)

### Module1 — Random Forest
| Metric | Value |
|---|---|
| MAE (priority_score) | ~1.51 |
| RMSE | ~2.02 |
| R² | ~0.991 |
| Accuracy (derived risk_level) | ~0.952 |
| F1 macro | ~0.954 |
| F1 weighted | ~0.952 |
| Precision / Recall (macro) | ~0.951 / ~0.958 |

Full confusion matrix + classification report printed on `--train`.
With stratified operational sampling and expanded training data (12,000+ samples),
all risk classes (CRITICAL, HIGH, MEDIUM, LOW) achieve high precision and recall (0.91-1.00).

### Module2 — XGBoost Ranker
| Metric | Value |
|---|---|
| NDCG@1 | ~0.948 |
| NDCG@3 | ~0.978 |
| Kendall Tau (mean) | ~0.80 |
| Top-1 accuracy (picks the true BEST window) | ~0.857 |
| MAP (best-window retrieval) | ~0.924 |

Ranking metrics are used here instead of plain accuracy/F1 because
Module2's job is to **order** candidates correctly, not classify them
independently — NDCG and Kendall Tau are the standard metrics for
learning-to-rank models.

## Retraining with real data

Once real historical task/outcome data is available:
1. Replace the body of `generate_module1_data()` with a function that loads
   your real records (same column names) and provides real `priority_score`
   / `risk_level` labels (however your ops team actually determines them).
2. Replace `generate_module2_data()` similarly — you'll need historical
   examples of which maintenance window was actually chosen/preferred per
   task, plus a per-task grouping key (`task_id` qid).
3. Everything else (`train_and_evaluate`, `predict`, `MLService`) works
   unchanged.
