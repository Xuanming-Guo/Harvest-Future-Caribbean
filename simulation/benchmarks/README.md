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
| `2026-09-04-after-forward-promises.json` / `.txt` | The same ten seeds after forward promises and the settlement window (#91) |

There is no separate "before forward promises" file. The command was re-run on
this branch immediately before the change and reproduced
`2026-09-02-after-horizon-clamp.json` metric for metric and digest for digest,
so that file is the pre-change column and a copy of it would only be a copy. The
same is true one change earlier, which is why there is no
`before-horizon-clamp` file either.

## The order book is back to its full size, and the run is longer

The horizon clamp took `HORIZON_TRUNCATED` to zero by refusing to raise 29 of
114 orders. A hotel ordering on day 20 for delivery on day 25 is a normal order,
and a benchmark that declines to score it is answering an easier question than
the one asked. The run now has a **7-day settlement window**: buyers still order
for 21 days, the run continues to day 28, and every order raised is followed
through to a real outcome. `HORIZON_TRUNCATED` is still zero, now by
construction rather than by omission.

At the same time Harvest may promise a crop that is still growing, dated from
the grower's own forecast window, and collect it when the growers report it
ready. Both changes move the world, so **every baseline digest is different**
and the comparison below crosses two different order books: 85 orders before,
114 after. Within each column both arms face the identical book from the same
seeded streams in the same order, which is what makes the pairing meaningful;
comparing a Harvest figure in one column against a Harvest figure in the other
compares two different questions.

## Fulfilment rate, ten paired seeds

Fulfilment is the share of a run's demands met in full by their deadline. `Δ` is
Harvest minus the baseline on that column's own order book.

| Seed | Baseline, clamped | Harvest, clamped | Δ clamped | Baseline, forward | Harvest, forward | Δ forward |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 42 | 12.5% | 50.0% | +37.5pp | 9.1% | 45.5% | +36.4pp |
| 8675309 | 0.0% | 55.6% | +55.6pp | 0.0% | 41.7% | +41.7pp |
| 7 | 14.3% | 85.7% | +71.4pp | 10.0% | 50.0% | +40.0pp |
| 19 | 22.2% | 22.2% | 0.0pp | 15.4% | 53.8% | +38.5pp |
| 23 | 25.0% | 25.0% | 0.0pp | 20.0% | 20.0% | 0.0pp |
| 31 | 20.0% | 60.0% | +40.0pp | 15.4% | 53.8% | +38.5pp |
| 101 | 9.1% | 45.5% | +36.4pp | 8.3% | 25.0% | +16.7pp |
| 202 | 0.0% | 71.4% | +71.4pp | 0.0% | 60.0% | +60.0pp |
| 303 | 14.3% | 28.6% | +14.3pp | 8.3% | 33.3% | +25.0pp |
| 404 | 0.0% | 33.3% | +33.3pp | 0.0% | 45.5% | +45.5pp |
| **median** | **13.4%** | **47.7%** | **+36.9pp** | **8.7%** | **45.5%** | **+38.5pp** |
| **mean** | **11.7%** | **47.7%** | **+36.0pp** | **8.7%** | **42.9%** | **+34.2pp** |

The median row's Δ is the median of the ten per-seed deltas, not the difference
of the two medians.

Read the win count rather than only the mean. On the clamped book Harvest beat
the baseline on eight seeds and tied two. On the full book it wins **nine and
ties one**, losing none. Seed 19 was one of the two ties and is now +38.5pp,
because the orders the clamp had removed from it were ones Harvest could fill:
it meets 7 of 13 where it met 2 of 9. Seed 7 is the largest single drop, 85.7%
to 50.0%, and it is a denominator: its clamped book was seven orders, of which
Harvest filled six, and on the ten orders it now faces it fills five.

Both arms score lower on the fuller book. The restored orders are late-window
ones, which are harder for everyone, and the baseline drops with Harvest.

Supporting figures, means across the same ten seeds unless marked.

| Measure | Baseline, clamped | Harvest, clamped | Baseline, forward | Harvest, forward |
| --- | ---: | ---: | ---: | ---: |
| Local procurement rate | 16.9% | 53.1% | 16.0% | 46.0% |
| Physical waste (kg) | 2,336 | 1,813 | 3,070 | 2,366 |
| Substituted, i.e. imported (kg) | 1,787 | 1,033 | 2,460 | 1,562 |
| Commitments approved (10 seeds) | 54 | 63 | 58 | 84 |
| Observation requests | 0 | 7.2 | 0 | 4.4 |
| Events processed | 86 | 130 | 110 | 157 |
| Orders raised (10 seeds) | 85 | 85 | 114 | 114 |

Three lines are worth reading twice.

**Commitments approved rise from 63 to 84** while the order book grows by 34%.
Harvest is not merely seeing more orders, it is converting more of them into a
promise: the whole point of promising a crop that is still growing is that an
order placed before anything is pickable can now be filled.

**Waste rises on both arms, from 2,336 to 3,070 kg for the baseline and 1,813 to
2,366 kg for Harvest.** Twenty-nine more orders and seven more days of a crop
losing six to fourteen percent of itself a day produce more spoilage in absolute
terms. Harvest's advantage over the baseline widens slightly, from 523 kg to
704 kg per run.

**Harvest's observation requests fall from 7.2 to 4.4 per run.** It asks a
grower to go and look when it has nothing recent enough to promise against, and
it now has a legitimate way to promise against a crop whose window is known. That
is a saving in farmer effort, which is the friction stakeholders complained
about, and it is worth watching in case it becomes a quality problem instead.

## Why demand went unmet

`causeCounts` assigns exactly one cause to every demand that ended unmet or
partially met, at the point it settles. Counts are totals across the same ten
seeds. `NOT_READY_IN_TIME` is new: it separates a load that came up short
because the crop had never been reported ready from one that came up short
because the crop was lost. Both used to read as `SPOILED_BEFORE_PICKUP`, which
said produce had perished when it had simply not arrived.

| Cause | Baseline, clamped | Harvest, clamped | Baseline, forward | Harvest, forward |
| --- | ---: | ---: | ---: | ---: |
| `NO_READY_SUPPLY` | 31 | 15 | 56 | 11 |
| `NOT_READY_IN_TIME` | n/a | n/a | 29 | 5 |
| `SPOILED_BEFORE_PICKUP` | 33 | 4 | 7 | 8 |
| `INSUFFICIENT_SUPPLY` | 10 | 18 | 11 | 14 |
| `APPROVAL_REJECTED` | 0 | 7 | 0 | 19 |
| `MISSION_LATE` | 1 | 1 | 1 | 8 |
| `DELIVERY_REJECTED` | 0 | 0 | 0 | 0 |
| `HORIZON_TRUNCATED` | 0 | 0 | 0 | 0 |
| **Total short** | **75 of 85** | **45 of 85** | **104 of 114** | **65 of 114** |

The baseline's 29 `NOT_READY_IN_TIME` is the reclassification doing its work: it
promises against a stated calendar window and sends a vehicle to a field nobody
has looked at, and 29 of its 33 former "spoilages" were that. Harvest carries 5,
which is the honest cost of forward promising: a promise dated from the grower's
own late estimate is still a promise about the future, and sometimes the future
disagrees.

Two of Harvest's rows got worse, and neither is an artefact.

- **`APPROVAL_REJECTED`, 7 to 19.** The approval gate re-checks each promise
  against current evidence two hours after it was proposed, and Harvest now
  proposes far more. This is now its largest bucket. Whether the gate is
  calibrated or merely strict has not been established, and it is the biggest
  single thing standing between Harvest and orders it has already matched.
- **`MISSION_LATE`, 1 to 8.** With 84 approved commitments rather than 63, more
  vehicles are on the road when the valley road closes or the van breaks down.
  Raising the lead time the policy reserves does not move this figure, which
  says it is the world rather than the schedule; the recovery path is where to
  look next.

Against that, `NO_READY_SUPPLY` falls from 15 to 11 on a book a third larger,
which is what forward promising was for, and `SPOILED_BEFORE_PICKUP` stays in
single figures on both columns.

## Determinism

Reproducibility is an acceptance criterion, so it is checked rather than
assumed: `simulation/tests/determinism.test.ts` compares whole-world digests
across repeat runs of one seed, `simulation/tests/fulfilment.test.ts` also
compares the full list of orders a seed raises across two runs, and every
benchmark file carries a `digest` per run. The same command on the same commit
reproduces the tables above exactly.
