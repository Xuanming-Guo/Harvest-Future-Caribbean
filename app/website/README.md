# Harvest website

The desktop-first Next.js website is the operational interface for the Harvest
hackathon workflow. It consumes only the shared Product API and generated
contract types. There is no website-specific database or private backend.

## Run it

From the repository root, with Docker Desktop running:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. The root route redirects to `/operations`.
`NEXT_PUBLIC_PRODUCT_API_URL` may point the client at another Product API; it
defaults to `http://localhost:3001`.

The top-right development persona selector obtains a local JWT from the API.
Use the buyer to create orders, operations/coordinator to approve changes, the
transporter to accept and progress missions, and the buyer to accept delivery.
These personas and all resulting scenario data are explicitly synthetic.

## Routes and Product API use

| Route | Purpose | Main Product API operations |
| --- | --- | --- |
| `/operations` | Supply, demand, order, approval, mission, exception, and event overview | snapshot plus list projections, approval decisions, mission actions, SSE |
| `/marketplace` | Browse ATP-backed listings and submit hotel demand/order | listings, buyer demand, orders |
| `/orders/[orderId]` | Lifecycle, risk, mission, and related activity | order detail, missions, SSE |
| `/simulation` | Observable 2D world and run controls | run detail, commands, world, exceptions, SSE |
| `/benchmark` | Paired baseline-versus-Harvest comparison | paired runs |
| `/agents/traces/[traceId]` | Safe decision evidence without chain-of-thought | agent trace |
| `/model-lab` | Prediction interval, ATP, features, warnings, and evaluation | crop batches, yield prediction evidence |
| `/data` | Provenance vocabulary and immutable events | crop batches, SSE |

There is intentionally no `/judge` route. The future issue #5 3D map can
replace the `WorldMap` visual component while keeping the same observable-world
and event interfaces.

## Shared client

`app/shared` generates the TypeScript Product API client from
`contracts/openapi.yaml` and the event type from the canonical JSON Schema.
Generated files are ignored and recreated by `npm run contracts:generate`.
The future Expo app must reuse this package rather than defining competing
payload types or a mobile-only backend.

## Visual and evidence policy

The interface follows the supplied cream, forest green, mint, amber, blue,
purple, and red mockup language. Green marks crops, amber demand and
reservations, blue transport, purple decisions, and red exceptions. Every
fixture and simulated result is labelled as a synthetic counterfactual; the UI
never presents it as deployed impact.
