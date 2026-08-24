"""Quantile gradient-boosting inference and transparent feature preparation."""

from __future__ import annotations

from dataclasses import asdict
from functools import lru_cache
from typing import Any

import numpy as np
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder
from sklearn.compose import ColumnTransformer

from . import MODEL_VERSION
from .data import DemoRow, make_demo_rows

NUMERIC = ["planted_area_hectares", "observation_count", "observation_quantity_kg", "rainfall_7d_mm", "ndvi_median", "ndvi_slope", "heat_stress_days", "cloud_quality_score", "days_since_planting"]
CATEGORICAL = ["crop_type", "crop_stage"]
FEATURE_COLUMNS = [*NUMERIC, *CATEGORICAL]


def row_features(row: DemoRow | dict[str, Any]) -> dict[str, Any]:
    raw = asdict(row) if isinstance(row, DemoRow) else row
    return {key: raw.get(key) for key in [*NUMERIC, *CATEGORICAL]}


def feature_matrix(rows: list[dict[str, Any]]) -> list[list[Any]]:
    """Keep feature order explicit without requiring a dataframe dependency."""
    return [[np.nan if item.get(column) is None and column in NUMERIC else item.get(column) for column in FEATURE_COLUMNS] for item in rows]


def build_features(crop_type: str, features: dict[str, Any], requested_at: str) -> tuple[dict[str, Any], list[str]]:
    """Map contract-safe summaries into model features; never infer hidden truth."""
    weather = features.get("weatherSummary") or {}
    satellite = features.get("satelliteSummary") or {}
    stage = str(features.get("cropStage") or "UNKNOWN").upper()
    warnings = ["Synthetic demonstration model; not calibrated to farm outcomes."]
    observation_quantity = features.get("observationQuantityKg")
    rainfall = weather.get("rainfall7dMm")
    ndvi = satellite.get("ndviMedian", satellite.get("ndvi"))
    values: dict[str, Any] = {
        "crop_type": crop_type.upper(),
        "planted_area_hectares": features.get("plantedAreaHectares"),
        "crop_stage": stage,
        "observation_count": features.get("observationCount", 0),
        "observation_quantity_kg": observation_quantity,
        "rainfall_7d_mm": rainfall,
        "ndvi_median": ndvi,
        "ndvi_slope": satellite.get("ndviSlope"),
        "heat_stress_days": weather.get("heatStressDays"),
        "cloud_quality_score": satellite.get("cloudQualityScore"),
        "days_since_planting": features.get("daysSincePlanting"),
    }
    if values["crop_type"] not in {"CUCUMBER", "TOMATO", "SWEET_PEPPER", "LETTUCE"}:
        warnings.append("Crop type is outside the synthetic training cohort.")
    if values["observation_count"] == 0:
        warnings.append("No field observations supplied.")
    if values["planted_area_hectares"] is None:
        warnings.append("Planted area is unavailable.")
    if rainfall is None:
        warnings.append("Seven-day rainfall is unavailable.")
    if ndvi is None:
        warnings.append("Satellite vegetation summary is unavailable.")
    return values, warnings


def _pipeline(alpha: float) -> Pipeline:
    preprocessor = ColumnTransformer([
        ("numeric", SimpleImputer(strategy="median", add_indicator=True), list(range(len(NUMERIC)))),
        ("categorical", Pipeline([("imputer", SimpleImputer(strategy="most_frequent")), ("onehot", OneHotEncoder(handle_unknown="ignore"))]), list(range(len(NUMERIC), len(FEATURE_COLUMNS)))),
    ])
    return Pipeline([("features", preprocessor), ("model", GradientBoostingRegressor(loss="quantile", alpha=alpha, n_estimators=140, max_depth=2, min_samples_leaf=6, learning_rate=0.05, random_state=20260807))])


@lru_cache(maxsize=1)
def fitted_models() -> dict[float, Pipeline]:
    rows = [row for row in make_demo_rows() if row.split == "train"]
    x = feature_matrix([row_features(row) for row in rows])
    y = [row.marketable_yield_kg for row in rows]
    return {alpha: _pipeline(alpha).fit(x, y) for alpha in (0.1, 0.5, 0.9)}


def raw_predict_quantiles(values: dict[str, Any]) -> tuple[float, float, float]:
    matrix = feature_matrix([values])
    predictions = [max(0.0, float(fitted_models()[alpha].predict(matrix)[0])) for alpha in (0.1, 0.5, 0.9)]
    q10, q50, q90 = np.maximum.accumulate(predictions).tolist()
    return q10, q50, q90


@lru_cache(maxsize=1)
def calibration_offsets() -> tuple[float, float]:
    """Calibrate interval edges on a cohort never used to fit or evaluate."""
    rows = [row for row in make_demo_rows() if row.split == "calibration"]
    lower_residuals = []
    upper_residuals = []
    for row in rows:
        q10, _, q90 = raw_predict_quantiles(row_features(row))
        lower_residuals.append(row.marketable_yield_kg - q10)
        upper_residuals.append(row.marketable_yield_kg - q90)
    return float(np.quantile(lower_residuals, 0.1)), float(np.quantile(upper_residuals, 0.9))


def predict_quantiles(values: dict[str, Any]) -> tuple[float, float, float]:
    q10, q50, q90 = raw_predict_quantiles(values)
    lower_adjustment, upper_adjustment = calibration_offsets()
    q10 = min(max(0.0, q10 + lower_adjustment), q50)
    q90 = max(q50, q90 + upper_adjustment)
    return tuple(round(value, 2) for value in (q10, q50, q90))


def confidence(values: dict[str, Any], q10: float, q90: float) -> float:
    present = sum(values[key] is not None for key in ("planted_area_hectares", "rainfall_7d_mm", "ndvi_median", "days_since_planting"))
    observation_factor = min(float(values["observation_count"] or 0) / 3, 1)
    relative_width = (q90 - q10) / max(q90, 1)
    return round(float(np.clip(0.3 + present * 0.09 + observation_factor * 0.16 - relative_width * 0.18, 0.1, 0.85)), 2)


def harvest_window(stage: str, requested_date: str) -> tuple[str, str, float]:
    from datetime import date, timedelta

    base = date.fromisoformat(requested_date[:10])
    offsets = {"HARVEST_READY": (1, 4, 0.86), "FRUITING": (7, 17, 0.64), "VEGETATIVE": (21, 42, 0.35)}
    start, end, readiness = offsets.get(stage.upper(), (14, 35, 0.45))
    return (base + timedelta(days=start)).isoformat(), (base + timedelta(days=end)).isoformat(), readiness


def metadata() -> dict[str, str]:
    return {"modelVersion": MODEL_VERSION, "trainingData": "synthetic-demo-cohort-v1", "algorithm": "quantile-gradient-boosting"}
