# Harvest-estimation model

The first executable baseline is a local FastAPI service using three quantile
gradient-boosting regressors. It returns q10/q50/q90 marketable yield, a
harvest window, readiness, confidence, warnings, and an immutable model
version. It is deliberately small enough to run locally in seconds.

## Responsibilities

- Satellite, climate, farm, crop-stage, and farmer-observation features.
- Model training, evaluation, calibration, inference, and version tracking.
- Prediction ranges such as q10, q50, and q90 rather than false precision.
- Data-quality warnings and evidence needed to interpret a prediction.
- Predicted-versus-actual records used for later calibration.

## Boundaries

- The model returns predictions through a documented contract.
- It never writes directly to Product API storage or commits inventory.
- The Product API validates predictions and applies deterministic safety and
  reservation rules.
- Training and benchmark windows must remain separate.
- The initial system assumes farm boundary and crop type are supplied; it does
  not claim exact crop recognition or guaranteed yield from satellite imagery.

Model interfaces belong in [`contracts/`](../contracts/).

## Run locally

Use Python 3.11+ in an isolated environment:

```bash
cd model
python -m venv .venv
.venv/Scripts/python -m pip install -e ".[dev]"
.venv/Scripts/harvest-model
```

The service listens on `http://localhost:8002`. It implements only the
internal, bearer-token-protected prediction operation in
[`contracts/model/openapi.yaml`](../contracts/model/openapi.yaml). Set
`INTERNAL_SERVICE_TOKEN` to the same value used by the Product API.

Run the held-out evaluation and tests with:

```bash
.venv/Scripts/harvest-model-evaluate
.venv/Scripts/python -m pytest
```

## Data, evaluation, and limitations

`harvest_model.data.make_demo_rows()` produces a fixed, labelled
`SYNTHETIC` crop-outcome cohort for cucumber, tomato, sweet pepper, and
lettuce. It combines known crop type and plot area with crop stage, farmer
observation count/quantity, seven-day rainfall, NDVI/NDVI slope, cloud quality,
heat-stress days, and days since planting. A deterministic farm-season split
keeps training, calibration, and held-out evaluation cohorts separate. A
calibration-only residual adjustment widens q10/q90 before the evaluator
reports MAE, RMSE, q10/q50/q90 pinball loss, 80% interval coverage, and
overall/crop bias. The CLI prints the exact synthetic result for the checked-in
model version; it must not be described as deployed accuracy.

The current reproducible run of `yield-qgb-synthetic-v0.1.0` reports the
following, all **synthetic** and therefore useful only as a pipeline check:

| Held-out rows | MAE | RMSE | q10–q90 coverage | Calibration rows |
| ---: | ---: | ---: | ---: | ---: |
| 96 | 1,003.75 kg | 1,654.99 kg | 83.3% | 96 |

The wide errors and crop-level bias are an expected limitation of the synthetic
cohort, not a performance claim. The exact crop-bias and pinball-loss values
are emitted by `harvest-model-evaluate` for review and regression testing.

These results are **not real farm performance** and must never be presented as
such. The model warns on absent plot, observation, weather, or satellite
evidence and on crop types outside the demonstration cohort. It assumes crop
type and farm boundary/area are supplied; it does not recognise crops from
satellite imagery. Replace the synthetic cohort with consented,
outcome-linked records and preserve a temporally separate benchmark window
before making any regional accuracy claim.

## Integration guide

The internal inference operation is defined in
[`contracts/model/openapi.yaml`](../contracts/model/openapi.yaml) and its shared
request/response schema. [`docs/api_info.md`](../docs/api_info.md) explains how
the Product API validates a prediction and calculates available-to-promise.
The model returns uncertainty and evidence; it never calculates ATP, reserves
inventory, or changes Product API state.
