"""FastAPI implementation of contracts/model/openapi.yaml."""

from __future__ import annotations

import os
from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from . import MODEL_VERSION
from .estimator import build_features, confidence, harvest_window, predict_quantiles


class FeatureSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")
    observationCount: int = Field(ge=0)
    observationQuantityKg: float | None = Field(default=None, ge=0)
    plantedAreaHectares: float | None = Field(default=None, gt=0)
    daysSincePlanting: int | None = Field(default=None, ge=0)
    cropStage: str | None = None
    lastObservedAt: datetime | None = None
    weatherSummary: dict[str, float | str | bool | None] | None = None
    satelliteSummary: dict[str, float | str | bool | None] | None = None


class PredictionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    requestId: UUID
    cropBatchId: UUID
    cropType: str = Field(min_length=1)
    farmId: UUID
    requestedAt: datetime
    simulationRunId: UUID | None = None
    provenance: str
    features: FeatureSummary


app = FastAPI(title="Harvest Yield Model API", version="0.1.0")


def require_token(authorization: str | None) -> None:
    expected = os.getenv("INTERNAL_SERVICE_TOKEN", "harvest-local-service-token-change-me")
    if authorization != f"Bearer {expected}":
        raise HTTPException(status_code=401, detail="Invalid service token")


@app.get("/healthz")
def health() -> dict[str, str]:
    return {"status": "ok", "modelVersion": MODEL_VERSION}


@app.post("/internal/v1/yield-predictions")
def create_yield_prediction(
    request: PredictionRequest,
    idempotency_key: str = Header(alias="Idempotency-Key", min_length=8, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]+$"),
    authorization: str | None = Header(default=None),
) -> dict[str, object]:
    require_token(authorization)
    if request.provenance not in {"OBSERVED", "INFERRED", "SYNTHETIC", "STAKEHOLDER_CALIBRATED"}:
        raise HTTPException(status_code=422, detail="Request provenance must be observable or synthetic, not model-predicted.")
    values, warnings = build_features(request.cropType, request.features.model_dump(), request.requestedAt.isoformat())
    q10, q50, q90 = predict_quantiles(values)
    start, end, readiness = harvest_window(values["crop_stage"], request.requestedAt.date().isoformat())
    return {
        "predictionId": str(uuid4()), "requestId": str(request.requestId), "cropBatchId": str(request.cropBatchId),
        "modelVersion": MODEL_VERSION,
        "q10MarketableYield": {"value": q10, "unit": "kg"},
        "q50MarketableYield": {"value": q50, "unit": "kg"},
        "q90MarketableYield": {"value": q90, "unit": "kg"},
        "harvestWindow": {"start": start, "end": end}, "readiness": readiness,
        "confidence": confidence(values, q10, q90), "warnings": warnings,
        "provenance": "MODEL_PREDICTED", "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }


def run() -> None:
    import uvicorn
    uvicorn.run("harvest_model.service:app", host="0.0.0.0", port=int(os.getenv("MODEL_PORT", "8002")))
