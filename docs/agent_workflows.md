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

Only two operations use the provider-neutral text adapter:

1. Extract an editable crop-observation draft from unstructured text.
2. Explain a delay recovery already calculated by deterministic code.

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

No live provider is selected in issue #6. These entries intentionally remain
blank in `.env.example`:

```dotenv
AGENT_LLM_PROVIDER=
AGENT_LLM_MODEL=
AGENT_LLM_BASE_URL=
AGENT_LLM_API_KEY=
```

A blank provider selects the deterministic fixture. This is the supported
local and test configuration and requires no account, API key, network call,
or provider SDK. A non-empty unregistered provider fails startup with a clear
message instead of silently sending data somewhere unexpected.

When the team selects a provider:

1. Add one adapter implementing `AgentTextAdapter` in `app/api/src/agents`.
2. Keep the two task-specific methods and return types unchanged.
3. Build messages from the versioned prompt builders and request strict
   structured output.
4. Validate every provider response before returning it to the coordinator.
5. Register the chosen lowercase provider name in `createAgentTextAdapter`.
6. Install only that provider's required dependency, if any.
7. Set the provider/model/base URL/key locally; never commit the real key.
8. Add tests for malformed output, timeout/error handling, secret-safe logs,
   and both prompt contracts before enabling the adapter outside development.

Changing provider must not change Product API payloads, deterministic business
rules, human approvals, or fixture-mode behaviour.
