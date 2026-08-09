# Control room

The simulation control room: a 3D globe view of the Saint Lucia scenario, on
port `3002`. It is where the team and judges watch the simulated food system
change over time, and it is separate from the participant website on `3000`,
which is a role-facing product interface rather than an operations console.

```bash
npm run control-room          # from the repository root
```

Then open <http://localhost:3002>. Nothing else needs to be running — no
database, no Product API.

## Why the simulation runs in the browser

The engine is pure TypeScript with no Node dependencies, so the control room
runs it directly and replays the recorded frames. That is a deliberate choice
rather than a shortcut:

- **A full run costs a few milliseconds.** A network round trip to a simulation
  service would be slower than the computation it was avoiding.
- **Scrubbing backwards is a requirement.** Issue #5 asks for play, pause,
  speed and reset. A live engine cannot run in reverse; a recorded timeline can
  be indexed in either direction.
- **Changing seed, policy or injected disruption is instantaneous**, which is
  what makes the baseline-versus-Harvest comparison something you can
  demonstrate rather than describe.

`src/lib/run.ts` is the seam. When the simulation service described in
`contracts/simulation/openapi.yaml` exists, `buildTimeline` becomes a `fetch`
and nothing above it changes.

## Event injection

Injecting an event re-runs the scenario from the same seed with the disruption
added, rather than poking a live engine. The injected world therefore stays
reproducible from its seed plus its injections, and the whole timeline —
including the period before the disruption — remains scrubbable.

Severity is deliberately not adjustable. It is hidden simulation truth, and
letting whoever is driving the demo choose how bad a storm is would let them
dial the outcome. The engine draws it from a seeded stream instead.

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
