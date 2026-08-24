# Control room

The simulation control room: a 3D globe view of synthetic Caribbean scenarios, on
port `3002`. It is where the team and judges watch the simulated food system
change over time, and it is separate from the participant website on `3000`,
which is a role-facing product interface rather than an operations console.

All new control-room interactions follow the repository's
[`frontend design contract`](../../docs/frontend-design-contract.md): visible
controls are custom, accessible Harvest components rather than browser/OS
widgets.

```bash
npm run control-room          # from the repository root
```

Keep the root `npm run dev` process running, then open <http://localhost:3002>.
The control room uses the Product API on `3001` and PostgreSQL to create and
load saved runs.

## Saved API runs and local playback

The control room never creates authoritative simulation state in the browser.
Selecting **Run simulation** calls the Product API, which completes and stores
the run before returning. The browser then loads the saved observable timeline
and handles play, pause, speed, rewind, scrub and reset locally:

- replay never repeats Product API actions or LLM calls;
- saved runs can be selected and replayed instantly;
- injecting a disruption creates a new derived run and preserves the source;
- Harvest agent actions and adapter provenance appear in purple in the feed;
- selecting a purple action opens its role, tool, status, approval class and
  safe trace/event references in the Inspector;
- a mapped participant can be opened in the normal website, read-only.

The scenario selector is populated by `GET /v1/simulation-scenarios`. It opens
on the full synthetic Caribbean scenario, whose scope can be narrowed with the
custom island picker. Every manifest island also has a focused runnable
scenario; `saint-lucia-demo-v1` remains the detailed benchmark.

### Reading the outcome cards

Harvest and baseline cards intentionally use different, clearly labelled
sources because only Harvest participants use the Product API:

- **Harvest product outcomes** come from the same run-scoped Product API
  records shown in participant workspaces: orders, approved commitments,
  completed missions and delivery acceptances.
- **Fragmented baseline outcomes** come from the physical simulation engine.
  Baseline actors do not call Harvest, so an empty Product API scope is the
  comparison boundary rather than missing data.

Engine frames still drive both policies' crops, weather, roads, spoilage and
disruptions. In connected Harvest runs, Product events schedule later physical
commitments/routes and the actual engine pickup quantity is sent back through
the Product delivery workflow. A final `RUN_SETTLED` frame at the scenario horizon makes the last
playback position agree with the stored result. These figures demonstrate a
synthetic end-to-end software workflow; they are not deployed impact.

`src/lib/run.ts` is the generated-client seam for run creation, saved-run
listing, timeline loading, derived disruptions and participant sessions.

The issue #29 backend can be tested independently using
[`docs/simulation_api_local_testing.md`](../../docs/simulation_api_local_testing.md).
Harvest runs contain run-scoped participant actors, crops, marketplace work,
orders, approvals, missions, events and safe traces. Baseline runs remain
engine-only and deliberately do not create those Product API records.

## Event injection

Injecting an event re-runs the scenario from the same seed with the disruption
added, rather than poking a live engine. The injected world therefore stays
reproducible from its seed plus its injections, and the whole timeline —
including the period before the disruption — remains scrubbable.

Severity is deliberately not adjustable. It is hidden simulation truth, and
letting whoever is driving the demo choose how bad a storm is would let them
dial the outcome. The engine draws it from a seeded stream instead.

The four control-room choices have deterministic physical meanings:

- a road closure postpones overlapping missions that collect from farms on
  that road;
- a vehicle breakdown postpones overlapping missions assigned to that vehicle;
- a storm adds seeded travel delay and accelerates spoilage while it is active;
- crop damage removes a seeded, capped share of the remaining unharvested crop
  at the selected farm.

These rules do not guarantee that a headline total changes. A closure that
misses every relevant route, or crop damage after the crop has already been
harvested, is an honest no-effect event. For a derived run, the panel compares
the final judge-visible totals with its immediate source run and says explicitly
when none changed. Product API exceptions are created only for delivery
missions whose physical schedule the engine actually changed.

An injection is scheduled one simulated hour after the current playhead. At or
too close to the final horizon the button is disabled and asks the viewer to
rewind; the API independently rejects an event starting exactly at the horizon.

## The globe

CesiumJS renders a real terrain globe. Moving between regions flies out to
globe scale, rotates the earth, and descends into the destination, which is
what `flyToRegion` in `src/components/globe/camera.ts` sequences.

**No Cesium ion token is required.** The default imagery is Esri's World
Imagery — real satellite photography, no account and no credential. Imagery
falls back in order: ion (only if `NEXT_PUBLIC_CESIUM_ION_TOKEN` is set) →
Esri satellite → OpenStreetMap. Each step is guarded, because a demo that
shows a blank blue sphere when a third-party tile service is having a bad
morning is worse than one that quietly falls back to a map. The token is
strictly an upgrade, never a dependency.

Sun lighting, ground and sky atmosphere, and distance fog are enabled: they are
what separate a textured sphere from something that reads as photographed from
orbit, and they cost nothing at a few hundred entities. The scene clock is
pinned to late morning over the Caribbean rather than following wall-clock or
simulation time. With lighting on, the terminator is real — at the wrong hour
the island is simply dark, and a control room that is unreadable half the day
is a bad control room. Following simulation time would be worse still, dropping
the map into night mid-run.

### Terrain

The globe carries **real elevation**, so zooming in shows the topography the
scenario's logistics actually contend with — Mount Gimie, the Pitons rising out
of the sea, and the steep valleys whose roads wash out in heavy rain.

The data is AWS's openly published Terrarium elevation tileset: CORS-enabled,
no key, no account. Cesium has no built-in provider for it, so
`src/components/globe/terrain.ts` implements one. Cesium's own global terrain
is an ion asset and would need a token; that remains an optional upgrade, never
a dependency. If the elevation service is unreachable, individual tiles fall
back to sea level rather than rejecting, because a rejected tile makes Cesium
stop refining that branch of the quadtree and leaves a permanent hole.

Markers clamp to the terrain surface, so nothing is buried inside a hillside.

**Photogrammetry mesh — the full Google Earth look with buildings — is not
available here.** Google's Photorealistic 3D Tiles work natively in Cesium but
need a Maps Platform key with billing and cover roughly 2,500 mostly North
American, European and Japanese cities; Saint Lucia is not among them. Cesium
OSM Buildings gives extruded footprints rather than photogrammetry, and OSM
building coverage on the island is sparse. For this island relief is the visual
win, not buildings.

Cesium loads its workers, shaders and widget assets at runtime by URL rather
than through the bundler. `scripts/copy-cesium.mjs` copies them from
`node_modules` into `public/cesium` on `predev`, `prebuild` and `pretest`. That
directory is roughly 40 MB of build artefact and is gitignored.

## Structures on the map

Below about 30 km the globe grows buildings: a barn and a crop field at each
farm, a store at each buyer, and trucks that drive the delivery routes. Above
that the markers take over, because a barn is a fraction of a pixel at the
island overview and drawing it there is noise.

Every shape is built procedurally from Cesium primitives rather than imported
as a glTF model. That keeps third-party binaries out of the repository, avoids
licence obligations, and — the reason that actually matters — lets a crop
field's colour come from the theme, so it can shift through the status ramp as
the crop ripens and rots. A textured model would need a separate texture per
state.

Fields and check-in rings are **draped onto the terrain** rather than extruded.
An extruded polygon is planar: on a valley side it floats at one end and buries
itself at the other. Classifying against terrain paints it onto the hillside
instead.

There are no walking figures, deliberately. A person is about 1.8 m; at the
island overview that is far below one pixel and even at region zoom it is a
couple of pixels of noise. Grower activity shows as the check-in ring and as
the crop changing state.

## Reading the interface

- **Crop colour** follows reported stage, not truth: teal is growing, green is
  ready, grey is harvested, red is spoiled.
- **A red dashed road** is currently degraded or closed.
- **The scrub bar** carries red ticks where disruptions became visible, so the
  timeline doubles as a summary of when things went wrong.

## If the globe looks black

Chrome throttles `requestAnimationFrame` almost to a stop in a background tab,
and Cesium renders from that loop. In a hidden or minimised window the globe
sits black and never loads its tiles, no matter what the code does. **Check it
in a visible, focused window before concluding anything is broken.** This cost
a long debugging detour once already.
- **The event feed** is written in plain English. The daily world tick is
  filtered out; if every routine heartbeat appeared, the events that matter
  would be buried, which is the "understandable without reading raw logs"
  criterion failing.

## Evidence status

Everything on screen is **synthetic**. The Saint Lucian geography is real and
the satellite imagery is real, but every farm, buyer, order, yield and delivery
is invented. The synthetic-simulation badge in the masthead is deliberately not
dismissible: a screenshot must not be able to separate a claim from its label.

Nothing shown here is measured impact from a deployed system, and it must never
be presented as such.
