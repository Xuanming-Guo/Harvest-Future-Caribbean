"""Reproducible, explicitly synthetic training and held-out evaluation data.

This is a demo cohort, not a claim about Saint Lucia farm outcomes.  It makes
the model executable until consented, outcome-linked production records exist.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class DemoRow:
    crop_type: str
    planted_area_hectares: float
    crop_stage: str
    observation_count: int
    observation_quantity_kg: float | None
    rainfall_7d_mm: float | None
    ndvi_median: float | None
    ndvi_slope: float | None
    heat_stress_days: int | None
    cloud_quality_score: float | None
    days_since_planting: int
    marketable_yield_kg: float
    split: str


_CROPS = {
    "CUCUMBER": {"kg_per_hectare": 15500.0, "days": 52, "ndvi": 0.70},
    "TOMATO": {"kg_per_hectare": 21500.0, "days": 72, "ndvi": 0.73},
    "SWEET_PEPPER": {"kg_per_hectare": 12800.0, "days": 78, "ndvi": 0.67},
    "LETTUCE": {"kg_per_hectare": 17500.0, "days": 42, "ndvi": 0.61},
}


def make_demo_rows(seed: int = 20260807, rows_per_crop: int = 120) -> list[DemoRow]:
    """Return deterministic synthetic outcomes with a fixed holdout cohort."""
    random = np.random.default_rng(seed)
    rows: list[DemoRow] = []
    for crop_index, (crop, profile) in enumerate(_CROPS.items()):
        for index in range(rows_per_crop):
            area = float(random.uniform(0.04, 0.8))
            days = int(random.integers(max(12, profile["days"] - 45), profile["days"] + 20))
            progress = float(np.clip(days / profile["days"], 0.15, 1.15))
            stage = "HARVEST_READY" if progress >= 0.93 else "FRUITING" if progress >= 0.65 else "VEGETATIVE"
            rainfall = float(np.clip(random.normal(48, 23), 0, 140))
            ndvi = float(np.clip(random.normal(profile["ndvi"] * min(progress / 0.8, 1), 0.07), 0.08, 0.92))
            ndvi_slope = float(random.normal(0.004 if progress < 0.8 else -0.002, 0.009))
            heat_days = int(random.integers(0, 8))
            cloud = float(random.uniform(0.45, 1.0))
            observations = int(random.integers(0, 5))
            potential = area * profile["kg_per_hectare"] * min(progress / 0.92, 1.0)
            weather_factor = 1 - max(0, rainfall - 85) * 0.003 - heat_days * 0.018
            vegetation_factor = 0.65 + 0.5 * ndvi
            actual = max(0, potential * weather_factor * vegetation_factor + random.normal(0, max(6, potential * 0.12)))
            observation = None if observations == 0 else float(max(0, actual * random.normal(1.0, 0.16)))
            # A deterministic farm-season split prevents training on the rows
            # reported as evaluation results.
            split_index = (index + crop_index * 7) % 5
            split = "test" if split_index == 0 else "calibration" if split_index == 1 else "train"
            rows.append(DemoRow(crop, area, stage, observations, observation, rainfall, ndvi, ndvi_slope, heat_days, cloud, days, actual, split))
    return rows
