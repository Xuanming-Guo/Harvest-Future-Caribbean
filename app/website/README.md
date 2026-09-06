# Harvest product website

This responsive Next.js website is the interface used by Harvest participants:
farmers, buyers, transporters and coordinators. It calls the shared Product API
and has no website-specific database or private backend.

All new participant controls follow the repository's
[`frontend design contract`](../../docs/frontend-design-contract.md): they are
custom, accessible Harvest controls rather than visible browser/OS widgets.

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

Role workspaces open directly. **Take the tutorial** in the sidebar starts the
optional role guide on demand.
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
the normal role page, and shows a compact read-only status. Workspace
form controls are disabled and the API independently rejects every mutation
with `SIMULATION_RUN_IMMUTABLE`. The tutorial is not shown during replay.

## Product routes

| Role | Routes | Main actions |
| --- | --- | --- |
| Farmer | `/farmer`, `/crops/[cropBatchId]`, `/orders` | crop update, forecast refresh, safe listing, commitment decision, read what was wrong and what to do next, follow the crop journey |
| Buyer | `/buyer`, `/marketplace`, `/orders`, `/orders/[orderId]` | demand, multi-farm order, commitment decision, delivery acceptance with a required rejection reason and next action |
| Transporter | `/transporter`, `/missions/[missionId]` | accept mission, pickup/arrival/delivery update, report exception |
| Coordinator | `/coordinator`, `/crops/[cropBatchId]`, `/orders` | permitted-farm verification, missing information, recovery decision, exception follow-up |

The crop journey on `/crops/[cropBatchId]` is composed in the browser from the
existing crop-batch, order, mission and mission-update reads. It shows recorded
Harvest evidence only, never a food-safety certification, and never private farm
coordinates.

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

## Dated harvest offers

The farmer workspace offers forecast supply as well as harvest-ready produce.
Growing/maturing batches need a published `promisableFrom` date and positive
available-to-promise quantity before an offer is recommended. Labels distinguish
future harvests from ready crops. Calendar-only contract dates retain their
published day; actual timestamps still display in Saint Lucia time. Expired
buyer needs are not recommended as current work. The Product API continues to
validate quantities, availability dates and every human approval.

## Harvest World

`/map` opens an illustrated view of the workspace island. Each island has a
separately rendered Blender island diorama using its own
georeferenced elevation data, with the existing buildings, crop art and
animation layered above it. The former shared-texture coastline mask is gone.
Property
names use an HTML layer with consistent screen-size type; decorative ground
rings and the always-on road network are omitted. Wheel/pinch zoom, keyboard
navigation and a shared percentage/fit toolbar work in both map views. Camera
limits keep the backdrop covering the viewport.

**Caribbean** opens all 28 islands and territories with searchable navigation.
Coastlines retain their geographic proportions and positions. Labels render
after the land, with collision-aware placement and more detail as space permits.
The directory always contains every island, including those too small to label
at the current zoom. **Explore island** opens any island's places view, even
when it has no operational locations.

The bundled `src/lib/island-coastlines.json` contains exterior rings from
Natural Earth 1:10m admin-0 map subunits, rounded to four decimal degrees. Source:
`https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_10m_admin_0_map_subunits.geojson`
(retrieved September 6, 2026). Natural Earth data is public domain; see
`https://www.naturalearthdata.com/about/terms-of-use/`. Administrative borders
remain distinct where territories share an island. The region directory uses
`simulation/src/scenario/caribbean-islands-manifest-v1.ts`; it imports no
simulation runtime. Maps load bundled coastlines and pre-rendered island
terrain, without
runtime elevation requests, external map tiles or a street-map library.
Terrain sources, rendering choices, rebuild steps and per-island provenance
are in `public/art/islands/README.md` and `world-manifest.json`.

**My places** opens the region returned by `GET /v1/world-map`. The current
API returns Saint Lucia and provides service zones, not property coordinates.
Property positions are deterministic display locations within the coastline,
projected through the artwork camera and its elevation registration,
not surveyed farm or hotel positions. Relief uses elevation data; vegetation
styling and buildings are illustrative. Other islands have an empty places
view until the API supplies
coverage; Saint Lucia's records are never copied onto them. Permissions,
identity disclosure and the Product API remain authoritative.

Role headers and empty states use concise labels. Optional tutorials retain
step-by-step guidance; routine workspace pages omit explanatory paragraphs.
The offline shell fetches unversioned JavaScript from the network first, with
its cached copy as an offline fallback. Content-hashed production assets remain
cache-first, preventing an old development bundle from masking UI changes.

## Place scale and close-up navigation

At island scale, building artwork uses illustrative physical footprint defaults
(60 m for a farm scene, 90 m for a hotel scene) projected through the island's
geographic extent. These defaults are not measured property boundaries. Small
screen-space markers retain accessible click targets. Selecting a place first
loads its detailed artwork while preserving the island. Once that image is
ready, the views crossfade with a small camera move (1.18 times the current
zoom), avoiding a pixelated deep crop of the island bitmap. The views share one
viewport and keep both layers mounted through the transition. Back restores
the overview with a crossfade. Reduced-motion preferences skip the animation.
Keyboard focus moves to the back control and returns to the originating place.

Property labels and corner panels are compact so the landscape stays visible.
Scrollable lists use Harvest's rounded green scrollbar, including Chromium
thumbs, tracks and hidden arrow buttons. The place viewport does not scroll
when transformed map controls receive focus.

The replacement v3 artwork covers all 28 catalogue entries. The image API pilot
failed because the configured account had no remaining credits; the user-
authorized fallback uses the reproducible Blender renderer. The user's style
reference and API prompts remain under `art-direction/`. V2 terrain images
remain geography guides and are no longer the active island backgrounds.
