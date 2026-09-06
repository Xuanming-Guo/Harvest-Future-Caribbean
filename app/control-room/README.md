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
- licensed public reference places appear as quieter category markers, with
  labels only at close range and full provenance in the Inspector;
- source and licence attribution remains visible whenever reference places are
  present, collapsed by default to a single credit line under the globe — the
  OpenStreetMap credit, the scene's other reference datasets named in words,
  and a **Sources** button that opens the full publishers, licences, retrieval
  dates upward over it;
- injecting a disruption creates a new derived run and preserves the source;
- Harvest agent actions and adapter provenance appear in purple in the feed,
  and a forecast-producing action also names the estimation method that ran;
- selecting a purple action opens its role, tool, status, approval class and
  safe trace/event references in the Inspector, and offers **Preview in
  Harvest**;
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

## Harvest estimation method

The setup toolbar carries a **Harvest estimation** segmented control with two
alternatives, saved with the run rather than set on the server:

- **Harvest estimation model** calls the FastAPI quantile service. If that
  service is unreachable or rejects the request, the run fails with
  `MODEL_UNAVAILABLE` and writes no forecasts. It never quietly falls back,
  because a run labelled as learned-model output has to be exactly that.
- **Deterministic fallback** uses the rule-based fixture, so crop, safe-supply,
  listing and marketplace workflows all keep working without the model service.
  Every forecast it produces is labelled in the API payload, the saved trace,
  the agent-action provenance and the participant crop page, so it cannot be
  read as a learned prediction.

Two alternatives that stay visible beat a collapsed menu here, because the
choice changes what the run actually does. The control is disabled while
**Baseline** is selected: baseline participants never call the Product API or
a forecast model, so the run records the choice and ignores it. The masthead
badge names the loaded run's method, and marks it `(unused)` on a Baseline run,
so a screenshot cannot separate a fallback run from a learned one.

Participants cannot change the method. The website's crop page shows an
**Estimated by** line naming the method and model version, and nothing else.

## Preview in Harvest

Selecting a saved agent action and pressing **Preview in Harvest** opens a
closable panel containing the real participant website, framed on the same
15-minute read-only session as **Open participant website**. The website then
scrolls to the control a person would use for that tool, rings it, and captions
what was recorded: participant, simulation time, entity, action, and outcome.
`Escape` or **Close** dismisses it.

It is a reenactment, not automation, and the panel says so. Agents call typed
Product API tools; they never drive a browser, so there are no input events to
replay. What is replayed is the *description* of a saved action, drawn over the
live interface.

Three separate things stop a preview from changing anything. The overlay is
inert (`pointer-events: none`), the framed workspace is already inside a
disabled fieldset because the session is read-only, and the Product API refuses
every write from a replay session. The outermost of the three is the API's.

The panel is capped short of the bottom of the window so the transport row stays
uncovered: playback keeps running, or stays paused, exactly as it was.

### What crosses into the frame

The frame gets one `postMessage` after it asks for one, containing exactly
`tool`, `entityIds`, `summary`, `status`, `simulationTime`, `participantName`,
`role` and the `actionId` that matches the `?preview=` flag in its URL. The
payload is built by naming those fields one at a time in
`src/lib/action-preview.ts`, never by spreading a recorded action, so a private
field added to `SimulationAgentAction` later cannot ride along. Trace,
correlation and causation ids stay in the Inspector. No chain of thought, no
hidden simulation truth, and nothing belonging to another participant.

Both ends check `event.origin` and ignore anything from elsewhere.

### Mapping a tool to a control

`app/website/src/lib/action-preview.ts` maps every `ProductTools` tool to a
route and an ordered chain of `data-tour` targets, reusing the attribute the
first-session tutorial already puts on those controls. The chain falls back from
the control, to the section that owns it, to the page: a saved run is a finished
world, so the approval that was decided is decided and its live button has
usually gone. Highlighting the section that owned a spent control is honest;
drawing a fake live button would not be.

A tool with no visual equivalent captions "No visual mapping for this action yet"
and shows the recorded detail instead of opening an unrelated page.
`app/website/tests/action-preview-map.test.ts` reads the tool list out of
`app/api/src/simulation-agents.ts` and fails on a tool nobody mapped or a
`data-tour` target no page renders any more.

Motion is one pulsing ring and a pointer; under `prefers-reduced-motion` the
pointer is dropped and the ring becomes a static highlight.

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

**No Cesium ion token is required.** The default imagery is OpenStreetMap's
standard tile layer — ODbL data, no account and no credential, matching the
licence posture of the reference places. Imagery falls back in order: ion
(only if `NEXT_PUBLIC_CESIUM_ION_TOKEN` is set) → OpenStreetMap → Esri World
Imagery. Each step is guarded, because a demo that shows a blank blue sphere
when a third-party tile service is having a bad morning is worse than one that
quietly falls back. The token is strictly an upgrade, never a dependency.

OpenStreetMap's public tile server permits light demo traffic only. A hosted
deployment should point `OSM_TILE_URL` in `CesiumGlobe.tsx` at a dedicated
tile provider before opening the control room to more than a demo audience.

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

## Weather overlay

The globe draws the weather the saved run recorded, per island, for whatever
frame the transport is showing. Three marks, and no more than three, because
the point is to see where the sky is doing something that matters:

- a **translucent disc** at cloud height, whose colour is the condition and
  whose opacity comes from `cloudCoverFraction` and `rainMm` together. A clear
  day is a barely-there haze; a storm is a deep indigo. That difference is the
  whole reason the disc reads at a glance;
- a **ring** around an island under a storm, and only a storm;
- an **arrow** showing which way the wind is blowing, sized by `windKph` and
  rotated from `windFromDegrees` (which is the direction the wind blows *from*,
  so the arrow points the opposite way).

Weather borrows none of the `--status-*` hues. Those map one operational state
to one colour each, and a rain cloud is not a crop stage.

**It uses saved replay data only.** Everything comes off `frame.weather`, which
issue #37 records with the run: no request on load, none on scrub, and no live
weather service anywhere. Play, pause, rewind, reset, speed and scrubbing all
arrive as a different `frame`, so the overlay follows them for free and a
rewind puts the sky back exactly as it was. Nothing here is ever a day the
replay has not reached.

The **Weather** switch in the map key turns the layer off. That hides its
entities and does nothing else — the simulation, the replay and every other
layer are untouched, and switching it back on restores the same picture.

Overlay entities are named under a `weather::` prefix and the globe's click
handler drills through them, so farms, buyers, vehicles, routes, reference
places and disruption markers stay clickable underneath a disc that covers the
whole island.

### Motion, and when it stops

The pulse and the cloud's downwind drift are functions of **simulation time**,
not wall-clock time. Pausing freezes them, scrubbing backwards returns them to
the state they had, and the same instant always renders the same frame — a
`requestAnimationFrame` phase would give none of that, and a screenshot of a
paused globe would not be reproducible.

Motion stops entirely, leaving static discs, a static ring and the arrow, when:

- the operating system asks for reduced motion (`prefers-reduced-motion`);
- the machine reports four or fewer logical cores, which is the supported low
  end of the demo hardware;
- a WebGL context cannot be created for the effect.

If Cesium itself is unavailable the overlay is simply absent, like the rest of
the globe; and a replay saved before #37 carries no weather, in which case the
layer draws nothing rather than inventing any.

### Reading the numbers

The map key carries the condition swatches and a **Weather now** readout for
the frame on screen: island, date, condition, rainfall in mm, wind in kph with
a compass point, temperature band, and the forecast with its own confidence.
Weather provenance remains in saved run data. The interface shows readings and
forecast confidence without explanatory badges or paragraphs.

## Reading the interface

- **Crop colour** follows reported stage, not truth: teal is growing, green is
  ready, grey is harvested, red is spoiled.
- **A red dashed road** is currently degraded or closed.
- **The scrub bar** carries red ticks where disruptions became visible, so the
  timeline doubles as a summary of when things went wrong.
- **Weather** is a translucent disc over each island, ringed when it is a
  storm, with an arrow for the wind. It is drawn from the saved frame, and the
  **Weather** switch in the map key hides it.

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

Everything operational on screen is **synthetic**. Map tiles and the
named OpenStreetMap reference places are public geographic context, but every
farm, buyer, order, yield and delivery is invented. Selecting a reference shows
its source, licence and retrieval metadata. The interface keeps source credits and concise operational labels; explanatory
badges and disclaimer paragraphs are omitted.

Nothing shown here is measured impact from a deployed system, and it must never
be presented as such.


## Caribbean explorer (#112)

The saved-run workspace opens on a Caribbean overview. **Islands** searches all
28 catalogue islands and territories; choosing one flies to its published camera
location without altering the run scope. Islands outside the saved run are
explicitly geographic context, with no implied simulated activity.

**A → B route** accepts two clicks on mapped participants or two accessible point
selections. It finds the shortest distance on the saved, undirected road graph,
using each segment's recorded distance. Unconnected public places and cross-island
pairs show **No route available**. No access roads, maritime transfers,
travel times or actual road geometry are invented. Route distances use the saved graph; this exploration tool creates no operational state.
Recorded degraded segments are flagged, rather than equated with road closures.
Roads and sea-link lines are hidden by default; mission paths appear only when
selected, while vehicle markers and weather remain visible.

Run setup is collapsible; outcomes, disruptions, participant replay and the map
key remain under **Outcomes & scenario tools**. **Activity** reveals the inspector
and event feed. Custom searchable menus preserve keyboard selection and Escape.
The map pauses rendering when its WebGL drawing buffer has zero dimensions during
an embedded-browser resize, and resumes when a drawable surface is available.

The browser follow-up in #117 gives the desktop island directory its own
scrollable area without a second outer scrollbar, leaves mobile explorer and
playback controls separated, and preserves simultaneous activity events using
frame ordinals instead of non-unique timestamp/type keys.
