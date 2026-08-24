# Harvest documentation

Use this reading order:

1. [`frontend-design-contract.md`](frontend-design-contract.md) — mandatory
   visual and interaction rule for new user-facing controls.

2. [`product.md`](product.md) — concise product scope and non-negotiables.
3. [`architecture.md`](architecture.md) — system ownership and communication.
4. [`api_info.md`](api_info.md) — exact API consumers, state changes, events,
   and simulation effects.
5. [`agent_workflows.md`](agent_workflows.md) — agent roles, prompts, safety,
   and provider setup.
6. [`../contracts/README.md`](../contracts/README.md) — machine-readable
   interface governance.
7. [`roadmap.md`](roadmap.md) — priorities and responsibility areas.
8. [`context.md`](context.md) — complete application, research, and planning
   background.

Before changing or testing saved simulation runs, replay, run-scoped
snapshots, SSE, or control-room integration, read
[`simulation_api_local_testing.md`](simulation_api_local_testing.md). It is the
copy-ready localhost guide and records the expected deterministic seed-42
values and the current issue #29/#30 boundary.

The linked GitHub issue defines the scope of a change. Product, architecture,
and contracts define the current system constraints. If an issue conflicts with
those constraints, record the decision and update the governing documentation
instead of silently creating a second design.

`context.md` is intentionally comprehensive and contains brainstorming,
application drafts, and long-term ideas. It informs the project but does not
make every idea part of the current hackathon scope.
