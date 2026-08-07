# Event catalogue

The Product API commits operational state and the matching outbox event in one
database transaction. Events are immutable. Consumers deduplicate `eventId`,
resume SSE from `Last-Event-ID`, and use `correlationId` plus `causationId` to
avoid feedback loops. The canonical envelope and payload validation live in
[`event-envelope.schema.json`](event-envelope.schema.json).

Hidden simulation truth is never a payload field. Simulation-originated events
contain only facts that actors or the Harvest system could observe at that
simulation time.

The schema's `x-harvest-event-examples` extension contains one complete,
schema-validated envelope for every event type below.

| Event type | Emitted after | Payload | Simulation reaction |
|---|---|---|---|
| `CROP_OBSERVATION_SUBMITTED` | A crop observation is stored | observation, crop batch, observation time, stage | Complete the actor's observation task; never alter hidden crop truth |
| `VERIFICATION_TASK_CREATED` | An observation creates explicit coordinator work | task, crop batch, observation, `OPEN` status | Schedule the permitted coordinator's observable verification action |
| `VERIFICATION_DECIDED` | A coordinator verifies an observation or requests changes | task, crop batch, observation, final status, optional note | Complete the verification action; never alter hidden crop truth |
| `FORECAST_PRODUCED` | A model response is validated and ATP is calculated | prediction, crop batch, q10 yield, ATP | Record the prediction for later predicted-versus-actual comparison |
| `LISTING_PUBLISHED` | Safely orderable supply is published | listing, batch, quantity, availability date | Make the listing discoverable during later buyer actions |
| `BUYER_DEMAND_CREATED` | Buyer demand is stored | demand, crop, quantity, deadline | Mark demand pending and schedule eligible actor reactions |
| `ORDER_REQUESTED` | An order is created | order, crop, requested quantity, `REQUESTED` | Mark the buyer's order pending and schedule matching |
| `ALLOCATION_PROPOSED` | A non-binding multi-farm allocation is saved | allocation, order, batch quantities | Schedule the relevant approval actions |
| `ALLOCATION_APPROVED` | Final approval creates reservations and commitment | allocation, order, batch quantities | Schedule harvest/pickup obligations and reduce planned uncommitted supply only |
| `DELIVERY_MISSION_CREATED` | A committed order receives a route | mission, order, status, stops | Add an available mission to transporter schedules |
| `DELIVERY_MISSION_ACCEPTED` | A transporter accepts a mission | mission, order, assignee, stops | Reserve the vehicle and schedule its pickup work |
| `DELIVERY_UPDATE_POSTED` | Pickup, position, delay, arrival, or delivery is recorded | mission, update type, time, optional location/note | Advance vehicle position and dependent schedules |
| `EXCEPTION_REPORTED` | An operational exception is stored | exception type, severity, affected entities | Expose/apply the observable disruption and pause affected future work where appropriate |
| `RECOVERY_APPROVED` | A human approves a recovery proposal | exception, approval, action, and concrete changed mission/deadline when applicable | Deterministically apply only the stored reroute, reschedule, substitute, reallocate, or cancellation |
| `DELIVERY_ACCEPTED` | Buyer records accepted and rejected quantities | delivery, order, totals, per-crop-batch outcomes, outcome | Record actual outcome and economics for model/benchmark evaluation |
| `ORDER_FULFILLED` | Accepted quantity completes the commitment | order, final status, accepted and released quantities | Satisfy demand, end remaining order tasks, and record procurement/fulfilment metrics |
| `ORDER_PARTIALLY_FULFILLED` | Some committed quantity is accepted | order, final status, accepted and released quantities | Schedule unmet-demand handling or import/substitution fallback |
| `ORDER_REJECTED` | No delivered quantity is accepted | order, final status, zero accepted and released quantities | Schedule fallback and record rejection economics |
| `ORDER_CANCELLED` | An approved cancellation releases active work | order, final status, accepted and released quantities | Cancel future pickups and return actors/vehicles to availability |
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
