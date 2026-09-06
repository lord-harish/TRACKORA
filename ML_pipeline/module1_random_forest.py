"""
module1_random_forest.py
=========================
Module1: Random Forest model for maintenance-task prioritization.

Input  -> list of task feature dicts (see ML_pipeline_IO.md)
Output -> [{"task_id", "priority_score", "risk_level"}, ...]

Architecture:
  - RandomForestRegressor predicts a continuous priority_score (0-100)
  - risk_level is derived from priority_score via fixed thresholds
    (kept as a deterministic post-processing step, not a separate
    classifier, so score and label can never disagree/contradict).

Includes: training, evaluation metrics (regression + derived
classification metrics), model persistence, and a predict() function
that returns JSON in the exact Output Module1 shape.
"""

import json
import os
import shutil
import numpy as np
import pandas as pd
import joblib

from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import OneHotEncoder
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
from sklearn.metrics import (
    mean_absolute_error,
    mean_squared_error,
    r2_score,
    accuracy_score,
    f1_score,
    precision_score,
    recall_score,
    confusion_matrix,
    classification_report,
)

from data_generator import generate_module1_data, _risk_level_from_score

NUMERIC_FEATURES = [
    "severity",
    "criticality",
    "urgency",
    "overdue_days",
    "safety_impact",
    "train_impact",
    "availability_impact",
    "maintenance_duration_min",
]
CATEGORICAL_FEATURES = ["asset_condition"]
ALL_FEATURES = NUMERIC_FEATURES + CATEGORICAL_FEATURES

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE_DIR, "module1_rf_model.joblib")


def build_pipeline(n_estimators=200, max_depth=12, random_state=42) -> Pipeline:
    """Random Forest wrapped in a preprocessing pipeline (one-hot for
    asset_condition). Wrapping in a Pipeline means the saved artifact
    handles raw dict input directly, no separate encoder to keep in sync.
    """
    preprocessor = ColumnTransformer(
        transformers=[
            ("num", "passthrough", NUMERIC_FEATURES),
            ("cat", OneHotEncoder(handle_unknown="ignore"), CATEGORICAL_FEATURES),
        ]
    )

    model = RandomForestRegressor(
        n_estimators=n_estimators,
        max_depth=max_depth,
        min_samples_leaf=2,
        random_state=random_state,
        n_jobs=-1,
    )

    return Pipeline(steps=[("preprocess", preprocessor), ("model", model)])


def train_and_evaluate(save_path: str = MODEL_PATH, verbose: bool = True):
    df = generate_module1_data(n_samples=12000)

    X = df[ALL_FEATURES]
    y_score = df["priority_score"]
    y_risk = df["risk_level"]  # kept only for evaluation, not trained directly

    X_train, X_test, y_train, y_test, risk_train, risk_test = train_test_split(
        X, y_score, y_risk, test_size=0.2, random_state=42
    )

    pipeline = build_pipeline()
    pipeline.fit(X_train, y_train)

    # ---- Predictions ----
    y_pred = pipeline.predict(X_test)
    y_pred = np.clip(y_pred, 0, 100)
    risk_pred = [_risk_level_from_score(s) for s in y_pred]

    # ---- Regression metrics (priority_score) ----
    mae = mean_absolute_error(y_test, y_pred)
    rmse = np.sqrt(mean_squared_error(y_test, y_pred))
    r2 = r2_score(y_test, y_pred)

    # ---- Classification metrics (derived risk_level) ----
    labels_order = ["LOW", "MEDIUM", "HIGH", "CRITICAL"]
    acc = accuracy_score(risk_test, risk_pred)
    f1_macro = f1_score(risk_test, risk_pred, labels=labels_order, average="macro")
    f1_weighted = f1_score(risk_test, risk_pred, labels=labels_order, average="weighted")
    precision_macro = precision_score(risk_test, risk_pred, labels=labels_order, average="macro", zero_division=0)
    recall_macro = recall_score(risk_test, risk_pred, labels=labels_order, average="macro", zero_division=0)
    cm = confusion_matrix(risk_test, risk_pred, labels=labels_order)
    report = classification_report(risk_test, risk_pred, labels=labels_order, zero_division=0)

    metrics = {
        "regression": {
            "MAE": round(float(mae), 4),
            "RMSE": round(float(rmse), 4),
            "R2": round(float(r2), 4),
        },
        "classification_derived_risk_level": {
            "Accuracy": round(float(acc), 4),
            "F1_macro": round(float(f1_macro), 4),
            "F1_weighted": round(float(f1_weighted), 4),
            "Precision_macro": round(float(precision_macro), 4),
            "Recall_macro": round(float(recall_macro), 4),
            "confusion_matrix_labels": labels_order,
            "confusion_matrix": cm.tolist(),
        },
        "feature_importances": dict(
            sorted(
                zip(
                    NUMERIC_FEATURES
                    + list(
                        pipeline.named_steps["preprocess"]
                        .named_transformers_["cat"]
                        .get_feature_names_out(CATEGORICAL_FEATURES)
                    ),
                    pipeline.named_steps["model"].feature_importances_.tolist(),
                ),
                key=lambda kv: -kv[1],
            )
        ),
    }

    if verbose:
        print("=" * 60)
        print("MODULE 1 — Random Forest — Evaluation")
        print("=" * 60)
        print("\n[Regression: priority_score]")
        print(f"  MAE  : {metrics['regression']['MAE']}")
        print(f"  RMSE : {metrics['regression']['RMSE']}")
        print(f"  R2   : {metrics['regression']['R2']}")
        print("\n[Classification: derived risk_level]")
        print(f"  Accuracy        : {metrics['classification_derived_risk_level']['Accuracy']}")
        print(f"  F1 (macro)      : {metrics['classification_derived_risk_level']['F1_macro']}")
        print(f"  F1 (weighted)   : {metrics['classification_derived_risk_level']['F1_weighted']}")
        print(f"  Precision(macro): {metrics['classification_derived_risk_level']['Precision_macro']}")
        print(f"  Recall (macro)  : {metrics['classification_derived_risk_level']['Recall_macro']}")
        print("\n  Confusion Matrix (rows=true, cols=pred), labels =", labels_order)
        print(np.array(metrics["classification_derived_risk_level"]["confusion_matrix"]))
        print("\n  Classification report:")
        print(report)
        print("\n[Top feature importances]")
        for feat, imp in list(metrics["feature_importances"].items())[:6]:
            print(f"  {feat:28s} {imp:.4f}")

    joblib.dump(pipeline, save_path)
    # Also sync copy to root workspace directory if present
    parent_path = os.path.join(BASE_DIR, "..", "module1_rf_model.joblib")
    if os.path.exists(parent_path):
        try:
            shutil.copyfile(save_path, parent_path)
        except Exception:
            pass

    if verbose:
        print(f"\nModel saved to: {save_path}")

    return pipeline, metrics


def predict(pipeline: Pipeline, tasks: list) -> list:
    """Run inference and return output in the EXACT Output Module1 shape.

    tasks: list of dicts matching Input Module1 schema (must include task_id
    plus the 9 feature fields).
    """
    df = pd.DataFrame(tasks)
    X = df[ALL_FEATURES]

    scores = pipeline.predict(X)
    scores = np.clip(scores, 0, 100)

    results = []
    for task_id, score in zip(df["task_id"], scores):
        results.append(
            {
                "task_id": task_id,
                "priority_score": round(float(score), 2),
                "risk_level": _risk_level_from_score(float(score)),
            }
        )
    return results


def load_model(path: str = MODEL_PATH) -> Pipeline:
    if not os.path.exists(path):
        local_path = os.path.join(BASE_DIR, os.path.basename(path))
        if os.path.exists(local_path):
            path = local_path
    return joblib.load(path)


if __name__ == "__main__":
    pipeline, metrics = train_and_evaluate()

    # sanity check against the sample input from ML_pipeline_IO.md
    sample_input = [
        {"task_id": "TASK001", "severity": 10, "criticality": 10, "urgency": 9, "overdue_days": 8,
         "safety_impact": 10, "train_impact": 9, "availability_impact": 10,
         "asset_condition": "poor", "maintenance_duration_min": 120},
        {"task_id": "TASK002", "severity": 9, "criticality": 9, "urgency": 8, "overdue_days": 6,
         "safety_impact": 9, "train_impact": 8, "availability_impact": 9,
         "asset_condition": "critical", "maintenance_duration_min": 150},
        {"task_id": "TASK003", "severity": 7, "criticality": 8, "urgency": 7, "overdue_days": 5,
         "safety_impact": 8, "train_impact": 7, "availability_impact": 8,
         "asset_condition": "poor", "maintenance_duration_min": 120},
        {"task_id": "TASK004", "severity": 6, "criticality": 8, "urgency": 6, "overdue_days": 2,
         "safety_impact": 7, "train_impact": 6, "availability_impact": 7,
         "asset_condition": "fair", "maintenance_duration_min": 90},
        {"task_id": "TASK005", "severity": 2, "criticality": 3, "urgency": 2, "overdue_days": 0,
         "safety_impact": 2, "train_impact": 2, "availability_impact": 2,
         "asset_condition": "good", "maintenance_duration_min": 45},
    ]
    output = predict(pipeline, sample_input)
    print("\n" + "=" * 60)
    print("Sanity check against ML_pipeline_IO.md sample input:")
    print("=" * 60)
    print(json.dumps(output, indent=2))
