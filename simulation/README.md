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
twenty-one-day run takes a few milliseconds. Each line ends with a `causes=`
histogram naming why every demand that missed its deadline missed it.

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

## Honest status of the baseline-versus-Harvest comparison

**On the current scenario the Harvest policy now outperforms the fragmented
baseline, after issue #53 fixed three coordination defects.** Across the same
ten paired seeds, mean fulfilment is 43.0% for Harvest against 8.7% for the
baseline, and Harvest leads on every one of the ten. Before those fixes it was
11.0% against 8.7%, losing on five seeds and carried on the mean by one.

The per-seed table, the supporting waste and substitution figures, and the
unmet-demand histogram are in [`benchmarks/README.md`](benchmarks/README.md).
Every number is synthetic simulation output, not deployed impact.

Nothing in the scenario changed to produce that. Supply sizes, order sizes,
deadlines, readiness windows, spoilage rates and observation intervals are
untouched, and the baseline world digests are identical before and after, which
is what makes the comparison worth reading at all. The three defects were:

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

What is still unresolved, from the cause histogram:

- **A fifth of Harvest's remaining misses are `HORIZON_TRUNCATED`.** The buyer's
  window closes after the run's twenty-one days, so the order is scored as a
  failure for arriving late in the scenario rather than for anything a
  coordinator did. It is classified rather than clamped; changing demand
  generation would change what the benchmark measures.
- **`APPROVAL_REJECTED` appeared.** The approval gate re-checks a promise
  against evidence that decayed after the proposal, and now has more
  commitments to decline. Whether that gate is calibrated or merely strict is
  open.
- **`INSUFFICIENT_SUPPLY` rose**, which is the expected shape of the trade:
  orders Harvest previously never attempted now land as partial deliveries.

Issue #4 owns the machinery that makes an honest comparison possible —
identical worlds, isolated policy hooks, reproducible seeds. Issue #11 owns the
comparison itself. Adjusting scenario constants until the favoured policy wins
would fabricate the very result those issues exist to measure, and the check
against it is that the baseline arm is bit-for-bit unchanged.

## Control-room outcome boundary

The engine remains authoritative for the simulated physical world: crop
observations, weather, roads, spoilage, disruptions and the isolated baseline
policy. After outstanding physical demand is settled, it records a final
`RUN_SETTLED` frame at the exact scenario horizon.

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
