# Harvest Product API

The Product API is the single operational backend for the Next.js website,
future Expo app, and Harvest-mode simulated actors. It runs on Fastify and owns
PostgreSQL state; clients never query the database directly.

## Local start

From the repository root:

```bash
npm install
npm run dev
```

Docker Compose starts PostgreSQL 16. Root scripts generate the Prisma client,
apply committed migrations, seed the deterministic Saint Lucia scenario, then
run Fastify on `http://localhost:3001` and Next.js on port 3000.

Useful commands:

```bash
npm run db:up
npm run db:migrate
npm run db:seed
npm run db:studio
npm run dev:api
```

The local database URL is a non-production default. Set `DATABASE_URL` to use a
different PostgreSQL or Supabase database. Never commit real credentials.

## Authentication

All `/v1` operations require a bearer JWT. In development only,
`POST /dev/session` returns a short-lived local JWT for one of the seeded
personas:

- `operations-demo`
- `buyer-hotel`
- `farmer-ana`
- `farmer-marcus`
- `transporter-daniel`
- `coordinator-maya`

The middleware derives identity and role from the token and database record;
request bodies cannot inject them. Set `ENABLE_DEV_AUTH=false` or run with
`NODE_ENV=production` to remove the development token endpoint. A production
deployment configures `SUPABASE_JWKS_URL`, `SUPABASE_JWT_ISSUER`, and
`SUPABASE_JWT_AUDIENCE`.

## Data and events

Prisma models cover actors and permissions, crop evidence and predictions,
marketplace demand, orders and reservations, approvals, delivery, exceptions,
traces, simulation projections, benchmark results, the immutable event log,
and idempotency receipts.

Mutation handlers validate domain invariants and write Product API state plus
the corresponding event transactionally. Every POST requires
`Idempotency-Key`. `/v1/events/stream` replays retained events from
`Last-Event-ID` and then tails new records with server-sent events.

## Model and simulation adapters

`MODEL_ADAPTER=fixture` and `SIMULATION_ADAPTER=fixture` are the local defaults.
They return deterministic, contract-valid synthetic evidence and never expose
hidden truth. Issues #4 and #7 can add HTTP adapters for the Python FastAPI
services without changing public routes, website code, mobile code, or Product
API database ownership.

The canonical wire contract is [`../../contracts/openapi.yaml`](../../contracts/openapi.yaml),
with behaviour and deterministic effects in
[`../../docs/api_info.md`](../../docs/api_info.md).
