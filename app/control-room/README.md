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

**No Cesium ion token is required.** The default imagery is OpenStreetMap,
which needs no account and no credential. If a `NEXT_PUBLIC_CESIUM_ION_TOKEN`
is present the higher-resolution ion imagery is used instead. A demo that dies
without a third-party credential is a bad demo, so the token is strictly an
upgrade and never a dependency.

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
