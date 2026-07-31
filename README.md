# Harvest

> An agentic farm-to-market coordination network for Caribbean food systems.

**Current phase:** repository foundations and hackathon implementation planning.

Harvest helps turn uncertain farmer updates into safer supply commitments,
multi-farm fulfilment, coordinated delivery, exception recovery, traceability,
and better future forecasts.

> The marketplace is the interface. The coordination layer and outcome dataset
> are the company.

## Project areas

| Area | Purpose |
| --- | --- |
| [`app/`](app/) | Product API, website, mobile experiences, and shared client assets |
| [`simulation/`](simulation/) | Paired baseline and Harvest-enabled food-system simulations |
| [`model/`](model/) | Harvest-estimation features, training, evaluation, and inference |
| [`contracts/`](contracts/) | Source of truth for APIs, events, and model interfaces |
| [`docs/`](docs/) | Product context, architecture, priorities, and decision guidance |

Deeper source folders are added only when an implementation issue needs them.

## Architecture at a glance

Website, mobile, and simulated users all interact through the same Product API.
The Product API owns user-visible operational state. The simulation owns its
clock, scenarios, random seeds, and hidden ground truth. The model owns model
features, predictions, versions, and artefacts. Communication between these
areas must follow the definitions in [`contracts/`](contracts/).

See [Architecture](docs/architecture.md) for the system boundaries.

## Team

- **Xuanming:** product direction, full-stack development, Product API,
  integration, agent architecture, and harvest-model integration.
- **Faisal:** simulation, agent orchestration, machine learning, technical
  architecture, and exception workflows.
- **Micky:** research, benchmark data, stakeholder interviews, product-market
  fit, business model, and pitch evidence.

Ownership helps coordination; it does not prevent teammates from collaborating
across areas.

## Start here

1. Read the [product brief](docs/product.md).
2. Read the [architecture](docs/architecture.md).
3. Choose or create a GitHub issue.
4. Follow [CONTRIBUTING.md](CONTRIBUTING.md).
5. If using an AI coding agent, also follow [AGENTS.md](AGENTS.md).

The full application and research background is preserved in
[`docs/context.md`](docs/context.md). It is background material, not a
requirement to build every idea it contains.

## Evidence policy

Synthetic or simulated results must always be labelled as synthetic. They must
not be presented as measured impact from a deployed real-world system.
