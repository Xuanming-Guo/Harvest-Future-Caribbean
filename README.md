# Harvest

> An agentic farm-to-market coordination network for Caribbean food systems.

**Current phase:** hackathon implementation.

Harvest helps turn uncertain farmer updates into safer supply commitments,
multi-farm fulfilment, coordinated delivery, exception recovery, traceability,
and better future forecasts. Traceability here means the recorded chain of
Harvest's own operational evidence, including the structured reason and next
action attached to every rejection. It is not a food-safety certification.

> The marketplace is the interface. The coordination layer and outcome dataset
> are the company.

## Project areas

| Area | Purpose |
| --- | --- |
| [`app/`](app/) | Product API, website, control room, and shared client assets |
| [`simulation/`](simulation/) | Paired baseline and Harvest-enabled food-system simulations |
| [`model/`](model/) | Harvest-estimation features, training, evaluation, and inference |
| [`contracts/`](contracts/) | Source of truth for APIs, events, and model interfaces |
| [`docs/`](docs/) | Product context, architecture, priorities, and decision guidance |

Deeper source folders are added only when an implementation issue needs them.

## Run the local product

Requirements: Node.js 20+ and Docker Desktop with Docker Compose.

```bash
npm install
npm run dev
```

This starts PostgreSQL in Docker, applies the committed Prisma migration,
seeds the labelled Saint Lucia counterfactual scenario, and runs the Product
API at `http://localhost:3001` plus the website at `http://localhost:3000`.
See [`app/api/README.md`](app/api/README.md) and
[`app/website/README.md`](app/website/README.md) for configuration and route
details. The copy-ready saved-run API checks and their expected seed-42 values
are in [`docs/simulation_api_local_testing.md`](docs/simulation_api_local_testing.md).

On Windows, the clickable shortcuts in [`launchers/`](launchers/) provide the
same local startup without typing npm commands. Choose Farmer, Buyer,
Transporter or Coordinator to start the stack when necessary and open that
role directly. The Simulation Control Room shortcut additionally starts and
opens port `3002`. Docker Desktop must already be running; see the
[`launcher instructions`](launchers/README.md) for prerequisites and shutdown.

The website on `3000` is only the real-user product interface. The separate
simulation control room lives on port `3002` and is started on its own:

```bash
npm run control-room
```

Keep `npm run dev` running when using it: the control room authenticates as the
local operations persona, creates or loads saved runs through the Product API,
and replays their immutable frames. Harvest-mode simulated participants use the
same Product API workflows as the website. See
[`app/control-room/README.md`](app/control-room/README.md) for the UI and
[`docs/simulation_api_local_testing.md`](docs/simulation_api_local_testing.md)
for copy-ready API checks.

To run a scenario headlessly instead, without any interface:

```bash
npm run sim -- --paired --seed 42
```

## Architecture at a glance

Website and simulated users all interact through the same Product API.
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
