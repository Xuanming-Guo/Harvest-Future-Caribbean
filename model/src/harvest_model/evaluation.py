"""Held-out evaluation and calibration report for the synthetic demo cohort."""

from __future__ import annotations

import json

import numpy as np

from .data import make_demo_rows
from .estimator import calibration_offsets, predict_quantiles, row_features


def pinball(actual: float, predicted: float, quantile: float) -> float:
    error = actual - predicted
    return max(quantile * error, (quantile - 1) * error)


def evaluate() -> dict[str, object]:
    rows = [row for row in make_demo_rows() if row.split == "test"]
    results = []
    for row in rows:
        q10, q50, q90 = predict_quantiles(row_features(row))
        results.append((row, q10, q50, q90))
    actual = np.array([row.marketable_yield_kg for row, *_ in results])
    median = np.array([q50 for _, _, q50, _ in results])
    report: dict[str, object] = {
        "dataset": "synthetic-demo-cohort-v1", "label": "SYNTHETIC", "holdoutRows": len(results),
        "maeKg": round(float(np.mean(np.abs(actual - median))), 2),
        "rmseKg": round(float(np.sqrt(np.mean((actual - median) ** 2))), 2),
        "biasKg": round(float(np.mean(median - actual)), 2),
        "intervalCoverageQ10Q90": round(float(np.mean([(q10 <= row.marketable_yield_kg <= q90) for row, q10, _, q90 in results])), 3),
        "pinballLoss": {str(alpha): round(float(np.mean([pinball(row.marketable_yield_kg, prediction, alpha) for row, *quantiles in results for prediction in [quantiles[{0.1: 0, 0.5: 1, 0.9: 2}[alpha]]]])), 2) for alpha in (0.1, 0.5, 0.9)},
        "biasByCropKg": {}, "calibration": {
            "method": "Separate-cohort residual quantile adjustment for q10 and q90; no held-out rows are used.",
            "calibrationRows": len([row for row in make_demo_rows() if row.split == "calibration"]),
            "q10AdjustmentKg": round(calibration_offsets()[0], 2), "q90AdjustmentKg": round(calibration_offsets()[1], 2),
        },
    }
    by_crop = report["biasByCropKg"]
    assert isinstance(by_crop, dict)
    for crop in sorted({row.crop_type for row, *_ in results}):
        pairs = [(row, q50) for row, _, q50, _ in results if row.crop_type == crop]
        by_crop[crop] = round(float(np.mean([q50 - row.marketable_yield_kg for row, q50 in pairs])), 2)
    return report


def main() -> None:
    print(json.dumps(evaluate(), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
