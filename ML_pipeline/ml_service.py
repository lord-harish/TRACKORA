"""
ml_service.py
=============
Single entry point for the Application Backend to load both trained
models once (at startup) and call them per-request. This is the file
your backend (Flask/FastAPI/Django/etc.) should import.

Usage in your backend:

    from ml_service import MLService

    ml_service = MLService()  # loads both models once, e.g. at app startup

    # Module1 endpoint
    result1 = ml_service.predict_priority(task_list)

    # Module2 endpoint
    result2 = ml_service.predict_ranking(candidate_window_list)

Run this file directly to train both models from scratch (only needed
once, or whenever you want to retrain):

    python ml_service.py --train
"""

import argparse
import json
import os

import module1_random_forest as m1
import module2_xgb_ranker as m2


class MLService:
    """Loads both models once and exposes predict methods matching the
    exact I/O contract in ML_pipeline_IO.md.
    """

    def __init__(self, m1_path: str = m1.MODEL_PATH, m2_path: str = m2.MODEL_PATH):
        def _resolve(path, default_path):
            if os.path.exists(path):
                return path
            if os.path.exists(default_path):
                return default_path
            pipeline_dir = os.path.dirname(os.path.abspath(__file__))
            candidate = os.path.join(pipeline_dir, os.path.basename(path))
            if os.path.exists(candidate):
                return candidate
            return path

        m1_path = _resolve(m1_path, m1.MODEL_PATH)
        m2_path = _resolve(m2_path, m2.MODEL_PATH)

        if not os.path.exists(m1_path):
            raise FileNotFoundError(
                f"Module1 model not found at '{m1_path}'. Run `python ml_service.py --train` first."
            )
        if not os.path.exists(m2_path):
            raise FileNotFoundError(
                f"Module2 model not found at '{m2_path}'. Run `python ml_service.py --train` first."
            )

        self._rf_pipeline = m1.load_model(m1_path)
        self._xgb_ranker = m2.load_model(m2_path)

    # ------------------------------------------------------------------
    # Module1: task prioritization
    # ------------------------------------------------------------------
    def predict_priority(self, tasks: list) -> list:
        """
        tasks: list of dicts, each with keys:
          task_id, severity, criticality, urgency, overdue_days,
          safety_impact, train_impact, availability_impact,
          asset_condition, maintenance_duration_min

        returns: list of dicts:
          {"task_id", "priority_score", "risk_level"}
        """
        self._validate(tasks, m1.ALL_FEATURES + ["task_id"], "Module1")
        return m1.predict(self._rf_pipeline, tasks)

    # ------------------------------------------------------------------
    # Module2: maintenance window ranking
    # ------------------------------------------------------------------
    def predict_ranking(self, candidates: list) -> list:
        """
        candidates: list of dicts, each with keys:
          task_id, window_id, section, block_id, duration_min,
          train_conflict_score, goods_train_probability,
          corridor_availability, weather_suitability,
          compatible_task_count, expected_asset_impact

        returns: list of dicts (ranked within each task_id group):
          {"task_id", "window_id", "xgb_score", "xgb_rank", "recommendation"}
        """
        self._validate(candidates, m2.NUMERIC_FEATURES + ["task_id", "window_id"], "Module2")
        return m2.predict(self._xgb_ranker, candidates)

    # ------------------------------------------------------------------
    @staticmethod
    def _validate(records: list, required_fields: list, module_name: str):
        if not records:
            raise ValueError(f"{module_name}: input list is empty.")
        missing = [f for f in required_fields if f not in records[0]]
        if missing:
            raise ValueError(
                f"{module_name}: input records are missing required field(s): {missing}"
            )


def train_all():
    print("\n" + "#" * 60)
    print("# TRAINING MODULE 1 (Random Forest)")
    print("#" * 60)
    m1.train_and_evaluate()

    print("\n" + "#" * 60)
    print("# TRAINING MODULE 2 (XGBoost Ranker)")
    print("#" * 60)
    m2.train_and_evaluate()

    print("\nBoth models trained and saved:")
    print(f"  - {m1.MODEL_PATH}")
    print(f"  - {m2.MODEL_PATH}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--train", action="store_true", help="Train both models from scratch")
    args = parser.parse_args()

    if args.train:
        train_all()
    else:
        service = MLService()

        sample_tasks = [
            {"task_id": "TASK001", "severity": 10, "criticality": 10, "urgency": 9, "overdue_days": 8,
             "safety_impact": 10, "train_impact": 9, "availability_impact": 10,
             "asset_condition": "poor", "maintenance_duration_min": 120},
        ]
        print("Module1 result:")
        print(json.dumps(service.predict_priority(sample_tasks), indent=2))

        sample_candidates = [
            {"task_id": "TASK001", "window_id": "TASK001_CW1", "section": "CBE-SLM", "block_id": "BLK001",
             "duration_min": 120, "train_conflict_score": 0.10, "goods_train_probability": 0.20,
             "corridor_availability": 1.0, "weather_suitability": 1.0,
             "compatible_task_count": 3, "expected_asset_impact": 1.0},
            {"task_id": "TASK001", "window_id": "TASK001_CW2", "section": "CBE-SLM", "block_id": "BLK002",
             "duration_min": 90, "train_conflict_score": 0.40, "goods_train_probability": 0.45,
             "corridor_availability": 0.75, "weather_suitability": 0.80,
             "compatible_task_count": 2, "expected_asset_impact": 0.65},
        ]
        print("\nModule2 result:")
        print(json.dumps(service.predict_ranking(sample_candidates), indent=2))
