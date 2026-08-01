# Product API, events, and shared contracts

This is the implementation guide for connecting Harvest's Product API,
website, mobile app, simulation, control room, and yield model. Wire validation
is authoritative in [`contracts/`](../contracts/); this guide explains who uses
each operation and what it must cause.

Do not add an endpoint, event, state transition, or simulation effect only in
code. Change the machine contract and this guide together first.

## Canonical architecture

```text
Website / Mobile / Harvest-mode simulated actor
                    |
                    | REST command/query
                    v
          Product API + agent runtime
                    |
          PostgreSQL transaction
          + append-only event/outbox
                    |
          +---------+---------+
          |                   |
          v                   v
      SSE clients       Simulation engine
 Website / Mobile /     deterministic event handler
 3D Control Room               |
                               v
                    Future actor schedules, routes,
                    observable world and metrics
```

- The Product API is a standalone TypeScript/Node Fastify service.
- Simulation and model are separate Python FastAPI services.
- The Next.js website uses a generated TypeScript Product API client.
- The Expo React Native app uses the same generated TypeScript client.
- PostgreSQL/Supabase is accessed only by the Product API.
- Agents run in the Product API runtime for the hackathon MVP.
- Commands and queries use REST JSON under `/v1`; live updates use SSE.
- Machine contracts use OpenAPI 3.1 and JSON Schema 2020-12.

## State ownership

| Owner | Canonical state | Must not own or expose |
|---|---|---|
| Product API | Farms and permissions; observations; crop batches; validated predictions; listings; demand; orders; allocations; reservations; approvals; deliveries; exceptions; traces; event log | Simulation hidden truth or model artefacts |
| Simulation | Clock; seed; scenario; hidden crop truth; disruptions; actor schedules; baseline and Harvest policies; paired initial state | Product operational records or human credentials |
| Model | Features; inference; model versions; evaluation; model artefacts | Inventory, reservations, ATP, orders, or delivery state |
| Website/mobile | Local presentation, cache, optimistic UI, and navigation state | Authoritative operational or simulation state |

Hidden crop yield, future disruptions, future actor decisions, and other
scenario truth must never appear in Product API responses, public events,
traces, or the observable world snapshot. They become visible only when a
scenario event makes them observable.

## Users, services, and authentication

- People use a Supabase-compatible bearer JWT. Middleware derives `actorId`
  and one of `FARMER`, `BUYER`, `TRANSPORTER`, `COORDINATOR`, `OPERATIONS`, or
  `ADMIN`; a request body cannot override that identity.
- The simulation and model use rotated internal service bearer tokens.
- A Harvest-mode simulated user is given a synthetic `actorId`, human role,
  and `simulationRunId` by authentication middleware. It then sends exactly the
  same public request body as the corresponding real user.
- A baseline-mode actor never calls Harvest coordination operations. Baseline
  policy acts inside the simulation and publishes only allow-listed observable
  run events for visualisation and comparison.
- Internal ingestion under `/internal/v1` is never exposed to website/mobile
  clients.

For example, a real farmer and a Harvest-mode simulated farmer submit the same
crop-observation JSON:

```json
{
  "cropBatchId": "11111111-1111-4111-8111-111111111111",
  "observedAt": "2026-08-01T09:30:00Z",
  "cropStage": "FRUITING",
  "notes": "Fruit size is increasing after rain.",
  "estimatedQuantity": { "value": 520, "unit": "kg" },
  "provenance": "OBSERVED"
}
```

For a simulated actor, middleware supplies the synthetic identity and run
context and the API records the effective provenance as `SYNTHETIC` where
appropriate. No hidden-truth field is added to the body.

## Shared conventions

- JSON fields use `camelCase`.
- Resource and event IDs are UUIDs.
- Real timestamps are ISO-8601 UTC. `simulationTime` is optional outside a run
  and uses the same wire format.
- Every `POST` requires `Idempotency-Key` (8-128 safe ASCII characters).
  Replaying the same actor/method/path/key/body returns the original result;
  reusing the key with a different body returns `409`.
- Domain events carry trace, correlation, causation, actor, entity, and run
  identifiers. A top-level command starts a correlation; derived actions keep
  its `correlationId` and name their triggering event as `causationId`.
- Lists use opaque `cursor` and bounded `limit`; responses contain `pageInfo`.
- Errors use `application/problem+json` and RFC 7807 fields. Expected classes
  are `400` malformed/validation, `401` unauthenticated, `403` role/scope,
  `404` not found, `409` lifecycle/idempotency conflict, and `422` invariant
  violation.
- Quantities are `{ "value": number, "unit": "kg" }`. Kilograms are the only
  initial unit; never pass a bare number.
- Money is `{ "amount": number, "currency": "XCD" }` (or another ISO 4217
  code when explicitly supported).
- Provenance is exactly `OBSERVED`, `INFERRED`, `SYNTHETIC`,
  `STAKEHOLDER_CALIBRATED`, or `MODEL_PREDICTED`.
- Unknown fields are rejected on commands and protected projections. This is
  intentional protection against identity or hidden-state injection.

## Product API catalogue

The public machine contract is [`contracts/openapi.yaml`](../contracts/openapi.yaml).
Roles below include a simulated actor authenticated with that same human role.
`COORDINATOR`, `OPERATIONS`, and `ADMIN` access remains subject to farm/run
scope, not only the role name.

### Crop intelligence

#### `POST /v1/crop-observations`

- Callers: farmer for an owned batch; coordinator for an authorised farm.
- Request: `cropBatchId`, `observedAt`, `cropStage`, `provenance`; optional
  `notes` and `estimatedQuantity`. Identity/run context comes from auth.
- Response: stored observation IDs/times, submitted safe fields, `traceId`.
- Product state/event: append the observation and provenance, update the
  batch's latest observation, start the forecast workflow, and atomically emit
  `CROP_OBSERVATION_SUBMITTED`.
- Simulation effect: complete that actor's observation task and schedule any
  later workflow reaction. Never change hidden crop truth.
- Consumers: farmer crop view, operations feed, crop map, Model Lab timeline.
- Rules/failures: reject inaccessible batches, future/out-of-window times,
  invalid units/provenance, actor fields, run fields, and unknown/hidden fields.

#### `GET /v1/crop-batches/{cropBatchId}`

- Callers: owning farmer, related buyer after disclosure, authorised
  coordinator/operations/admin.
- Request: UUID path parameter; no body.
- Response: observable batch identity/type/status, latest observation and
  prediction IDs, deterministic `availableToPromise`, and provenance.
- Product state/event: none.
- Simulation effect: none; reading cannot advance time or reveal truth.
- Consumers: farmer crop view, order/allocation detail, crop map.
- Rules/failures: return `403` for unauthorised scope and `404` only when
  absence may safely be disclosed.

#### `POST /v1/crop-batches/{cropBatchId}/forecast-requests`

- Callers: owning farmer, coordinator, operations, or scheduled Product API
  workflow.
- Request: `reason` = `NEW_OBSERVATION`, `MANUAL_REFRESH`, or
  `SCHEDULED_REFRESH`.
- Response: forecast request ID, batch ID, queue status, request time.
- Product state/event: store an idempotent job and invoke the internal model.
  When its result validates, store a prediction snapshot, calculate ATP, and
  emit `FORECAST_PRODUCED`.
- Simulation effect: the request itself changes no world state; the produced
  forecast is retained for predicted-versus-actual evaluation.
- Consumers: farmer forecast, crop map, Model Lab, operations feed.
- Rules/failures: concurrent equivalent jobs return their existing receipt;
  reject missing evidence, inaccessible batches, and invalid job transitions.

### Marketplace and orders

#### `GET /v1/listings`

- Callers: buyer, farmer, coordinator, operations, admin.
- Request: optional `cropType`, opaque `cursor`, and `limit`.
- Response: role-filtered listing page with quantities, price, availability,
  status, farmer/listing/batch IDs, and `pageInfo`.
- Product state/event: none.
- Simulation effect: none. Harvest buyer actors discover returned listings
  only during their scheduled browse action.
- Consumers: buyer marketplace, operations supply view.
- Rules/failures: inactive/private supply is filtered; invalid cursors or
  limits return `400`.

#### `POST /v1/listings`

- Callers: farmer for an owned batch; coordinator with explicit authority.
- Request: `cropBatchId`, `quantity`, `unitPrice`, `availableFrom`,
  `availableUntil`.
- Response: listing ID plus owner/crop/status/created time and submitted fields.
- Product state/event: verify quantity is within current ATP, store active
  listing, and emit `LISTING_PUBLISHED`.
- Simulation effect: make supply discoverable to eligible buyer actors at later
  scheduled actions; do not change biological yield.
- Consumers: farmer inventory/listing view, marketplace, operations supply.
- Rules/failures: return `422` when quantity exceeds ATP or dates/prices are
  invalid; `409` when a concurrent reservation makes supply unsafe.

#### `POST /v1/buyer-demands`

- Callers: buyer; coordinator acting with authorised buyer scope.
- Request: `cropType`, `quantity`, `neededBy`, `deliveryLocation`; optional
  `maxUnitPrice`.
- Response: demand ID, buyer ID, fields, `OPEN` status, creation time.
- Product state/event: store demand, start matching, and emit
  `BUYER_DEMAND_CREATED`.
- Simulation effect: mark demand pending and schedule reactions from eligible
  Harvest actors.
- Consumers: buyer demand view, operations demand queue.
- Rules/failures: deadline must be future/current simulation time; location is
  disclosed only to authorised workflow participants.

#### `POST /v1/orders`

- Callers: buyer; coordinator with authorised buyer scope.
- Request: `cropType`, `requestedQuantity`, `neededBy`, `deliveryLocation`;
  optional candidate `listingIds`.
- Response: order ID, buyer ID, requested/accepted quantities, lifecycle status,
  risk overlay, timestamps.
- Product state/event: store `REQUESTED`, start matching, and emit
  `ORDER_REQUESTED`. Creation does not reserve stock.
- Simulation effect: mark buyer demand pending and schedule matching/actor
  reactions.
- Consumers: buyer order timeline, operations demand/orders.
- Rules/failures: duplicate business intent with the same key returns the same
  order; inaccessible listings, invalid quantity/date, or identity fields fail.

#### `GET /v1/orders/{orderId}`

- Callers: participating buyer/farm/transporter when relevant; authorised
  coordinator/operations/admin.
- Request: order UUID.
- Response: quantities, deadline, lifecycle status, `atRisk`, active exception
  IDs, and timestamps.
- Product state/event: none.
- Simulation effect: none.
- Consumers: buyer/farmer order status, transporter context, operations detail.
- Rules/failures: role-filter sensitive farm, buyer, route, and location data.

### Approvals and delivery

#### `POST /v1/approvals/{approvalId}/decisions`

- Callers: the named human approver for the pending subject; admin only through
  an explicitly audited override.
- Request: `decision` (`APPROVE`/`REJECT`) and optional `reason`.
- Response: approval subject, final status, decider, and time.
- Product state/event: record one final decision. Allocation approval creates
  reservations and commitment in the same transaction and emits
  `ALLOCATION_APPROVED`; recovery approval applies its validated operational
  changes and emits `RECOVERY_APPROVED`.
- Simulation effect: allocation approval schedules harvest/pickup obligations
  and reduces planned uncommitted supply; recovery approval deterministically
  reroutes/reschedules/substitutes/reallocates/cancels future work.
- Consumers: approval cards, order timeline, notifications, control-room route.
- Rules/failures: a decided approval is immutable; stale subject state returns
  `409`; required commitment/substitution/cancellation/location/quality/inter-
  island decisions cannot be bypassed.

#### `GET /v1/delivery-missions`

- Callers: transporter (available/owned jobs), coordinator/operations/admin.
- Request: optional status, cursor, limit.
- Response: visible mission page with route stops, quantity, deadline,
  assignment/status, and `pageInfo`.
- Product state/event: none.
- Simulation effect: none until a simulated transporter takes its scheduled
  browse/accept action.
- Consumers: transporter job list, operations delivery queue.
- Rules/failures: private pickup/drop-off coordinates are role/scope-filtered.

#### `GET /v1/delivery-missions/{missionId}`

- Callers: assigned/eligible transporter and authorised operations roles.
- Request: mission UUID.
- Response: mission/order IDs, status, assignment, vehicle, quantity, deadline,
  and ordered stops.
- Product state/event: none.
- Simulation effect: none.
- Consumers: transporter job detail, tracking view, control room.
- Rules/failures: return no private route to unrelated actors.

#### `POST /v1/delivery-missions/{missionId}/acceptance`

- Callers: an eligible transporter.
- Request: `decision: ACCEPT` and `vehicleId`.
- Response: mission changed to `ASSIGNED` with transporter/vehicle.
- Product state/event: atomically claim an available mission and emit
  `DELIVERY_MISSION_ACCEPTED`.
- Simulation effect: make that transporter/vehicle unavailable for conflicting
  work and schedule pickup tasks.
- Consumers: transporter active job, blue active control-room route, tracking.
- Rules/failures: competing acceptances produce one winner; later attempts
  return `409`; reject unavailable/unauthorised vehicles.

#### `POST /v1/delivery-missions/{missionId}/updates`

- Callers: assigned transporter; authorised coordinator for a verified update.
- Request: `updateType`, `recordedAt`; optional `position`, `quantity`, `note`.
- Response: update and mission IDs plus submitted safe fields.
- Product state/event: append progress, advance allowed mission/order state,
  and emit `DELIVERY_UPDATE_POSTED`.
- Simulation effect: advance observable vehicle position and future actor/task
  schedules. It cannot rewrite past positions.
- Consumers: live map, order timeline, ETA/tracking, operations feed.
- Rules/failures: update type must be valid for current mission state; time must
  be monotonic; position is required for `POSITION`.

#### `POST /v1/exceptions`

- Callers: farmer, buyer, assigned transporter, coordinator, operations; only
  for an entity visible to the caller.
- Request: type, severity, affected entity IDs, description, provenance.
- Response: exception ID, status, report time, and submitted safe fields.
- Product state/event: store exception, set `atRisk` overlay on affected active
  orders, start recovery analysis, emit `EXCEPTION_REPORTED`.
- Simulation effect: apply/expose the corresponding observable disruption and
  pause affected future schedules where appropriate. Hidden cause/outcome stays
  internal until observable.
- Consumers: red exception state, recovery/approval UI, notifications.
- Rules/failures: reject unknown/inaccessible entities, hidden-state fields, and
  an unsupported provenance.

#### `POST /v1/deliveries/{deliveryId}/acceptance`

- Callers: receiving buyer or explicitly authorised receiving coordinator.
- Request: outcome, accepted quantity, rejected quantity, optional note.
- Response: delivery/order IDs, outcome/quantities, accepter and time.
- Product state/event: record immutable actual outcome and emit
  `DELIVERY_ACCEPTED`; then atomically derive one of `ORDER_FULFILLED`,
  `ORDER_PARTIALLY_FULFILLED`, or `ORDER_REJECTED` and release unused
  reservations.
- Simulation effect: record actual farmer/transporter economics and model
  evaluation data. Fulfilment satisfies demand and ends remaining order tasks;
  partial/rejected outcomes schedule unmet-demand/import/substitution fallback.
- Consumers: buyer receipt, farmer outcome/revenue, trust, benchmark, Model Lab.
- Rules/failures: quantities must use one unit, be non-negative, sum to the
  delivered amount, and match outcome; produce rejection requires approval.

### Operational and live views

#### `GET /v1/operations/snapshot`

- Callers: coordinator, operations, admin; run-scoped control room.
- Request: optional `simulationRunId`.
- Response: generation time and role-filtered counts/IDs for supply, demand,
  order states, active missions, and open exceptions.
- Product state/event: none.
- Simulation effect: none.
- Consumers: operations dashboard and initial control-room projection.
- Rules/failures: snapshot and later SSE stream must use the same run/scope.

#### `GET /v1/agent-traces/{traceId}`

- Callers: actors affected by the trace and authorised operations roles.
- Request: trace UUID.
- Response: safe summary, subject, status, evidence/tool/decision/approval/state
  steps, and confidence where relevant.
- Product state/event: none.
- Simulation effect: none.
- Consumers: trace viewer and Judge Mode.
- Rules/failures: never return private chain-of-thought, secrets, hidden truth,
  or evidence the caller cannot access.

#### `GET /v1/events/stream`

- Callers: authenticated website/mobile clients; run-scoped simulation and 3D
  control room.
- Request: optional `simulationRunId`; optional `Last-Event-ID` header.
- Response: `text/event-stream` frames where `id` is `eventId`, `event` is
  `eventType`, and `data` is the validated event envelope.
- Product state/event: read-only replay then live tail of the append-only log.
- Simulation effect: Harvest simulation handlers deterministically schedule
  documented future effects.
- Consumers: operations, mobile notifications/state cache, 3D control room,
  trace viewer, benchmark UI, Harvest simulation policy.
- Rules/failures: stream is role/run-filtered. An expired/invalid cursor returns
  `409`; client refreshes snapshot, stores the new boundary, and reconnects.

### Simulation gateway

The Product API exposes these operations to the control room. It validates and
authorises them, calls the internal [simulation API](../contracts/simulation/openapi.yaml),
and returns observable projections. It never copies hidden truth into its DB.

#### `POST /v1/simulation-runs`

- Callers: operations/admin/control-room operator.
- Request: `scenarioId`, `policy` (`BASELINE`/`HARVEST`), integer `seed`, speed.
- Response: run ID, inputs, `READY`, observable clock, creation time.
- Product state/event: store run metadata/reference; ask simulation to create
  deterministic state.
- Simulation effect: initialise clock, actors, schedule and hidden truth from
  scenario/seed; do not advance time.
- Consumers: 3D control room and benchmark setup.
- Rules/failures: seed/scenario/policy are immutable after creation.

#### `GET /v1/simulation-runs/{runId}`

- Callers: operations/admin/control room and benchmark viewer.
- Request: run UUID.
- Response: policy, seed, speed, status, observable time, creation time.
- Product state/event: none.
- Simulation effect: none.
- Consumers: run controls/status and benchmark progress.
- Rules/failures: response cannot include future queue or hidden scenario state.

#### `POST /v1/simulation-runs/{runId}/commands`

- Callers: authorised control-room operator.
- Request: one typed command: `START`, `PAUSE`, `RESUME`, `RESET`; `SPEED` with
  speed; `REWIND` with target time; or `INJECT` with allow-listed disruption,
  schedule, affected IDs, and public description.
- Response: command/run IDs, type, `ACCEPTED`, and accepted time.
- Product state/event: store auditable command receipt and proxy it.
- Simulation effect: deterministic state-machine action. Rewind reconstructs
  from seed/checkpoint/event history. Injection schedules a future effect and
  never edits past truth.
- Consumers: 3D controls, timeline, scenario controls.
- Rules/failures: invalid command/state is `409`; illegal time/speed/injection
  is `422`; same idempotency key never applies twice.

#### `GET /v1/simulation-runs/{runId}/world`

- Callers: control room, operations/admin.
- Request: run UUID.
- Response: observable time, actors/roles/positions/activities, active routes,
  and disruptions already observed.
- Product state/event: none; gateway retrieves the allow-listed projection.
- Simulation effect: none.
- Consumers: 3D map/control room.
- Rules/failures: schema rejects hidden yields, quality, readiness, future
  disruptions, actor plans, and future event queues.

#### `POST /v1/paired-runs`

- Callers: operations/admin/benchmark operator.
- Request: `scenarioId` and seed.
- Response: pair ID, baseline and Harvest run IDs, seed, `READY`.
- Product state/event: store pair reference and ask simulation to create both.
- Simulation effect: clone identical initial scenario/random streams, changing
  only baseline versus Harvest policy.
- Consumers: benchmark setup/progress.
- Rules/failures: reject unavailable scenario or inconsistent pair creation;
  the two policies cannot have different initial inputs.

#### `GET /v1/paired-runs/{pairId}`

- Callers: benchmark viewer, operations/admin.
- Request: pair UUID.
- Response: pair/run IDs, seed, status, and baseline/Harvest aggregate result
  after completion.
- Product state/event: none.
- Simulation effect: none.
- Consumers: benchmark website, Judge Mode, pitch dashboard.
- Rules/failures: no result is fabricated while incomplete; metrics are labelled
  simulated and trace back to run IDs.

### Internal ingestion

#### `POST /internal/v1/simulation-events`

- Caller: simulation service token only.
- Request/response: one complete `EventEnvelope`; receipt is `ACCEPTED` or
  `DUPLICATE` for its `eventId`.
- Product state/event: validate allow-listed observable payload and run; append
  once to the event log/projection. This does not permit arbitrary operational
  mutation.
- Simulation effect: none (it originated there); correlation prevents echo.
- Consumers: observable world/control-room projections and run timeline.
- Rules/failures: reject hidden fields, real-world/no-run context, unknown
  schema versions, events from a different run token, and mismatched payload.

#### `POST /internal/v1/benchmark-results`

- Caller: simulation service token only after both paired runs complete.
- Request: pair and run IDs, baseline/Harvest aggregate metrics, calculation
  time. Response: ingestion receipt.
- Product state/event: validate pair identity, store one aggregate result, emit
  `BENCHMARK_RESULT_RECORDED`.
- Simulation effect: none.
- Consumers: benchmark website and Judge Mode.
- Rules/failures: reject unpaired IDs, incomplete runs, invalid rates/units, or
  conflicting replays.

## Interface-to-operation map

| Interface | Reads | Writes/actions | Live events |
|---|---|---|---|
| Farmer mobile | Crop batch, order status, relevant trace | Crop observation, forecast request, listing, approval decision | Crop/forecast/listing/allocation/order/delivery outcomes |
| Buyer mobile/website | Listings, order, delivery tracking | Buyer demand, order, relevant approval, delivery acceptance | Demand/allocation/mission/delivery/order outcomes |
| Transporter mobile | Mission list/detail, relevant order | Mission acceptance, delivery updates, exception | Mission/update/exception/recovery/order outcome |
| Coordinator mobile | Crop/order/mission context, snapshot, trace | Authorised observation/demand, approvals, verified update, exception | All scoped operational events |
| Operations website | Operations snapshot, order/mission/trace detail | Scoped approvals and run actions | Role-filtered operational stream |
| 3D control room | Run, observable world, snapshot | Run commands | Run-scoped operational and observable simulation events |
| Benchmark website | Paired-run status/result | Create paired run | Benchmark result and run progress |
| Trace viewer / Judge Mode | Agent trace and relevant entity detail | None | Trace-linked events |
| Harvest simulated farmer | Same crop/listing/approval operations as farmer | Same request bodies as farmer | Run-scoped events |
| Harvest simulated buyer | Same listing/demand/order/acceptance operations as buyer | Same request bodies as buyer | Run-scoped events |
| Harvest simulated transporter | Same mission/update/exception operations as transporter | Same request bodies as transporter | Run-scoped events |
| Model service | No public Product API reads | Internal prediction response only | None |

## Events and their effects

Every event uses [`EventEnvelope`](../contracts/events/event-envelope.schema.json):
`eventId`, `eventType`, `occurredAt`, optional `simulationTime`, explicit nullable
`simulationRunId`, `actorId`, `entityId`, `traceId`, `correlationId`, nullable
`causationId`, `schemaVersion`, `provenance`, and a typed `payload`.

The Product API writes operational state and the outbox record in one database
transaction. No consumer is expected to infer a successful state change from a
missing event or apply an event whose schema it cannot validate.

| API command/event | Product API impact | Simulation impact | Interface impact |
|---|---|---|---|
| Crop observation submitted / `CROP_OBSERVATION_SUBMITTED` | Stores observation/provenance and starts forecast workflow | Completes actor update; hidden crop truth unchanged | Farmer crop view and operations feed update |
| Forecast produced / `FORECAST_PRODUCED` | Stores model snapshot and deterministic safe-quantity inputs/ATP | Records prediction for predicted-versus-actual comparison | Farmer forecast, Model Lab, crop map update |
| Listing published / `LISTING_PUBLISHED` | Adds safely orderable marketplace supply | Buyer actors may discover it during later scheduled actions | Marketplace and operations supply update |
| Buyer demand/order created / `BUYER_DEMAND_CREATED`, `ORDER_REQUESTED` | Stores demand/order and starts matching | Marks demand pending and schedules eligible reactions | Buyer order and operations demand update |
| Allocation proposed / `ALLOCATION_PROPOSED` | Stores non-binding multi-farm proposal; no reservation | Schedules farmer/buyer approval actions | Approval cards and order timeline update |
| Allocation approved / `ALLOCATION_APPROVED` | Transactionally creates reservations/commitment | Schedules harvest/pickup obligations; reduces planned uncommitted supply, not hidden biological yield | Inventory, order, pending-delivery views update |
| Delivery mission created / `DELIVERY_MISSION_CREATED` | Stores route, stops, quantities, deadline | Adds mission to transporter schedules | Job list and control-room route appear |
| Mission accepted / `DELIVERY_MISSION_ACCEPTED` | Assigns transporter/vehicle and state | Prevents conflicting work and schedules pickups | Blue active route and tracking update |
| Delivery update / `DELIVERY_UPDATE_POSTED` | Appends pickup/position/delay/progress | Advances vehicle position and actor schedules | Map, timeline, ETA update |
| Exception / `EXCEPTION_REPORTED` | Opens exception, overlays `atRisk`, starts recovery | Applies/exposes observable disruption and pauses affected future schedules as appropriate | Red exception and recovery UI update |
| Recovery / `RECOVERY_APPROVED` | Updates validated reservations/farms/route/timing | Deterministically reroutes, reschedules, or adds an actor | New route, ETA, allocation, notification |
| Delivery accepted / `DELIVERY_ACCEPTED` | Stores accepted/rejected actual outcome | Records actual economics and evaluation data | Outcome, trust, revenue, benchmark update |
| Order fulfilled / `ORDER_FULFILLED` | Finalises order and releases unused reservations | Satisfies buyer demand, ends remaining tasks, records local procurement/fulfilment | Fulfilled order and dashboard totals update |
| Partial/rejected / `ORDER_PARTIALLY_FULFILLED`, `ORDER_REJECTED` | Stores actual accepted quantity and releases remainder | Schedules unmet-demand/import/substitution fallback | Partial/rejected state and exception path appear |
| Cancelled / `ORDER_CANCELLED` | Releases reservations and cancels operational work | Cancels future pickups and returns actors/vehicles to availability | Supply, routes, and order state update |

The full event list and payload purpose is in
[`EVENT_CATALOGUE.md`](../contracts/events/EVENT_CATALOGUE.md).

## Order lifecycle

```text
REQUESTED
  -> ALLOCATION_PROPOSED
  -> AWAITING_APPROVAL
  -> COMMITTED
  -> IN_DELIVERY
  -> FULFILLED | PARTIALLY_FULFILLED | REJECTED | CANCELLED
```

`AT_RISK` is not a lifecycle status. It is an active-exception overlay while an
order remains in its underlying state. Resolving all active exceptions clears
the overlay without pretending that the order moved backward.

The end-to-end fulfilment sequence is:

```text
crop observation -> forecast -> listing -> buyer demand/order
-> allocation proposal -> human approval + reservation
-> delivery mission -> transporter acceptance + updates
-> buyer delivery acceptance -> DELIVERY_ACCEPTED
-> ORDER_FULFILLED -> reservation release + demand satisfied + metrics
```

## Simulation event-handler rules

For each SSE event, the simulation must:

1. Validate the envelope and event-specific payload.
2. Ignore an already-applied `eventId`.
3. Persist the last fully applied SSE ID before acknowledging progress.
4. Ignore feedback whose correlation/causation shows it originated from the
   same already-applied simulation action.
5. Apply only the effect in the table/catalogue, deterministically from current
   state, run seed, and event data.
6. Schedule future effects; never rewrite past state or hidden crop truth.
7. Publish only allow-listed observable simulation events through
   `POST /internal/v1/simulation-events`.

On disconnect, reconnect with `Last-Event-ID`. If an event arrives again, step
2 prevents a second schedule/metric mutation. If retention has expired and the
API returns `409`, load the observable snapshot/world, transactionally replace
the public projection and cursor, then resume. The simulation never queries or
modifies the Product API database.

## Yield model interface and ATP

The Product API alone calls
`POST /internal/v1/yield-predictions` from the
[model OpenAPI](../contracts/model/openapi.yaml). It sends batch/farm/crop IDs,
request time/run context, provenance, and allow-listed observation/weather/
satellite feature summaries. The model returns:

- model and prediction/request IDs;
- q10, q50, and q90 marketable-yield quantities in the same unit;
- harvest window and readiness;
- confidence and data-quality warnings;
- `MODEL_PREDICTED` provenance and generation time.

The Product API validates `q10 <= q50 <= q90`, units, dates, confidence ranges,
IDs, and provenance. It then calculates—not the model—safe orderable supply:

```text
availableToPromise = max(
  0,
  q10MarketableYield - activeReservations - commitments - safetyBuffer
)
```

All terms use kilograms and the same crop batch. A model/LLM result never
directly mutates inventory, reserves supply, or makes a binding commitment.

## Contract use in implementations

- Generate the website and mobile TypeScript client from
  `contracts/openapi.yaml`; keep no hand-written competing payload types.
- Generate/validate Python simulation and model types from their OpenAPI files
  and the shared JSON Schemas.
- The Product API must validate model responses and simulation ingestion at the
  boundary, even when generated types compile.
- Contract changes are complete only when OpenAPI/JSON Schema, this guide, event
  catalogue, generated consumers, and deterministic handlers agree.

## Contract verification checklist

- Parse/lint every OpenAPI and JSON Schema document and resolve local `$ref`s.
- Validate the included example for every operation and event payload.
- Generate temporary TypeScript and Python clients/types; do not commit output.
- Exercise observation through `ORDER_FULFILLED` and assert each state/event.
- Send the same observation body as a real and simulated farmer.
- Disconnect/reconnect SSE and assert an event is applied once.
- Assert simulation effects change future schedules/metrics without exposing or
  rewriting hidden truth.
- Reject invalid units, provenance, roles, quantile ordering, idempotency keys,
  identity injection, run injection, and hidden-state fields.
