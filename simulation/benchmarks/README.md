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
| `2026-09-02-before.json` / `.txt` | Ten paired seeds at `origin/main`, before any issue #53 fix |
| `2026-09-02-after-engine-defects.json` / `.txt` | The same ten seeds after the three coordination fixes |
| `2026-09-02-after-horizon-clamp.json` / `.txt` | The same ten seeds after demand generation became horizon-aware |

There is no separate `before-horizon-clamp` file. The command was re-run on this
branch immediately before the change and reproduced
`2026-09-02-after-engine-defects.json` metric for metric and digest for digest,
so that file is the pre-clamp column and a copy of it would only be a copy.

## The world moved this time, and the baseline moved with it

The three coordination fixes were policy and scheduling logic, so the baseline
arm came out bit-for-bit identical and the comparison could be read as a clean
policy delta. **The horizon clamp is not like that.** It changes demand
generation, which is part of the world, so both arms see a different and smaller
set of orders, and every baseline digest changed.

What changed is stated precisely rather than waved at. A buyer whose next
`neededBy` plus the twelve-hour substitution grace would fall after the
twenty-one-day horizon no longer raises that order at all. Over the ten seeds
that withholds **29 of 114 orders**. Both policies face the identical reduced
order book, drawn from the same seeded streams in the same sequence, so the
pairing that makes the comparison meaningful is intact.

The deadline is *withheld*, never pulled back inside the window. Clamping
`neededBy` would have kept all 114 orders and turned the late ones into
unusually urgent ones, manufacturing exactly the tight deadlines a coordination
benchmark is most sensitive to.

For the baseline the removed orders cost it nothing physical. Per seed, its
waste, accepted kilograms, completed deliveries and count of fully met orders
are **identical** before and after the clamp; only four approvals that never led
to a delivery disappear along with the orders they were for. Its fulfilment
*rate* rises because the denominator shrank, not because it did anything better.

For Harvest the removed orders were not all failures. Of the 29, twenty were
scored `HORIZON_TRUNCATED` and nine Harvest had actually delivered in full
before the run ended, despite their settlement falling outside the window. The
clamp therefore takes real wins away from Harvest as well as artefactual losses
from the baseline, and Harvest's waste rises slightly because crop those nine
orders would have absorbed is now left in the field.

## Fulfilment rate, ten paired seeds

Fulfilment is the share of a run's demands met in full by their deadline. The
first three value columns share one world of 114 orders; the last two share the
clamped world of 85. Comparing across that boundary compares two different order
books.

| Seed | Baseline, pre-clamp | Harvest, before defects | Harvest, after defects | Baseline, clamped | Harvest, clamped | Δ clamped |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 42 | 9.1% | 0.0% | 45.5% | 12.5% | 50.0% | +37.5pp |
| 8675309 | 0.0% | 8.3% | 41.7% | 0.0% | 55.6% | +55.6pp |
| 7 | 10.0% | 40.0% | 60.0% | 14.3% | 85.7% | +71.4pp |
| 19 | 15.4% | 7.7% | 30.8% | 22.2% | 22.2% | 0.0pp |
| 23 | 20.0% | 10.0% | 30.0% | 25.0% | 25.0% | 0.0pp |
| 31 | 15.4% | 7.7% | 69.2% | 20.0% | 60.0% | +40.0pp |
| 101 | 8.3% | 8.3% | 41.7% | 9.1% | 45.5% | +36.4pp |
| 202 | 0.0% | 10.0% | 50.0% | 0.0% | 71.4% | +71.4pp |
| 303 | 8.3% | 0.0% | 25.0% | 14.3% | 28.6% | +14.3pp |
| 404 | 0.0% | 18.2% | 36.4% | 0.0% | 33.3% | +33.3pp |
| **median** | **8.7%** | **8.3%** | **41.7%** | **13.4%** | **47.7%** | **+36.9pp** |
| **mean** | **8.7%** | **11.0%** | **43.0%** | **11.7%** | **47.7%** | **+36.0pp** |

`Δ clamped` is Harvest minus the baseline on the clamped world, per seed. The
median row's Δ is the median of the ten per-seed deltas, not the difference of
the two medians. Note that this is a *policy* gap; the `Δ Harvest` column this
table used to carry compared Harvest against its own earlier self, which is a
different question.

Read the win count rather than only the mean. On the pre-clamp world Harvest
beat the baseline on all ten seeds, by a mean of 34.4pp. On the clamped world
the mean gap is slightly wider at 36.0pp, but Harvest wins eight seeds and
**ties two** (19 and 23), losing none. Both ties are the same mechanism: the
clamp removed orders Harvest was filling and orders the baseline was failing, so
the two arms converged. A claim that Harvest leads on every seed is no longer
true and is not made here.

Supporting figures, means across the same ten seeds.

| Measure | Baseline, pre-clamp | Harvest, before defects | Harvest, after defects | Baseline, clamped | Harvest, clamped |
| --- | ---: | ---: | ---: | ---: | ---: |
| Local procurement rate | 13.2% | 15.8% | 46.3% | 16.9% | 53.1% |
| Physical waste (kg) | 2,336 | 2,348 | 1,759 | 2,336 | 1,813 |
| Substituted, i.e. imported (kg) | 2,545 | 2,468 | 1,478 | 1,787 | 1,033 |
| Commitments approved (10 seeds) | 58 | 56 | 80 | 54 | 63 |
| Observation requests | 0 | 5.9 | 7.8 | 0 | 7.2 |
| Events processed | 89 | 118 | 144 | 86 | 130 |
| Orders raised (10 seeds) | 114 | 114 | 114 | 85 | 85 |

Two lines are worth reading twice. The baseline's waste is unchanged to the
kilogram, which is the check that the clamp did not quietly hand it a physical
advantage. Harvest's waste rises from 1,759 kg to 1,813 kg, because the nine
orders it was filling past the horizon were pulling produce out of fields that
now spoil unpicked. That is the price of measuring only what the run can settle,
and it is paid by the policy the benchmark favours.

## Why demand went unmet

`causeCounts` assigns exactly one cause to every demand that ended unmet or
partially met, at the point it settles. Counts are totals across the same ten
seeds. The metric did not exist before the engine-defect fixes, so there is no
column for `2026-09-02-before.json`.

| Cause | Baseline, pre-clamp | Harvest, after defects | Baseline, clamped | Harvest, clamped |
| --- | ---: | ---: | ---: | ---: |
| `SPOILED_BEFORE_PICKUP` | 33 | 4 | 33 | 4 |
| `NO_READY_SUPPLY` | 31 | 15 | 31 | 15 |
| `HORIZON_TRUNCATED` | 29 | 20 | 0 | 0 |
| `INSUFFICIENT_SUPPLY` | 10 | 18 | 10 | 18 |
| `APPROVAL_REJECTED` | 0 | 7 | 0 | 7 |
| `MISSION_LATE` | 1 | 1 | 1 | 1 |
| `DELIVERY_REJECTED` | 0 | 0 | 0 | 0 |
| **Total short** | **104 of 114** | **65 of 114** | **75 of 85** | **45 of 85** |

Every non-horizon row is unchanged. That is the strongest evidence the clamp did
what it claimed and nothing else: it removed a category of scored failure that
was an artefact of the run's length, and left every other way of failing exactly
where it was. `HORIZON_TRUNCATED` is now zero on both arms across all ten seeds,
asserted in `tests/fulfilment.test.ts` rather than only recorded here. The
classification survives in the engine as a guard, because a scenario or an
injected effect could still produce such an order and it must not be mistaken
for a late delivery.

What is left to argue with:

- `INSUFFICIENT_SUPPLY` at 18 against the baseline's 10. Harvest delivers on far
  more orders, so partial deliveries it previously never attempted register here
  instead of as `NO_READY_SUPPLY`. That is the expected shape of the trade
  rather than a defect, but it is now the largest single bucket left.
- `APPROVAL_REJECTED` at 7. The approver re-checks a promise against evidence
  that decayed since the proposal. Whether the gate is calibrated or merely
  strict is still open.
- `NO_READY_SUPPLY` at 15. The orders nobody could commit against at all, which
  is the part a better forecast rather than better coordination would address.

## Determinism

Reproducibility is an acceptance criterion, so it is checked rather than
assumed: `simulation/tests/determinism.test.ts` compares whole-world digests
across repeat runs of one seed, `simulation/tests/fulfilment.test.ts` also
compares the full list of orders a seed raises across two runs, and every
benchmark file carries a `digest` per run. The same command on the same commit
reproduces the tables above exactly.
