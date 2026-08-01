# Harvest documentation

Use this reading order:

1. [`product.md`](product.md) — concise product scope and non-negotiables.
2. [`architecture.md`](architecture.md) — system ownership and communication.
3. [`api_info.md`](api_info.md) — exact API consumers, state changes, events,
   and simulation effects.
4. [`../contracts/README.md`](../contracts/README.md) — machine-readable
   interface governance.
5. [`roadmap.md`](roadmap.md) — priorities and responsibility areas.
6. [`context.md`](context.md) — complete application, research, and planning
   background.

The linked GitHub issue defines the scope of a change. Product, architecture,
and contracts define the current system constraints. If an issue conflicts with
those constraints, record the decision and update the governing documentation
instead of silently creating a second design.

`context.md` is intentionally comprehensive and contains brainstorming,
application drafts, and long-term ideas. It informs the project but does not
make every idea part of the current hackathon scope.
