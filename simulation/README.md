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

No database and no services: the engine is self-contained and a full run takes
a few milliseconds. A run covers 28 days: buyers raise demand for 21 of them
and the remaining 7 are the settlement window, in which the last orders raised
are delivered, accepted and scored. Each line ends with a `causes=` histogram
naming why every demand that missed its deadline missed it.

Recorded paired-seed comparisons live in
[`benchmarks/`](benchmarks/README.md).

## How it is put together

| Path | Role |
| --- | --- |
| `src/core/random.ts` | Seeded generators, split into independent named streams |
| `src/core/queue.ts` | Binary-heap event queue with a total ordering |
| `src/core/ids.ts` | Deterministic UUID-shaped identifiers |
| `src/core/time.ts` | Simulation time; the only file allowed to touch `Date` |
| `src/world/types.ts` | The hidden-truth / observed-world split |
| `src/world/observable.ts` | Contract projection, leak guard, world digest |
| `src/world/weather.ts` | Realised weather, imperfect forecasts, and what weather does |
| `src/scenario/` | Scenario recipes; `saint-lucia-demo-v1` is the hero |
| `src/policy/` | `baseline` and `harvest` coordination policies |
| `src/engine.ts` | Clock, handlers, validation, metrics |
| `benchmarks/` | Recorded paired-seed runs and the comparison they support |

`SimulationEngine` also exposes `start`, `advanceTo`, `applyProductEffect`,
`checkpoint` and `finish` for connected saved runs. Normal `run()` delegates to
the same stepping implementation, so headless and baseline behaviour do not
fork into a second engine.

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

### Disruption effects

Injected disruptions follow the same physical rules as scenario disruptions.
Road closures and vehicle breakdowns postpone only overlapping, matching
missions; storms add seeded travel delay and increase active spoilage; crop
incidents remove a seeded, capped portion of affected unharvested crops. The
engine records only the safe disruption-to-mission causal link for the Product
API bridge, never hidden severity. An event may correctly leave final totals
unchanged when it does not intersect relevant activity.

## Current benchmark

The #91 report uses 21 demand days plus seven settlement days. Across the ten
unchanged seeds Harvest has nine wins and one tie against baseline, with a
median paired fulfilment gain of 25 percentage points. Seed 23 still has six
unmet orders and more waste than baseline. All runs have zero horizon-truncated
orders. See [the current report](benchmarks/README.md#current-forward-promise-and-settlement-results-91)
for counts and deterministic repeat evidence. These are synthetic standalone
outcomes; connected Product API outcomes are measured separately.

Connected hero outcomes and their remaining failures are documented in the
[fulfilment investigation](../docs/fulfilment-investigation.md). Final Product
snapshots, engine counts and replay demand statuses now agree; the existing
Product final-order events are authoritative for connected status.

## Historical comparison before the settlement window

**On the pre-settlement scenario the Harvest policy outperformed the fragmented
baseline, and it still loses one seed.** Across the same ten paired seeds, mean
fulfilment is 39.2% for Harvest against 12.7% for the baseline: seven wins, two
ties, and one loss. Under the synthetic weather generator that preceded recorded
weather (#90) it was 32.7% against 11.6% on the same record of wins. Before
realised weather existed at all (#37) it was 47.7% against 11.7%, with eight
wins, two ties and no losses. Before the issue #53 fixes it was 11.0% against
8.7%, losing on five seeds and carried on the mean by one.

Two changes to the physics move these numbers, in opposite directions, and
neither was tuned.

Realised weather (#37) cost Harvest roughly a third of its lead and cost the
baseline almost nothing, for a reason worth stating plainly: **Harvest's
advantage is delivered through promises, and weather is a machine for
invalidating promises.** A batch that ripens late, loses grade to rain and rots
faster once ready is a batch Harvest has already committed against; the baseline
was mostly failing those orders anyway.

Recorded weather (#90) then gave part of that back, because **the real record is
milder than the generator was**: 4.7 wet days per run against 10.0, and 0.4 storm
days against 3.8. That is a fact about daily gridded reanalysis over a small
island rather than a claim that Saint Lucian Septembers are calm, and
[`data/README-weather.md`](data/README-weather.md) sets out the limits of the
dataset at length. Two results in that column are awkward and are reported as
measured: the baseline is **not** flat for the first time (seed 19 gains an
order), and baseline physical waste *rises* in the gentler world, because crop
that ripens on schedule spends more days standing ready in a field nobody
collects from.

The full mechanism, the losing seed, and what was *not* done about any of it are
in [`benchmarks/README.md`](benchmarks/README.md). No weather constant was tuned
to recover an earlier number, in either direction.

Realised weather for `saint-lucia-demo-v1` is **recorded**, not generated:
the scenario declares `weatherReference` and replays 1-22 September of a real
year chosen deterministically from the run seed, from the committed offline
snapshot in [`data/README-weather.md`](data/README-weather.md) (Open-Meteo
Historical Weather API, CC BY 4.0). Those days carry
`evidenceType: 'PUBLIC_REFERENCE'`; generated days carry `'SYNTHETIC'`, and the
label is per day rather than per run. Scenarios that do not declare a reference
keep the generator unchanged. Forecasts stay `MODEL_PREDICTED` either way, and
no weather service is contacted at runtime.


The per-seed table, the supporting waste and substitution figures, and the
unmet-demand histogram are in [`benchmarks/README.md`](benchmarks/README.md).
Every number is synthetic simulation output, not deployed impact.

The three coordination defects were:

1. **Just-in-time pickup maximised spoilage.** Missions were scheduled to arrive
   shortly before the delivery deadline while a ready cucumber crop was losing
   six to fourteen percent a day, so Harvest committed early, collected late,
   and wasted slightly *more* than the baseline it was supposed to beat. Once
   every allocated batch has been *reported* ready, collection is now brought
   forward, capped by `MAX_READY_HOLD_MS` in the Harvest policy. The delivery
   deadline remains the upper bound and the readiness figure is the grower's
   report, never the hidden `readyAt`, so this buys coordination and not
   foresight.
2. **Matching ran once and never again.** Planning fired only from the order
   that triggered it, plus a few replans while the policy chased observations.
   A batch reported ready on day nine was invisible to an order placed on day
   eight that nobody could fill at the time, so the order waited out its
   deadline beside supply that existed. A bounded sweep now re-plans waiting
   demand for that crop when new ready supply is reported, oldest deadline
   first, at most three times per demand.
3. **Stale evidence was never rechecked.** Harvest asked a grower to go and look
   only when it had no ready candidate at all. A five-day-old READY report is
   the least trustworthy evidence in the set, and it was exactly what the policy
   was promising against. That trigger now covers stale READY reports too.

The first two are coordination levers rather than physics, so they are declared
per policy in `PolicyCapabilities` and the fragmented baseline does not get
them: nobody there holds the whole picture, so nobody notices a crop was
reported ready this morning or revisits an order that could not be filled. That
is a modelling choice, and it is the one most worth arguing with.

The fourth defect is not a policy lever at all. It was in the measurement, and
the first attempt at it made the measurement worse:

4. **The run raised orders it could never settle, and then stopped raising
   them.** `onBuyerDemand` drew a deadline three to seven days out regardless of
   how much of the twenty-one-day window was left, and `schedule` drops any event
   past the horizon, so an order whose deadline plus the twelve-hour substitution
   grace fell outside the window never received its own `DEMAND_DEADLINE`. It sat
   PENDING until the final sweep and was then scored short, which counted the
   length of the run as a coordination failure. The first fix withheld those
   orders. That took `HORIZON_TRUNCATED` to zero by deleting 29 of 114 normal
   orders from the measurement: a hotel ordering on day 20 for delivery on day 25
   is not an unreasonable order, and a benchmark that refuses to score it is
   answering an easier question than the one asked. The run now has a **7-day
   settlement window** instead. Buyers still order for 21 days; the run continues
   to day 28, which is long enough for the latest deadline the ordering window can
   draw, so every order raised is followed through to a real outcome.
   `HORIZON_TRUNCATED` is still zero on all ten benchmark seeds, asserted in
   `tests/fulfilment.test.ts`, but now by construction rather than by omission.
   The classification stays in the engine as a guard so that a scenario with a
   shorter settlement window cannot have such an order silently recorded as a
   late delivery instead.

There is a fifth, and it is the one that was hiding behind the first three:

5. **Nothing could be promised until it was already picked.** Harvest committed
   only against a batch someone had reported READY, which made every promise
   keepable by making most promises impossible. `docs/product.md` says a buyer
   may request current **or future** produce, and a forecast that may never be
   promised against is decoration. The defect was never promising a growing crop;
   it was promising one **without a date**. The policy now commits against a crop
   still growing when the grower's own late estimate of readiness, plus the hour
   to get a vehicle on the road and the journey to collect and deliver, still
   lands before the buyer needs it — at the same uncertainty-discounted quantity,
   never the optimistic maximum. Collection is dated with it: a mission planned
   against the deadline is brought forward the moment the growers report the load
   ready, and if nobody does the vehicle goes anyway and delivers what is truly
   in the field. That failure has its own name now, `NOT_READY_IN_TIME`, because
   calling it spoilage said the crop was lost when it had simply not arrived.

**Both of those changed the world, and the baseline changed with them.** The
first three defects were policy and scheduling logic and left every baseline
digest bit-for-bit identical, which is what let the earlier comparison be read
as a clean policy delta. Demand generation is not policy, so the settlement
window moves both arms: the order book is 114 again rather than 85, and every
baseline digest is different. The pairing still holds — both policies face the
identical order book from the same seeded streams in the same order — but the
guarantee is "the same world for both arms", not "the same world as before".

Forward promising is not free for Harvest either. It commits far more (84
approved commitments across the ten seeds against 63) and delivers far more, and
its own failure profile changes shape: promises made against crops that are not
in the ground yet fail in new ways, `APPROVAL_REJECTED` rises from 7 to 19 as the
approval gate re-checks more proposals against decayed evidence, and
`MISSION_LATE` rises from 1 to 8 as more vehicles are on the road when a road
closes. `benchmarks/README.md` carries the per-seed numbers and states what each
of those costs.

### Realised weather is the second world change, and the costlier one

Issue #37 gave every island-day a condition, a rainfall, a wind and a
temperature band, and let those act on the crop: wet days slow ripening (capped
at three days per batch), wet and hot-dry days raise spoilage, wet days take
marketable grade off, storms degrade more roads, and a vehicle that departs into
rain arrives later. All of it is physics, so both arms face it and every digest
moved again. The order book did not move: the same 85 orders are raised, because
weather does not touch demand generation.

The forecast is the other half and is deliberately not physics. It is a noised,
lossy model of the realised series whose error grows with the square root of
lead time; it misses storms and predicts storms that never arrive, and
`tests/weather.test.ts` asserts both. It reaches the Harvest policy through
`PolicyContext.weather`, which refuses realised weather for a day that has not
occurred. Harvest uses it to bring a pickup forward when a storm falls inside
the ready-hold window, and uses *realised* rain to decide that a report written
before a soaking is no longer evidence. The baseline is given neither, declared
as `readsForecast: false` in `PolicyCapabilities` rather than hidden in a
policy-name check, and the tests assert no baseline decision ever cites a
forecast.

What is still unresolved, from the cause histogram:

- **`INSUFFICIENT_SUPPLY` is Harvest's largest bucket**, at 23 against the
  baseline's 5, up from 18 before weather. That is the expected shape of the
  trade — orders Harvest previously never attempted now land as partial
  deliveries — but it is the biggest remaining category and it has not been
  attacked.
- **`APPROVAL_REJECTED` at 12, up from 7.** The approval gate re-checks a
  promise against evidence that decayed after the proposal, and weather is now a
  second way for evidence to decay. Whether that gate is calibrated or merely
  strict matters more than it did.
- **`NO_READY_SUPPLY` at 17.** Orders nothing could be promised against at all.
  This is the part a better *yield* forecast (#7), not better coordination and
  not a weather forecast, would move. Knowing a storm is coming does not create
  ready crop.


Issue #4 owns the machinery that makes an honest comparison possible —
identical worlds, isolated policy hooks, reproducible seeds. Issue #11 owns the
comparison itself. Adjusting scenario constants until the favoured policy wins
would fabricate the very result those issues exist to measure. No scenario
constant has been touched: supply sizes, order sizes, readiness windows, base
spoilage rates and observation intervals are all unchanged, and the deadline
draw is still three to seven days. The two world changes are which orders get
raised at all, and what the weather does to the crop; both are stated here
together with what they cost each arm. The weather coefficients were set once
from plausibility and were not revisited after the benchmark was read.


## Control-room outcome boundary

The engine remains authoritative for the simulated physical world: crop
observations, weather, roads, spoilage, disruptions and the isolated baseline
policy. After outstanding physical demand is settled, it records a final
`RUN_SETTLED` frame at the exact scenario horizon, which is the end of the
settlement window rather than the end of the ordering window.

For a connected Harvest run, operational headline figures do not come from
the engine's older policy counters. The internal Harvest coordination policy is
disabled. Simulated participants call the normal Product API, and approved
allocations and mission acceptance schedule future engine commitments, pickup
and arrival. The engine decides what is physically ready and loaded; that
quantity is returned through transporter progress and buyer acceptance. The
Product API's run-scoped orders, allocations, missions and delivery acceptances
determine the Harvest outcome cards. This proves the real product workflow ran
without pretending the current policy already beats the baseline.

## Evidence status

Every number this package produces is **synthetic**. Licensed OpenStreetMap
place names and coordinates provide offline Caribbean context; no actor, yield,
price, demand, road speed or spoilage figure is a measurement. Synthetic actors
can carry a `referencePlaceId` without adopting the real place's identity.
Each `RunResult` carries an `evidenceLabel` and a
`provenanceNote`, so the label travels with the data rather than living only in
a document. Results are simulated counterfactual evidence and must never be
presented as measured impact from a deployed system.

## Caribbean reference places

The versioned catalogue in
`src/scenario/caribbean-reference-places-v1.data.ts` contains 8 to 20 licensed
public reference features for each of the 28 manifest areas. The engine filters
it to the selected island scope, anchors compatible generic synthetic actors
where possible, and preserves the existing synthetic fallback when a category
is absent. The replay scene includes both the selected references and their
source registry so clients can show attribution and the non-participant
disclaimer.

There is no runtime geography lookup. Maintainers can run
`npm --workspace @harvest/simulation run refresh:reference-places` from the
repository root to rebuild the snapshot, then review the generated diff. See
[`docs/caribbean-scenario-data.md`](../docs/caribbean-scenario-data.md) for the
source, licence, safe-field rules and limitations.

## Scoped inter-island trade (#40)

`src/world/maritime.ts` loads the reviewed offline network in
`data/caribbean-maritime-network.v1.json` (34 ports, 13 published links, 13
currencies, every record carrying its own source, licence and retrieval date;
see [`data/README-maritime.md`](data/README-maritime.md)) and restricts it to
the islands a run selected.

**Scope is applied once, when the world is built.** A link survives only when
*both* of its ports are on in-scope islands, so:

- one island keeps its port and has **no links**, and therefore no shipment;
- two islands can only use a connection between those two, and cannot see a
  third island's port at all;
- two published links that meet at a shared island are **not** chained into a
  through-service, because no source publishes one;
- where the dataset records no connection, none is invented. The run records
  `NO_PUBLIC_ROUTE` against the order instead, which is a different failure from
  `NO_READY_SUPPLY` (there was crop) and from `INSUFFICIENT_SUPPLY` (the promise
  was not too small — there was no boat).

Every maritime code path is gated on the scoped network having at least one
link, which is why a one-island run reproduces its pre-#40 digests exactly.

### What is public reference and what is synthetic

| Public reference (cited, licensed) | Synthetic (invented here) |
| --- | --- |
| Port identity and coordinates | Capacity per sailing (`SAILING_CAPACITY_KG`) |
| That a scheduled service exists between two ports | That *produce* moves on it at all |
| A journey time the operator published | A journey time where none was published, labelled `SYNTHETIC_DEFAULT` |
| Exchange rates and their `asOf` date | Freight price, clearance fee, every amount converted |
| — | Customs documentation, inspection, delay and cost |
| — | Sailing failure probability, weather delay, and every outcome |

Both labels travel on every structure that leaves this package
(`networkProvenance` and `operationsProvenance`), because one label for a
shipment would let a reader take the synthetic half for cited evidence.

### The shipment

A cross-island commitment produces a `MARITIME` delivery mission with three
legs: a local pickup run to the origin port, the published sea leg, and a local
delivery run from the destination port to the buyer. Statuses are `SCHEDULED`,
`DEPARTED`, `DELAYED`, `ARRIVED`, `DELIVERED` and `FAILED`.

- **Capacity** binds at planning time; a consignment is never promised past the
  synthetic per-sailing allowance.
- **Weather** acts on the sea leg at sailing, reusing #37's storm effect, and
  only then — at planning time that day has not happened.
- **Customs** is a synthetic documentation check at the destination port with a
  seeded inspection delay and a fixed cost line. **It is not a legal customs
  model** and carries a disclaimer saying so on every instance.
- **Failure** is a seeded per-sailing draw, held as hidden truth in the same
  sense a scheduled disruption is. A failed consignment is scored
  `SHIPMENT_FAILED`, not as spoilage: nothing rotted, a boat lost it.
- **Currency**: every cross-island price is stated in the destination island's
  currency and in XCD, with the fixed offline rate that connects them. No live
  financial API is called, during a run or a replay.

### Regional coordination

Only the Harvest policy coordinates across islands
(`PolicyCapabilities.coordinatesAcrossIslands`); the baseline declares it does
not, which is what keeps the paired benchmark fair. When the buyer's own island
comes up short, the policy ranks each reachable in-scope island on a documented
deterministic score — coverage including capacity, evidence freshness, transit
time against the time remaining, synthetic cost per kilogram, and risk — and
proposes at most one source island and one sailing. No random stream is touched.

The proposal then takes the **`INTER_ISLAND_COMMITMENT` approval gate**, which
`AGENTS.md` requires. In the engine's own policy mode that is
`approveCommitment`; in a connected run it is real Product API approvals from
the buyer and every far-island grower whose crop it commits. Until the last
approval lands there is no shipment object at all, so the gate cannot be
bypassed by forgetting to read a flag.

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
Harvest-mode simulated actors, saved-run/control-room operations, SSE
replay rules, and deterministic effects. Fastify imports this package directly;
there is no separate simulation HTTP service or port. Event consumers
deduplicate UUID event IDs, apply monotonic cursors, suppress physical-action
echoes, schedule only future effects, and never expose or rewrite hidden truth.
Product UUIDs stay outside deterministic physical world identity; commitments
and missions use the seeded engine ID stream.

For a complete localhost Product API walkthrough, including the exact expected
seed-42 replay and paired-run values, use
[`docs/simulation_api_local_testing.md`](../docs/simulation_api_local_testing.md).
