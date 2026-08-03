# Harvest product website

This responsive Next.js website is the interface used by Harvest participants:
farmers, buyers, transporters and coordinators. It calls the shared Product API
and has no website-specific database or private backend.

It is deliberately not the simulation/control-room website. Benchmark charts,
world maps, model evidence, raw traces and judge controls belong to a separate
future frontend, whose development port is reserved as `3002`.

## Run it

From the repository root, with Docker Desktop running:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. The Product API defaults to
`http://localhost:3001`; override it with `NEXT_PUBLIC_PRODUCT_API_URL` when
needed. The root page provides a development-only role sign-in backed by
`POST /dev/session`.

## Product routes

| Role | Routes | Main actions |
| --- | --- | --- |
| Farmer | `/farmer`, `/crops/[cropBatchId]`, `/orders` | crop update, forecast refresh, safe listing, commitment decision |
| Buyer | `/buyer`, `/marketplace`, `/orders`, `/orders/[orderId]` | demand, multi-farm order, commitment decision, delivery acceptance |
| Transporter | `/transporter`, `/missions/[missionId]` | accept mission, pickup/arrival/delivery update, report exception |
| Coordinator | `/coordinator`, `/crops/[cropBatchId]`, `/orders` | permitted-farm verification, missing information, recovery decision, exception follow-up |

The client shell guards role routes for usability. Fastify independently
enforces actor and resource permissions; hiding a link is never the security
boundary.

## Shared backend and client

The future mobile app will reuse this Product API and the generated client in
`app/shared`. PostgreSQL is authoritative. Browser local storage holds only the
short-lived demo token and actor summary, never operational records.

All seeded records are demo data. The participant interface presents them as
normal workflow records and does not describe simulated outcomes as deployed
impact.
