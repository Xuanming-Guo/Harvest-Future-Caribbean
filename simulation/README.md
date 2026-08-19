# Simulation

Harvest's discrete-event simulation and its paired benchmark policies.

## Running it

```bash
npm run sim                                  # hero scenario, Harvest policy
npm run sim -- --policy BASELINE --seed 42
npm run sim -- --paired --seed 42            # both policies, identical world
npm run sim -- --paired --seeds 1,2,3        # several paired runs
npm run sim -- --json                        # machine-readable
npm run sim -- --decisions                   # print the decision trace
```

No database and no services: the engine is self-contained and a full
twenty-one-day run takes a few milliseconds.

## How it is put together

| Path | Role |
| --- | --- |
| `src/core/random.ts` | Seeded generators, split into independent named streams |
| `src/core/queue.ts` | Binary-heap event queue with a total ordering |
| `src/core/ids.ts` | Deterministic UUID-shaped identifiers |
| `src/core/time.ts` | Simulation time; the only file allowed to touch `Date` |
| `src/world/types.ts` | The hidden-truth / observed-world split |
| `src/world/observable.ts` | Contract projection, leak guard, world digest |
| `src/scenario/` | Scenario recipes; `saint-lucia-demo-v1` is the hero |
| `src/policy/` | `baseline` and `harvest` coordination policies |
| `src/engine.ts` | Clock, handlers, validation, metrics |

### Determinism

Reproducibility is an acceptance criterion, not a nicety, so the package is
built around it:

- **No unseeded randomness or wall-clock time.** ESLint fails the build on
  `Math.random`, `Date.now` and bare `Date` outside the two files that
  legitimately need them.
- **Independent random streams.** Each subsystem draws from a stream seeded
  from the run seed mixed with a stream name. Adding a draw to the weather
  model cannot shift demand or yields.
- **A total ordering on events.** Ties at the same instant break on priority
  and then on insertion sequence, so nothing depends on heap internals.
- **Whole-world digests.** `worldDigest` hashes hidden truth as well as
  observed state, because two runs could agree on every published number while
  their underlying truth had diverged.

### The hidden-truth boundary

`HiddenTruth` holds actual yields, actual readiness, actual quality and
disruptions that have not happened yet. `ObservedWorld` holds only what someone
has reported by the current simulation time. They are separate objects, so a
policy handed the observed world has no route to the truth — the value is not
on the object it received. `assertNoTruthLeak` backs this at runtime for
dynamically assembled payloads.

A policy's advantage must come from coordination, never from foresight.

## Honest status of the baseline-versus-Harvest comparison

**On the current scenario the Harvest policy does not outperform the
fragmented baseline.** Mean fulfilment across ten paired seeds is roughly 9.7%
for Harvest against 9.8% for the baseline, and Harvest wastes slightly more.

This is recorded rather than tuned away. Issue #4 owns the machinery that makes
an honest comparison possible — identical worlds, isolated policy hooks,
reproducible seeds. Issue #11 owns the comparison itself, and adjusting
constants here until the favoured policy wins would fabricate the very result
that issue exists to measure.

Two causes have been identified so far, both worth addressing in #11:

1. **Observation latency dominates.** Growers report every two to fourteen
   days; buyers want an answer within three to seven. Harvest will only promise
   against a batch reported ready, so it routinely misses the window. It can
   now ask a grower to go and look (`requestObservation`), which recovered a
   large part of the gap, but the six-to-forty-two-hour response time still
   costs it orders the baseline wins by guessing.
2. **Just-in-time pickup maximises spoilage.** Missions are scheduled to arrive
   shortly before the deadline, while a ready cucumber crop is losing six to
   fourteen percent a day. Committing early and collecting late is worse than
   not committing at all. Picking on readiness rather than on the delivery
   deadline is the obvious fix and belongs with the logistics work.

Neither is a defect in the engine; both are policy and scheduling questions the
benchmark issue should answer with repeated seeds and reported distributions.

## Evidence status

Every number this package produces is **synthetic**. The Saint Lucian locations
are real; no yield, price, demand, road speed or spoilage figure is a
measurement. Each `RunResult` carries an `evidenceLabel` and a
`provenanceNote`, so the label travels with the data rather than living only in
a document. Results are simulated counterfactual evidence and must never be
presented as measured impact from a deployed system.

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
future Harvest-mode simulated actors, saved-run/control-room operations, SSE
replay rules, and deterministic effects. Fastify imports this package directly;
there is no separate simulation HTTP service or port. Event consumers must
deduplicate UUID event IDs, persist the monotonic `Last-Event-ID` cursor,
schedule future effects, and never expose or rewrite hidden truth.

For a complete localhost Product API walkthrough, including the exact expected
seed-42 replay and paired-run values, use
[`docs/simulation_api_local_testing.md`](../docs/simulation_api_local_testing.md).
