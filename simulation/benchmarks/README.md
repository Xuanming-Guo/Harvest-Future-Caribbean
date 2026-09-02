# Benchmark records

**SYNTHETIC SIMULATION OUTPUT, NOT DEPLOYED IMPACT.** Every figure on this page
comes from a seeded discrete-event simulation of an invented Saint Lucian
cucumber supply chain. No yield, price, deadline, road speed or spoilage number
here is a measurement, and none of it is evidence that a deployed system would
behave this way.

## What was measured

Ten paired seeds on `saint-lucia-demo-v1`. A paired run builds one world from a
seed and runs both policies over it, so the coordination policy is the only
variable.

```bash
npm run sim -- --paired --seeds 42,8675309,7,19,23,31,101,202,303,404
```

| File | Contents |
| --- | --- |
| `2026-09-02-before.json` / `.txt` | Ten paired seeds at `origin/main`, before the issue #53 engine fixes |
| `2026-09-02-after-engine-defects.json` / `.txt` | The same ten paired seeds after them |

The before run is `origin/main`; the after run is the same command on this
branch. No scenario constant was altered between them: supply sizes, order
sizes, deadlines, readiness windows, spoilage rates and observation intervals
are untouched, and the fixes are policy and scheduling logic only. The baseline
world digests are identical in the two files, which is the check that the world
itself did not move.

## Fulfilment rate, ten paired seeds

Fulfilment is the share of a run's demands met in full by their deadline.

| Seed | Baseline | Harvest before | Harvest after | Δ Harvest |
| --- | ---: | ---: | ---: | ---: |
| 42 | 9.1% | 0.0% | 45.5% | +45.5pp |
| 8675309 | 0.0% | 8.3% | 41.7% | +33.3pp |
| 7 | 10.0% | 40.0% | 60.0% | +20.0pp |
| 19 | 15.4% | 7.7% | 30.8% | +23.1pp |
| 23 | 20.0% | 10.0% | 30.0% | +20.0pp |
| 31 | 15.4% | 7.7% | 69.2% | +61.5pp |
| 101 | 8.3% | 8.3% | 41.7% | +33.3pp |
| 202 | 0.0% | 10.0% | 50.0% | +40.0pp |
| 303 | 8.3% | 0.0% | 25.0% | +25.0pp |
| 404 | 0.0% | 18.2% | 36.4% | +18.2pp |
| **median** | **8.7%** | **8.3%** | **41.7%** | **+29.2pp** |
| **mean** | **8.7%** | **11.0%** | **43.0%** | **+32.0pp** |

The median row's Δ is the median of the ten per-seed deltas, not the difference
of the two medians.

Harvest previously lost to the baseline on five of ten seeds and won the mean
only on the strength of one seed. It now leads on all ten, and the seed it was
already winning (7) improved as well.

Supporting figures, means across the same ten seeds. The baseline column is
identical before and after by construction.

| Measure | Baseline | Harvest before | Harvest after |
| --- | ---: | ---: | ---: |
| Local procurement rate | 13.2% | 15.8% | 46.3% |
| Physical waste (kg) | 2,336 | 2,348 | 1,759 |
| Substituted, i.e. imported (kg) | 2,545 | 2,468 | 1,478 |
| Commitments approved (10 seeds) | 58 | 56 | 80 |
| Observation requests | 0 | 5.9 | 7.8 |
| Events processed | 89 | 118 | 144 |

The waste line is the one worth reading twice. Before the fix Harvest wasted
slightly *more* than the fragmented baseline while fulfilling less: it committed
early and collected at the deadline, so a promised crop rotted under a promise.

## Why demand went unmet

`causeCounts` assigns exactly one cause to every demand that ended unmet or
partially met, at the point it settles. Counts below are totals across the same
ten seeds, from the after run; the metric did not exist before this change, so
there is no before column.

| Cause | Baseline | Harvest after |
| --- | ---: | ---: |
| `SPOILED_BEFORE_PICKUP` | 33 | 4 |
| `NO_READY_SUPPLY` | 31 | 15 |
| `HORIZON_TRUNCATED` | 29 | 20 |
| `INSUFFICIENT_SUPPLY` | 10 | 18 |
| `APPROVAL_REJECTED` | 0 | 7 |
| `MISSION_LATE` | 1 | 1 |
| `DELIVERY_REJECTED` | 0 | 0 |
| **Total short** | **104 of 114** | **65 of 114** |

Read as a diagnosis of what is left:

- `HORIZON_TRUNCATED` is 20 of Harvest's 65 misses. These are orders whose
  `neededBy` plus the substitution grace falls after the run ends, so they are
  scored as failures for arriving late in a twenty-one-day window rather than
  for anything a coordinator did. Classified, deliberately not clamped:
  changing demand generation changes what the benchmark measures and belongs in
  its own change.
- `INSUFFICIENT_SUPPLY` rose. That is the expected shape of the trade: Harvest
  now delivers on far more orders, and partial deliveries it previously never
  attempted now register here instead of as `NO_READY_SUPPLY`.
- `APPROVAL_REJECTED` at 7 is new and worth investigating. The approver
  re-checks a promise against evidence that has decayed since the proposal, and
  a stricter gate now has more commitments to decline.

## Determinism

Reproducibility is an acceptance criterion, so it is checked rather than
assumed: `simulation/tests/determinism.test.ts` compares whole-world digests
across repeat runs of one seed, and both benchmark files carry a `digest` per
run. The same command on the same commit reproduces the tables above exactly.
