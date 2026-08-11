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
marketplace demand, orders and reservations, actor-targeted approvals,
transporter vehicles, verification tasks, delivery, concrete exception
recovery proposals, safe internal traces, the immutable event log, and
idempotency receipts.

Mutation handlers validate domain invariants and write Product API state plus
the corresponding event transactionally. Every POST requires
`Idempotency-Key`. `/v1/events/stream` replays retained events from
`Last-Event-ID` and then tails new records with server-sent events.

## Model integration and simulation boundary

`MODEL_ADAPTER=fixture` is the local default and returns deterministic,
contract-valid prediction evidence. A later model issue can replace it with an
HTTP adapter without changing website or mobile payloads.

Agent text assistance is separately provider-neutral. Leave
`AGENT_LLM_PROVIDER`, `AGENT_LLM_MODEL`, `AGENT_LLM_BASE_URL`, and
`AGENT_LLM_API_KEY` blank to use the deterministic fixture. No live provider
SDK is installed. Provider selection and adapter instructions are in
[`../../docs/agent_workflows.md`](../../docs/agent_workflows.md).

Issue #8 does not serve simulation runs, observable world projections, paired
runs, an operations snapshot, or a browser event stream. Those OpenAPI paths
remain planned contracts for the separate simulation/control-room issue; they
have no runtime handler or Product API database model in this implementation.

The canonical wire contract is [`../../contracts/openapi.yaml`](../../contracts/openapi.yaml),
with behaviour and deterministic effects in
[`../../docs/api_info.md`](../../docs/api_info.md).

## Participant workflow projections

The P0 API includes privacy-safe listing evidence and market opportunities,
profile-backed buyer delivery defaults, transporter-owned vehicles, explicit
coordinator verification tasks, aggregated order details, chronological
mission updates, concrete exception recovery proposals, and per-crop delivery
outcomes. These projections are shared by the website and future mobile app.

The ten simulation/control-room and internal-ingestion operations remain in
OpenAPI with `x-harvest-status: planned`; Fastify intentionally does not serve
them yet.
