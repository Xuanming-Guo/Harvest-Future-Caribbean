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
| `2026-09-03-after-weather.json` / `.txt` | The same ten seeds after realised weather and forecasts (#37) |
| `2026-09-04-after-inter-island.json` / `.txt` | The same ten seeds after scoped inter-island trade (#40); identical to the row above |
| `2026-09-04-two-island.json` / `.txt` | Saint Lucia + Martinique, ten paired seeds, the only scope in this directory that can ship |
| `2026-09-04-recorded-weather.json` / `.txt` | The same ten seeds after realised weather became *recorded* Saint Lucian weather (#90) |


## Current forward-promise and settlement results (#91)

`2026-09-06-forward-settlement.json` is the current standalone report. Each of
10 unchanged benchmark seeds was run twice per policy, with identical repeated
digests. Buyers order for 21 days; seven additional days settle those orders.
No demand is suppressed simply because its deadline exceeds the demand window.
All 20 policy/seed results have zero `HORIZON_TRUNCATED` orders.

| Seed | Baseline fully met | Harvest fully met | Harvest partial | Harvest unmet | Fulfilment delta (pp) |
| --- | ---: | ---: | ---: | ---: | ---: |
| 42 | 1 | 4 | 5 | 2 | +27.27 |
| 8675309 | 1 | 4 | 5 | 3 | +25.00 |
| 7 | 1 | 7 | 0 | 3 | +60.00 |
| 19 | 2 | 5 | 5 | 3 | +23.08 |
| 23 | 2 | 2 | 2 | 6 | 0.00 |
| 31 | 3 | 5 | 6 | 2 | +15.38 |
| 101 | 1 | 3 | 3 | 6 | +16.67 |
| 202 | 0 | 5 | 2 | 3 | +50.00 |
| 303 | 1 | 4 | 2 | 6 | +25.00 |
| 404 | 1 | 7 | 3 | 1 | +54.55 |

Nine wins, one tie; median paired improvement is 25 percentage points. Seed 23
remains a weak outcome: six unmet orders and 90.17 kg more waste than baseline.
The hero seeds serve at least part of 9/11 and 9/12 orders respectively.
These are synthetic standalone outcomes, not connected Product API totals or
real-world evidence. No scenario parameters were tuned to improve the score.

The extended demand book and weather horizon change the world. Historical
reports below use their original 21-day horizon and must not be read as a
controlled before/after comparison of the forward-promise policy alone.

## Historical reports (before the settlement window)

## Weather changed the world again, and it cost Harvest most

Realised weather (#37) is a change to the physics, not to a policy, so both arms
face it and every digest moved again. The order book did not: the same **85
orders** are raised, drawn from the same seeded streams, because weather does
not touch demand generation. The pairing that makes the comparison meaningful is
therefore intact, and what follows is a genuine change in outcomes rather than a
change in what was counted.

**The result is not flattering to Harvest, and it is reported as measured.**
Mean fulfilment falls from 47.7% to 32.7%; the baseline is flat at 11.6% against
11.7%. The policy gap narrows from a mean of +36.0pp to **+21.1pp**. Harvest
still wins seven of the ten seeds, but it now **loses seed 23 outright** (0.0%
against the baseline's 25.0%) where before the two tied. No tuning was done to
recover the old numbers, and none should be: the constants are in
`src/world/weather.ts`, they were set once from plausibility rather than from
outcomes, and moving them until the benchmark improved would make the benchmark
a measure of nothing.

Why the harder world hurts the arm that was winning:

- **The baseline had little left to lose.** It already fails most orders, so
  degrading readiness and grade removes value from crop it was never going to
  deliver. Its weather-attributed spoilage is actually the *higher* of the two
  at a mean of 351 kg against Harvest's 280 kg — it leaves more produce standing
  ready in the field to rot — yet its headline waste barely moves, because crop
  that ripens later also spends fewer days rotting and the two roughly cancel.
- **Harvest's advantage is realised through promises, and weather invalidates
  promises.** Its whole mechanism is to commit early against observed readiness
  and collect promptly. A batch that ripens up to three days late, loses grade to
  rain and rots faster once ready is a batch it has already promised against.
  Approvals rejected on decayed evidence rise from 7 to 12 across the ten seeds,
  and `INSUFFICIENT_SUPPLY` from 18 to 23: both are the same event seen twice,
  a promise the field could no longer cover.
- **It works harder for less.** Observation requests roughly double, from a mean
  of 7.2 to 13.9, because heavy realised rain now invalidates reports written
  before it and the policy goes back to ask. Events processed rise from 130 to
  150 per run. The extra coordination recovers part of the loss but not all of
  it.
- **Seed 23 is the honest failure.** Harvest committed against batches whose
  readiness slipped and whose grade fell, had two approvals rejected on the
  decayed evidence, and ended with 0 of 8 orders met against the baseline's 2.
  Substituted (imported) kilograms rose above the baseline's on that seed. A
  coordination policy that promises can be beaten by one that does not, in a
  world where the thing promised degrades faster than the promise can be met.

The forecast is not a fix for this, and is not offered as one. It brings a
pickup forward when a storm is coming inside the hold window, which recovers
some of the loss on stormy seeds; it is also wrong often enough that acting on
it sometimes costs an early collection for nothing. Both are visible in the
per-seed table rather than argued for here.

### What the weather actually did, ten seeds, Harvest arm

`metrics.weather` counts each effect as a counterfactual against the same run in
mild weather, so a run whose weather did nothing would report zeros.

| Measure | Mean per run | Total, 10 seeds |
| --- | ---: | ---: |
| Island-days realised wet (rain or storm) | 10.0 | 100 |
| Island-days realised as a storm | 3.8 | 38 |
| Ripening pushed back (batch-days) | 8.7 | 86.8 |
| Marketable grade lost (sum of fractions) | 1.13 | 11.3 |
| Spoilage the weather added (kg) | 280 | 2,799 |
| Missions slowed by departure-day weather | 2.4 | 24 |

Those are the *synthetic* figures. The recorded-weather section below replaces
them; both are kept because the difference between them is the point.

Wet days, storm days and readiness delay are identical on the baseline arm, as
they must be: they are properties of the world, not of the policy.

## Recorded weather made the world milder, and Harvest took most of the benefit

Issue #90 replaced the seeded rainfall stream with **recorded** Saint Lucian
daily weather for the scenario's own calendar window, replaying 1-22 September
of a real year chosen deterministically from the run seed
(`data/saint-lucia-weather-reference.v1.json`, Open-Meteo Historical Weather API,
CC BY 4.0; provenance and every threshold in `data/README-weather.md`). It is
another change to the physics, not to a policy, so both arms face it.

The order book is untouched: the same **85 orders**, and the same count on every
individual seed, because weather does not reach demand generation. The pairing is
intact and what follows is a genuine change in outcomes.

**The record is much milder than the generator that preceded it, and that is the
whole story of this column.** Nothing was tuned; the constants that classify a
recorded day were set from the physical meaning of the numbers before any run.

| Measure, Harvest arm, mean per run | Synthetic weather | Recorded weather |
| --- | ---: | ---: |
| Island-days realised wet | 10.0 | 4.7 |
| Island-days realised as a storm | 3.8 | 0.4 |
| Ripening pushed back (batch-days) | 8.7 | 2.7 |
| Marketable grade lost (sum of fractions) | 1.13 | 0.38 |
| Spoilage the weather added (kg) | 280 | 240 |
| Missions slowed by departure-day weather | 2.4 | 1.2 |

Across all six station-years in the dataset the windiest day reaches 24.6 kph and
exactly one day exceeds 20 mm of rain. That is a property of daily gridded
reanalysis over a small island rather than evidence that Saint Lucia has calm
Septembers, and `data/README-weather.md` says so at length. The demo is milder
because the record is milder.

Mean fulfilment rises from 32.7% to **39.2%** for Harvest and from 11.6% to
**12.7%** for the baseline, so the policy gap widens from +21.1pp to **+26.4pp**.
The record is seven wins, two ties (19 and 303) and one loss (23) — the same
shape as before, but seed 23's loss narrows from -25.0pp to -12.5pp.

Four things in that are worth reading twice, and two of them are awkward.

- **The baseline is not flat this time.** Seed 19 moves from 11.1% to 22.2%,
  which is one more order met. Every previous column could point at an unchanged
  baseline as evidence the change had not quietly handed it an advantage, and
  this one cannot. The claim is narrower: both arms got a milder world, and
  Harvest converted more of it.
- **Baseline waste rises even though the weather got gentler**, from a mean of
  2,328 kg to 2,487 kg, and it rises on eight of the ten seeds. This looks
  backwards and is not. Under synthetic weather, rain delayed ripening by 8.7
  batch-days per run; crop that ripens late spends fewer days standing ready and
  unpicked. Mild recorded weather ripens the crop on schedule and then leaves it
  in a field the baseline cannot collect from. Less weather damage, more waste.
- **Harvest works less hard for a better result.** Observation requests nearly
  halve, from a mean of 13.9 to 7.7, and events processed fall from 150 to 133,
  because the recheck-after-heavy-rain trigger fires far less often. Approvals
  rejected on decayed evidence fall from 12 to 8. Its own waste still rises
  slightly (1,912 kg to 1,994 kg) for the same ripening reason as the baseline's,
  but its substituted imports fall from 1,337 kg to 1,134 kg.
- **The forecast path has almost nothing left to act on.** With one storm day in
  three years of record, no benchmark seed now triggers a pull-forward on a
  forecast storm; a sweep of seeds 1-120 fires it on exactly one. That is
  asserted in `tests/weather.test.ts` rather than left as a footnote, so the day
  storms return to this scenario the test will fail and say so.

`INSUFFICIENT_SUPPLY` is unmoved at 23 on the Harvest arm, which is the clearest
sign that the largest remaining failure bucket is not a weather artefact. It
survived making the world harder in #37 and survived making it milder here.

## Fulfilment rate, ten paired seeds

Fulfilment is the share of a run's demands met in full by their deadline. The
first three value columns share one world of 114 orders; the rest share the
clamped world of 85. Comparing across that boundary compares two different order
books. The last three columns share the clamped order book with the two before
them but a physically harder world, because weather now acts on the crop.

| Seed | Baseline, pre-clamp | Harvest, before defects | Harvest, after defects | Baseline, clamped | Harvest, clamped | Δ clamped | Baseline, synthetic weather | Harvest, synthetic weather | Δ synthetic weather | Baseline, recorded weather | Harvest, recorded weather | Δ recorded weather |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 42 | 9.1% | 0.0% | 45.5% | 12.5% | 50.0% | +37.5pp | 12.5% | 25.0% | +12.5pp | 12.5% | 50.0% | +37.5pp |
| 8675309 | 0.0% | 8.3% | 41.7% | 0.0% | 55.6% | +55.6pp | 0.0% | 44.4% | +44.4pp | 0.0% | 22.2% | +22.2pp |
| 7 | 10.0% | 40.0% | 60.0% | 14.3% | 85.7% | +71.4pp | 14.3% | 71.4% | +57.1pp | 14.3% | 85.7% | +71.4pp |
| 19 | 15.4% | 7.7% | 30.8% | 22.2% | 22.2% | 0.0pp | 11.1% | 11.1% | 0.0pp | 22.2% | 22.2% | 0.0pp |
| 23 | 20.0% | 10.0% | 30.0% | 25.0% | 25.0% | 0.0pp | 25.0% | 0.0% | **-25.0pp** | 25.0% | 12.5% | **-12.5pp** |
| 31 | 15.4% | 7.7% | 69.2% | 20.0% | 60.0% | +40.0pp | 30.0% | 50.0% | +20.0pp | 30.0% | 60.0% | +30.0pp |
| 101 | 8.3% | 8.3% | 41.7% | 9.1% | 45.5% | +36.4pp | 9.1% | 45.5% | +36.4pp | 9.1% | 45.5% | +36.4pp |
| 202 | 0.0% | 10.0% | 50.0% | 0.0% | 71.4% | +71.4pp | 0.0% | 42.9% | +42.9pp | 0.0% | 57.1% | +57.1pp |
| 303 | 8.3% | 0.0% | 25.0% | 14.3% | 28.6% | +14.3pp | 14.3% | 14.3% | 0.0pp | 14.3% | 14.3% | 0.0pp |
| 404 | 0.0% | 18.2% | 36.4% | 0.0% | 33.3% | +33.3pp | 0.0% | 22.2% | +22.2pp | 0.0% | 22.2% | +22.2pp |
| **median** | **8.7%** | **8.3%** | **41.7%** | **13.4%** | **47.7%** | **+36.9pp** | **11.8%** | **34.0%** | **+21.1pp** | **13.4%** | **33.8%** | **+26.1pp** |
| **mean** | **8.7%** | **11.0%** | **43.0%** | **11.7%** | **47.7%** | **+36.0pp** | **11.6%** | **32.7%** | **+21.1pp** | **12.7%** | **39.2%** | **+26.4pp** |

Each `Δ` column is Harvest minus the baseline on that world, per seed. The
median row's Δ is the median of the ten per-seed deltas, not the difference of
the two medians. Note that this is a *policy* gap; the `Δ Harvest` column this
table used to carry compared Harvest against its own earlier self, which is a
different question.

Read the win count rather than only the mean. On the pre-clamp world Harvest
beat the baseline on all ten seeds, by a mean of 34.4pp. On the clamped world
the mean gap was slightly wider at 36.0pp, with eight wins, **two ties** (19 and
23) and no losses; both ties were the clamp removing orders Harvest was filling
and orders the baseline was failing. With weather the record is **seven wins,
two ties (19 and 303) and one loss (23)**, at a mean gap of 21.1pp. A claim that
Harvest leads on every seed has not been true since the clamp, and a claim that
it never loses stopped being true here.


Both arms score lower on the fuller book. The restored orders are late-window
ones, which are harder for everyone, and the baseline drops with Harvest.

| Measure | Baseline, pre-clamp | Harvest, before defects | Harvest, after defects | Baseline, clamped | Harvest, clamped | Baseline, synthetic wx | Harvest, synthetic wx | Baseline, recorded wx | Harvest, recorded wx |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Local procurement rate | 13.2% | 15.8% | 46.3% | 16.9% | 53.1% | 15.4% | 38.8% | 16.8% | 48.5% |
| Physical waste (kg) | 2,336 | 2,348 | 1,759 | 2,336 | 1,813 | 2,328 | 1,912 | 2,487 | 1,994 |
| Substituted, i.e. imported (kg) | 2,545 | 2,468 | 1,478 | 1,787 | 1,033 | 1,822 | 1,337 | 1,786 | 1,134 |
| Commitments approved (10 seeds) | 58 | 56 | 80 | 54 | 63 | 55 | 56 | 54 | 62 |
| Observation requests | 0 | 5.9 | 7.8 | 0 | 7.2 | 0 | 13.9 | 0 | 7.7 |
| Events processed | 89 | 118 | 144 | 86 | 130 | 86 | 150 | 86 | 133 |
| Orders raised (10 seeds) | 114 | 114 | 114 | 85 | 85 | 85 | 85 | 85 | 85 |

Two lines were worth reading twice at the clamp. The baseline's waste was
unchanged to the kilogram, which was the check that the clamp did not quietly
hand it a physical advantage. Harvest's waste rose from 1,759 kg to 1,813 kg,
because the nine orders it was filling past the horizon were pulling produce out
of fields that now spoil unpicked.

Three more are worth reading twice at the weather column. The baseline's waste
is flat again (−8 kg), so weather did not hand it an advantage either. Harvest's
waste rises a further 99 kg and its imports by 304 kg, which is produce it can no
longer get out of the field in time. And its observation requests nearly double,
which is the recheck-after-rain trigger doing exactly what it was written to do:
a report written before 25 mm of rain is no longer evidence, so somebody is
asked to go and look again.


## Why demand went unmet

`causeCounts` assigns exactly one cause to every demand that ended unmet or
partially met, at the point it settles. Counts are totals across the same ten
seeds. `NOT_READY_IN_TIME` is new: it separates a load that came up short
because the crop had never been reported ready from one that came up short
because the crop was lost. Both used to read as `SPOILED_BEFORE_PICKUP`, which
said produce had perished when it had simply not arrived.

| Cause | Baseline, pre-clamp | Harvest, after defects | Baseline, clamped | Harvest, clamped | Baseline, synthetic wx | Harvest, synthetic wx | Baseline, recorded wx | Harvest, recorded wx |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `SPOILED_BEFORE_PICKUP` | 33 | 4 | 33 | 4 | 36 | 5 | 34 | 5 |
| `NO_READY_SUPPLY` | 31 | 15 | 31 | 15 | 30 | 17 | 31 | 15 |
| `HORIZON_TRUNCATED` | 29 | 20 | 0 | 0 | 0 | 0 | 0 | 0 |
| `INSUFFICIENT_SUPPLY` | 10 | 18 | 10 | 18 | 5 | 23 | 8 | 23 |
| `APPROVAL_REJECTED` | 0 | 7 | 0 | 7 | 0 | 12 | 0 | 8 |
| `MISSION_LATE` | 1 | 1 | 1 | 1 | 4 | 0 | 1 | 1 |
| `DELIVERY_REJECTED` | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **Total short** | **104 of 114** | **65 of 114** | **75 of 85** | **45 of 85** | **75 of 85** | **57 of 85** | **74 of 85** | **52 of 85** |

At the clamp, every non-horizon row was unchanged. That was the strongest
evidence the clamp did what it claimed and nothing else: it removed a category
of scored failure that was an artefact of the run's length, and left every other
way of failing exactly where it was. `HORIZON_TRUNCATED` is still zero on both
arms across all ten seeds, asserted in `tests/fulfilment.test.ts` rather than
only recorded here. The classification survives in the engine as a guard,
because a scenario or an injected effect could still produce such an order and it
must not be mistaken for a late delivery.

The weather column moves almost every row, which is what a change to the physics
should look like. Harvest's total short rises from 45 to 57 of 85 and the twelve
extra failures land in two buckets: `APPROVAL_REJECTED` (7 → 12) and
`INSUFFICIENT_SUPPLY` (18 → 23). Both are the same event described twice — a
promise the field could no longer cover once rain slowed ripening and took grade
off the crop. The baseline's total short does not move at all (75 either way);
weather rearranges *why* it fails (four late missions where before there was
one, five fewer partial deliveries) without changing how often.


Two of Harvest's rows got worse, and neither is an artefact.

- `INSUFFICIENT_SUPPLY` at 23 against the baseline's 5. Harvest delivers on far
  more orders, so partial deliveries the baseline never attempts register here
  instead of as `NO_READY_SUPPLY`. That is the expected shape of the trade
  rather than a defect, but it is the largest bucket left and weather made it
  larger.
- `APPROVAL_REJECTED` at 12, up from 7. The approver re-checks a promise against
  evidence that decayed since the proposal, and weather is now a second way for
  evidence to decay. Whether the gate is calibrated or merely strict is still
  open, and it matters more than it did.
- `NO_READY_SUPPLY` at 17. The orders nobody could commit against at all, which
  is the part a better *harvest* forecast (#7) rather than better coordination
  would address. The weather forecast added here does not touch it: knowing a
  storm is coming does not create ready crop.

## Inter-island trade changed nothing for one island, and very little for two

Issue #40 adds ports, published sailings, a synthetic customs checkpoint,
dual-currency pricing and regional coordination. Two things were measured.

```bash
# One island, the ten paired seeds above
npm run sim -- --paired --seeds 42,8675309,7,19,23,31,101,202,303,404

# Two islands joined by the one published FRS Express des Iles connection
npm run sim -- --scenario caribbean-islands-v1 --islands saint-lucia,martinique \
  --paired --seeds 42,8675309,7,19,23,31,101,202,303,404
```

| File | Contents |
| --- | --- |
| `2026-09-04-after-inter-island.json` / `.txt` | The same ten Saint Lucia paired seeds after issue #40 |
| `2026-09-04-two-island.json` / `.txt` | Saint Lucia + Martinique, ten paired seeds, with the maritime column |

### One island is bit-for-bit unchanged, and that is the design

`2026-09-04-after-inter-island.json` reproduces
`2026-09-03-after-weather.json` **digest for digest and metric for metric across
all twenty runs**. Nothing moved, because nothing could: a one-island scope
keeps Castries but no link, a link needs two in-scope ports on two different
islands, and every maritime code path is gated on the scoped network having at
least one. No new event is scheduled, no new identifier is drawn, and no new
random stream is consumed.

That is worth stating plainly because it is the only reason a coordination
benchmark survives a change this size. The hero scenario is the comparison
everything else in this repository is measured against, and issue #40 was built
so that it did not have to move.

### Two islands: honest numbers, and they are small

Saint Lucia and Martinique are joined by one published connection (FRS Express
des Iles, Fort-de-France to Castries, 1h30 non-stop). The scoped network is
**2 ports and 1 link**. Both arms face the same 117 orders across the ten seeds.

| | Baseline | Harvest |
| --- | --- | --- |
| Mean fulfilment | 4.3% | 5.2% |
| Mean paired gap | — | **+1.0pp** |
| Seeds won / lost / tied | — | 3 / 2 / 5 |

Across the ten Harvest runs the maritime layer produced:

| Measure | Value |
| --- | --- |
| Sailings proposed | 4 |
| Sailings that cleared approval | 2 |
| Delivered | 1 |
| Failed at the checkpoint | 1 |
| Kilograms shipped | 123.8 kg |
| Synthetic freight + clearance | 372.86 XCD |
| Sailings the realised weather lengthened | 2 |
| Customs inspections | 0 |
| Orders that needed a route the dataset does not record | 0 |

**Four sailings over 117 orders is not a transformation, and it is not
presented as one.** Three things hold it down, and none of them was tuned away:

- **The regional scenario is thin.** Each island carries three smallholdings,
  and `NO_READY_SUPPLY` is still the largest cause on both arms (66 of 111
  Harvest misses). Regional coordination cannot move crop that nobody has
  reported as ready, on either island.
- **The approval gate is real and it declines.** `APPROVAL_REJECTED` rises from
  0 to 26 across the ten Harvest runs, because the approver re-checks a promise
  against current evidence and two hours of decay is often enough to fail it.
  Two of the four proposed sailings never bound anybody. That is the boundary
  doing its job, not a defect.
- **Shipping is genuinely risky here.** One of the two approved sailings failed
  outright, and two were lengthened by weather on the crossing. The synthetic
  failure probability is 8% per sailing; on a sample of two, losing one is
  unremarkable and it still cost the run a whole order.

Where Harvest does win it is mostly *not* the boat. Its `SPOILED_BEFORE_PICKUP`
count falls from 28 to 1, which is the readiness-driven collection from issue
#53 doing the work, and its `INSUFFICIENT_SUPPLY` rises from 4 to 15 because it
promises less. Seed 202 is the one seed where a sailing visibly helps: one
53 kg consignment arrives and the fulfilment gap on that seed is +9.1pp.

Seeds 19 and 23 are the honest losses. On 19 Harvest proposed a cross-island
fill, had it declined at the gate, and ended the run behind a baseline that had
promised more and delivered some of it.

### What these numbers are not

Every figure on this page is a seeded simulation output. The ports, the ferry
link and the exchange rates are cited public references; the capacity, the
freight price, the customs behaviour, the failure probability and every outcome
above are synthetic demonstration assumptions. A published ferry route is not
evidence that a produce service exists on it, and nothing here is evidence that
a deployed system would move a single kilogram between two islands.


## Determinism

Reproducibility is an acceptance criterion, so it is checked rather than
assumed: `simulation/tests/determinism.test.ts` compares whole-world digests
across repeat runs of one seed, `simulation/tests/fulfilment.test.ts` also
compares the full list of orders a seed raises across two runs, and every
benchmark file carries a `digest` per run. The same command on the same commit
reproduces the tables above exactly.

The recorded-weather column adds one dependency to that guarantee, and it is a
file rather than a service: `data/saint-lucia-weather-reference.v1.json` is
committed and read from disk, so no run makes a network call and no upstream
revision can move these numbers. Refreshing or extending that dataset *will*
change which recorded year a seed replays, which is why it is versioned and why
`data/README-weather.md` requires a refresh to re-run these seeds and record a
new column rather than editing this one.
