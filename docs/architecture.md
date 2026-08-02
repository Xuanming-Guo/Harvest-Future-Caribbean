# Architecture

Harvest is one instrumented workflow, not separate app, simulation, and model
demos. All components communicate through documented contracts.

## System flow

```text
Website / mobile / simulated actors
                 |
                 v
        Product API and agent runtime
            |                 |
            v                 v
 Operational state        Model service
 and append-only log      predictions
            |
            v
 Website, mobile, simulation control room,
 traces, and benchmark views update
```

## Ownership

### Product API

The Product API owns user-visible operational state, including:

- farms and permissions;
- crop batches and observations;
- marketplace listings and buyer demand;
- orders, reservations, and allocations;
- approvals, delivery missions, and exceptions;
- traceability and accepted operational outcomes.

Website, mobile, and simulated users call this API. They do not access its
database directly.

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
configuration accepts Supabase-compatible JWTs instead. Development model and
simulation adapters implement the documented boundaries with deterministic
fixture data and can be replaced by the Python services through configuration.

The browser never treats local storage as operational state. Website caches and
navigation state are disposable; PostgreSQL plus the append-only event log are
authoritative.
