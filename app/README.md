# Application

This area contains the real-user Harvest product and its shared operational
backend.

## Responsibilities

- `api/`: the Product API, operational workflows, permissions, approvals and
  PostgreSQL access.
- `website/`: the responsive interface for farmers, buyers, transporters and
  coordinators.
- `mobile/`: the future mobile interface for the same role journeys.
- `shared/`: generated contract types and the Product API client shared by web
  and mobile.

The judge-facing simulation control room is not part of `app/website`. It will
be a separate future frontend owned with the simulation work. Its eventual
development port is reserved as `3002`; no package or placeholder exists yet.

## Boundaries

- The Product API owns farms, crops, observations, listings, demand, orders,
  reservations, allocations, deliveries, approvals, exceptions and their
  traceable events.
- Website and mobile clients call the same Product API and never access storage
  directly.
- The simulation may later drive synthetic actors through the same contracted
  operations, but its clock, world and benchmark are not product pages.
- Shared code must not duplicate backend permissions or business rules.
- API requests and responses are defined in [`contracts/`](../contracts/).

## Local development

Run `npm install` and `npm run dev` from the repository root. This starts only
PostgreSQL in Docker, the Product API on `3001`, and the product website on
`3000`. The future website and mobile app use the same backend rather than
introducing separate databases.
