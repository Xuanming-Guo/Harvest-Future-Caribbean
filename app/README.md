# Application

This area will contain the user-facing Harvest product and its Product API.
Deeper folders will be added by implementation issues rather than created
upfront.

## Planned responsibilities

- `api/`: Product API, operational workflows, validated agent actions, and
  access to operational state.
- `website/`: buyer marketplace, operations centre, simulation control room,
  benchmark dashboard, trace viewer, Model Lab, and Judge Mode.
- `mobile/`: focused farmer, buyer, transporter, and coordinator journeys.
- `shared/`: generated contract types and shared client/design assets.

## Boundaries

- The Product API owns farms, crops, observations, listings, orders,
  reservations, allocations, deliveries, approvals, exceptions, and
  traceability visible to users.
- Website and mobile clients call the Product API and never access storage
  directly.
- Simulated users call the same Product API operations as real users.
- Shared code must not duplicate backend business rules.
- API requests and responses must be defined in [`contracts/`](../contracts/).

## Integration guide

Before implementing a page, mobile journey, or Product API handler, use
[`docs/api_info.md`](../docs/api_info.md) to find the exact operation, caller
role, state/event transaction, simulation effect, and affected interfaces.
Generate the Next.js and Expo clients from
[`contracts/openapi.yaml`](../contracts/openapi.yaml); do not maintain a second
set of hand-written request/response types.
