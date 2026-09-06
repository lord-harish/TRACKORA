"""
module2_xgb_ranker.py
======================
Module2: XGBoost Ranker for maintenance-window recommendation.

Input  -> list of candidate window dicts, one task can have multiple
          candidate windows (see ML_pipeline_IO.md "Inputs Module2")
Output -> [{"task_id", "window_id", "xgb_score", "xgb_rank",
            "recommendation"}, ...]   (ranked per task, rank 1 = BEST)

Architecture:
  - xgboost.XGBRanker (rank:pairwise objective) trained with per-task
    groups (qid), which is the correct way to train a Learning-to-Rank
    model: it learns relative ordering within each task's candidate
    windows rather than an absolute regression target.
  - xgb_score is exposed as a 0-100 scaled version of the model's raw
    ranking score (min-max scaled PER TASK GROUP, since ranker scores
    are only meaningful in relative/within-group terms).
  - recommendation is derived deterministically from rank (1=BEST,
    2=ALTERNATIVE, 3+=LOW), matching the sample output pattern.

Includes: training, ranking evaluation metrics (NDCG@k, MAP, Kendall
tau, top-1 accuracy), model persistence, and a predict() function that
returns JSON in the exact Output Module2 shape.
"""

import json
import os
import shutil
import numpy as np
import pandas as pd
import joblib
import xgboost as xgb

from sklearn.model_selection import GroupShuffleSplit
from sklearn.metrics import ndcg_score
from scipy.stats import kendalltau

from data_generator import generate_module2_data

NUMERIC_FEATURES = [
    "duration_min",
    "train_conflict_score",
    "goods_train_probability",
    "corridor_availability",
    "weather_suitability",
    "compatible_task_count",
    "expected_asset_impact",
]

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE_DIR, "module2_xgb_ranker.joblib")


def _make_groups(df: pd.DataFrame):
    """Return sizes of contiguous task-id groups, required by XGBRanker.
    Assumes df is already sorted by task_id (train_and_evaluate ensures this).
    """
    return df.groupby("task_id", sort=False).size().to_numpy()


def train_and_evaluate(save_path: str = MODEL_PATH, verbose: bool = True):
    df = generate_module2_data(n_tasks=1500)
    df = df.sort_values("task_id", kind="stable").reset_index(drop=True)

    task_ids = df["task_id"].unique()
    splitter = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=42)
    train_idx, test_idx = next(splitter.split(df, groups=df["task_id"]))

    train_df = df.iloc[train_idx].sort_values("task_id", kind="stable").reset_index(drop=True)
    test_df = df.iloc[test_idx].sort_values("task_id", kind="stable").reset_index(drop=True)

    X_train = train_df[NUMERIC_FEATURES]
    y_train = train_df["relevance"]
    group_train = _make_groups(train_df)

    X_test = test_df[NUMERIC_FEATURES]
    y_test = test_df["relevance"]
    group_test = _make_groups(test_df)

    ranker = xgb.XGBRanker(
        objective="rank:pairwise",
        n_estimators=200,
        max_depth=5,
        learning_rate=0.08,
        subsample=0.9,
        colsample_bytree=0.9,
        random_state=42,
    )
    ranker.fit(X_train, y_train, group=group_train)

    raw_scores = ranker.predict(X_test)
    test_df = test_df.copy()
    test_df["raw_score"] = raw_scores

    # ---- Ranking evaluation metrics ----
    ndcg_at_1, ndcg_at_3, kendall_scores, top1_hits, n_groups = [], [], [], 0, 0
    ap_scores = []

    for task_id, group in test_df.groupby("task_id", sort=False):
        n_groups += 1
        true_rel = group["relevance"].to_numpy().reshape(1, -1)
        pred_rel = group["raw_score"].to_numpy().reshape(1, -1)

        if len(group) >= 2:
            k1 = min(1, len(group))
            k3 = min(3, len(group))
            ndcg_at_1.append(ndcg_score(true_rel, pred_rel, k=k1))
            ndcg_at_3.append(ndcg_score(true_rel, pred_rel, k=k3))

            tau, _ = kendalltau(group["relevance"], group["raw_score"])
            if not np.isnan(tau):
                kendall_scores.append(tau)

            # top-1 accuracy: does the model's #1 pick match the true #1?
            pred_top = group.loc[group["raw_score"].idxmax(), "xgb_rank_label"]
            top1_hits += int(pred_top == 1)

            # Average precision treating "BEST" (rank==1) as the relevant item
            true_best_mask = (group["xgb_rank_label"] == 1).astype(int).to_numpy()
            order = np.argsort(-group["raw_score"].to_numpy())
            ranked_relevance = true_best_mask[order]
            if ranked_relevance.sum() > 0:
                precisions = np.cumsum(ranked_relevance) / (np.arange(len(ranked_relevance)) + 1)
                ap = precisions[ranked_relevance == 1].mean()
                ap_scores.append(ap)

    metrics = {
        "NDCG@1": round(float(np.mean(ndcg_at_1)), 4),
        "NDCG@3": round(float(np.mean(ndcg_at_3)), 4),
        "Kendall_tau_mean": round(float(np.mean(kendall_scores)), 4),
        "Top1_accuracy": round(top1_hits / n_groups, 4),
        "MAP_best_window": round(float(np.mean(ap_scores)), 4),
        "n_test_groups": int(n_groups),
        "feature_importances": dict(
            sorted(
                zip(NUMERIC_FEATURES, ranker.feature_importances_.tolist()),
                key=lambda kv: -kv[1],
            )
        ),
    }

    if verbose:
        print("=" * 60)
        print("MODULE 2 — XGBoost Ranker — Evaluation")
        print("=" * 60)
        print(f"\n  Test groups (tasks)   : {metrics['n_test_groups']}")
        print(f"  NDCG@1                : {metrics['NDCG@1']}")
        print(f"  NDCG@3                : {metrics['NDCG@3']}")
        print(f"  Kendall Tau (mean)    : {metrics['Kendall_tau_mean']}")
        print(f"  Top-1 accuracy (BEST) : {metrics['Top1_accuracy']}")
        print(f"  MAP (best-window)     : {metrics['MAP_best_window']}")
        print("\n[Feature importances]")
        for feat, imp in metrics["feature_importances"].items():
            print(f"  {feat:28s} {imp:.4f}")

    joblib.dump(ranker, save_path)
    # Also sync copy to root workspace directory if present
    parent_path = os.path.join(BASE_DIR, "..", "module2_xgb_ranker.joblib")
    if os.path.exists(parent_path):
        try:
            shutil.copyfile(save_path, parent_path)
        except Exception:
            pass

    if verbose:
        print(f"\nModel saved to: {save_path}")

    return ranker, metrics


def _recommendation_from_rank(rank: int) -> str:
    if rank == 1:
        return "BEST"
    elif rank == 2:
        return "ALTERNATIVE"
    else:
        return "LOW"


def predict(ranker: xgb.XGBRanker, candidates: list) -> list:
    """Run inference and return output in the EXACT Output Module2 shape.

    candidates: list of dicts matching Inputs Module2 schema. Can contain
    candidates for one or multiple tasks; each task's candidates are
    ranked independently (rank 1 = BEST within that task).
    """
    df = pd.DataFrame(candidates)
    X = df[NUMERIC_FEATURES]
    raw_scores = ranker.predict(X)
    df = df.copy()
    df["raw_score"] = raw_scores

    results = []
    for task_id, group in df.groupby("task_id", sort=False):
        group = group.copy()
        # min-max scale this task's scores to 0-100 (ranker output is only
        # meaningful in relative/within-group terms, not an absolute unit)
        lo, hi = group["raw_score"].min(), group["raw_score"].max()
        if hi - lo < 1e-9:
            scaled = pd.Series([100.0] * len(group), index=group.index)
        else:
            scaled = (group["raw_score"] - lo) / (hi - lo) * 100

        group["xgb_score"] = scaled.round(2)
        group = group.sort_values("xgb_score", ascending=False).reset_index(drop=True)
        group["xgb_rank"] = group.index + 1

        for _, row in group.iterrows():
            results.append(
                {
                    "task_id": row["task_id"],
                    "window_id": row["window_id"],
                    "xgb_score": round(float(row["xgb_score"]), 2),
                    "xgb_rank": int(row["xgb_rank"]),
                    "recommendation": _recommendation_from_rank(int(row["xgb_rank"])),
                }
            )
    return results


def load_model(path: str = MODEL_PATH) -> xgb.XGBRanker:
    if not os.path.exists(path):
        local_path = os.path.join(BASE_DIR, os.path.basename(path))
        if os.path.exists(local_path):
            path = local_path
    return joblib.load(path)


if __name__ == "__main__":
    ranker, metrics = train_and_evaluate()

    # sanity check against the sample input from ML_pipeline_IO.md
    sample_input = [
        {"task_id": "TASK001", "window_id": "TASK001_CW1", "section": "CBE-SLM", "block_id": "BLK001",
         "duration_min": 120, "train_conflict_score": 0.10, "goods_train_probability": 0.20,
         "corridor_availability": 1.0, "weather_suitability": 1.0,
         "compatible_task_count": 3, "expected_asset_impact": 1.0},
        {"task_id": "TASK001", "window_id": "TASK001_CW2", "section": "CBE-SLM", "block_id": "BLK001b",
         "duration_min": 100, "train_conflict_score": 0.35, "goods_train_probability": 0.40,
         "corridor_availability": 0.80, "weather_suitability": 0.85,
         "compatible_task_count": 2, "expected_asset_impact": 0.75},
        {"task_id": "TASK001", "window_id": "TASK001_CW3", "section": "CBE-SLM", "block_id": "BLK001c",
         "duration_min": 130, "train_conflict_score": 0.70, "goods_train_probability": 0.65,
         "corridor_availability": 0.55, "weather_suitability": 0.60,
         "compatible_task_count": 1, "expected_asset_impact": 0.40},
    ]
    output = predict(ranker, sample_input)
    print("\n" + "=" * 60)
    print("Sanity check (3 candidate windows for TASK001):")
    print("=" * 60)
    print(json.dumps(output, indent=2))
