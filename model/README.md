# Harvest-estimation model

This area will contain the crop and harvest-estimation pipeline. Deeper folders
will be introduced by model issues when data preparation, training, evaluation,
or inference work begins.

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
