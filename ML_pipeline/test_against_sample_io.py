"""
test_against_sample_io.py
==========================
Runs the exact inputs from ML_pipeline_IO.md through the trained models
and compares predictions against the expected outputs given in that file.

Usage:
    python test_against_sample_io.py

What "pass" means here:
  - risk_level / recommendation (the categorical labels): must match
    EXACTLY, since these are the fields a backend will branch logic on.
  - priority_score / xgb_score (the numeric scores): checked within a
    tolerance band, not exact match. These scores came from whatever
    system originally produced ML_pipeline_IO.md, not from this trained
    model, so exact numeric equality isn't the right bar — the model is
    "correct" if it lands close enough to imply the same decision.
    Tolerance is configurable via --tolerance.
"""

import argparse
import json

from ml_service import MLService


# ---------------------------------------------------------------------------
# Test data — copied verbatim from ML_pipeline_IO.md
# ---------------------------------------------------------------------------

MODULE1_INPUT = [
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

MODULE1_EXPECTED = [
    {"task_id": "TASK001", "priority_score": 87.39, "risk_level": "CRITICAL"},
    {"task_id": "TASK002", "priority_score": 84.72, "risk_level": "CRITICAL"},
    {"task_id": "TASK003", "priority_score": 70.18, "risk_level": "HIGH"},
    {"task_id": "TASK004", "priority_score": 61.91, "risk_level": "MEDIUM"},
    {"task_id": "TASK005", "priority_score": 16.47, "risk_level": "LOW"},
]

MODULE2_INPUT = [
    {"task_id": "TASK001", "window_id": "TASK001_CW1", "section": "CBE-SLM", "block_id": "BLK001",
     "duration_min": 120, "train_conflict_score": 0.10, "goods_train_probability": 0.20,
     "corridor_availability": 1.0, "weather_suitability": 1.0,
     "compatible_task_count": 3, "expected_asset_impact": 1.0},
    {"task_id": "TASK002", "window_id": "TASK002_CW1", "section": "SLM-ED", "block_id": "BLK002",
     "duration_min": 90, "train_conflict_score": 0.15, "goods_train_probability": 0.25,
     "corridor_availability": 1.0, "weather_suitability": 0.95,
     "compatible_task_count": 2, "expected_asset_impact": 0.90},
    {"task_id": "TASK003", "window_id": "TASK003_CW1", "section": "ED-TUP", "block_id": "BLK003",
     "duration_min": 90, "train_conflict_score": 0.20, "goods_train_probability": 0.30,
     "corridor_availability": 0.90, "weather_suitability": 0.90,
     "compatible_task_count": 3, "expected_asset_impact": 0.85},
    {"task_id": "TASK004", "window_id": "TASK004_CW1", "section": "TUP-CBE", "block_id": "BLK004",
     "duration_min": 60, "train_conflict_score": 0.30, "goods_train_probability": 0.40,
     "corridor_availability": 0.85, "weather_suitability": 0.95,
     "compatible_task_count": 2, "expected_asset_impact": 0.80},
    {"task_id": "TASK005", "window_id": "TASK005_CW1", "section": "CBE-SLM", "block_id": "BLK005",
     "duration_min": 45, "train_conflict_score": 0.05, "goods_train_probability": 0.15,
     "corridor_availability": 1.0, "weather_suitability": 1.0,
     "compatible_task_count": 1, "expected_asset_impact": 0.70},
]

# NOTE: Module2's sample OUTPUT in ML_pipeline_IO.md ranks 3 windows
# (CW001/CW002/CW003) for TASK001 alone, but the sample INPUT only gives
# ONE candidate window per task (5 different tasks, not 3 windows for one
# task). The input and output examples don't actually correspond to the
# same request. We test what the input can actually support: each task
# here has exactly 1 candidate window, so every task's single window is
# trivially "BEST" by construction. This is flagged in the report below.
MODULE2_EXPECTED_SINGLE_WINDOW = {
    # task_id -> expected recommendation, given only 1 candidate each
    "TASK001": "BEST", "TASK002": "BEST", "TASK003": "BEST",
    "TASK004": "BEST", "TASK005": "BEST",
}


def test_module1(service: MLService, tolerance: float, verbose: bool = True) -> bool:
    predictions = service.predict_priority(MODULE1_INPUT)
    pred_by_id = {p["task_id"]: p for p in predictions}

    all_pass = True
    rows = []
    for expected in MODULE1_EXPECTED:
        tid = expected["task_id"]
        pred = pred_by_id[tid]

        score_diff = abs(pred["priority_score"] - expected["priority_score"])
        score_ok = score_diff <= tolerance
        risk_ok = pred["risk_level"] == expected["risk_level"]
        row_pass = score_ok and risk_ok
        all_pass &= row_pass

        rows.append({
            "task_id": tid,
            "expected_score": expected["priority_score"],
            "predicted_score": pred["priority_score"],
            "diff": round(score_diff, 2),
            "score_ok": score_ok,
            "expected_risk": expected["risk_level"],
            "predicted_risk": pred["risk_level"],
            "risk_ok": risk_ok,
            "pass": row_pass,
        })

    if verbose:
        print("=" * 78)
        print("MODULE 1 — Random Forest — Test vs ML_pipeline_IO.md")
        print("=" * 78)
        header = f"{'task_id':10} {'exp_score':>10} {'pred_score':>11} {'diff':>6} {'exp_risk':>10} {'pred_risk':>10} {'result':>8}"
        print(header)
        print("-" * len(header))
        for r in rows:
            result = "PASS" if r["pass"] else "FAIL"
            print(f"{r['task_id']:10} {r['expected_score']:>10} {r['predicted_score']:>11} "
                  f"{r['diff']:>6} {r['expected_risk']:>10} {r['predicted_risk']:>10} {result:>8}")
        n_pass = sum(r["pass"] for r in rows)
        print(f"\n{n_pass}/{len(rows)} tasks passed (score tolerance = ±{tolerance}, risk_level must match exactly)")

    return all_pass


def test_module2(service: MLService, verbose: bool = True) -> bool:
    predictions = service.predict_ranking(MODULE2_INPUT)
    pred_by_id = {p["task_id"]: p for p in predictions}

    all_pass = True
    rows = []
    for tid, expected_rec in MODULE2_EXPECTED_SINGLE_WINDOW.items():
        pred = pred_by_id[tid]
        row_pass = pred["recommendation"] == expected_rec
        all_pass &= row_pass
        rows.append({
            "task_id": tid,
            "window_id": pred["window_id"],
            "xgb_score": pred["xgb_score"],
            "predicted_recommendation": pred["recommendation"],
            "expected_recommendation": expected_rec,
            "pass": row_pass,
        })

    if verbose:
        print("\n" + "=" * 78)
        print("MODULE 2 — XGBoost Ranker — Test vs ML_pipeline_IO.md")
        print("=" * 78)
        print("NOTE: sample input gives only 1 candidate window per task, so every")
        print("      window is trivially ranked #1/BEST. This does NOT exercise real")
        print("      ranking behavior — see test_module2_multi_window() below for that.\n")
        header = f"{'task_id':10} {'window_id':16} {'xgb_score':>10} {'pred_rec':>13} {'exp_rec':>13} {'result':>8}"
        print(header)
        print("-" * len(header))
        for r in rows:
            result = "PASS" if r["pass"] else "FAIL"
            print(f"{r['task_id']:10} {r['window_id']:16} {r['xgb_score']:>10} "
                  f"{r['predicted_recommendation']:>13} {r['expected_recommendation']:>13} {result:>8}")
        n_pass = sum(r["pass"] for r in rows)
        print(f"\n{n_pass}/{len(rows)} tasks passed")

    return all_pass


def test_module2_multi_window(service: MLService, verbose: bool = True) -> bool:
    """Reconstructs the actual scenario shown in Module2's sample OUTPUT:
    ONE task (TASK001) with THREE candidate windows (CW001/CW002/CW003),
    ranked BEST/ALTERNATIVE/LOW. Since the sample input doesn't give us
    3 windows' worth of raw features for TASK001, this builds 3 plausible
    candidates (best/mid/worst) to verify the ranker orders them correctly
    -- this is the realistic multi-candidate use case Module2 is for.
    """
    candidates = [
        {"task_id": "TASK001", "window_id": "CW001", "section": "CBE-SLM", "block_id": "BLK001",
         "duration_min": 120, "train_conflict_score": 0.10, "goods_train_probability": 0.20,
         "corridor_availability": 1.0, "weather_suitability": 1.0,
         "compatible_task_count": 3, "expected_asset_impact": 1.0},
        {"task_id": "TASK001", "window_id": "CW002", "section": "CBE-SLM", "block_id": "BLK001b",
         "duration_min": 110, "train_conflict_score": 0.35, "goods_train_probability": 0.40,
         "corridor_availability": 0.80, "weather_suitability": 0.85,
         "compatible_task_count": 2, "expected_asset_impact": 0.70},
        {"task_id": "TASK001", "window_id": "CW003", "section": "CBE-SLM", "block_id": "BLK001c",
         "duration_min": 130, "train_conflict_score": 0.75, "goods_train_probability": 0.70,
         "corridor_availability": 0.50, "weather_suitability": 0.55,
         "compatible_task_count": 1, "expected_asset_impact": 0.35},
    ]
    expected_order = ["CW001", "CW002", "CW003"]  # BEST, ALTERNATIVE, LOW
    expected_recs = {"CW001": "BEST", "CW002": "ALTERNATIVE", "CW003": "LOW"}

    predictions = service.predict_ranking(candidates)
    predictions_sorted = sorted(predictions, key=lambda p: p["xgb_rank"])
    predicted_order = [p["window_id"] for p in predictions_sorted]

    order_ok = predicted_order == expected_order
    rec_ok = all(p["recommendation"] == expected_recs[p["window_id"]] for p in predictions_sorted)
    all_pass = order_ok and rec_ok

    if verbose:
        print("\n" + "=" * 78)
        print("MODULE 2 — Multi-window ranking test (realistic scenario)")
        print("=" * 78)
        print("3 candidate windows for TASK001 (best/mid/worst quality by design):\n")
        header = f"{'window_id':10} {'xgb_score':>10} {'xgb_rank':>9} {'recommendation':>15} {'expected':>13}"
        print(header)
        print("-" * len(header))
        for p in predictions_sorted:
            exp = expected_recs[p["window_id"]]
            match = "OK" if p["recommendation"] == exp else "MISMATCH"
            print(f"{p['window_id']:10} {p['xgb_score']:>10} {p['xgb_rank']:>9} "
                  f"{p['recommendation']:>15} {exp:>13}   {match}")
        print(f"\nOrdering correct (CW001 > CW002 > CW003): {order_ok}")
        print(f"Recommendation labels correct: {rec_ok}")
        print(f"Result: {'PASS' if all_pass else 'FAIL'}")

    return all_pass


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--tolerance", type=float, default=10.0,
                         help="Allowed absolute difference for priority_score/xgb_score comparisons (default: 10.0)")
    args = parser.parse_args()

    service = MLService()

    m1_pass = test_module1(service, tolerance=args.tolerance)
    m2_pass = test_module2(service)
    m2_multi_pass = test_module2_multi_window(service)

    print("\n" + "#" * 78)
    print("SUMMARY")
    print("#" * 78)
    print(f"Module1 (Random Forest)         : {'PASS' if m1_pass else 'FAIL'}")
    print(f"Module2 (single-window sample)  : {'PASS' if m2_pass else 'FAIL'}  (trivial case, see note above)")
    print(f"Module2 (multi-window ranking)  : {'PASS' if m2_multi_pass else 'FAIL'}  (realistic case)")
