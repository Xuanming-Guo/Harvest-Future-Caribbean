# Product API, events, and shared contracts

This is the implementation guide for connecting Harvest's Product API,
website, simulation, control room, and yield model. Wire validation
is authoritative in [`contracts/`](../contracts/); this guide explains who uses
each operation and what it must cause.

Do not add an endpoint, event, state transition, or simulation effect only in
code. Change the machine contract and this guide together first.

## Current implementation boundary

Issue #8 implements the participant Product API used by the farmer, buyer,
transporter and coordinator website on port `3000`. Its Fastify runtime serves
the crop, forecast, listing, privacy-safe opportunity, demand, order,
actor-targeted approval, vehicle, verification, delivery mission, exception and
delivery-acceptance operations described below. Issue #6 adds the in-process
agent coordinator, editable observation intake, and safe trace read operation.

Saved runs execute the TypeScript engine and, for Harvest policy, an
interleaved participant cycle. After each actionable physical event, synthetic
farmers, buyers, transporters and the coordinator use the existing
authenticated Product API operations. Product events are consumed in cursor
order and change only later physical commitments, routes, timings and outcomes;
their run-scoped state, traces and concise actions are saved with the safe
replay. The separate control room creates and loads these runs. The participant
website has no simulation controls, but it can display one completed synthetic
participant in an explicitly read-only replay session.
Use [`simulation_api_local_testing.md`](simulation_api_local_testing.md) for the
copy-ready localhost requests and expected seed-42 behavior.

## Canonical architecture

```text
Website / Harvest-mode simulated actor
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
      SSE clients       TypeScript simulation engine
 Website / control     deterministic run execution
 3D Control Room               |
                               v
                    Immutable observable replay
```

- The Product API is a standalone TypeScript/Node Fastify service.
- Saved simulation execution runs in the Fastify process; hidden truth remains
  owned by the simulation package and is never stored in Product API records.
- The Next.js website uses a generated TypeScript Product API client.
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
| Website/control room | Local presentation, cache, playback position, and navigation state | Authoritative operational or simulation state |

Hidden crop yield, future disruptions, future actor decisions, and other
scenario truth must never appear in Product API responses, public events,
traces, or the observable world snapshot. They become visible only when a
scenario event makes them observable.

## Users, services, and authentication

- People use a Supabase-compatible bearer JWT. Middleware derives `actorId`
  and one of `FARMER`, `BUYER`, `TRANSPORTER`, `COORDINATOR`, `OPERATIONS`, or
  `ADMIN`; a request body cannot override that identity.
- A Harvest-mode simulated user is given a synthetic `actorId`, human role,
  and `simulationRunId` by authentication middleware. It then sends exactly the
  same public request body as the corresponding real user.
- A baseline-mode actor never calls Harvest coordination operations. Baseline
  policy acts inside the simulation and publishes only allow-listed observable
  run events for visualisation and comparison.
- Saved runs do not use a second service token or an internal ingestion API.

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

#### `GET /v1/crop-batches`

- Callers: farmer for owned batches and authorised coordinator, operations, or
  admin roles.
- Request: optional `cropType`, status, cursor, and limit filters.
- Response: a role-filtered page of observable crop batches with latest safe
  prediction IDs, ATP, provenance, and latest verification status.
- Product state/event and simulation effect: none; this is a read projection.
- Consumers: farmer crop lists and authorised technical evidence views.

#### `POST /v1/crop-observation-intakes`

- Callers: farmer for an owned batch; coordinator for an authorised farm.
- Request: batch and observation time, source type (`TEXT`, supplied
  `VOICE_TRANSCRIPT`, or `COORDINATOR_NOTE`), source text, and observable
  provenance. Issue #6 does not capture or transcribe audio.
- Response: persisted draft ID, optional suggested stage/quantity/notes,
  per-field and overall confidence, warnings, prompt/adapter provenance,
  `DRAFT` status, and trace ID.
- Product state/event: store a non-binding draft and emit
  `CROP_OBSERVATION_INTAKE_DRAFTED`. Do not update the batch, forecast, ATP,
  listing, order, or simulation truth.
- Consumers: the farmer crop form.
- Rules/failures: source text is limited to 4,000 characters. The caller must
  review and explicitly submit the structured observation separately.

#### `POST /v1/crop-observations`

- Callers: farmer for an owned batch; coordinator for an authorised farm.
- Request: `cropBatchId`, `observedAt`, `cropStage`, `provenance`; optional
  `notes`, `estimatedQuantity`, and accessible same-batch `intakeId`.
  Identity/run context comes from auth. Submitted human-reviewed fields are
  authoritative; the draft values are never copied behind the caller's back.
- Response: stored observation IDs/times, submitted safe fields, `traceId`,
  and confirmed intake ID when one was used.
- Product state/event: append the observation and provenance, update the
  batch's latest observation, create one verification task, produce one
  refreshed forecast, and emit `CROP_OBSERVATION_SUBMITTED`,
  `VERIFICATION_TASK_CREATED`, and `FORECAST_PRODUCED`. Clients must not submit
  a second `NEW_OBSERVATION` forecast request after this command succeeds.
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

#### `GET /v1/yield-predictions/{predictionId}`

- Callers: actors authorised for the related crop batch and operations roles.
- Response: the Product API's validated prediction, allow-listed feature
  snapshot, version, interval, confidence, warnings, provenance, and optional
  accepted-outcome evaluation.
- Product state/event and simulation effect: none.
- Consumers: technical evidence and crop evidence panels. The website never calls the
  internal model endpoint directly and never receive model artefacts or hidden
  simulation truth.

### Marketplace and orders

#### `GET /v1/buyer-demands`

- Callers: the buyer for owned demand plus authorised coordinator, operations,
  and admin roles.
- Request: optional crop, status, cursor, and limit filters.
- Response: a role-filtered demand page.
- Product state/event and simulation effect: none.
- Consumers: operations demand table and future buyer demand history.

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

#### `GET /v1/listings/{listingId}`

- Callers: buyer for active supply, owning farmer, permitted coordinator,
  operations, or admin.
- Response: the listing plus a general production zone and supply evidence:
  forecast provenance, confidence, generation time, harvest window, warnings,
  and coordinator verification status. Exact farm coordinates are never part
  of this projection.
- Product state/event and simulation effect: none.
- Consumers: buyer marketplace detail.

#### `GET /v1/market-opportunities`

- Callers: farmer for owned crop types, permitted coordinator, or admin.
- Response: open/matching demand as crop, quantity, deadline, general delivery
  zone, optional maximum price, and opportunity ID. Buyer identity and exact
  delivery coordinates are deliberately omitted.
- Product state/event and simulation effect: none.
- Consumers: farmer home opportunity view.

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
- Consumers: buyer marketplace and order timeline.
- Rules/failures: duplicate business intent with the same key returns the same
  order; inaccessible listings, invalid quantity/date, or identity fields fail.

#### `GET /v1/orders`

- Callers: the buyer, participating farmers, and authorised coordinators.
- Request: optional lifecycle status, risk overlay, cursor, and limit filters.
- Response: a role-filtered order page using the same lifecycle representation
  as order detail.
- Product state/event and simulation effect: none.
- Consumers: buyer, farmer, and coordinator order lists.

#### `GET /v1/orders/{orderId}`

- Callers: participating buyer/farm/transporter when relevant; authorised
  coordinator/operations/admin.
- Request: order UUID.
- Response: quantities, deadline, lifecycle status, `atRisk`, active exception
  IDs, timestamps, safe allocation, approval totals and the caller's approval,
  trace ID, related delivery mission, and immutable delivery acceptance when recorded.
  Private farm coordinates are not exposed here.
- Product state/event: none.
- Simulation effect: none.
- Consumers: buyer/farmer order status and coordinator order detail.
- Rules/failures: role-filter sensitive farm, buyer, route, and location data.

### Approvals and delivery

#### `GET /v1/approvals`

- Callers: the actor named in `requestedFromActorId`; coordinators see only
  approvals explicitly targeted to them.
- Request: optional status, subject type, cursor, and limit filters.
- Response: pending or decided approvals with request time and role-safe
  context. Farmers see only their committed line quantity; buyers see their
  order total; each sees the estimated price for those visible lines;
  coordinators see the concrete recovery summary. Decision
  identity, time, and reason appear only after a final human decision.
- Product state/event and simulation effect: none.
- Consumers: focused farmer, buyer, and coordinator decision cards.

#### `POST /v1/approvals/{approvalId}/decisions`

- Callers: the named human approver for the pending subject; admin only through
  an explicitly audited override.
- Request: `decision` (`APPROVE`/`REJECT`) and optional `reason`.
- Response: approval subject, final status, decider, and time.
- Product state/event: record one final decision. An allocation creates one
  targeted approval for its buyer and one for every participating farmer. No
  reservation, commitment, or mission exists until all remain valid and every
  required actor approves. The final approval atomically creates reservations
  and the mission and emits `APPROVAL_DECIDED` and `ALLOCATION_APPROVED`. If
  aggregate ATP or listing supply changed, invalidate the proposal with
  `ALLOCATION_INVALIDATED`, return the order to `REQUESTED`, and create no
  partial reservation. Any rejection marks the
  allocation/order rejected and cancels the other pending approvals without
  committing inventory. Recovery approval applies its validated operational
  changes and emits `RECOVERY_APPROVED`.
- Simulation effect: allocation approval schedules harvest/pickup obligations
  and reduces planned uncommitted supply; recovery approval deterministically
  reroutes/reschedules/substitutes/reallocates/cancels future work.
- Consumers: approval cards, order timeline, notifications, control-room route.
- Rules/failures: a decided approval is immutable; stale subject state returns
  `409`; required commitment/substitution/cancellation/location/quality/inter-
  island decisions cannot be bypassed.

#### `GET /v1/delivery-missions`

- Callers: transporter (available/owned jobs) and actors participating in the
  related order; coordinators remain limited to relevant orders.
- Request: optional status, cursor, limit.
- Response: visible mission page with route stops, quantity, deadline,
  assignment/status, pickup batch quantities, estimated distance/duration/
  arrival, and `pageInfo`.
- Product state/event: none.
- Simulation effect: none until a simulated transporter takes its scheduled
  browse/accept action.
- Consumers: transporter job list and participant order tracking.
- Rules/failures: private pickup/drop-off coordinates are role/scope-filtered.

#### `GET /v1/delivery-missions/{missionId}`

- Callers: assigned/eligible transporter or an actor participating in the
  related order.
- Request: mission UUID.
- Response: mission/order IDs, status, assignment, vehicle, quantity, deadline,
  and ordered stops.
- Product state/event: none.
- Simulation effect: none.
- Consumers: transporter job detail and participant delivery tracking.
- Rules/failures: return no private route to unrelated actors.

#### `POST /v1/delivery-missions/{missionId}/acceptance`

- Callers: an eligible transporter.
- Request: `decision: ACCEPT` and `vehicleId`.
- Response: mission changed to `ASSIGNED` with transporter/vehicle.
- Product state/event: atomically claim an available mission and emit
  `DELIVERY_MISSION_ACCEPTED`.
- Simulation effect: make that transporter/vehicle unavailable for conflicting
  work and schedule pickup tasks.
- Consumers: transporter active job and participant tracking.
- Rules/failures: competing acceptances produce one winner; later attempts
  return `409`; reject unavailable/unauthorised vehicles.

#### `GET /v1/me/vehicles`

- Callers: transporter.
- Response: only vehicles owned by the signed-in transporter, including label,
  optional registration/capacity, and `AVAILABLE`, `IN_USE`, or `INACTIVE`.
- Product state/event and simulation effect: none. Mission acceptance changes
  the selected vehicle to `IN_USE`; delivery or cancellation releases it.
- Consumers: transporter job list and mission acceptance.

#### `GET /v1/delivery-missions/{missionId}/updates`

- Callers: the same actors allowed to read the mission.
- Response: chronological progress updates with derived stop sequence.
- Product state/event and simulation effect: none.
- Consumers: participant delivery timelines.

#### `POST /v1/delivery-missions/{missionId}/updates`

- Callers: assigned transporter.
- Request: `updateType`, `recordedAt`; optional `position`, `quantity`, `note`.
- Response: update and mission IDs plus submitted safe fields.
- Product state/event: append progress, enforce monotonic timestamps and the
  arrival/pickup/drop-off sequence, advance mission/order state, and emit
  `DELIVERY_UPDATE_POSTED`.
- Simulation effect: advance observable vehicle position and future actor/task
  schedules. It cannot rewrite past positions.
- Consumers: transporter progress and participant order tracking.
- Rules/failures: update type must be valid for current mission state; time must
  be monotonic; position is required for `POSITION`.

#### `GET /v1/verification-tasks`

- Callers: coordinator for permitted farms or admin.
- Response: explicit observation-verification tasks, optionally filtered by
  status.
- Product state/event and simulation effect: none.
- Consumers: coordinator verification queue.

#### `POST /v1/verification-tasks/{taskId}/decisions`

- Callers: coordinator for the task's permitted farm or admin.
- Request: `VERIFY` or `REQUEST_CHANGES` plus an optional note.
- Product state/event: finalise the task and emit `VERIFICATION_DECIDED`.
- Simulation effect: complete the observable verification action without
  changing hidden crop truth.
- Consumers: coordinator queue and crop/listing evidence.

#### `POST /v1/exceptions`

- Callers in Issue #8: assigned transporter or coordinator, only for an entity
  visible to that actor.
- Request: type, severity, affected entity IDs, description, provenance.
- Response: exception ID, status, report time, and submitted safe fields.
- Product state/event: store exception, set `atRisk` overlay on affected active
  orders, start recovery analysis, emit `EXCEPTION_REPORTED`, and for a mission
  delay emit `RECOVERY_PROPOSED` with an exact two-hour deadline change that is
  not applied until approval.
- Simulation effect: apply/expose the corresponding observable disruption and
  pause affected future schedules where appropriate. Hidden cause/outcome stays
  internal until observable.
- Consumers: red exception state, recovery/approval UI, notifications.
- Rules/failures: reject unknown/inaccessible entities, hidden-state fields, and
  an unsupported provenance.

#### `GET /v1/exceptions`

- Callers: affected actors and authorised operations roles.
- Request: optional status, severity, cursor, and limit filters.
- Response: role-filtered operational exceptions and provenance.
- Product state/event and simulation effect: none.
- Consumers: the coordinator recovery workspace and related participant state.

#### `GET /v1/exceptions/{exceptionId}`

- Callers: affected participants and authorised coordinator/admin roles.
- Response: exception detail plus a stored recovery action, plain-language
  summary, concrete changes, and approval totals when a proposal exists.
- Product state/event and simulation effect: none.
- Initial delay recovery: a mission delay resolves the related order, marks it
  at risk, and proposes extending that mission's deadline by two hours. Human
  approval applies that exact deadline, resolves the exception, and clears the
  risk overlay only when no other active exception remains.

#### `POST /v1/deliveries/{deliveryId}/acceptance`

- Callers: receiving buyer or explicitly authorised receiving coordinator.
- Request: outcome, accepted quantity, rejected quantity, one accepted/rejected
  outcome for every committed crop batch, and optional note.
- Response: delivery/order IDs, outcome/quantities, accepter and time.
- Product state/event: record immutable actual outcome and emit
  `DELIVERY_ACCEPTED`; then atomically derive one of `ORDER_FULFILLED`,
  `ORDER_PARTIALLY_FULFILLED`, or `ORDER_REJECTED` and release unused
  reservations.
- Simulation effect: record actual farmer/transporter economics and model
  evaluation data. Each crop line updates its latest prediction's accepted
  actual quantity and absolute error. Fulfilment satisfies demand and ends remaining order tasks;
  partial/rejected outcomes schedule unmet-demand/import/substitution fallback.
- Consumers: buyer receipt, farmer outcome/revenue, trust, benchmark, Model Lab.
- Rules/failures: quantities must use one unit, be non-negative, sum to the
  delivered amount, and match outcome; produce rejection requires approval.

#### `GET /v1/agent-traces/{traceId}`

- Callers: actors affected by the trace and authorised operations roles.
- Request: trace UUID.
- Response: workflow/stage/status, safe summary, timestamps, and ordered
  evidence/tool/decision/approval/state steps with optional agent, tool,
  provenance, prompt version, fixture/provider adapter, duration, and confidence.
- Product state/event and simulation effect: none.
- Consumers: linked operational evidence and the future control-room viewer.
- Rules/failures: access follows the trace subject. Never return source text,
  assembled prompts, credentials, private chain-of-thought, hidden truth, or
  evidence the caller cannot access.

### Operational and live views

#### `GET /v1/operations/snapshot`

- Callers: coordinator, operations, admin; run-scoped control room.
- Request: optional `simulationRunId`. A run-scoped actor is always forced to
  its authenticated run. Only operations/admin may explicitly select a run.
- Response: generation time and role-filtered counts/IDs for supply, demand,
  raw order states, active missions, and open exceptions. It also returns a
  deadline-aware order outcome summary, summed accepted delivery kilograms,
  approved commitment count, and completed mission count.
- Outcome rules: `FULFILLED` and `PARTIALLY_FULFILLED` retain those outcomes;
  rejected/cancelled orders and incomplete orders at or past `neededBy` are
  unfulfilled; other incomplete orders are pending. Every visible order is in
  exactly one category.
- Connected runs capture the control-room copy through a synthetic,
  run-scoped operations observer. That observer makes no participant decisions
  and is not shown on the map; it exists only so the saved projection has the
  same complete run visibility as this operations endpoint.
- Product state/event: none.
- Simulation effect: none.
- Consumers: operations dashboard and initial control-room projection.
- Rules/failures: omitting `simulationRunId` selects real/unscoped records.
  Snapshot and SSE use the same run boundary and never combine real records or
  records from two runs.

#### `GET /v1/events/stream`

- Callers: authenticated website clients; run-scoped simulation and 3D
  control room.
- Request: optional `simulationRunId`; optional `Last-Event-ID` header.
- Response: `text/event-stream` frames where `id` is the monotonic decimal
  database cursor, `event` is `eventType`, and `data` is the validated event
  envelope containing its UUID `eventId`.
- Product state/event: read-only replay then live tail of the append-only log.
- Simulation effect: Harvest simulation handlers deterministically schedule
  documented future effects.
- Consumers: website state updates, 3D control room,
  trace viewer, benchmark UI, Harvest simulation policy.
- Rules/failures: stream is role/run-filtered. With no cursor it replays all
  retained visible events. A malformed cursor or one beyond the retained log
  returns `409`; reconnecting after cursor `N` starts strictly after `N`.

### Saved simulation runs and replay

The Product API calls the deterministic TypeScript simulation package in
process, assigns a unique storage run ID, and persists an immutable observable
timeline. The simulation still owns its seed, clock and hidden truth. Only the
safe scene, replay frames, concise decisions, metrics, evidence label and
provenance are stored. Replay reads never execute a new simulation or LLM call.

#### `GET /v1/simulation-scenarios`

- Callers: operations/admin/control-room operator.
- Response: safe scenario metadata, current policies, supported decision modes,
  islands, duration and provenance. The regional scenario exposes every current
  UN M49 Caribbean country or area as an independently simulated, synthetic
  local system; the Saint Lucia recipe remains the focused benchmark.

#### `GET /v1/simulation-runs`

- Callers: operations/admin/control-room operator.
- Request: optional scenario, policy, status, cursor and limit filters.
- Response: saved-run metadata and metrics without the large replay frames.
- Rules/failures: newest first; cursor is opaque to clients.

#### `POST /v1/simulation-runs`

- Callers: operations/admin/control-room operator.
- Request for a new run: `scenarioId`, policy, integer seed, `decisionMode`,
  island scope and optional deterministic disruptions. A derived request sends
  only a completed `derivedFromRunId` and one or more additional disruptions.
- Response: completed saved-run metadata, metrics, frame/decision counts and
  explicit synthetic evidence labels.
- Product state/event: store `CREATING`, execute the whole run synchronously,
  validate the observable artefact for hidden-truth leakage, then store
  `COMPLETED` or `FAILED`.
- Simulation effect: initialise and execute from scenario/seed. A derived run
  inherits immutable inputs and never edits its source.
- Consumers: 3D control room and benchmark setup.
- Rules/failures: seed/scenario/policy/scope are immutable. `LLM_ASSISTED`
  uses a labelled predetermined fixture when all four LLM settings are blank.
  A complete `openai-compatible` configuration calls that provider; partial,
  failed or invalid output fails safely before unchecked tools execute. An
  injected disruption must start strictly before the scenario horizon; an
  offset at or after the horizon returns `422 INVALID_DISRUPTION` because no
  simulated time remains in which it could occur.
  `saint-lucia-demo-v1` accepts only Saint Lucia; `caribbean-islands-v1`
  accepts one, several, or `ALL` manifest islands; each
  `caribbean-<island-id>-v1` focused scenario accepts its named island only.
  Island systems share the clock but never create inter-island allocations,
  routes, or commitments.
  Manifest reference inputs and synthetic fallbacks are documented in
  [`caribbean-scenario-data.md`](caribbean-scenario-data.md).

#### `GET /v1/simulation-runs/{runId}`

- Callers: operations/admin/control room and benchmark viewer.
- Request: run UUID.
- Response: immutable inputs, status, metrics, evidence/provenance, counts,
  source-run reference and failure information without frames or hidden digest.
- Product state/event: none.
- Simulation effect: none.
- Consumers: saved-run picker and benchmark progress.
- Rules/failures: response cannot include future queue or hidden scenario state.

#### `GET /v1/simulation-runs/{runId}/timeline`

- Callers: operations/admin/control room.
- Response: evidence label, provenance note, static scene and the complete
  ordered observable frame array.
- Reference geography: the scene includes `referencePlaces` and
  `referenceDataSources`. Each public place has a stable reference ID, category,
  position, source feature URL, retrieval/revision metadata, evidence type and
  warnings. Farms, buyers and transporters may carry a `referencePlaceId` that
  links a synthetic actor to nearby geographic context. The source registry
  supplies the attribution and licence that the control room displays. Only
  references inside the run's selected island scope are returned. Older saved
  scenes with no reference arrays are normalised to empty arrays when read.
- Product state/simulation effect: none. Playback position, pause, speed,
  rewind and reset are local array navigation and never API commands.
  - Replay consistency: the engine appends a `RUN_SETTLED` frame at the exact
    scenario horizon after physical demand settlement. Harvest frames retain the
    latest run-scoped Product API snapshot between participant action cycles, so
    the final replay frame, saved-run metrics and operations endpoint agree.
    Multi-island runs retain periodic visible-world checkpoints plus every
    disruption and participant-action frame, rather than serialising an
    unbounded full-world snapshot after every physical event.
- Rules/failures: only completed runs are replayable. Public references never
  become operational Product API organisations, listings or orders. Their
  presence does not imply participation or endorsement, and all actor behaviour
  and results remain synthetic.

#### `GET /v1/simulation-runs/{runId}/world`

- Callers: control room, operations/admin.
- Request: run UUID and required zero-based `frameIndex`.
- Response: run ID, frame index/count and exactly one saved observable frame.
- Product state/event: none; this reads JSON already stored for the run.
- Simulation effect: none.
- Consumers: 3D map/control room.
- Rules/failures: schema rejects hidden yields, quality, readiness, future
  disruptions, actor plans, and future event queues.

#### `POST /v1/simulation-runs/{runId}/participant-sessions`

- Callers: operations/admin/control-room operator.
- Request: a mapped `productActorId` from the completed Harvest replay scene.
- Response: a 15-minute bearer token plus the participant role, run and
  explicit read-only status.
- Product state/simulation effect: none; it creates access to already-completed
  run-scoped records and never resumes the run.
- Rules/failures: baseline, incomplete, unrelated and non-synthetic actors are
  rejected. Every mutation attempted with the completed participant identity
  returns `SIMULATION_RUN_IMMUTABLE`.

#### `GET /v1/me`

- Callers: every authenticated Product API role.
- Response: current identity, role, synthetic flag, optional run scope/location,
  run status and `readOnly` flag.
- Consumers: website session bootstrap and replay banner/routing.

#### `POST /v1/paired-runs`

- Callers: operations/admin/benchmark operator.
- Request: scenario, seed, deterministic decision mode, island scope and
  optional disruptions.
- Response: completed pair, unique baseline/Harvest run IDs, aggregate metrics,
  signed deltas and synthetic evidence label.
- Product state/simulation effect: create two immutable saved runs with exactly
  the same scenario, seed, scope and disruptions, changing only policy.
- Consumers: benchmark setup/progress.
- Rules/failures: reject unavailable scenario or inconsistent pair creation;
  the two policies cannot have different initial inputs.

#### `GET /v1/paired-runs/{pairId}`

- Callers: benchmark viewer, operations/admin.
- Request: pair UUID.
- Response: pair inputs, run IDs, status and stored baseline/Harvest comparison.
- Product state/event: none.
- Simulation effect: none.
- Consumers: benchmark website, Judge Mode, pitch dashboard.
- Rules/failures: no result is fabricated while incomplete; metrics are labelled
  simulated and trace back to run IDs.


## Interface-to-operation map

| Interface | Reads | Writes/actions | Live events |
|---|---|---|---|
| Farmer website | Owned crop batches, prediction, participating orders and missions | Crop observation, forecast request, safe listing, own approval decision | Crop/forecast/listing/allocation/order/delivery outcomes |
| Buyer website | Listings, owned demand/orders, relevant approval and delivery | Buyer demand, order, own approval decision, delivery acceptance | Demand/allocation/mission/delivery/order outcomes |
| Transporter website | Available and assigned mission detail | Mission acceptance, delivery updates, exception | Mission/update/exception/recovery/order outcome |
| Coordinator website | Permitted crops, relevant orders, targeted approvals and exceptions | Approval decision, verified update, exception escalation | Scoped operational events |
| 3D control room | Saved runs, timelines, individual frames, participants and snapshots | Create run, derived run or paired run; open replay participant | Run-scoped operational events |
| Future benchmark view | Paired-run status/result | Create paired run | Benchmark result and run progress |
| Future trace/evidence view | Agent trace and relevant entity detail | None | Trace-linked events |
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
| Crop observation draft / `CROP_OBSERVATION_INTAKE_DRAFTED` | Stores an editable draft and safe trace; no crop state changes | None until the actor submits an observation | Farmer form is prefilled for review |
| Crop observation submitted / `CROP_OBSERVATION_SUBMITTED` | Stores observation/provenance and starts forecast workflow | Completes actor update; hidden crop truth unchanged | Farmer crop view and operations feed update |
| Verification task/decision / `VERIFICATION_TASK_CREATED`, `VERIFICATION_DECIDED` | Stores explicit coordinator work and its final status | Completes only the observable verification action | Coordinator queue and supply evidence update |
| Forecast produced / `FORECAST_PRODUCED` | Stores model snapshot and deterministic safe-quantity inputs/ATP | Records prediction for predicted-versus-actual comparison | Farmer forecast, Model Lab, crop map update |
| Listing published / `LISTING_PUBLISHED` | Adds safely orderable marketplace supply | Buyer actors may discover it during later scheduled actions | Marketplace and operations supply update |
| Buyer demand/order created / `BUYER_DEMAND_CREATED`, `ORDER_REQUESTED` | Stores demand/order and starts matching | Marks demand pending and schedules eligible reactions | Buyer order and operations demand update |
| Allocation proposed / `ALLOCATION_PROPOSED` | Stores non-binding multi-farm proposal; no reservation | Schedules farmer/buyer approval actions | Approval cards and order timeline update |
| Approval / `APPROVAL_DECIDED` | Stores only the named human's decision | Completes only that actor's decision task | Approval totals and timeline update |
| Invalidated allocation / `ALLOCATION_INVALIDATED` | Marks stale proposal and leaves order open without partial reservation | Cancels proposal tasks and leaves demand pending | Order returns to waiting for supply |
| Allocation approved / `ALLOCATION_APPROVED` | Transactionally creates reservations/commitment | Schedules harvest/pickup obligations; reduces planned uncommitted supply, not hidden biological yield | Inventory, order, pending-delivery views update |
| Delivery mission created / `DELIVERY_MISSION_CREATED` | Stores route, stops, quantities, deadline | Adds mission to transporter schedules | Job list and control-room route appear |
| Mission accepted / `DELIVERY_MISSION_ACCEPTED` | Assigns transporter/vehicle and state | Prevents conflicting work and schedules pickups | Blue active route and tracking update |
| Delivery update / `DELIVERY_UPDATE_POSTED` | Appends pickup/position/delay/progress | Advances vehicle position and actor schedules | Map, timeline, ETA update |
| Exception / `EXCEPTION_REPORTED` | Opens exception, overlays `atRisk`, starts recovery | Applies/exposes observable disruption and pauses affected future schedules as appropriate | Red exception and recovery UI update |
| Recovery proposal / `RECOVERY_PROPOSED` | Stores a concrete action and requests human approval; applies nothing | Schedules coordinator decision only | Recovery card shows exact proposed change |
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

For each Product event, whether read from SSE by a separate consumer or from
the in-process outbox during synchronous saved-run execution, the simulation
must:

1. Validate the envelope and event-specific payload.
2. Ignore an already-applied `eventId`.
3. Persist the last fully applied monotonic SSE cursor before acknowledging progress.
4. Ignore feedback whose correlation/causation shows it originated from the
   same already-applied simulation action.
5. Apply only the effect in the table/catalogue, deterministically from current
   state, run seed, and event data.
6. Schedule future effects; never rewrite past state or hidden crop truth.
7. Publish only allow-listed operational events through the authenticated
   Product API operations used by the simulated participant.

An external consumer reconnects with `Last-Event-ID`. If an event arrives again, step
2 prevents a second schedule/metric mutation. If retention has expired and the
API returns `409`, load the observable snapshot/world, transactionally replace
the public projection and cursor, then resume. The engine never queries or
modifies Product API storage. The in-process coordinator builds role context
through authenticated Product API queries; only the API-owned bootstrap and
outbox adapter touch Prisma.

### Connected execution order

`EXTERNAL_PRODUCT_API` mode disables the engine's internal Harvest allocation,
approval and recovery policy. The saved-run coordinator then repeats:

1. advance to the next seeded physical event;
2. expose only the resulting observable frame;
3. execute the relevant role-safe tools in stable actor order;
4. consume every emitted Product event in monotonic cursor order;
5. deduplicate its UUID and suppress physical-action echoes;
6. apply validated effects only to future physical work;
7. checkpoint the actions and run-scoped Product snapshot.

Product event UUIDs are never used as physical commitment or mission IDs. The
engine consumes its seeded ID stream for those records, so database-generated
identifiers cannot change the deterministic digest. Past frames, hidden crop
truth and undisclosed disruption severity are immutable.

## Yield model interface and ATP

The Product API alone calls
`POST /internal/v1/yield-predictions` from the
[model OpenAPI](../contracts/model/openapi.yaml). It sends batch/farm/crop IDs,
request time/run context, provenance, and allow-listed observation/weather/
satellite feature summaries. These may include observation count/latest
observed quantity, planted area, crop stage, and days since planting; absent
evidence must remain absent rather than being fabricated. The model returns:

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

- Generate the website and control-room TypeScript client from
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
