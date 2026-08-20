# Agent coordination workflows

Harvest runs a small typed coordinator inside the Product API. It is not a
separate service and does not use an agent framework or background queue. The
authoritative workflow state remains in PostgreSQL: crop observations,
predictions, allocations, approvals, reservations, missions, exceptions,
events, and safe trace steps.

## End-to-end flow

```text
free text or supplied transcript
-> Intake Agent draft
-> human-confirmed crop observation
-> Crop Intelligence Agent forecast and ATP
-> Market Balance and Matching Agents
-> buyer and participating-farmer approvals
-> Commitment Agent reservation transaction
-> Logistics Agent pickup mission
-> Exception Agent recovery proposal
-> human coordinator decision
-> delivery outcome and prediction evaluation
```

Human waiting points are durable because their proposal and approval records
are stored. Each API command runs synchronously and is protected by the normal
`Idempotency-Key` contract. There is no hidden background action to resume.

## Deterministic and text-assisted responsibilities

Normal validated TypeScript owns quantities, ATP, matching, prices,
reservations, approval checks, routes, deadline changes, permissions, and state
transitions. The yield model adapter owns prediction output, not an LLM.

The normal participant workflow uses the provider-neutral text adapter for:

1. Extract an editable crop-observation draft from unstructured text.
2. Explain a delay recovery already calculated by deterministic code.

Connected `LLM_ASSISTED` simulation runs also use the shared structured client
to select from the current participant role's fixed tool allow-list. The call
is made at most once per participant per simulated day and only when that role
has an actionable cycle. The Product API still validates permissions,
visibility, run scope, quantities and lifecycle state before executing a tool.
An LLM cannot invent a tool or bypass a rejection.

The text adapter cannot save an observation, reserve supply, approve a
proposal, change a route, or change a deadline. Every stored trace contains a
safe summary and provenance, never chain-of-thought, credentials, or the raw
assembled prompt.

## Crop observation extraction

Prompt ID: `crop-observation-extraction-v1`.

The system instruction identifies the task as agricultural field extraction
for Harvest in Saint Lucia. It says that the result is a non-binding draft for
human review; unsupported quantities, dates, stages, and damage must not be
invented; units must be preserved and converted to kilograms only when
unambiguous; uncertainty needs confidence and warnings; output must follow the
strict schema; and forecasting, inventory, allocation, commitment, pricing,
and approval decisions are forbidden.

The call receives only:

- the actor role and permitted crop batch ID;
- crop type and current public batch status;
- observation time and `America/St_Lucia` timezone;
- source type (`TEXT`, `VOICE_TRANSCRIPT`, or `COORDINATOR_NOTE`);
- source text, limited to 4,000 characters;
- allowed crop-stage values and the output schema.

It returns an optional stage, optional kilogram quantity, source-grounded
notes, field and overall confidence, and warnings. The website fills the
existing form from this response. A farmer must review the form and select
**Save crop update** before any crop record or forecast changes.

## Delay recovery explanation

Prompt ID: `delay-recovery-explanation-v1`.

Deterministic policy first calculates one action: move the affected mission's
deadline exactly two hours later. The system instruction says the adapter may
only explain this stored action, must use supplied evidence, must separate fact
from uncertainty, must not disclose private or hidden simulation information,
and must not alter, approve, or execute the change.

The call receives the exception type/severity/time/description, mission status
and public stop count, order quantity, previous deadline, and exact proposed
deadline. It returns a concise explanation, evidence, risks, and a
clarification flag. The deadline remains unchanged until the targeted human
coordinator approves it.

## Provider configuration

The default remains intentionally blank in `.env.example`:

```dotenv
AGENT_LLM_PROVIDER=
AGENT_LLM_MODEL=
AGENT_LLM_BASE_URL=
AGENT_LLM_API_KEY=
```

A fully blank configuration selects the labelled `fixture`. It requires no
account, key or network and provides predetermined tool choices and concise
text. It must never be described as a real model call.

To use a compatible provider, create a repository-root `.env` (gitignored) and
set all four values:

```dotenv
AGENT_LLM_PROVIDER=openai-compatible
AGENT_LLM_MODEL=your-model-name
AGENT_LLM_BASE_URL=https://your-provider.example/v1
AGENT_LLM_API_KEY=your-local-secret
```

The base URL must expose `POST /chat/completions` with OpenAI-compatible
messages and JSON response format. Native server-side `fetch` is used, so no
provider SDK is required. The key never enters browser bundles, events, replay
frames or committed files.

All four values must be blank or all four must be present. Partial
configuration, an unsupported provider name, timeout, non-2xx response,
missing content, invalid JSON or schema-invalid output produces a clear failure
and no unchecked action. Restart `npm run dev` after changing `.env`.

Changing provider must not change Product API payloads, deterministic business
rules, human approvals, or fixture-mode behaviour.

## Connected simulation decision context

The role prompt contains the synthetic participant's role, display name,
island, current simulated date, fixed allow-list and a compact role-safe
snapshot: owned batch/ATP state for a farmer, active supply and own orders for a
buyer, owned vehicles and visible missions for a transporter, or permitted
tasks/approvals/exceptions for a coordinator. Operational payload values remain
constructed by deterministic code from that actor's visible Product API state.
Those compact snapshots are loaded through the same permission-aware query
routes as the website, not by reading Product tables from the simulation
coordinator. A role decision is cached at most once per actor per simulated day,
even though physical and Product events are interleaved more frequently.
The response is exactly:

```json
{
  "toolNames": ["place_order"],
  "summary": "Place the currently observable demand through the normal order workflow."
}
```

Allowed tools are farmer observation/listing/approval; buyer demand/order/
approval/acceptance; transporter mission/progress/exception; and coordinator
verification/approval. Unknown tools are rejected before any API call. Short
summaries may be shown in the control room; private chain-of-thought is never
requested or stored.

Synthetic approvals are labelled `SYNTHETIC_PARTICIPANT` in replay actions.
That proves the run crossed the same stored approval boundary; it does not turn
an AI decision into authorisation for a real commitment.
