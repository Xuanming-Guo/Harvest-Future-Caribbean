# Hosting the public demo

Harvest can run as a public, read/write demo on free-tier infrastructure:
the Fastify Product API + Postgres on **Railway**, and the Next.js
**website** and **control room** on **Vercel**. This is a demo deployment,
not production hardening — see the warning at the bottom.

All data behind this deployment is synthetic (seeded fixtures and simulated
runs). Nothing here represents a real farm, buyer, or delivery.

## 1. Railway: Postgres + Product API

1. Create a Railway project (e.g. `harvest-demo`).
2. Add a **Postgres** plugin/service to the project.
3. Add a service from this GitHub repo:
   - **Root Directory:** repository root (`/`) — the API needs the npm
     workspace install (`@harvest/shared`, `@harvest/simulation`) from the
     repo root, not just `app/api`.
   - `app/api/railway.json` documents the intended build/start/healthcheck
     commands, but Railway's Config-as-Code (`railway.json`) is deprecated
     in favor of Infrastructure-as-Code — set the same values directly on
     the service instead (Settings → Build → Build Command, Settings →
     Deploy → Start Command / Healthcheck Path), or via
     `railway api` against `serviceInstanceUpdate`. Use the exact commands
     from `app/api/railway.json`.
4. Set service environment variables:
   - `DATABASE_URL` — reference the Postgres plugin's connection string
     (Railway → Variables → "Add Reference" → the Postgres service's
     `DATABASE_URL`).
   - `NODE_ENV=production`
   - `HARVEST_DEMO_PERSONAS=true` — opts this deployment into demo persona
     sign-in and the control room's operations session. Never set this on
     a deployment with real data.
   - `DEV_JWT_SECRET` — a random 32-byte hex string (`openssl rand -hex 32`).
   - `INTERNAL_SERVICE_TOKEN` — a second random 32-byte hex string.
   - `MODEL_ADAPTER=fixture`
   - `SIMULATION_ADAPTER=fixture`
   - `WEBSITE_ORIGIN` and `CONTROL_ROOM_ORIGIN` — set placeholders first
     (e.g. `https://placeholder.vercel.app`), then update to the real Vercel
     URLs once step 2 is done, and redeploy.
   - `EXTRA_ORIGINS` — optional, comma-separated, for any additional origin
     (e.g. a Vercel preview URL).
   - Railway sets `PORT` automatically; the API listens on
     `process.env.PORT ?? PRODUCT_API_PORT`, so no action needed.
5. Deploy. Railway runs the build command, then on boot the `start` script
   (`npm run start --workspace @harvest/api`) recompiles the API
   (`tsc`), runs `prisma migrate deploy`, then boots. The rebuild-on-start
   is deliberate: `app/api/dist` is gitignored, and Railway's build layer
   does not reliably carry gitignored build output into the run image, so
   `start` treats the build as ephemeral rather than depending on it.
6. Generate a public domain for the service (Railway → Settings →
   Networking → Generate Domain).
7. Confirm `GET https://<railway-domain>/health` returns
   `{"status":"ok",...}`.
8. Seed the database once: `railway run --service <api-service> npm run db:seed --workspace @harvest/api`
   (or trigger a one-off command from the Railway dashboard with the
   service's environment attached). Safe to re-run; seeding is idempotent.

## 2. Vercel: website + control room

Create **two** Vercel projects from the same GitHub repo (a monorepo, so
each project needs "Include files outside the root directory" enabled —
Vercel does this automatically when a `Root Directory` is set and it detects
workspace dependencies; verify under Project Settings → General if assets
are missing).

### `harvest-website`
- Root Directory: `app/website`
- Framework preset: Next.js
- Environment variables:
  - `NEXT_PUBLIC_PRODUCT_API_URL=https://<railway-domain>`
  - `NEXT_PUBLIC_HARVEST_DEMO_PERSONAS=true`
  - `NEXT_PUBLIC_WEBSITE_URL=https://<this-project's-vercel-domain>`
- Deploy: `vercel --prod` (or via the dashboard).

### `harvest-control-room`
- Root Directory: `app/control-room`
- Framework preset: Next.js
- Environment variables:
  - `NEXT_PUBLIC_PRODUCT_API_URL=https://<railway-domain>`
  - `NEXT_PUBLIC_HARVEST_DEMO_PERSONAS=true`
  - `NEXT_PUBLIC_WEBSITE_URL=https://<harvest-website's-vercel-domain>`
- Deploy: `vercel --prod`.
- Cesium's static assets (`public/cesium`) are copied by the workspace's
  `prebuild` script (`scripts/copy-cesium.mjs`), which npm runs
  automatically before `next build`. No extra Vercel configuration needed.

## 3. Close the loop

Once both Vercel URLs exist, go back to the Railway API service and update:
- `WEBSITE_ORIGIN` → the `harvest-website` production URL
- `CONTROL_ROOM_ORIGIN` → the `harvest-control-room` production URL

Redeploy the API service so the new CORS allow-list takes effect.

## Environment variable reference

| Variable | Where | Purpose |
|---|---|---|
| `HARVEST_DEMO_PERSONAS` | API | `true` allows `/dev/session` and the control room's operations session under `NODE_ENV=production`. Default off. |
| `NEXT_PUBLIC_HARVEST_DEMO_PERSONAS` | website, control room | Client-side mirror of the same flag; gates the demo persona sign-in link and the control room's session bootstrap. |
| `WEBSITE_ORIGIN` / `CONTROL_ROOM_ORIGIN` / `EXTRA_ORIGINS` | API | Builds the CORS allow-list. No wildcard is ever used. |
| `PORT` | API | Railway injects this; the API prefers it over `PRODUCT_API_PORT`. |
| `DEV_JWT_SECRET` / `INTERNAL_SERVICE_TOKEN` | API | Random secrets for this deployment only; never reuse local dev values. |

## Warning: synthetic data only

This deployment exists to demo the product, not to hold real operational
data. `HARVEST_DEMO_PERSONAS=true` intentionally weakens auth (anyone with
the URL can sign in as any seeded persona). Never point this configuration
at a database containing real farms, buyers, or deliveries, and never reuse
the demo secrets for a production deployment with real users.
