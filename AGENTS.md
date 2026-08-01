# Instructions for AI coding agents

These instructions apply to the entire repository.

## Mission

Harvest is not merely a marketplace. It converts uncertain farmer signals into
crop intelligence, safer commitments, multi-farm fulfilment, delivery
coordination, exception recovery, traceability, and learning from outcomes.

Keep the project useful for a three-person, three-week hackathon. Prefer the
smallest coherent implementation that proves the end-to-end workflow.

## Read before changing files

1. The linked GitHub issue and its acceptance criteria.
2. [`README.md`](README.md).
3. [`docs/product.md`](docs/product.md).
4. [`docs/architecture.md`](docs/architecture.md).
5. [`docs/api_info.md`](docs/api_info.md) before implementing or calling an
   API, event, simulation effect, or model interface.
6. The README for the area being changed.
7. [`contracts/README.md`](contracts/README.md) and any relevant contracts.
8. [`docs/roadmap.md`](docs/roadmap.md) for current priorities.

Use [`docs/context.md`](docs/context.md) for deeper background. It contains
brainstorming and long-term ideas, so do not treat every item as current scope.

## System boundaries

- The Product API owns user-visible operational state.
- Website, mobile, and simulated users call the Product API; they do not access
  databases directly.
- The simulation owns simulation time, random seeds, scenarios, synthetic
  actors, policy behaviour, and hidden ground truth.
- The model owns feature preparation, training, evaluation, predictions, model
  versions, and model artefacts.
- The simulation and model never write directly to Product API storage.
- Cross-area communication follows the canonical definitions in `contracts/`.
- Shared client code must not become a second home for backend business logic.

## Implementation rules

- Work from one focused issue and avoid unrelated changes.
- Locate an operation in the API catalogue and its machine-readable contract
  before implementing or calling it.
- Do not invent an endpoint, event, or model payload outside `contracts/`.
- Do not invent state transitions or simulation effects outside
  [`docs/api_info.md`](docs/api_info.md) and the event catalogue.
- Update contracts, documentation, and affected consumers together when an
  interface changes. If that is impossible, link explicit blocking issues.
- Every API or event change must update the applicable OpenAPI/JSON Schema,
  `docs/api_info.md`, and affected generated clients/handlers together.
- Simulation handlers must apply only the deterministic event effects defined
  in `docs/api_info.md` and `contracts/events/EVENT_CATALOGUE.md`.
- Use deterministic, validated code for quantities, reservations, allocation,
  routing, permissions, and state transitions.
- Use AI for unstructured extraction, prediction support, and complex exception
  reasoning—not as an unchecked authority over inventory or commitments.
- Validate all model or LLM output before it can affect operational state.
- Require human approval for commitments, substitutions, price changes,
  cancellations, private-location disclosure, disputed reliability changes,
  produce rejection, and inter-island commitments.
- Record concise decision summaries, inputs, evidence, tool calls, and outcomes.
  Never expose private chain-of-thought.
- Label observed, inferred, synthetic, stakeholder-calibrated, and
  model-predicted data accurately.
- Never describe simulated results as real deployed impact.
- Do not rewrite `docs/context.md` unless an issue explicitly requests it.
- Never commit secrets, credentials, private personal data, or unapproved
  private datasets.

## Pull request control

- AI agents may create branches and open or update pull requests, but must stop
  after doing so and leave the pull request open.
- AI agents and automated systems must never push directly to `main`, merge a
  branch or pull request into `main`, close a pull request, enable auto-merge,
  or delete a pull-request branch.
- Only a human may formally review, approve, request changes on, merge, or close
  a pull request. Any authorised human collaborator may perform those actions.
- Every merge must be deliberately initiated by a human. Auto-merge is always
  forbidden.
- Only a human deletes a branch after its pull request is merged or closed.
- Human reviews are optional. AI agents may inspect, test, and report findings,
  but must not submit a formal GitHub review or approval.

## Definition of done

- The issue acceptance criteria are met.
- Relevant validation or tests pass.
- Documentation and contracts are current.
- Synthetic inputs and outcomes are labelled.
- No secrets or generated artefacts are committed.
- The pull request is focused, links its issue, and has no unresolved conflicts.
