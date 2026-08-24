from uuid import uuid4

from fastapi.testclient import TestClient

from harvest_model.evaluation import evaluate
from harvest_model.service import app


def request_payload() -> dict:
    return {
        "requestId": str(uuid4()), "cropBatchId": str(uuid4()), "cropType": "CUCUMBER", "farmId": str(uuid4()),
        "requestedAt": "2026-08-01T09:31:00Z", "provenance": "SYNTHETIC",
        "features": {"observationCount": 3, "plantedAreaHectares": 0.12, "cropStage": "FRUITING", "weatherSummary": {"rainfall7dMm": 41.2}, "satelliteSummary": {"ndviMedian": 0.71, "ndviSlope": 0.01, "cloudQualityScore": 0.8}, "daysSincePlanting": 40},
    }


def test_contract_prediction_is_ordered_and_versioned() -> None:
    response = TestClient(app).post("/internal/v1/yield-predictions", json=request_payload(), headers={"Authorization": "Bearer harvest-local-service-token-change-me", "Idempotency-Key": "model-test-001"})
    assert response.status_code == 200
    body = response.json()
    assert body["modelVersion"].startswith("yield-qgb-")
    assert body["provenance"] == "MODEL_PREDICTED"
    assert body["q10MarketableYield"]["value"] <= body["q50MarketableYield"]["value"] <= body["q90MarketableYield"]["value"]
    assert body["q10MarketableYield"]["unit"] == "kg"


def test_missing_features_reduce_confidence_and_disclose_limitations() -> None:
    payload = request_payload()
    payload["features"] = {"observationCount": 0}
    response = TestClient(app).post("/internal/v1/yield-predictions", json=payload, headers={"Authorization": "Bearer harvest-local-service-token-change-me", "Idempotency-Key": "model-test-002"})
    assert response.status_code == 200
    assert response.json()["confidence"] < 0.6
    assert "No field observations supplied." in response.json()["warnings"]


def test_contract_rejects_unallowlisted_features_and_invalid_service_token() -> None:
    payload = request_payload()
    response = TestClient(app).post("/internal/v1/yield-predictions", json=payload, headers={"Authorization": "Bearer incorrect", "Idempotency-Key": "model-test-003"})
    assert response.status_code == 401
    payload["features"]["hiddenTruth"] = 12
    response = TestClient(app).post("/internal/v1/yield-predictions", json=payload, headers={"Authorization": "Bearer harvest-local-service-token-change-me", "Idempotency-Key": "model-test-004"})
    assert response.status_code == 422


def test_evaluation_reports_required_metrics() -> None:
    report = evaluate()
    assert report["label"] == "SYNTHETIC"
    assert report["holdoutRows"] > 0
    assert 0 <= report["intervalCoverageQ10Q90"] <= 1
    assert set(report["pinballLoss"]) == {"0.1", "0.5", "0.9"}
