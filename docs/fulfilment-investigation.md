# Fulfilment investigation (#53)

**SYNTHETIC SIMULATION OUTPUT, NOT DEPLOYED IMPACT.**

## Findings and corrections

The original issue recorded seed 42 with 2 fulfilled, 8 unfulfilled and 1 pending
order; seed 8675309 had 0 fulfilled, 1 partial, 8 unfulfilled and 3 pending.
Those are historical observations, not reruns on an identical current world.

The coordination fixes now on main expire stale listings, re-match waiting
orders when eligible supply appears, permit safe partial commitments under the
buyer's declared minimum, and collect reported-ready crops sooner. #91 corrects
the initial overrestriction on growing crops: forecast supply may be promised,
but its earliest date travels through ATP, listing, matching and collection.
The same change replaces censored late-window demand with seven settlement days.
#86 makes allocation reads independent of database row movement and random IDs.

The final remaining consistency defect was reproduced at the Product API seam:
seed 42 reported **4 fulfilled** in engine metrics but **3 fulfilled** in Product
records, even though both counted **885.68 kg** accepted. The engine re-scored
accepted quantities against the standalone buyer's 90% acceptable fraction;
the Product API retained a partial-delivery outcome. The adapter now consumes
the existing final-order events, and deadline/settlement processing retains the
Product status. No quantities are added by the status event. The regression
failed with the old handler and passes with the corrected handler.

No supply, observation interval, order size, weather, seed or policy coefficient
was tuned to manufacture a favourable outcome.

## Current connected hero runs

[Machine-readable connected report](../simulation/benchmarks/2026-09-06-connected-outcomes.json)
contains every order's requested, committed and accepted quantity, final status,
and Product cause/note. Each seed was executed twice through
`POST /v1/simulation-runs`, with deterministic decisions and selected Saint Lucia
scope. Normalized metrics, outcomes, per-order records and digests matched.

| Seed | Orders | Fulfilled | Partial | Unfulfilled | Pending | Accepted kg | Successful actions |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 42 | 11 | 3 | 3 | 5 | 0 | 885.68 | 271 |
| 8675309 | 12 | 1 | 8 | 3 | 0 | 1323.21 | 357 |

Both runs have zero rejected agent actions. At least some local produce reaches
6/11 and 9/12 orders, compared with 2/11 and 1/12 in the issue's original report.
This does not make every partial outcome good: seed 42's sixth order receives
only 1.55 of 315 kg. Five seed-42 orders and three seed-8675309 orders receive
nothing. Their rows remain in the report and the control-room cause panel.

Every order that is not fully fulfilled has a Product `DELIVERY_REJECTED` cause
and an explicit shortfall note. In this adapter, unavailable promised produce
is recorded as rejected at acceptance. That Product category alone does not
prove poor delivered quality. The engine's separate physical cause classification
can distinguish readiness and pickup failures; it is not a second Product status.
Neither cause vocabulary nor a negative outcome was removed to improve scores.

## Paired standalone distribution

[Ten-seed report](../simulation/benchmarks/2026-09-06-forward-settlement.json)
and [benchmark explanation](../simulation/benchmarks/README.md) use the original
fixed seeds: 42, 8675309, 7, 19, 23, 31, 101, 202, 303 and 404. Every policy/seed
was repeated, and all 20 recorded metrics and digests were checked again after
the connected-status correction. Standalone scoring and digests are unchanged.

Harvest has nine wins and one tie, with a median paired gain of 25 percentage
points. Seed 23 remains weak and wastes 90.17 kg more than baseline. Each pair
faces the same demand book and world. Historical before/after reports span
changes to the horizon and weather; they must not be used as a controlled
estimate of the policy's causal effect. Standalone scoring uses the buyer's
minimum acceptable fraction, while connected status is the Product API's
recorded full/partial outcome, so those rates must remain clearly identified.

## Reproduction and regression coverage

Follow [the connected testing guide](simulation_api_local_testing.md) to start
the API and create the two hero seeds twice using new idempotency keys. Compare
final Product snapshots, final replay demand statuses and saved metrics. The
control room uses Product snapshots for connected outcome cards and retains
negative cause counts. Saved runs are immutable and remain auditable.

`npm run test --workspace @harvest/api` exercises this cross-layer equality,
new-supply rematching, expiry, partial supply, forward dates, and three repeated
connected runs each for seeds 42, 51, 99 and 123. Seed 42 explicitly must include
multi-batch partially rejected deliveries. `npm run test --workspace
@harvest/simulation` verifies settlement, readiness collection, hidden-truth
boundaries, deterministic events and retention of all final Product statuses.
Use a separate test database: API pretest reseeds its configured database.
