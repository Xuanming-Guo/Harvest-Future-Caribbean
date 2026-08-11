# Architecture

Harvest is one instrumented workflow presented through separate, purpose-built
interfaces. All components communicate through documented contracts.

## System flow

```text
Farmer / buyer / transporter / coordinator website (port 3000)
Future mobile app                         Future simulated actors
                       \                   /
                        v                 v
                         Product API (3001)
                         /               \
                        v                 v
            Operational PostgreSQL      Model service

Future simulation engine <-> future simulation/control-room website (3002)
          |                         map, benchmark and technical evidence
          +------ documented Product API and event contracts only --------+
```

## Ownership

### Product API

The Product API owns user-visible operational state, including:

- farms and permissions;
- crop batches and observations;
- marketplace listings and buyer demand;
- orders, reservations, and allocations;
- approvals, delivery missions, and exceptions;
- transporter vehicles and coordinator verification tasks;
- traceability and accepted operational outcomes.

Website, mobile, and simulated users call this API. They do not access its
database directly.

The product website is role-facing. It contains crop, marketplace, order,
delivery and coordination-task journeys, not a global operations console.
Resource-level Fastify checks remain authoritative even when the browser also
guards routes.

### Simulation

The simulation owns:

- simulation time and event scheduling;
- scenarios, actors, random seeds, and disruptions;
- hidden ground truth for crop condition, yield, readiness, quality, and
  outcomes;
- baseline and Harvest-enabled policy behaviour;
- reproducible paired-run inputs.

It observes Product API results through supported interfaces and never changes
Product API storage directly.

### Model

The model owns:

- satellite, weather, farm, and observation feature preparation;
- training, evaluation, calibration, and inference;
- model versions and generated model artefacts;
- prediction ranges, confidence, and data-quality warnings.

It returns predictions using the model contract. The Product API decides how a
validated prediction affects operational recommendations.

### Contracts

[`contracts/`](../contracts/) defines API, event, and model communication.
Contracts are updated before or with affected implementations so TypeScript and
Python consumers do not drift.

[`api_info.md`](api_info.md) maps each contracted operation to its caller,
Product API state change, emitted event, deterministic simulation effect, and
website/mobile consumer. Implementations must follow both sources together.

## State and events

The intended operational record is an append-only event log linked to current
state. Events support live interfaces, replay, benchmark calculations, agent
traces, and debugging.

Each event carries event, run, actor, entity, trace, correlation, and causation
identifiers; real and optional simulation time; schema version; provenance; and
a typed payload. Exact validation is defined by
[`event-envelope.schema.json`](../contracts/events/event-envelope.schema.json).

Hidden simulation truth must remain separate from observed Product API state.
Agents and models receive only the evidence available to Harvest at that point
in the scenario.

Simulation reactions are deterministic future schedule/world effects defined
in [`api_info.md`](api_info.md) and the
[`event catalogue`](../contracts/events/EVENT_CATALOGUE.md). The simulation
deduplicates by event ID, persists its SSE cursor, and never accesses Product
API storage directly.

## Deterministic and AI responsibilities

Use deterministic, validated code for:

- available-to-promise calculations;
- reservations and state transitions;
- allocation and matching constraints;
- permissions and private-data disclosure;
- routing and metric calculations.

Use AI or learned models for:

- structuring unstructured farmer input;
- supporting yield and readiness prediction;
- explaining complex exceptions and recovery options.

An LLM or model response cannot directly mutate inventory or create a binding
commitment. Outputs must pass schema validation and deterministic rules.

## Human approval

Require explicit approval for commitments, substitutions, price changes,
cancellations, private-location disclosure, disputed reliability changes,
produce rejection, and inter-island commitments.

Agent traces expose concise summaries, evidence, tool calls, confidence,
approvals, and state changes—not private chain-of-thought.

The hackathon coordinator is an in-process typed service inside the Product
API. Human pauses are stored as normal approvals and domain records; there is
no second agent database, background queue, or agent framework. Only
unstructured crop-draft extraction and deterministic recovery explanation use
the provider-neutral text adapter. See
[`agent_workflows.md`](agent_workflows.md) for exact prompts and configuration.

## Data and evidence

Every important input must state whether it is:

- observed;
- inferred;
- synthetic;
- stakeholder-calibrated;
- model-predicted.

Synthetic operational data is acceptable for the hackathon when clearly
labelled. Simulation measures operational and economic behaviour; usability and
adoption claims require real stakeholder testing.

## Local implementation

The hackathon development stack runs PostgreSQL 16 in Docker and runs Fastify
and Next.js directly through npm. Prisma migrations define Product API storage.
A seeded development JWT issuer supplies synthetic role personas; production
configuration accepts Supabase-compatible JWTs instead. The development model
adapter provides deterministic fixture predictions and can later be replaced
by the Python model service through configuration.

`npm run dev` starts PostgreSQL, the Product API on `3001`, and the participant
website on `3000`.

The simulation control room runs separately on `3002` via `npm run control-room`.
It does not touch PostgreSQL or the Product API: it executes the simulation
engine in the browser and replays the recorded frames, because a full run costs
a few milliseconds and a recorded timeline can be scrubbed backwards where a
live engine cannot. `app/control-room/src/lib/run.ts` is the seam at which that
becomes a call to the simulation service in
[`contracts/simulation/openapi.yaml`](../contracts/simulation/openapi.yaml)
once that service exists.

The browser never treats local storage as operational state. Website caches and
navigation state are disposable; PostgreSQL plus the append-only event log are
authoritative.
