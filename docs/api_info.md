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
  prediction IDs, ATP, provenance, latest verification status, and the optional
  `latestDecision` explanation described under `GET /v1/crop-batches/{cropBatchId}`.
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
  prediction IDs, deterministic `availableToPromise`, and provenance. When the
  batch's most recent verification decision was `REQUEST_CHANGES`, or its most
  recent delivery line was rejected, the response also carries the additive
  optional `latestDecision` object: `source` (`VERIFICATION` or `DELIVERY`),
  `decidedAt`, and the recorded `reasonCode`, `nextAction`, and `note`. Records
  written before structured reasons existed simply omit those fields. This is
  traceability evidence about one operational decision, not a food-safety
  certification.
- Product state/event: none.
- Simulation effect: none; reading cannot advance time or reveal truth.
- Consumers: farmer crop view, order/allocation detail, crop map.
- Rules/failures: return `403` for unauthorised scope and `404` only when
  absence may safely be disclosed.

#### `GET /v1/crop-standards`

- Callers: every authenticated product role. Published standards are visible
  to all roles; buyers, coordinators, and admins also see their own drafts.
- Request: required `cropType`; optional cursor and limit filters.
- Response: newest-first crop-standard versions with publisher identity,
  review date, geography, attributed source, buyer checklist, licensed images,
  and individually sourced farmer guidance.
- Product state/event and simulation effect: none; this is a read projection.
- Consumers: the crop detail guidance card and order standard attribution.

#### `POST /v1/crop-standards`

- Callers: buyer, coordinator, or admin.
- Request: crop type, `DRAFT` or `PUBLISHED` status, review date, geography,
  source, checklist, images, and sourced guidance. The publisher is derived
  from the authenticated actor.
- Response: the newly stored standard. Each command creates the next version
  for that publisher and crop; published versions remain immutable history.
- Product state/event and simulation effect: no domain event and no simulation
  effect.
- Consumers: future standards-authoring surfaces and the current crop/order
  read projections.
- Rules/failures: unknown fields and invalid source URLs fail validation.
  Checklist requirements or guidance text mentioning chlorine, bleach,
  sanitiser/sanitizer, or a pesticide dose return `422`
  `CHEMICAL_GUIDANCE_NOT_REVIEWED` until reviewed chemical guidance is in scope.

#### `POST /v1/crop-batches/{cropBatchId}/forecast-requests`

- Callers: owning farmer, coordinator, operations, or scheduled Product API
  workflow.
- Request: `reason` = `NEW_OBSERVATION`, `MANUAL_REFRESH`, or
  `SCHEDULED_REFRESH`.
- Response: forecast request ID, batch ID, queue status, request time.
- Product state/event: store an idempotent job and invoke the harvest-
  estimation method that applies to the batch. When its result validates,
  store a prediction snapshot, calculate ATP, and emit `FORECAST_PRODUCED`.
- Simulation effect: the request itself changes no world state; the produced
  forecast is retained for predicted-versus-actual evaluation.
- Consumers: farmer forecast, crop map, Model Lab, operations feed.
- Rules/failures: concurrent equivalent jobs return their existing receipt;
  reject missing evidence, inaccessible batches, and invalid job transitions.
  A batch whose run selected `LEARNED_MODEL` returns `502 MODEL_UNAVAILABLE`
  when that service is unreachable or rejects the request; the deterministic
  fallback is never substituted silently.

#### `GET /v1/yield-predictions/{predictionId}`

- Callers: actors authorised for the related crop batch and operations roles.
- Response: the Product API's validated prediction, allow-listed feature
  snapshot, `estimationMode`, `modelVersion`, interval, confidence, warnings,
  provenance, and optional accepted-outcome evaluation. `provenance` is
  `MODEL_PREDICTED` for both methods, so `estimationMode` is what separates a
  labelled deterministic-fallback estimate from learned-model output.
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
- Product state/event: verify the batch is reported `HARVEST_READY` or
  `HARVESTED` and the quantity is within current ATP, store the active
  listing, emit `LISTING_PUBLISHED`, then re-run matching once for every
  `REQUESTED` order of that crop whose deadline is still ahead (oldest
  deadline first). Before any matching pass, listings whose `availableUntil`
  has passed move to `EXPIRED` with `LISTING_EXPIRED`.
- Simulation effect: make supply discoverable to eligible buyer actors at later
  scheduled actions; do not change biological yield.
- Consumers: farmer inventory/listing view, marketplace, operations supply.
- Rules/failures: return `422` `CROP_NOT_READY` for a growing batch, `422`
  `ATP_EXCEEDED` when quantity exceeds ATP, `422` when dates/prices are
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
  optional `minimumAcceptableFraction`, `paymentTermsDays`, and candidate
  `listingIds`.
- Response: order ID, buyer ID, requested/committed/accepted quantities, the
  buyer's `minimumAcceptableFraction`, lifecycle status, risk overlay,
  timestamps, optional `cropStandardId`, and `outcomeCause`/`outcomeNote` once
  matching has run.
- `minimumAcceptableFraction` is the smallest share of `requestedQuantity` the
  buyer will accept as a commitment. It is a number from 0.5 to 1 and defaults
  to `0.8`. That default is **stakeholder-calibrated**, from hotel buyer
  feedback that a hotel routinely takes part of an order and sources the
  remainder elsewhere rather than lose the delivery; the simulation's buyer
  personas independently sit at 0.8 to 0.9. A value outside 0.5 to 1 fails with
  `INVALID_ACCEPTANCE_THRESHOLD`.
- `committedQuantity` is what approval actually reserved. It is `0` until an
  allocation is approved and below `requestedQuantity` on a safe partial
  commitment.
- `paymentTermsDays` is the number of days after a delivery is accepted that
  the buyer has to pay. It is a whole number from 0 to 90 and defaults to `14`.
  That default is **stakeholder-calibrated**, from farmer feedback that hotels
  currently take one, two, or more months to pay, which is what limits farm
  cash flow. A value outside 0 to 90 fails with `INVALID_PAYMENT_TERMS`.
  Harvest records the term and derives the resulting status; it never moves
  money, holds funds, or verifies a transfer.
- Product state/event: store `REQUESTED`, start matching, and emit
  `ORDER_REQUESTED`. Creation does not reserve stock. An order whose safe cover
  falls below `minimumAcceptableFraction` stays `REQUESTED` with `outcomeCause`
  `NO_READY_SUPPLY` or `INSUFFICIENT_SUPPLY` and is re-matched automatically
  when a later listing of the same crop is published. When a published crop
  standard exists, creation records the newest published version for that crop
  in `cropStandardId`; later standard versions do not rewrite the order.
- Simulation effect: mark buyer demand pending and schedule matching/actor
  reactions.
- Consumers: buyer marketplace and order timeline.
- Rules/failures: duplicate business intent with the same key returns the same
  order; inaccessible listings, invalid quantity/date, or identity fields fail.

#### `GET /v1/orders`

- Callers: the buyer, participating farmers, and authorised coordinators.
- Request: optional lifecycle status, risk overlay, cursor, and limit filters.
- Response: a role-filtered order page using the same lifecycle and payment
  representation as order detail.
- Product state/event and simulation effect: none.
- Consumers: buyer, farmer, and coordinator order lists, and the crop-batch
  journey view.
- Rules/failures: the optional `cropBatchId` filter narrows the caller's already
  visible orders to those whose allocation commits that batch. It never widens
  visibility and never discloses private farm coordinates.

#### `GET /v1/orders/{orderId}`

- Callers: participating buyer/farm/transporter when relevant; authorised
  coordinator/operations/admin.
- Request: order UUID.
- Response: requested/committed/accepted quantities, the buyer's
  `minimumAcceptableFraction`, `paymentTermsDays` and the derived `payment`
  record, deadline, lifecycle status, optional `cropStandardId`, `atRisk`,
  active exception IDs, timestamps, safe allocation, approval totals and the
  caller's approval,
  trace ID, related enriched delivery mission, immutable delivery acceptance when
  recorded (including its `reasonCode`/`nextAction` and any per-line reasons, so
  the affected farmer reads the same explanation the buyer recorded), and
  `outcomeCause`/`outcomeNote` (the latest recorded reason the
  order is not fulfilled: `NO_READY_SUPPLY`, `INSUFFICIENT_SUPPLY`,
  `SUPPLY_CHANGED`, `APPROVAL_REJECTED`, `DELIVERY_REJECTED`, `CANCELLED`).
  The mission view includes role-safe route labels and only the crop batches
  allocated to this order.
  Private farm coordinates are not exposed here.
- `payment` is present once an approved commitment prices the order and absent
  before then, because nothing is owed until supply is reserved. It carries
  `status`, `amount`, `dueAt`, `paidAt`, `reference`, and `daysOutstanding`.
- `payment.status` is derived on every read rather than stored, so no scheduled
  job can leave a stale status behind: `PAID` when a confirmation was recorded;
  otherwise `NOT_DUE` before the delivery is accepted or while the term is
  still running, `DUE` on the day the term expires, and `OVERDUE` on any later
  day. `dueAt` is `deliveryAcceptance.acceptedAt` plus `paymentTermsDays`;
  `daysOutstanding` counts whole days from acceptance to payment, or to now
  while the order is unpaid.
- `payment.amount` is the committed line quantity multiplied by that line's
  listing price at commitment, recomputed on the accepted quantities when the
  delivery outcome is recorded. Rejected produce is not billed.
- Product state/event: none.
- Simulation effect: none.
- Consumers: buyer/farmer order status and coordinator order detail.
- Rules/failures: role-filter sensitive farm, buyer, route, and location data.

#### `POST /v1/orders/{orderId}/payment-confirmations`

- Callers: the order's buyer, an authorised coordinator, or admin.
- Request: optional `reference` of at most 120 characters, the buyer's own
  reference for the transfer it made outside Harvest.
- Response: `orderId` and the resulting `payment` record with status `PAID`.
- Product state/event: store `paidAt` and `paymentReference`, append an outcome
  trace step, and emit `PAYMENT_CONFIRMED`. Nothing else changes.
- Simulation effect: none. The event records settlement evidence and mutates no
  world state.
- Consumers: buyer payment list, farmer money-owed summary, coordinator overdue
  count, order payment card.
- Rules/failures: the order must be `FULFILLED` or `PARTIALLY_FULFILLED`, else
  `PAYMENT_NOT_PAYABLE`; an order that already carries a payment fails with
  `PAYMENT_ALREADY_CONFIRMED`; an order the caller cannot see is `404`. Replay
  with the same `Idempotency-Key` and body returns the first response.
- **Harvest does not move money.** This operation records the buyer's own
  statement that it paid. Harvest holds no funds, initiates no transfer, and
  verifies nothing with any financial institution.

### Approvals and delivery

#### `GET /v1/approvals`

- Callers: the actor named in `requestedFromActorId`; coordinators see only
  approvals explicitly targeted to them.
- Request: optional status, subject type, cursor, and limit filters.
- Response: pending or decided approvals with request time and role-safe
  context. Farmers see only their committed line quantity; buyers see their
  order total; each sees the estimated price for those visible lines;
  coordinators see the concrete recovery summary. An allocation context also
  carries `coverage` (requested and proposed quantities, `coverageFraction`,
  and a `partial` flag) and states "covers X of Y kg (Z%)" in its summary, so
  nobody approves a partial commitment believing the whole order is covered.
  Decision identity, time, and reason appear only after a final human decision.
- Product state/event and simulation effect: none.
- Consumers: focused farmer, buyer, and coordinator decision cards.

#### `POST /v1/approvals/{approvalId}/decisions`

- Callers: the named human approver for the pending subject; admin only through
  an explicitly audited override.
- Request: `decision` (`APPROVE`/`REJECT`) and optional `reason`. A `REJECT`
  must also carry `reasonCode` (`QUANTITY_MISMATCH`, `MATURITY_OR_QUALITY`, `DAMAGE`, `CLEANLINESS`,
  `SIZE_OR_GRADE`, `MISSING_INFORMATION`, or `OTHER`) and a `nextAction` of 1-300
  characters saying what the affected participant should do next. A request
  that omits either fails with `422 DECISION_REASON_REQUIRED` and records no
  decision.
- Response: approval subject, final status, decider, time, and the recorded
  `reasonCode`/`nextAction` when present.
- Product state/event: record one final decision. An allocation creates one
  targeted approval for its buyer and one for every participating farmer. No
  reservation, commitment, or mission exists until all remain valid and every
  required actor approves. The final approval atomically creates reservations
  and the mission and emits `APPROVAL_DECIDED` and `ALLOCATION_APPROVED`. The
  order's `committedQuantity` and the mission quantity are the sum of the
  approved allocation lines, which is below `requestedQuantity` on a safe
  partial commitment. If aggregate ATP or listing supply changed, invalidate
  the proposal with `ALLOCATION_INVALIDATED`, return the order to `REQUESTED`,
  and create no partial reservation. That invalidation rule is unchanged: a
  proposal that fails revalidation still reserves nothing at all. Any rejection
  marks the
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
- Response: visible mission page with route stops, safe farm/buyer labels,
  order crop and risk, allocated cargo, quantity, deadline, assignment/status,
  estimated distance/duration/arrival, and `pageInfo`. Crop status is withheld
  from an available job until that transporter accepts it.
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
  ordered labelled stops, order crop/risk, buyer name, and allocated cargo.
  Buyers see crop status only for batches committed to their own order;
  transporters see it only after assignment.
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
  `REQUEST_CHANGES` must also carry `reasonCode` (`QUANTITY_MISMATCH`, `MATURITY_OR_QUALITY`, `DAMAGE`, `CLEANLINESS`,
  `SIZE_OR_GRADE`, `MISSING_INFORMATION`, or `OTHER`) and a `nextAction`
  of 1-300 characters; without both the request fails with
  `422 DECISION_REASON_REQUIRED` and the task stays `OPEN`.
- Product state/event: finalise the task, store the structured reason, and emit
  `VERIFICATION_DECIDED` with the additive `reasonCode`/`nextAction` fields. The
  reason is surfaced to the owning farmer as the batch's `latestDecision`.
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
  outcome for every committed crop batch, and optional note. Whenever any
  quantity is rejected, the request must also carry `reasonCode` (`QUANTITY_MISMATCH`, `MATURITY_OR_QUALITY`, `DAMAGE`, `CLEANLINESS`,
  `SIZE_OR_GRADE`, `MISSING_INFORMATION`, or `OTHER`) and
  a `nextAction` of 1-300 characters. Both may be given once on the acceptance
  and apply to every rejected line, or per line for a batch-specific reason; a
  per-line value overrides the shared one. Any rejected line left without both
  fields fails with `422 DECISION_REASON_REQUIRED` and stores nothing.
- Response: delivery/order IDs, outcome/quantities, accepter, time, the stored
  `reasonCode`/`nextAction`, and the per-line reasons inside `lineOutcomes`.
- Product state/event: record immutable actual outcome with its structured
  reasons and emit `DELIVERY_ACCEPTED` carrying the additive
  `reasonCode`/`nextAction` fields; then atomically derive one of `ORDER_FULFILLED`,
  `ORDER_PARTIALLY_FULFILLED`, or `ORDER_REJECTED` and release unused
  reservations. Accepted and rejected quantities are measured against the
  mission quantity, which is the committed quantity. A fully accepted delivery
  against a partial commitment derives `ORDER_PARTIALLY_FULFILLED` with
  `outcomeCause` `INSUFFICIENT_SUPPLY`, because the shortfall came from supply
  and not from produce being refused on arrival. `releasedReservationQuantity`
  is what was reserved and not accepted. The order's payment amount is
  recomputed here on the accepted quantities at their committed listing prices,
  and the payment term starts from this acceptance time.
- Simulation effect: record actual farmer/transporter economics and model
  evaluation data. Each crop line updates its latest prediction's accepted
  actual quantity and absolute error. Fulfilment satisfies demand and ends remaining order tasks;
  partial/rejected outcomes schedule unmet-demand/import/substitution fallback.
- Consumers: buyer receipt, farmer outcome/revenue, trust, benchmark, Model Lab.
- Rules/failures: quantities must use one unit, be non-negative, sum to the
  delivered amount, and match outcome; produce rejection requires approval and
  an actionable reason. The affected farmer reads the recorded reason as the
  crop batch's `latestDecision`.

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
  approved commitment count, completed mission count, and `paymentOverdueCount`.
- `paymentOverdueCount` counts visible orders whose payment term has expired
  with nothing recorded as paid, using the same derivation as the order reads.
  An order with no delivery acceptance is never counted, however late it is,
  because the term only starts when produce is accepted. The field is additive,
  so a saved projection from before payment tracking still replays without it.
- Outcome rules: `FULFILLED` and `PARTIALLY_FULFILLED` retain those outcomes;
  rejected/cancelled orders and incomplete orders at or past `neededBy` are
  unfulfilled; other incomplete orders are pending. Every visible order is in
  exactly one category. `orderOutcomes.causes` counts one cause per
  unfulfilled or partially fulfilled order: the recorded `outcomeCause` when
  present, otherwise the state the order ran out of time in
  (`AWAITING_APPROVAL` → `APPROVAL_TIMEOUT`, `COMMITTED`/`IN_DELIVERY` →
  `MISSION_LATE`, `REQUESTED` → `NO_READY_SUPPLY`). In a run-scoped snapshot,
  an incomplete order whose `neededBy` falls after the scenario horizon is
  counted as unfulfilled with cause `HORIZON_TRUNCATED` once the horizon has
  passed. Before then it stays pending, because it could still be delivered
  early. The horizon is the scenario's own start instant plus its duration, so
  it is available while a run is still executing.
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

#### `GET /v1/weather`

- Callers: every product role, human or simulated. Deliberately unfiltered by
  role: the point of issue #37 is that a farmer, a coordinator, a transporter
  and any simulated actor plan from the *same* conditions and the same
  forecast, so a role-narrowed answer would defeat the feature. The payload
  carries no operational state, so there is nothing to filter.
- Request: optional `islandId` (defaults to `saint-lucia`), optional `asOf`
  calendar date, optional `simulationRunId`.
- Response: `current`, the realised reading for a day that has already
  occurred, labelled `SYNTHETIC`; and `forecast`, up to five days ahead,
  labelled `MODEL_PREDICTED`. Each forecast day carries `leadDays` and a
  `confidence` that decays with lead time.
- **Realised weather for a day that has not occurred is never written**, so no
  query against this endpoint can return it. `asOf` past the last recorded day
  returns that day rather than an error or an invented one, which keeps a
  client asking for "today" working inside a completed replay without giving it
  a way to probe the horizon. An `asOf` before the run returns the newest
  recorded day at or before it, with the forecast that day issued.
- The forecast is deliberately imperfect: a noised model of the realised series
  whose error grows with the square root of lead time. It misses storms and
  predicts storms that never arrive, and the simulation tests assert both.
  Nothing in it changes crop biology; it changes only what a participant or a
  policy decides to do.
- Product state/event: none. This is a read.
- Simulation effect: none. The connected simulation *writes* here as each day
  occurs, from the same frame the replay saves, so the website and a simulated
  participant read one series rather than two that agree until they do not.
- Consumers: farmer workspace weather panel, coordinator island table, the
  `read_weather` agent tool, and the control-room masthead.
- Rules/failures: a run-scoped actor is forced to its own run and gets `403`
  `RUN_SCOPE_FORBIDDEN` for another; only operations/admin may name a run. A
  malformed `asOf` returns `422` `INVALID_WEATHER_DATE`. An island with no
  recorded day returns an empty forecast and no `current` rather than inventing
  weather. No live weather service is contacted, by demo and test requirement.

#### Scoped inter-island trade (#40)

Produce may move between islands the run selected, and only over connections a
reviewed offline dataset records. Four endpoints, and the split between them is
the point: a *commitment* is a promise that opens a human approval gate, and a
*shipment* is the movement that may only exist once that gate is clear.

The reference data is
[`simulation/data/caribbean-maritime-network.v1.json`](../simulation/data/caribbean-maritime-network.v1.json),
with sources, licences and retrieval dates in
[`README-maritime.md`](../simulation/data/README-maritime.md). **A listed port
or link is evidence that public infrastructure or a scheduled passenger service
exists. It is never evidence that a produce-trading service, timetable,
capacity, cost or price exists on that route.** Capacity, freight price, customs
behaviour, failure and every operational outcome are SYNTHETIC.

#### `GET /v1/maritime-network`

- Callers: every product role.
- Request: `islandIds`, a comma-separated list of manifest island ids.
- Response: ports, published links and fixed offline exchange rates restricted
  to those islands, each carrying `reference` with source, publisher, licence,
  retrieval date and `evidenceType: PUBLIC_REFERENCE`, plus a `disclaimer`.
- A link survives only when *both* of its ports are on islands in the request,
  so one island returns no links at all and two islands can never see a third
  island's port. Nothing is chained: two links that meet at a shared island are
  not offered as one through-service, because no source publishes one.
- Product state/event: none. This is a read of offline reference data.
- Rules/failures: an island the manifest does not carry returns `422`
  `UNKNOWN_ISLAND`. No live vessel or exchange-rate service is called, during a
  run or a replay.

#### `POST /v1/inter-island-commitments`

- Callers: coordinator, operations, admin. A buyer or farmer *approves* one of
  these; neither proposes one on the other's behalf.
- Request: `orderId`, `originIslandId`, `destinationIslandId`, `linkId` and
  per-batch `lines`. `destinationIslandId` is stated rather than derived,
  because an order carries a delivery point and not a manifest island id.
- Response: `InterIslandCommitment` in `PROPOSED` with `boundAt: null`, its
  route citation, its quantity, its synthetic cost in the destination island's
  currency and in XCD, and an `approvalSummary`.
- Product state/event: creates the commitment and one `INTER_ISLAND_COMMITMENT`
  approval per counterparty (the buyer, and every grower whose crop it
  commits), and emits `INTER_ISLAND_COMMITMENT_PROPOSED`. Nothing is reserved
  and nobody is bound.
- Rules/failures: a link that is not a published connection between those two
  islands returns `422` `UNKNOWN_MARITIME_ROUTE`; a pair with no published
  connection at all returns `422` `NO_PUBLIC_ROUTE` rather than an invented
  route; a consignment above the synthetic per-sailing allowance returns `422`
  `SAILING_CAPACITY_EXCEEDED`.

#### `POST /v1/approvals/{approvalId}/decisions` on an inter-island subject

- The ordinary approval endpoint. `subjectType` is `INTER_ISLAND_COMMITMENT`,
  which `AGENTS.md` already lists among the decisions requiring human approval.
- The commitment becomes `APPROVED` and gains a `boundAt` only when the **last**
  pending approval is granted, and emits `INTER_ISLAND_COMMITMENT_APPROVED`
  then. One participant agreeing does not commit the others.
- A rejection marks the commitment `REJECTED`, cancels every other pending
  approval on it, and no sailing can ever be booked against it.

#### `POST /v1/inter-island-commitments/{commitmentId}/shipments`

- Callers: coordinator, operations, admin.
- Request: the three legs (local pickup, sea, local delivery), the synthetic
  customs checkpoint, the scheduled departure and arrival, and optionally the
  capacity, load and the simulation shipment id the record stands for.
- Response: `MaritimeShipment` in `SCHEDULED`, carrying both provenance labels:
  `networkProvenance: PUBLIC_REFERENCE` for the ports, link and rate, and
  `operationsProvenance: SYNTHETIC` for the schedule, capacity, price, customs
  behaviour and outcome.
- Product state/event: creates the shipment, moves the commitment to `SHIPPED`,
  and emits `MARITIME_SHIPMENT_SCHEDULED`.
- Rules/failures: **`409` `INTER_ISLAND_APPROVAL_REQUIRED` while any approval on
  the commitment is still pending or has been rejected.** This is the
  enforcement point for "an inter-island commitment cannot bypass required human
  approval": before the gate clears there is no row to bind anybody. A customs
  block without its `disclaimer` returns `422`
  `CUSTOMS_DISCLAIMER_REQUIRED` — a checkpoint record that travels without the
  sentence saying it is not a legal customs model can be mistaken for one.

#### `POST /v1/maritime-shipments/{shipmentId}/updates`

- Callers: transporter, coordinator, operations, admin.
- Records sailing, weather delay, clearance, arrival, delivery or failure, all
  taken from the physical simulation. There is no vessel tracker behind it.
- Rules/failures: a status may only move forward (`409`
  `SHIPMENT_STATUS_REGRESSION`) and `FAILED` is terminal (`409`
  `SHIPMENT_TERMINAL`), so a late or duplicated update cannot resurrect a lost
  sailing or rewind a delivered one.

#### `GET /v1/inter-island-commitments`, `GET /v1/maritime-shipments`

- Role-filtered reads. A cross-island order has no local allocation line, so
  order visibility for a farmer or coordinator also follows the commitment's own
  lines: the grower whose crop it commits and the coordinator who proposed it
  can see it, and nobody else gains access they did not already have.
- `GET /v1/orders/{orderId}` carries `interIslandCommitment` and
  `maritimeShipment` when they exist. Both fields are additive; an order that
  never left its island is exactly the shape it was before.

#### The synthetic customs checkpoint

`CustomsCheckpoint` is a documentation check with a seeded inspection delay and
a fixed cost line. **It is not a legal customs model.** It encodes no tariff
schedule, no phytosanitary rule, no CARICOM instrument and no territory's actual
procedure, and every instance carries a `disclaimer` saying so, so the caveat
travels with the data rather than living only in a README.

#### Currency

Every cross-island price is stated twice: in the destination island's own
currency and in XCD, with `unitsPerComparisonCurrency` and `rateAsOf` naming the
fixed offline rate that connects them. The rate is `PUBLIC_REFERENCE`; the
amount it converts is `SYNTHETIC`. No live financial API is called during a run
or a replay.

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
  optional `estimationMode`, island scope and optional deterministic
  disruptions. A derived request sends only a completed `derivedFromRunId` and
  one or more additional disruptions; it inherits the estimation method with
  the rest of its immutable inputs.
- Response: completed saved-run metadata, metrics, frame/decision counts and
  explicit synthetic evidence labels.
- Product state/event: store `CREATING`, execute the whole run synchronously,
  validate the observable artefact for hidden-truth leakage, then store
  `COMPLETED` or `FAILED`.
- Simulation effect: initialise and execute from scenario/seed. A derived run
  inherits immutable inputs and never edits its source.
- Consumers: 3D control room and benchmark setup.
- Rules/failures: seed/scenario/policy/scope/estimation mode are immutable.
  `estimationMode` is `LEARNED_MODEL` or `DETERMINISTIC_FALLBACK`; anything
  else returns `422 INVALID_ESTIMATION_MODE` and an omitted field selects
  `DETERMINISTIC_FALLBACK`. A `HARVEST` run that selected `LEARNED_MODEL`
  fails as `FAILED` with `MODEL_UNAVAILABLE` and returns `502` the moment the
  learned service is unreachable or rejects a request, so no run mixes learned
  and fallback forecasts. `BASELINE` records the choice and never uses it.
  `LLM_ASSISTED`
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

#### `GET /v1/world-map`

- Callers: every authenticated Product API role.
- Response: role-filtered farm and hotel locations with safe crop summaries or
  actionable open demand where the caller is allowed to see it.
- Product state/simulation effect: none; this is a read-only projection.
- Consumers: the website island world and its farm/hotel zoom views.
- Rules/failures: exact private coordinates, unrelated crop progress and private
  orders are omitted. Website marker placement is deterministic but explicitly
  illustrative; new accessible farms and hotels appear without UI changes.

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
| Farmer website | Owned crop batches, prediction, participating orders and missions, money owed for accepted deliveries | Crop observation, forecast request, safe listing, own approval decision | Crop/forecast/listing/allocation/order/delivery/payment outcomes |
| Buyer website | Listings, owned demand/orders, relevant approval and delivery, payments due | Buyer demand, order, own approval decision, delivery acceptance, payment confirmation | Demand/allocation/mission/delivery/order/payment outcomes |
| Transporter website | Available and assigned mission detail | Mission acceptance, delivery updates, exception | Mission/update/exception/recovery/order outcome |
| Coordinator website | Permitted crops, relevant orders, targeted approvals and exceptions, overdue payment count | Approval decision, verified update, exception escalation, payment confirmation on a permitted order | Scoped operational events |
| 3D control room | Saved runs, timelines, individual frames, participants and snapshots | Create run, derived run or paired run; open replay participant | Run-scoped operational events |
| Future benchmark view | Paired-run status/result | Create paired run | Benchmark result and run progress |
| Future trace/evidence view | Agent trace and relevant entity detail | None | Trace-linked events |
| Harvest simulated farmer | Same crop/listing/approval operations as farmer | Same request bodies as farmer | Run-scoped events |
| Harvest simulated buyer | Same listing/demand/order/acceptance/payment operations as buyer | Same request bodies as buyer | Run-scoped events |
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
| Inter-island proposed / `INTER_ISLAND_COMMITMENT_PROPOSED` | Stores a non-binding cross-island promise and one approval per counterparty; nothing reserved | Records the proposal only; no commitment, mission or shipment exists yet | Order page shows the route, the cost in both currencies, and that nothing ships until every approval lands |
| Inter-island approved / `INTER_ISLAND_COMMITMENT_APPROVED` | Sets `boundAt` once the last approval is granted; the commitment may now be booked | Creates the physical commitment and books the sailing; this is the only route by which a connected run puts produce on a boat | Order page shows the commitment as binding |
| Sailing scheduled / `MARITIME_SHIPMENT_SCHEDULED` | Stores the consignment, its three legs and its synthetic customs checkpoint | Schedules departure, the sea leg, the checkpoint and delivery | Control room draws the sea route and a vessel; order page lists the legs |
| Payment confirmed / `PAYMENT_CONFIRMED` | Stores `paidAt` and the buyer's reference; no other state changes | None; the payload is settlement evidence only | Farmer money-owed total drops and the order shows paid |

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

Payment status is not a lifecycle status either. It is derived from the
delivery acceptance time plus the order's `paymentTermsDays` on every read, and
only `paidAt` is stored. Harvest tracks payment terms and status so a farmer
can see what a hotel owes and how long it has been outstanding; it does not
move money, hold funds, or verify a transfer.

Matching proposes an allocation once safe cover reaches the order's
`minimumAcceptableFraction`, so a commitment may be for less than the requested
quantity. Everything downstream then measures against `committedQuantity`: the
mission carries it, delivery acceptance sums to it, and a fully accepted
partial commitment ends `PARTIALLY_FULFILLED` rather than `FULFILLED`.

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

A synthetic buyer places its orders on 7-day payment terms and then records
paying its own accepted delivery a fixed ten simulated days later, in sorted
order-ID order so the run stays deterministic. Both numbers are
**stakeholder-calibrated** and scaled to the 21-day scenario: hotels quote
short terms and pay in one to two months, a gap no 21-day window can contain,
so 7 against 10 preserves "paid late" at demonstration scale. A delivered
simulated order therefore falls due on day 7, reads as overdue from day 8, and
is settled on day 10 unless the run window closes first. Real buyers keep the
Product API's 14-day default. Baseline runs never call the operation, and
replay reads saved frames rather than repeating it.

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

Harvest estimates come from one of two methods, chosen per simulation run and
never by a global runtime switch. `LEARNED_MODEL` calls the FastAPI quantile
service; `DETERMINISTIC_FALLBACK` uses the rule-based fixture, which stamps a
`fixture-` model version and a leading `Deterministic fallback estimate, not a
learned-model prediction` warning on every forecast it writes. A crop batch
that belongs to a run inherits that run's stored `estimationMode`, so two runs
executing at once can use different methods; a real participant's batch has no
run and keeps the server's `MODEL_ADAPTER` configuration. Replay reads saved
predictions and provenance and never requests a new one.

When the learned method applies, the Product API alone calls
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
IDs, and provenance. It then calculates—not the model—safe orderable supply.
Available-to-promise is `0` while the crop batch is `PLANNED` or `GROWING`;
the forecast stays visible as evidence, but only a batch whose latest
observation reports `HARVEST_READY` or `HARVESTED` can be promised or listed,
and a later observation that leaves readiness withdraws its active listings:

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
