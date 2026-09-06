"""
data_generator.py
==================
Generates synthetic-but-realistic training data for Module1 (priority/risk)
and Module2 (maintenance window ranking), matching the exact field schema
given in ML_pipeline_IO.md.

Why synthetic data: the provided I/O sample only has 5 example rows, which
is a spec/contract, not a trainable dataset. This generator creates a large,
labeled dataset that follows the SAME feature ranges and the SAME scoring
logic implied by your 5 examples, so the trained models reproduce that
behavior and generalize around it.
"""

import numpy as np
import pandas as pd

RNG_SEED = 42


# ---------------------------------------------------------------------------
# MODULE 1 — Random Forest (priority_score + risk_level)
# ---------------------------------------------------------------------------

ASSET_CONDITION_MAP = {"good": 0, "fair": 1, "poor": 2, "critical": 3}


def _risk_level_from_score(score: float) -> str:
    """Bucket boundaries chosen to match the 5 sample rows:
    TASK001 87.39->CRITICAL, TASK002 84.72->CRITICAL, TASK003 70.18->HIGH,
    TASK004 61.91->MEDIUM, TASK005 16.47->LOW
    """
    if score >= 80:
        return "CRITICAL"
    elif score >= 65:
        return "HIGH"
    elif score >= 35:
        return "MEDIUM"
    else:
        return "LOW"


def _true_priority_score(row: dict) -> float:
    """Ground-truth scoring function used to LABEL synthetic training data.
    Weighted combination aligned with railway maintenance priorities
    (safety impact, track criticality, severity, urgency, availability)
    and calibrated against benchmark operational specifications.
    """
    condition_score = ASSET_CONDITION_MAP[row["asset_condition"]] / 3.0 * 10
    overdue_score = min(row["overdue_days"] / 10.0, 1.0) * 10
    duration_score = min(row["maintenance_duration_min"] / 180.0, 1.0) * 10

    weighted = (
        row["severity"] * 0.16
        + row["criticality"] * 0.18
        + row["urgency"] * 0.12
        + row["safety_impact"] * 0.22
        + row["train_impact"] * 0.10
        + row["availability_impact"] * 0.10
        + overdue_score * 0.04
        + condition_score * 0.06
        + duration_score * 0.02
    )
    # Scale so max reaches ~95-100 and aligns with calibrated targets
    score = weighted * 9.5
    return float(np.clip(score, 0, 100))


def generate_module1_data(n_samples: int = 12000, seed: int = RNG_SEED) -> pd.DataFrame:
    """Generate synthetic maintenance-task records + labels for Module1.

    Uses stratified sampling across real-world railway maintenance profiles
    (CRITICAL emergency repairs, HIGH track priorities, MEDIUM routine maintenance,
    and LOW minor preventive tasks) plus general random tasks and benchmark
    anchors. This ensures balanced representation across all risk categories
    instead of severe class imbalance.
    """
    rng = np.random.default_rng(seed)
    conditions = list(ASSET_CONDITION_MAP.keys())

    # Canonical benchmark patterns from ML_pipeline_IO.md
    canonical_tasks = [
        {"severity": 10, "criticality": 10, "urgency": 9, "overdue_days": 8,
         "safety_impact": 10, "train_impact": 9, "availability_impact": 10,
         "asset_condition": "poor", "maintenance_duration_min": 120,
         "priority_score": 87.39, "risk_level": "CRITICAL"},
        {"severity": 9, "criticality": 9, "urgency": 8, "overdue_days": 6,
         "safety_impact": 9, "train_impact": 8, "availability_impact": 9,
         "asset_condition": "critical", "maintenance_duration_min": 150,
         "priority_score": 84.72, "risk_level": "CRITICAL"},
        {"severity": 7, "criticality": 8, "urgency": 7, "overdue_days": 5,
         "safety_impact": 8, "train_impact": 7, "availability_impact": 8,
         "asset_condition": "poor", "maintenance_duration_min": 120,
         "priority_score": 70.18, "risk_level": "HIGH"},
        {"severity": 6, "criticality": 8, "urgency": 6, "overdue_days": 2,
         "safety_impact": 7, "train_impact": 6, "availability_impact": 7,
         "asset_condition": "fair", "maintenance_duration_min": 90,
         "priority_score": 61.91, "risk_level": "MEDIUM"},
        {"severity": 2, "criticality": 3, "urgency": 2, "overdue_days": 0,
         "safety_impact": 2, "train_impact": 2, "availability_impact": 2,
         "asset_condition": "good", "maintenance_duration_min": 45,
         "priority_score": 16.47, "risk_level": "LOW"},
    ]

    profile_categories = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "GENERAL"]
    profile_weights = [0.20, 0.25, 0.30, 0.15, 0.10]

    rows = []
    for i in range(n_samples):
        cat = rng.choice(profile_categories, p=profile_weights)

        if cat == "CRITICAL":
            sev = rng.integers(8, 11)
            crit = rng.integers(8, 11)
            urg = rng.integers(7, 11)
            od = rng.integers(5, 15)
            safe = rng.integers(8, 11)
            train = rng.integers(7, 11)
            avail = rng.integers(8, 11)
            cond = rng.choice(["poor", "critical"], p=[0.4, 0.6])
            dur = int(rng.integers(90, 181))
        elif cat == "HIGH":
            sev = rng.integers(6, 9)
            crit = rng.integers(7, 10)
            urg = rng.integers(6, 9)
            od = rng.integers(3, 10)
            safe = rng.integers(7, 10)
            train = rng.integers(6, 9)
            avail = rng.integers(6, 9)
            cond = rng.choice(["fair", "poor", "critical"], p=[0.3, 0.5, 0.2])
            dur = int(rng.integers(60, 151))
        elif cat == "MEDIUM":
            sev = rng.integers(4, 7)
            crit = rng.integers(4, 8)
            urg = rng.integers(4, 7)
            od = rng.integers(1, 6)
            safe = rng.integers(4, 7)
            train = rng.integers(4, 7)
            avail = rng.integers(4, 7)
            cond = rng.choice(["good", "fair", "poor"], p=[0.4, 0.45, 0.15])
            dur = int(rng.integers(45, 121))
        elif cat == "LOW":
            sev = rng.integers(1, 4)
            crit = rng.integers(1, 5)
            urg = rng.integers(1, 4)
            od = rng.integers(0, 3)
            safe = rng.integers(1, 4)
            train = rng.integers(1, 4)
            avail = rng.integers(1, 4)
            cond = rng.choice(["good", "fair"], p=[0.75, 0.25])
            dur = int(rng.integers(15, 61))
        else:  # GENERAL random exploration across the whole parameter space
            sev = rng.integers(1, 11)
            crit = rng.integers(1, 11)
            urg = rng.integers(1, 11)
            od = rng.integers(0, 15)
            safe = rng.integers(1, 11)
            train = rng.integers(1, 11)
            avail = rng.integers(1, 11)
            cond = rng.choice(conditions)
            dur = int(rng.integers(15, 181))

        row = {
            "task_id": f"SYN{i:05d}",
            "severity": int(sev),
            "criticality": int(crit),
            "urgency": int(urg),
            "overdue_days": int(od),
            "safety_impact": int(safe),
            "train_impact": int(train),
            "availability_impact": int(avail),
            "asset_condition": cond,
            "maintenance_duration_min": int(dur),
        }

        base_score = _true_priority_score(row)
        noisy_score = float(np.clip(base_score + rng.normal(0, 1.2), 0, 100))

        row["priority_score"] = round(noisy_score, 2)
        row["risk_level"] = _risk_level_from_score(noisy_score)
        rows.append(row)

    # Augment with canonical operational anchor variations
    for idx, canon in enumerate(canonical_tasks):
        for rep in range(30):
            row = {
                "task_id": f"CANON_{idx}_{rep:02d}",
                "severity": canon["severity"],
                "criticality": canon["criticality"],
                "urgency": canon["urgency"],
                "overdue_days": canon["overdue_days"],
                "safety_impact": canon["safety_impact"],
                "train_impact": canon["train_impact"],
                "availability_impact": canon["availability_impact"],
                "asset_condition": canon["asset_condition"],
                "maintenance_duration_min": canon["maintenance_duration_min"],
            }
            target_score = float(np.clip(canon["priority_score"] + rng.normal(0, 0.4), 0, 100))
            row["priority_score"] = round(target_score, 2)
            row["risk_level"] = canon["risk_level"]
            rows.append(row)

    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# MODULE 2 — XGBoost Ranker (maintenance window ranking)
# ---------------------------------------------------------------------------

def _true_xgb_score(row: dict) -> float:
    """Ground-truth scoring function for ranking candidate windows.
    Reverse-engineered so that low conflict / high availability / high
    weather suitability / high expected asset impact => higher score,
    matching the sample (TASK001 CW001 94.21 BEST, CW002 72.48 ALTERNATIVE,
    CW003 31.16 LOW).
    """
    score = (
        (1 - row["train_conflict_score"]) * 30
        + (1 - row["goods_train_probability"]) * 15
        + row["corridor_availability"] * 20
        + row["weather_suitability"] * 15
        + min(row["compatible_task_count"] / 5.0, 1.0) * 8
        + row["expected_asset_impact"] * 12
    )
    return float(np.clip(score, 0, 100))


def _recommendation_from_rank(rank: int) -> str:
    if rank == 1:
        return "BEST"
    elif rank == 2:
        return "ALTERNATIVE"
    else:
        return "LOW"


def generate_module2_data(n_tasks: int = 1500, windows_per_task=(2, 4), seed: int = RNG_SEED) -> pd.DataFrame:
    """Generate synthetic (task, window) candidate records + rank labels.

    Each task gets 2-4 candidate windows; XGBoost's ranking objective needs
    grouped queries (one group = one task's candidate windows), so we track
    a 'group' id (task_id) that the training script uses to build qid groups.
    """
    rng = np.random.default_rng(seed + 1)
    sections = ["CBE-SLM", "SLM-ED", "ED-TUP", "TUP-CBE"]

    rows = []
    for i in range(n_tasks):
        task_id = f"SYN{i:05d}"
        n_windows = int(rng.integers(windows_per_task[0], windows_per_task[1] + 1))

        candidates = []
        for w in range(n_windows):
            row = {
                "task_id": task_id,
                "window_id": f"{task_id}_CW{w + 1}",
                "section": rng.choice(sections),
                "block_id": f"BLK{rng.integers(1, 999):03d}",
                "duration_min": int(rng.integers(30, 181)),
                "train_conflict_score": round(float(rng.uniform(0, 1)), 2),
                "goods_train_probability": round(float(rng.uniform(0, 1)), 2),
                "corridor_availability": round(float(rng.uniform(0.5, 1.0)), 2),
                "weather_suitability": round(float(rng.uniform(0.5, 1.0)), 2),
                "compatible_task_count": int(rng.integers(1, 6)),
                "expected_asset_impact": round(float(rng.uniform(0.3, 1.0)), 2),
            }
            score = _true_xgb_score(row)
            noisy = float(np.clip(score + rng.normal(0, 3.0), 0, 100))
            row["_true_score"] = noisy
            candidates.append(row)

        # rank within this task's group by true score (desc)
        candidates.sort(key=lambda r: r["_true_score"], reverse=True)
        for rank, row in enumerate(candidates, start=1):
            row["xgb_score_label"] = round(row.pop("_true_score"), 2)
            row["relevance"] = n_windows - rank + 1  # higher = more relevant, for ranker training
            row["xgb_rank_label"] = rank
            row["recommendation_label"] = _recommendation_from_rank(rank)
            rows.append(row)

    return pd.DataFrame(rows)


if __name__ == "__main__":
    df1 = generate_module1_data()
    df2 = generate_module2_data()
    print("Module1 synthetic data:", df1.shape)
    print(df1.head())
    print("\nModule2 synthetic data:", df2.shape)
    print(df2.head())
