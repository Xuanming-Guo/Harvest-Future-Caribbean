# Hackathon roadmap

This roadmap records priorities and responsibility areas. GitHub issues contain
the executable scope and acceptance criteria.

## P0 — prove the complete workflow

- Establish canonical Product API, event, and model contracts as their
  implementation issues begin.
- Run one deterministic Saint Lucia scenario in fragmented-baseline and
  Harvest-enabled modes.
- Drive real and simulated user actions through the same Product API.
- Capture an append-only operational event and trace history.
- Demonstrate structured crop intake and a prediction range with confidence.
- Calculate safe available-to-promise without LLM-controlled inventory.
- Combine supply across farms for one buyer order.
- Require human approval before commitments and sensitive changes.
- Create and track a delivery mission.
- Recover from one weather, road, crop, or transport exception.
- Show an honest paired benchmark and concise agent trace for the scenario.

## P1 — strengthen evidence and presentation

- Expand to several crops, farms, buyers, and transporters.
- Add a live geographic control-room view.
- Use real, provenance-labelled satellite and climate features where feasible.
- Run repeated paired seeds and report distributions rather than one hero run.
- Add model-calibration, business, and compute-efficiency metrics.
- Conduct stakeholder usability testing separately from simulation.

## P2 — only after the core demo is reliable

- Payments and settlement.
- Complete inter-island shipping and trade integration.
- Crop recognition from imagery.
- Region-wide coverage.
- Financing and insurance.
- Full offline synchronisation.
- Complex marketplace or social features.

## Responsibility areas

### Xuanming

- Product direction and priorities.
- Product API and full-stack implementation.
- Website/control-room/simulation integration.
- Agent architecture and model integration.

### Faisal

- Simulation engine and policies.
- Agent orchestration and exception workflows.
- Machine learning and technical architecture.

### Micky

- Market and benchmark research.
- Data-source and provenance evidence.
- Stakeholder interviews and product-market fit.
- Business model, pitch evidence, and go-to-market.

These are coordination defaults, not hard ownership barriers.

## Current next step

Convert the approved implementation prompt into focused GitHub issues with
clear dependencies and acceptance criteria. Do not create deeper source folders
until the issue that owns them starts.
