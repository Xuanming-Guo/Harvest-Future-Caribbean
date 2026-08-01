# Simulation

This area will contain Harvest's discrete-event simulation and paired benchmark
policies. Deeper folders will be created only when implementation issues need
them.

## Responsibilities

- Simulated clock, random seed, scenario state, and synthetic actors.
- Hidden ground truth such as actual yield, readiness, quality, and disruption
  outcomes.
- Fragmented baseline and Harvest-enabled policies.
- Reproducible paired runs under the same initial conditions.
- Evaluation inputs for operational and economic benchmark metrics.

## Boundaries

- Simulated actors use the same Product API as real app users.
- The simulation never writes directly to Product API storage.
- Hidden ground truth remains separate from what Harvest can observe.
- Scenario data records whether each value is observed, inferred, synthetic,
  stakeholder-calibrated, or model-predicted.
- Simulation results demonstrate counterfactual behaviour, not deployed
  real-world impact.

Communication with the Product API follows [`contracts/`](../contracts/).

## Integration guide

Use [`docs/api_info.md`](../docs/api_info.md) for the public operations used by
Harvest-mode simulated actors, run/control-room operations, SSE replay rules,
and the deterministic effect of every Product API event. The simulation service
interface is [`contracts/simulation/openapi.yaml`](../contracts/simulation/openapi.yaml).
Handlers must deduplicate event IDs, persist `Last-Event-ID`, schedule future
effects, and never expose or rewrite hidden truth.
