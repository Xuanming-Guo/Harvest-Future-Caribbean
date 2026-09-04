# Event catalogue

The Product API commits operational state and the matching outbox event in one
database transaction. Events are immutable. Consumers deduplicate `eventId`,
resume SSE from `Last-Event-ID`, and use `correlationId` plus `causationId` to
avoid feedback loops. The canonical envelope and payload validation live in
[`event-envelope.schema.json`](event-envelope.schema.json).

Hidden simulation truth is never a payload field. Simulation-originated events
contain only facts that actors or the Harvest system could observe at that
simulation time.

During a synchronous connected run, the in-process adapter consumes the same
ordered event records that SSE would expose. `ALLOCATION_APPROVED`,
`DELIVERY_MISSION_ACCEPTED`, `RECOVERY_APPROVED` and `DELIVERY_ACCEPTED` alter
only future physical commitments, schedules or outcomes. Delivery updates that
were themselves caused by a physical departure/arrival are consumed as echoes
and never advance the engine twice. Product UUIDs are dedupe/correlation keys,
not seeded physical-world identifiers.

The schema's `x-harvest-event-examples` extension contains one complete,
schema-validated envelope for every event type below.

| Event type | Emitted after | Payload | Simulation reaction |
|---|---|---|---|
| `CROP_OBSERVATION_INTAKE_DRAFTED` | Text or a supplied transcript is extracted into a non-binding draft | intake, crop batch, source type, prompt version, adapter | No world mutation; wait for the actor to review and submit structured fields |
| `CROP_OBSERVATION_SUBMITTED` | A crop observation is stored | observation, crop batch, observation time, stage | Complete the actor's observation task; never alter hidden crop truth |
| `VERIFICATION_TASK_CREATED` | An observation creates explicit coordinator work | task, crop batch, observation, `OPEN` status | Schedule the permitted coordinator's observable verification action |
| `VERIFICATION_DECIDED` | A coordinator verifies an observation or requests changes | task, crop batch, observation, final status, optional note, and for `CHANGES_REQUESTED` the required `reasonCode` and `nextAction` | Complete the verification action; never alter hidden crop truth |
| `FORECAST_PRODUCED` | A model response is validated and ATP is calculated | prediction, crop batch, q10 yield, ATP, the date that ATP can be handed over | Record the prediction for later predicted-versus-actual comparison |
| `LISTING_PUBLISHED` | Safely orderable supply is published | listing, batch, quantity, availability date | Make the listing discoverable during later buyer actions |
| `LISTING_EXPIRED` | An active listing's `availableUntil` date has passed | listing, batch, availability end date | Stop offering the listing; no inventory or reservation changes |
| `BUYER_DEMAND_CREATED` | Buyer demand is stored | demand, crop, quantity, deadline | Mark demand pending and schedule eligible actor reactions |
| `ORDER_REQUESTED` | An order is created | order, crop, requested quantity, `REQUESTED` | Mark the buyer's order pending and schedule matching |
| `ALLOCATION_PROPOSED` | A non-binding multi-farm allocation is saved | allocation, order, batch quantities, coverage fraction of the requested quantity | Schedule the relevant approval actions |
| `APPROVAL_DECIDED` | A person approves or rejects an allocation or recovery | approval, subject, decision, and for `REJECT` the required `reasonCode` and `nextAction` | Complete only that actor's approval task; never infer other approvals |
| `ALLOCATION_INVALIDATED` | Final validation detects changed safe supply | allocation, order, `SUPPLY_CHANGED`, `STALE` | Cancel the proposal without creating partial reservations and leave demand open |
| `ALLOCATION_APPROVED` | Final approval creates reservations and commitment | allocation, order, batch quantities | Schedule harvest/pickup obligations and reduce planned uncommitted supply only |
| `DELIVERY_MISSION_CREATED` | A committed order receives a route | mission, order, status, quantity-bearing stops, route estimates and the instant the load is collectable | Add an available mission to transporter schedules |
| `DELIVERY_MISSION_ACCEPTED` | A transporter accepts a mission | mission, order, assignee, stops | Reserve the vehicle and schedule its pickup work |
| `DELIVERY_UPDATE_POSTED` | Pickup, position, delay, arrival, or delivery is recorded | mission, update type, time, optional location/note | Advance vehicle position and dependent schedules |
| `EXCEPTION_REPORTED` | An operational exception is stored | exception type, severity, affected entities | Expose/apply the observable disruption and pause affected future work where appropriate |
| `RECOVERY_PROPOSED` | Deterministic recovery code stores a concrete action for approval | exception, approval, action, mission, before/after deadline | Schedule the permitted coordinator approval; do not apply the change yet |
| `RECOVERY_APPROVED` | A human approves a recovery proposal | exception, approval, action, and concrete changed mission/deadline when applicable | Deterministically apply only the stored reroute, reschedule, substitute, reallocate, or cancellation |
| `DELIVERY_ACCEPTED` | Buyer records accepted and rejected quantities | delivery, order, totals, per-crop-batch outcomes, outcome, and whenever any quantity is rejected the required `reasonCode` and `nextAction` (acceptance level and on each rejected line) | Record actual outcome and economics for model/benchmark evaluation |
| `ORDER_FULFILLED` | Accepted quantity completes the commitment | order, final status, accepted and released quantities | Satisfy demand, end remaining order tasks, and record procurement/fulfilment metrics |
| `ORDER_PARTIALLY_FULFILLED` | Some committed quantity is accepted | order, final status, accepted and released quantities | Schedule unmet-demand handling or import/substitution fallback |
| `ORDER_REJECTED` | No delivered quantity is accepted | order, final status, zero accepted and released quantities | Schedule fallback and record rejection economics |
| `ORDER_CANCELLED` | An approved cancellation releases active work | order, final status, accepted and released quantities | Cancel future pickups and return actors/vehicles to availability |
| `PAYMENT_CONFIRMED` | A buyer or coordinator records that the buyer paid a delivered order outside Harvest | order, paid time, agreed term, optional due time, amount, reference, days outstanding | No world mutation; records settlement evidence |
| `SIMULATION_ACTOR_MOVED` | The simulation reports an observable position | actor and position | Update the observable world/control-room projection only |
| `SIMULATION_DISRUPTION_OBSERVED` | A disruption becomes observable | type, affected entities, time, description | Start the corresponding visible exception/reaction path; do not publish hidden severity/outcome |
| `SIMULATION_TASK_COMPLETED` | A scheduled observable actor task ends | task, type, actor, completion time | Update the observable world and run timeline |
| `BENCHMARK_RESULT_RECORDED` | Both runs in a pair finish | pair/run IDs and aggregate metrics | No world mutation; update benchmark projections |

## Compatibility

- Event names and payload fields are additive only within schema version `1.x`.
- A breaking rename, removal, semantic change, or unit change requires a new
  schema major version and coordinated updates to contracts and consumers.
- Consumers must ignore an event version they cannot validate and surface an
  operational error; they must not guess at its meaning.
