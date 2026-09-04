# Connected simulation: local testing guide

This guide verifies Issue #30: Harvest-mode simulation participants use the
normal Product API, the control room replays saved API runs, and a completed
participant can be inspected in the normal website read-only.

Read [`simulation_vision.md`](simulation_vision.md) for the intended experience
and [`api_info.md`](api_info.md) for endpoint/effect rules.

## What runs where

| Address | Purpose |
|---|---|
| <http://localhost:3000> | Normal farmer, buyer, transporter and coordinator website |
| <http://localhost:3001> | Fastify Product API |
| <http://localhost:3002> | Separate 3D simulation control room |
| Docker PostgreSQL | Product and saved-run state |

The participant website contains no simulation controls. The control room does
not run the authoritative engine in the browser.

## 1. Start the product and control room

Requirements: Node.js 20+, npm and Docker Desktop.

From the repository root:

```powershell
npm install
npm run dev
```

This starts PostgreSQL, applies migrations, reseeds disposable development
data, and starts ports `3000` and `3001`. In a second PowerShell window:

```powershell
npm run control-room
```

Open <http://localhost:3002>. Keep both terminal processes running. A root
`npm run dev` restart reseeds the database, so saved run IDs from an earlier
session will disappear.

Check the API:

```powershell
Invoke-RestMethod http://localhost:3001/health
```

Expected important fields:

```text
status          : ok
service         : harvest-product-api
contractVersion : 0.8.0
```

## 2. Create an operations session

```powershell
$base = "http://localhost:3001"

$session = Invoke-RestMethod `
  -Method Post `
  -Uri "$base/dev/session" `
  -ContentType "application/json" `
  -Body '{"persona":"operations-demo"}'

$auth = @{
  Authorization = "Bearer $($session.accessToken)"
}
```

## 3. Check the scenario contract

```powershell
$scenarios = Invoke-RestMethod `
  -Uri "$base/v1/simulation-scenarios" `
  -Headers $auth

$scenarios.items | Select-Object scenarioId, durationDays, settlementDays,
  availablePolicies, availableDecisionModes
```

Expected:

- the Saint Lucia benchmark, the whole-Caribbean scenario, and one focused
  `caribbean-<island-id>-v1` scenario for every manifest island;
- 21 simulated ordering days and a 7-day settlement window, so a run covers 28
  days and an order raised on the last ordering day still has its deadline,
  its substitution grace and its settlement inside the run;
- `BASELINE` and `HARVEST` policies;
- `DETERMINISTIC` and `LLM_ASSISTED` decision modes;
- the Saint Lucia benchmark exposes Saint Lucia only; the regional scenario
  exposes all 28 current UN M49 Caribbean country/area entries; each focused
  Caribbean scenario exposes its named island only.

## 4. Create a connected deterministic Harvest run

```powershell
$runHeaders = @{
  Authorization = "Bearer $($session.accessToken)"
  "Idempotency-Key" = "connected-harvest-seed-42-001"
}

$runRequest = @{
  scenarioId = "saint-lucia-demo-v1"
  policy = "HARVEST"
  seed = 42
  decisionMode = "DETERMINISTIC"
  scope = @{
    mode = "SELECTED"
    islandIds = @("saint-lucia")
  }
} | ConvertTo-Json -Depth 6

$run = Invoke-RestMethod `
  -Method Post `
  -Uri "$base/v1/simulation-runs" `
  -Headers $runHeaders `
  -ContentType "application/json" `
  -Body $runRequest

$run | Select-Object runId, status, policy, decisionMode,
  decisionAdapter, frameCount, decisionCount, metrics
```

Expected engine values for seed `42`, re-recorded from a real run after forward
promises and the settlement window. These move whenever the engine or the
Product API changes, so the connected-run test checks determinism, outcome
arithmetic, and the cause vocabulary rather than pinning these counts; this
document is where the counts themselves are kept:

```text
status            COMPLETED
policy            HARVEST
decisionMode      DETERMINISTIC
decisionAdapter   deterministic
frameCount        170
eventsProcessed   108
totalDemandedKg   2956
totalAcceptedKg   982.21
endedAt           2026-09-29T06:00:00Z
```

`metrics.productActions` must also exist with positive attempted, succeeded and
domain-event counts. For the deterministic seed-`42` run, expect:

```text
attempted             214
succeeded             214
rejected                0
domainEventsCreated   334
activeListings          6
openDemands             11
totalOrders             11
activeMissions           0
openExceptions           0
```

The final Product API outcome summary is separate from the physical engine
metrics above. For deterministic seed `42`, expect:

```text
total orders              11
fulfilled                  4
partially fulfilled        2
unfulfilled                5
pending                    0
approved commitments      11
completed missions        11
overdue payments           5
```

`paymentOverdueCount` is `5` in that closing snapshot, and it is not constant
through the run. Synthetic buyers order on 7-day terms and pay on their tenth
simulated day, so every settled order is paid three days late and shows as
overdue in between. Across the saved timeline:

```text
frames with an overdue payment    98 of 170
highest overdue count in a frame    6
delivered orders                   11
paid inside the run window          4
```

The four paid orders were accepted 23.8, 19.6, 19.6 and 13.8 days before the
run ended, far enough ahead for their tenth day to arrive. The other seven were
accepted 13.6 days or less before the end; two of those are still inside their
term at the close and five are overdue and unpaid. Scrub the control room back
into the middle of the run to see the count rise and fall. Harvest tracks these
payments; it moves no money.

`orderOutcomes.causes` explains every unfulfilled or partially fulfilled
order. For seed `42`:

```text
DELIVERY_REJECTED          7
```

All seven shortfalls read as `DELIVERY_REJECTED` from the Product API, which
sees a buyer accepting less than was committed. The engine's own histogram for
the same run says `NOT_READY_IN_TIME` six times and `SPOILED_BEFORE_PICKUP`
once: it knows why the field came up short, and the Product API only knows what
arrived at the gate. Both are true from where they stand, and the difference is
the point of running the two together.

`HORIZON_TRUNCATED` does not appear. The run now continues for a settlement
window after buyers stop ordering, long enough for the latest deadline the
ordering window can produce, so every order raised is followed through to a
real outcome instead of being withheld from the measurement. The
classification stays in the Product API as a guard, so a scenario with a
shorter settlement window still gets such an order named rather than recorded
as an operational failure.

### Where the seed-42 numbers came from

Every figure above is read from a real run, never edited by hand. The five
columns show what each change to the fulfilment path moved:

| Value | Before the #53 fixes | After readiness/expiry/re-match | After safe partial commitment | After the horizon clamp | After payment tracking | After forward promises |
|---|---|---|---|---|---|---|
| `frameCount` | 130 | 119 | 127 | 117 | 119 | 170 |
| `eventsProcessed` | 82 | 76 | 80 | 76 | 76 | 108 |
| `productActions.attempted` | 154 | 140 | 151 | 123 | 125 | 214 |
| `productActions.domainEventsCreated` | 242 | 222 | 238 | 199 | 201 | 334 |
| `activeListings` | 7 | 3 | 3 | 5 | 5 | 6 |
| total orders | 11 | 11 | 11 | 8 | 8 | 11 |
| fulfilled | 2 | 3 | 4 | 3 | 3 | 4 |
| partially fulfilled | 0 | 2 | 2 | 1 | 1 | 2 |
| unfulfilled | 8 | 5 | 5 | 4 | 4 | 5 |
| pending | 1 | 1 | 0 | 0 | 0 | 0 |
| approved commitments | 8 | 5 | 7 | 5 | 5 | 11 |
| completed missions | 8 | 5 | 7 | 5 | 5 | 11 |
| `deliveryAcceptedKg` | 359 | 1387.75 | 1545.13 | 1000.63 | 1000.63 | 982.21 |
| overdue payments at run end | n/a | n/a | n/a | n/a | 0 | 5 |
| frames showing an overdue payment | n/a | n/a | n/a | n/a | 19 | 98 |

The first column is the pre-#53 baseline this document recorded before the
readiness fixes, when unready crop was still listable, so eight commitments
were approved but only 359 kg survived to delivery. The second column is the
readiness, expiry, and re-match fixes. The third adds safe partial commitment:
two more orders reach a commitment they would previously have waited out, and
the horizon-truncated order carries a cause instead of sitting in `pending`.

The fourth column is the horizon clamp, and it is the only one of the five
that changes the world rather than how the world is handled. Three of the eleven
orders are no longer raised at all, because their deadline fell outside the
run window, so every downstream count drops with them: fewer orders means less
demand, fewer commitments, fewer missions, and less delivered weight. Read the
column as a smaller order book, not as a regression. The rate is what survives
the comparison, and it holds: 4 of 11 fully met before, 3 of 8 after, with one
partial on each side. `activeListings` rises because supply that would have
been committed to a withheld order stays on the marketplace instead.

The fifth column adds payment tracking on top of that smaller order book: two
synthetic buyers record paying a delivered order, which is two more product
actions, two more domain events, and two more agent-cycle checkpoint frames.
No physical outcome moves, because recording a payment mutates no world state,
and giving the synthetic buyers 7-day terms changes none of these totals
either: it changes only which payment status those same orders report.

The last column is forward promises and the settlement window together, and it
moves the world twice over. The three orders the clamp withheld are raised
again, so the order book is back to 11; the run is 28 days rather than 21, so
there is more of it to record; and growing crops can now be promised, so every
order that finds supply reaches a commitment — 11 approved commitments and 11
completed missions against 5 and 5. `deliveryAcceptedKg` falls slightly, from
1000.63 to 982.21, on three more orders and twice the missions: the promises
now being made are against crops that are not in the ground yet, and six of
them come up short because the field is not ready when the vehicle arrives.
Read the column as a market that trades far more and keeps slightly less of
what it promises, which is the trade the benchmark records rather than hides.
Overdue payments rise from 0 to 5 for the same reason plus one more: deliveries
land earlier in a longer run, so more 7-day terms expire before the run ends.

`deliveryAcceptedKg` is the sum of the eleven immutable delivery acceptances,
not the engine's `totalAcceptedKg`. The control room uses this Product API
quantity for its Harvest **Delivered** card. For seed `42`, both values are
`982.21 kg` because the engine applies the Product API delivery acceptances back
to physical state as each mission arrives.

The `runId` is a fresh UUID. All evidence is explicitly labelled synthetic and
is not a real-world impact result. Normal Product API permissions and
validation remain authoritative for every simulated action; a rejection would
be retained in the replay rather than hidden.

Run creation is synchronous. The physical engine and Product API are
interleaved: each physical timestamp is advanced, role-safe participants act
through the normal endpoints in stable order, new Product events are projected
once into future physical state, and then the replay checkpoint is saved.

## 5. Inspect the replay and connected actions

```powershell
$runId = $run.runId

$timeline = Invoke-RestMethod `
  -Uri "$base/v1/simulation-runs/$runId/timeline" `
  -Headers $auth

$agentFrames = @($timeline.frames | Where-Object {
  $_.agentActions.Count -gt 0
})

[pscustomobject]@{
  Frames = $timeline.frames.Count
  Farms = $timeline.scene.farms.Count
  Buyers = $timeline.scene.buyers.Count
  Transporters = $timeline.scene.transporters.Count
  Participants = $timeline.scene.participants.Count
  MappedParticipants = @($timeline.scene.participants | Where-Object {
    $null -ne $_.productActorId
  }).Count
  ReferencePlaces = $timeline.scene.referencePlaces.Count
  ReferenceSources = $timeline.scene.referenceDataSources.Count
  ReferencedActors = @(
    $timeline.scene.farms + $timeline.scene.buyers + $timeline.scene.transporters |
      Where-Object { $null -ne $_.referencePlaceId }
  ).Count
  FramesWithAgentActions = $agentFrames.Count
  AgentActions = @($timeline.frames.agentActions).Count
}
```

Expected:

```text
Frames             119
Farms              5
Buyers             3
Transporters       2
Participants       11
MappedParticipants 11
ReferencePlaces    13
ReferenceSources    1
ReferencedActors    4
```

`FramesWithAgentActions` and `AgentActions` must be positive. The eleventh
participant is the run-scoped coordinator. Each action includes role, tool,
success/rejection, concise summary, adapter, event IDs and optional trace/entity
IDs. It must not include prompts, secrets or chain-of-thought.

The reference count is the licensed offline snapshot for the selected Saint
Lucia scope. The linked actors remain generically named synthetic actors;
their `referencePlaceId` provides nearby map context only. Open any reference
marker in the control room and confirm its Inspector includes the feature URL,
retrieval date, licence and the statement that it is not a Harvest participant
or customer. `© OpenStreetMap contributors` must remain visible on the map.

The last frame must have `eventType: RUN_SETTLED`, its `at` value must equal
`scene.endsAt`, and every Harvest frame must carry an `operationsSnapshot`.
Between participant action cycles the latest snapshot is retained unchanged.

Check the final Product API projection:

```powershell
$snapshot = Invoke-RestMethod `
  -Uri "$base/v1/operations/snapshot?simulationRunId=$runId" `
  -Headers $auth

$snapshot
```

Unlike the Issue #29 foundation, this is no longer empty. Expect positive
run-scoped demand/order activity. Its final order outcomes, accepted delivery
quantity, approved commitments and completed missions must match the last
timeline frame and the underlying run-scoped Product API records.

## 6. Confirm that Product API records and events are run-scoped

For a streaming view, use:

```powershell
curl.exe -N `
  -H "Authorization: Bearer $($session.accessToken)" `
  "$base/v1/events/stream?simulationRunId=$runId"
```

Press `Ctrl+C` to stop. Each SSE `id` is an increasing decimal cursor. Event
JSON uses a UUID `eventId` and contains:

- this `simulationRunId`;
- a simulated `simulationTime`;
- synthetic/model provenance as appropriate;
- actor, entity, trace and correlation IDs.

## 7. Open a participant read-only

Pick a mapped participant (buyer shown here):

```powershell
$participant = $timeline.scene.participants |
  Where-Object { $_.role -eq "BUYER" } |
  Select-Object -First 1

$participantHeaders = @{
  Authorization = "Bearer $($session.accessToken)"
  "Idempotency-Key" = "participant-replay-seed-42-001"
}

$participantSession = Invoke-RestMethod `
  -Method Post `
  -Uri "$base/v1/simulation-runs/$runId/participant-sessions" `
  -Headers $participantHeaders `
  -ContentType "application/json" `
  -Body (@{ productActorId = $participant.productActorId } | ConvertTo-Json)

$participantSession.participant
```

Expected: the selected name/role, this run ID, `readOnly: true`, and
`expiresInSeconds: 900` in the surrounding response.

The control-room **Open participant website** button performs this call and
opens port `3000`. Expected website behavior:

- it routes to that role's normal page;
- a purple `Synthetic simulation replay · read-only` banner is visible;
- the completed run's run-scoped data is shown;
- form controls and action buttons are disabled;
- the token is immediately removed from the URL fragment.

The API is the final enforcement. This command must return HTTP `409` with
`SIMULATION_RUN_IMMUTABLE`:

```powershell
$replayAuth = @{
  Authorization = "Bearer $($participantSession.accessToken)"
  "Idempotency-Key" = "blocked-replay-demand-001"
}

try {
  Invoke-RestMethod `
    -Method Post `
    -Uri "$base/v1/buyer-demands" `
    -Headers $replayAuth `
    -ContentType "application/json" `
    -Body '{"cropType":"CARROT","quantity":{"value":1,"unit":"kg"},"neededBy":"2026-09-20T10:00:00Z","deliveryLocation":{"latitude":14,"longitude":-61}}'
} catch {
  $_.ErrorDetails.Message
}
```

## 8. Verify idempotency and deterministic normalization

Repeating the original request with the same key/body returns the same stored
run:

```powershell
$repeat = Invoke-RestMethod `
  -Method Post `
  -Uri "$base/v1/simulation-runs" `
  -Headers $runHeaders `
  -ContentType "application/json" `
  -Body $runRequest

$repeat.runId -eq $run.runId
```

Expected: `True`.

Use a new idempotency key to create another seed-42 run. Run IDs, Product API
UUIDs and processing timestamps differ, but physical digest/metrics and the
normalized role/tool/status action sequence are repeatable. Never compare raw
replay JSON byte-for-byte because run-scoped UUIDs are intentionally new.

### Reproducibility depends on the run's own event order, never on a UUID

Repeat the check with several seeds, not just `42`. Seed `51` used to produce a
different digest and frame count on almost every run (#83) while `42` held.

The cause was ordering, not the engine. A connected participant works through
the approvals, verification tasks and delivery missions the Product API reports
as waiting, and the connected loop sorted each of those queues by the Product
identifier of its record. Every Product identifier is a `randomUUID()`, so the
queue order was drawn fresh in each run. It only mattered when two items were
waiting at once and processing one changed what happened to the other, which is
why some seeds looked stable: with seed `51`, two delivery missions became
available in the same agent cycle and competed for the same vehicles, so the
mission offered first was carried and the other was sometimes left behind.
Whichever supply and missions that produced then changed the physical world,
and with it the digest and the number of frames.

The connected loop now orders every such queue by the position at which the
record first appeared in that run's own domain-event stream, which follows from
the seed rather than from a random draw. When adding a participant behaviour,
order its work the same way (`byArrival` in `app/api/src/simulation-agents.ts`)
and never sort by a `cropBatchId`, `orderId`, `missionId`, `approvalId` or
`taskId`. The same rule applies to any Product API query the connected loop
depends on: give it a total order over stable columns, because a tie broken by
insertion order is not stable between runs either.

`app/api/tests/api.integration.test.ts` runs seeds `42`, `51`, `99` and `123`
three times each and compares the digest, the frame count, the closing outcome
summary, the engine metrics and the normalized action sequence.

## 9. Verify baseline isolation

Create the same request with `policy = "BASELINE"` and a new key. Its scene has
the ten engine participants with `productActorId: null`. Its run-scoped
operations snapshot is empty because baseline actors do not use Harvest's
marketplace or coordination workflows. This is the intended comparison
boundary, not a missing integration.

## 10. Verify fixture and configured LLM modes

With all `AGENT_LLM_*` values blank, create a Harvest run with
`decisionMode = "LLM_ASSISTED"`. Expect `COMPLETED` and
`decisionAdapter = "fixture"`; replay actions also say `fixture`. No network
model call occurs.

To use a real compatible provider, follow
[`agent_workflows.md`](agent_workflows.md), set all four variables in the
repository-root `.env`, restart the API, and run again. Expect
`decisionAdapter = openai-compatible:<model>`. Partial configuration, provider
errors and invalid structured output fail the run safely. Never commit `.env`
or a real key.

## 11. Test the control room

At <http://localhost:3002>:

1. Choose Harvest, seed `42`, and Deterministic.
2. Choose the Saint Lucia scenario in **Scenario**.
3. Select **Run simulation**. A loading overlay is shown until the synchronous
   API run completes.
4. Confirm the globe, metrics and playback controls appear. Harvest should say
   **Harvest product outcomes** and baseline should say
   **Fragmented baseline outcomes**.
5. Play, pause, change speed, rewind, scrub and reset. None should create a new
   run or repeat participant actions.
6. Select a purple feed item and confirm the inspector shows its participant,
   role, tool, status, adapter, time, synthetic approval classification and
   safe trace/entity/event references.
7. Choose an existing run from **Saved run** and confirm it loads immediately.
8. Rewind to a point with at least one simulated hour remaining, then inject a
   road/weather/crop/vehicle event. The panel shows its concrete target and
   time. A new derived run should be saved; the source run remains unchanged.
9. Confirm **Impact versus source run** lists changed final totals or says that
   no measurable final total changed. A no-change result is valid when the
   disruption did not overlap relevant crop or delivery activity.
10. Confirm the transport clock reads **Day x of 28 (orders until day 21)**, so
    the days after the ordering window are visibly part of the run rather than
    looking like days on which nothing happened.
11. Scrub to the final `RUN_SETTLED` frame. The injection button must be
    disabled and read **Rewind to inject an event**, never **Inject on day 29**.
12. Select a mapped Harvest participant and choose **Open participant website**.

The API independently enforces the horizon, and the horizon is the whole run:
21 ordering days plus the 7-day settlement window. For the Saint Lucia
scenario, an injected `offsetMs` of `2419200000` (day 28) must return HTTP `422`
with
`INVALID_DISRUPTION`; the last valid offset is one millisecond earlier.

Physical effects remain deterministic and deliberately do not guarantee a
dramatic score change:

- a matching road closure or vehicle breakdown postpones an overlapping
  mission;
- a storm slows overlapping missions and increases spoilage while active;
- crop damage removes a seeded, capped share of remaining unharvested produce;
- an event that intersects no relevant work remains visible in replay but can
  leave all final totals unchanged.

### Verified seed-8675309 disruption example

The control-room sequence reported on 20 August 2026 was rechecked with the
current code using seed `8675309`:

| Run | Frames | Delivered | Order outcomes | Commitments / missions | Physical waste |
| --- | ---: | ---: | --- | ---: | ---: |
| Clean | 131 | 399.22 kg | 0 fulfilled, 1 partial, 8 unfulfilled, 3 pending | 5 / 5 | 2281.12 kg |
| Road closure at `910800000` ms | 133 | 399.22 kg | unchanged | 5 / 5 | 2281.12 kg |
| Plus storm at `1006963200` ms | 136 | 399.22 kg | unchanged | 5 / 5 | 2342.08 kg |

The road closure did not intersect a mission using that selected road, so its
unchanged totals are correct. The later storm did not overlap a delivery, but
it did accelerate spoilage, increasing physical waste by `60.96 kg`. Neither
event fabricated a Product API exception. In the UI, the first derived run says
that no final total changed; the second lists the physical-waste change against
its immediate source run.

If port `3001` is unavailable, the control room shows a connection error rather
than silently running a local substitute.

## Boundaries

- The regional scenario contains independent synthetic local systems for all
  current UN M49 Caribbean areas. It does not model inter-island orders,
  shipping, ports, customs, or currency conversion.
- No mobile app.
- No benchmark, Model Lab, Data Room or Judge page is added here.
- Simulated approvals are synthetic decisions; real commitments still require
  people.
- Synthetic results are evidence that the software workflow runs, not evidence
  of deployed Caribbean impact.
