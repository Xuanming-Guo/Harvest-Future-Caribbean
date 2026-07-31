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
5. The README for the area being changed.
6. [`contracts/README.md`](contracts/README.md) and any relevant contracts.
7. [`docs/roadmap.md`](docs/roadmap.md) for current priorities.

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
- Do not invent an endpoint, event, or model payload outside `contracts/`.
- Update contracts, documentation, and affected consumers together when an
  interface changes. If that is impossible, link explicit blocking issues.
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

- Agents and teammates may create branches and open or update pull requests.
- Only Xuanming may merge or close a pull request.
- Leave every pull request open after creating or updating it. Never enable
  auto-merge or perform an automatic merge or close action.
- Only Xuanming deletes a branch after its pull request is merged or closed.
- Reviews are optional and may be requested when they are useful.

## Definition of done

- The issue acceptance criteria are met.
- Relevant validation or tests pass.
- Documentation and contracts are current.
- Synthetic inputs and outcomes are labelled.
- No secrets or generated artefacts are committed.
- The pull request is focused, links its issue, and has no unresolved conflicts.
