# Harvest product website

This responsive Next.js website is the interface used by Harvest participants:
farmers, buyers, transporters and coordinators. It calls the shared Product API
and has no website-specific database or private backend.

It is deliberately not the simulation/control-room website. The separate saved-
run control room is on `3002`; benchmark charts, model evidence, raw traces and
judge controls do not belong in participant pages.

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

Windows users can instead double-click a role in the repository's
[`launchers/`](../../launchers/) folder. The shortcut starts the normal local
stack if needed and opens the selected role automatically. It passes one of
the four allowlisted seeded personas in a short-lived URL fragment, which the
website removes before requesting the same development session used by the
role picker. The fragment is ignored in production and does not change
production authentication or the Product API contract.

Role shortcuts use the browser's normal shared local storage, so they are
intended for one role at a time. Opening another role replaces the active
Harvest session; close older Harvest tabs before continuing in the new role.

## First-session tutorial

After a participant signs in for the first time, the website asks whether they
want a short tutorial. Choosing **Yes** opens a role-specific guide that moves
through the real pages and explains the main controls. Choosing **No** opens the
workspace immediately. Either choice is remembered for that signed-in identity,
and the guide can always be replayed with **Take the tutorial** in the sidebar.

Tutorial completion is presentation-only state stored in browser local storage
under `harvest.onboarding.v1:<auth-subject>`. It contains no farm, order, vehicle,
delivery, or other operational data. A future production authentication flow can
keep the same behaviour because the key uses the authenticated subject returned
by the Product API; the current hackathon build uses the seeded demo personas.

The guide never performs an operational action. It points to the same controls a
participant uses, while crop updates, listings, demands, orders, approvals,
verification, and mission changes continue to go through the shared Product API.

## Synthetic participant replay

The control room can open a mapped participant from a completed Harvest run.
It passes a 15-minute token in the URL fragment; the website consumes and
immediately removes that fragment, loads the actor from `GET /v1/me`, routes to
the normal role page, and shows a purple synthetic/read-only banner. Workspace
form controls are disabled and the API independently rejects every mutation
with `SIMULATION_RUN_IMMUTABLE`. The tutorial is not shown during replay.

## Product routes

| Role | Routes | Main actions |
| --- | --- | --- |
| Farmer | `/farmer`, `/crops/[cropBatchId]`, `/orders` | crop update, forecast refresh, safe listing, commitment decision |
| Buyer | `/buyer`, `/marketplace`, `/orders`, `/orders/[orderId]` | demand, multi-farm order, commitment decision, delivery acceptance |
| Transporter | `/transporter`, `/missions/[missionId]` | accept mission, pickup/arrival/delivery update, report exception |
| Coordinator | `/coordinator`, `/crops/[cropBatchId]`, `/orders` | permitted-farm verification, missing information, recovery decision, exception follow-up |

Participant pages poll active orders, approvals, missions, exceptions and
verification tasks every five seconds. Crop, demand, listing and opportunity
views refresh every fifteen seconds, and all queries refresh when the browser
regains focus. This is deliberately simple polling for the hackathon; the
planned event stream remains part of the separate simulation/live-update work.

Buyer delivery coordinates and delivery zone come from the signed-in profile,
and transporters must select an available vehicle returned by the Product API.
The browser contains no hardcoded operational identity, location, or vehicle.

The client shell guards role routes for usability. Fastify independently
enforces actor and resource permissions; hiding a link is never the security
boundary.

## Shared backend and client

The website uses the Product API through the generated client in `app/shared`.
PostgreSQL is authoritative. Browser local storage holds only the short-lived
demo token, actor summary, and tutorial preference, never operational records.

All seeded records are demo data. The participant interface presents them as
normal workflow records and does not describe simulated outcomes as deployed
impact.
