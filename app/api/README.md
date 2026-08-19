# Harvest Product API

The Product API is the single operational backend for the Next.js website and
future Harvest-mode simulated actors. It runs on Fastify and owns
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

Use [`../../docs/simulation_api_local_testing.md`](../../docs/simulation_api_local_testing.md)
for copy-ready authentication, saved-run, replay, determinism, derived-run,
paired-run, snapshot and SSE checks with expected values. The root `npm run
dev` command reseeds disposable development data, so it clears saved run IDs
from a previous root development session.

## Authentication

All `/v1` operations require a bearer JWT. In development only,
`POST /dev/session` returns a short-lived local JWT for one of the seeded
personas:

- `buyer-hotel`
- `farmer-ana`
- `farmer-marcus`
- `transporter-daniel`
- `coordinator-maya`
- `operations-demo`

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
HTTP adapter without changing website payloads.

Agent text assistance is separately provider-neutral. Leave
`AGENT_LLM_PROVIDER`, `AGENT_LLM_MODEL`, `AGENT_LLM_BASE_URL`, and
`AGENT_LLM_API_KEY` blank to use the deterministic fixture. No live provider
SDK is installed. Provider selection and adapter instructions are in
[`../../docs/agent_workflows.md`](../../docs/agent_workflows.md).

Issue #29 serves deterministic saved runs, disruption-derived runs, immutable
timelines and frames, paired comparisons, run-scoped operations snapshots, and
cursor-based SSE from this Fastify service. It imports the TypeScript simulation
package directly; there is no Docker container, Python service, run-command
endpoint, internal ingestion endpoint, or port `8001`.

`LLM_ASSISTED` remains an explicit reserved decision mode. It returns a clear
conflict until issue #30 provides the simulated-agent decision cycle and a text
provider is configured; it never silently falls back to deterministic mode.

The canonical wire contract is [`../../contracts/openapi.yaml`](../../contracts/openapi.yaml),
with behaviour and deterministic effects in
[`../../docs/api_info.md`](../../docs/api_info.md).

## Participant workflow projections

The P0 API includes privacy-safe listing evidence and market opportunities,
profile-backed buyer delivery defaults, transporter-owned vehicles, explicit
coordinator verification tasks, aggregated order details, chronological
mission updates, concrete exception recovery proposals, and per-crop delivery
outcomes. Normal records use a null run scope. Future simulated participants
inherit `simulationRunId` from authentication, and all created operational
records and events retain that scope so real data and separate runs cannot mix.
