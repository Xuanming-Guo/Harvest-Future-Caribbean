"use client";

/**
 * The 3D globe (issue #5): a Google-Earth-style augmented view of the Saint
 * Lucia scenario, with a camera that flies between regions rather than
 * cutting between them.
 *
 * Cesium touches `window` and WebGL at import time, so nothing in this file
 * may statically `import` the Cesium runtime — only its CSS (safe, inert
 * stylesheet) and its types (erased at compile time) are imported at the top
 * level. The runtime module is loaded with `await import('cesium')` inside
 * the mount effect, strictly after `window.CESIUM_BASE_URL` is set, which is
 * what lets Cesium find its Workers/Assets/ThirdParty under `/public/cesium`
 * without an ion token or a bundler asset pipeline.
 */

import "cesium/Build/Cesium/Widgets/widgets.css";

import { useEffect, useRef, useState } from "react";
import type { Cartesian2, ScreenSpaceEventHandler, Viewer } from "cesium";
import type { ControlRoomFrame, ControlRoomScene, GeoPoint } from "@harvest/simulation";
import { missionPositionAt } from "@harvest/simulation";

import { flyToRegion } from "./camera";
import { syncFrame, syncScene, type CesiumModule } from "./entities";
import { createTerrariumTerrainProvider } from "./terrain";

declare global {
  interface Window {
    /** Read by Cesium at module-init time to locate its static assets. */
    CESIUM_BASE_URL?: string;
  }
}

export interface CesiumGlobeProps {
  scene: ControlRoomScene;
  frame: ControlRoomFrame;
  atMs: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  focusRegion: string | null;
}

function overviewPoint(scene: ControlRoomScene): GeoPoint {
  const points = overviewPoints(scene);
  if (!points.length) return { latitude: 13.97, longitude: -60.97 };
  return { latitude: points.reduce((sum, point) => sum + point.latitude, 0) / points.length, longitude: points.reduce((sum, point) => sum + point.longitude, 0) / points.length };
}

function overviewPoints(scene: ControlRoomScene): GeoPoint[] {
  return [
    ...scene.farms.map((farm) => farm.position),
    ...scene.buyers.map((buyer) => buyer.position),
    ...scene.transporters.map((transporter) => transporter.homePosition),
    ...scene.referencePlaces.map((place) => place.position),
  ];
}

/** Keep a single island close while fitting regional selections into view. */
function overviewHeightMeters(scene: ControlRoomScene): number {
  const points = overviewPoints(scene);
  if (points.length < 2) return 78_000;
  const latitudes = points.map((point) => point.latitude);
  const longitudes = points.map((point) => point.longitude);
  const spanDegrees = Math.max(
    Math.max(...latitudes) - Math.min(...latitudes),
    Math.max(...longitudes) - Math.min(...longitudes),
  );
  // The floating side panels leave much less usable map area than the full
  // canvas, so use a deliberately generous scale for multi-island scopes.
  return Math.max(78_000, spanDegrees * 350_000);
}

/**
 * OpenStreetMap's standard tile layer: ODbL data, no account, no key.
 *
 * This is the default imagery (#58). It is a cartographic rendering rather
 * than photography, so the island reads as a map rather than a place at the
 * altitudes this demo flies to; that trade was made deliberately so the globe
 * runs on openly licensed tiles that match the licensed reference places.
 *
 * The public tile server's usage policy allows light demo traffic only. A
 * production deployment must point this at a dedicated tile host.
 */
const OSM_TILE_URL = "https://tile.openstreetmap.org/";

/**
 * OpenStreetMap publishes levels 0–19; requests beyond that return nothing.
 */
const OSM_MAXIMUM_LEVEL = 19;

/**
 * Esri's World Imagery: global satellite photography, no account, no key.
 *
 * Kept as the last-resort fallback because it looks better than a road atlas
 * when the demo is flying low, but its terms of use are stricter than OSM's,
 * so it is no longer the layer a fresh load reaches for first.
 */
const ESRI_WORLD_IMAGERY =
  "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer";

/**
 * Esri's tile endpoint, addressed directly.
 *
 * Note the `{z}/{y}/{x}` ordering: Esri serves `tile/{level}/{row}/{col}`,
 * which is row before column, the reverse of the `{z}/{x}/{y}` most slippy-map
 * services use. Getting this backwards silently fetches a valid tile from the
 * wrong place, which renders as plausible-looking but wrong terrain rather
 * than as an error.
 */
const ESRI_TILE_TEMPLATE = `${ESRI_WORLD_IMAGERY}/tile/{z}/{y}/{x}`;

/**
 * Esri publishes 24 levels, but levels past ~19 are not populated everywhere
 * and a request for one returns an empty dark tile rather than a 404.
 */
const ESRI_MAXIMUM_LEVEL = 19;

/**
 * Builds the base imagery layer, most openly licensed first.
 *
 * Ordered ion (if a token exists) → OpenStreetMap → Esri satellite. Each step
 * is wrapped because imagery is fetched over the network at construction time,
 * and a demo that shows a blank blue sphere when a third-party tile service is
 * having a bad morning is worse than one that quietly falls back.
 */
async function createBaseLayer(
  Cesium: CesiumModule,
  ionToken: string | undefined,
): Promise<InstanceType<CesiumModule["ImageryLayer"]>> {
  if (typeof ionToken === "string" && ionToken.length > 0) {
    try {
      return Cesium.ImageryLayer.fromProviderAsync(Cesium.createWorldImageryAsync(), {});
    } catch {
      // Fall through: a bad or expired token must not be fatal.
    }
  }

  try {
    const provider = new Cesium.OpenStreetMapImageryProvider({
      url: OSM_TILE_URL,
      maximumLevel: OSM_MAXIMUM_LEVEL,
      credit: new Cesium.Credit("© OpenStreetMap contributors", false),
    });
    return new Cesium.ImageryLayer(provider);
  } catch {
    // Fall through to Esri below.
  }

  // Addressed as a plain tile template rather than through
  // `ArcGisMapServerImageryProvider.fromUrl`.
  //
  // That provider derives its tiling scheme and level range from the
  // service's own metadata, and here it got them wrong: it requested
  // `tile/23/0/0` — the maximum level at the corner of the world — and
  // stretched that one dark ocean tile across the entire globe. The result
  // looked exactly like a globe that had failed to load any imagery at all,
  // when in fact every request was returning HTTP 200. Pinning the tiling
  // scheme and the level range makes the behaviour deterministic and
  // independent of whatever the service reports about itself.
  const provider = new Cesium.UrlTemplateImageryProvider({
    url: ESRI_TILE_TEMPLATE,
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
    maximumLevel: ESRI_MAXIMUM_LEVEL,
    credit: new Cesium.Credit("Imagery: Esri World Imagery", false),
  });
  return new Cesium.ImageryLayer(provider);
}

/**
 * Scene settings that sell the globe as a globe.
 *
 * Sun lighting, ground and sky atmosphere, and distance fog are what separate a
 * textured sphere from something that reads as photographed from orbit. They
 * cost nothing at this scene complexity — a few hundred entities.
 *
 * The clock is pinned to late morning over the Caribbean rather than following
 * either wall-clock or simulation time. With lighting enabled the terminator is
 * real: at the wrong hour the island is simply dark, and a control room that is
 * unreadable half the day is a bad control room. Simulation time would be worse
 * still, plunging the map into night in the middle of a run.
 */
function applyPhotorealisticScene(Cesium: CesiumModule, viewer: Viewer): void {
  const { scene } = viewer;
  const { globe } = scene;

  globe.enableLighting = true;
  globe.showGroundAtmosphere = true;
  // Left at Cesium's default. Lowering it to 1.5 for sharper tiles multiplied
  // the number of tiles the opening view needs, and on a cold cache that
  // pushed the first paint past ten seconds — during which the globe is an
  // unlit black sphere. Sharpness is not worth a demo that looks broken for
  // its first ten seconds.
  globe.maximumScreenSpaceError = 2;

  // Optional in the scene's type: absent in 2D and Columbus View, which this
  // viewer never enters, but worth guarding rather than asserting.
  if (scene.skyAtmosphere) scene.skyAtmosphere.show = true;
  scene.fog.enabled = true;

  viewer.clock.shouldAnimate = false;
  viewer.clock.currentTime = Cesium.JulianDate.fromIso8601("2026-09-01T14:30:00Z");
}

/** Give up waiting for imagery after this long and show the globe regardless. */
const TILE_WAIT_TIMEOUT_MS = 12_000;

/**
 * Resolves once the globe has no outstanding tiles, or the timeout expires.
 *
 * The timeout is not optional. If the tile service is unreachable the queue
 * never drains, and without a ceiling the control room would sit on its
 * loading message indefinitely — strictly worse than showing a bare globe with
 * the markers and timeline working over it.
 */
function waitForTiles(viewer: Viewer): Promise<void> {
  return new Promise((resolve) => {
    if (viewer.isDestroyed() || viewer.scene.globe.tilesLoaded) {
      resolve();
      return;
    }

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      remove();
      resolve();
    };

    const remove = viewer.scene.globe.tileLoadProgressEvent.addEventListener((queued: number) => {
      if (queued === 0) finish();
    });
    const timer = window.setTimeout(finish, TILE_WAIT_TIMEOUT_MS);
  });
}

function midpoint(a: GeoPoint, b: GeoPoint): GeoPoint {
  return { latitude: (a.latitude + b.latitude) / 2, longitude: (a.longitude + b.longitude) / 2 };
}

/**
 * Resolves a selected domain id to a place the camera can fly to.
 *
 * Deliberately looked up from the scene/frame data rather than from the
 * rendered entities: it has to work the instant `focusRegion` changes, before
 * any entity-sync effect has necessarily run, and it stays correct even for
 * ids (a road, a mission mid-flight) that do not have a single fixed point.
 * Ids this cannot place (an actor, a disruption) simply leave the camera
 * where it is rather than jumping somewhere misleading.
 */
function resolveFocusPoint(
  scene: ControlRoomScene,
  frame: ControlRoomFrame,
  atMs: number,
  id: string,
): GeoPoint | null {
  const farm = scene.farms.find((candidate) => candidate.farmId === id);
  if (farm) return farm.position;

  const buyer = scene.buyers.find((candidate) => candidate.buyerId === id);
  if (buyer) return buyer.position;

  const transporter = scene.transporters.find((candidate) => candidate.transporterId === id);
  if (transporter) return transporter.homePosition;

  const referencePlace = scene.referencePlaces.find((candidate) => candidate.referencePlaceId === id);
  if (referencePlace) return referencePlace.position;

  const road = scene.roads.find((candidate) => candidate.roadSegmentId === id);
  if (road) return midpoint(road.from, road.to);

  const mission = frame.missions.find((candidate) => candidate.missionId === id);
  if (mission) return missionPositionAt(mission, atMs) ?? mission.path[0] ?? null;

  return null;
}

export default function CesiumGlobe(props: CesiumGlobeProps): React.JSX.Element {
  const { scene, frame, atMs, selectedId, onSelect, focusRegion } = props;
  const sceneRef = useRef(scene);
  sceneRef.current = scene;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const cesiumRef = useRef<CesiumModule | null>(null);

  // `onSelect` is called from a Cesium event handler set up once on mount; a
  // ref keeps that handler reading the latest callback without needing to be
  // torn down and recreated whenever the parent passes a new function
  // identity.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const [ready, setReady] = useState(false);

  // Mount: build the viewer exactly once. React 19 StrictMode runs effects
  // twice in development to surface missing cleanup; the `cancelled` flag
  // stops the first run's async setup from installing a viewer after its own
  // cleanup has already fired, which would otherwise leak a second WebGL
  // context against the same container.
  useEffect(() => {
    let cancelled = false;
    let handler: ScreenSpaceEventHandler | null = null;

    async function setup(): Promise<void> {
      window.CESIUM_BASE_URL = "/cesium";
      const Cesium = await import("cesium");
      if (cancelled || !containerRef.current) return;

      // No ion token is provisioned for this demo, and none is required. A
      // token is honoured if the deployment happens to provide one, but its
      // absence must never blank the screen.
      const ionToken = process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN;
      if (typeof ionToken === "string" && ionToken.length > 0) {
        Cesium.Ion.defaultAccessToken = ionToken;
      }

      const baseLayer = await createBaseLayer(Cesium, ionToken);
      if (cancelled || !containerRef.current) return;

      const viewer = new Cesium.Viewer(containerRef.current, {
        // `imageryProvider` was removed from this Cesium version's
        // ConstructorOptions in favour of `baseLayer` (valid precisely when
        // `baseLayerPicker` is false, which it is here).
        baseLayer,
        animation: false,
        timeline: false,
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        fullscreenButton: false,
        infoBox: false,
        selectionIndicator: false,
      });

      if (cancelled) {
        viewer.destroy();
        return;
      }

      viewerRef.current = viewer;
      cesiumRef.current = Cesium;

      applyPhotorealisticScene(Cesium, viewer);

      // Real elevation. Attached after construction rather than passed as a
      // viewer option so a failure here degrades to a smooth globe instead of
      // preventing the viewer from existing at all.
      try {
        viewer.scene.setTerrain(new Cesium.Terrain(Promise.resolve(createTerrariumTerrainProvider(Cesium))));
        // Without depth testing, markers and routes draw through hills they
        // are genuinely behind, which reads worse than having no relief.
        viewer.scene.globe.depthTestAgainstTerrain = true;
      } catch {
        // Keep the ellipsoid; the control room is still usable without relief.
      }

      handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      handler.setInputAction((movement: { position: Cartesian2 }) => {
        if (viewer.isDestroyed()) return;
        const picked = viewer.scene.pick(movement.position);
        // `picked.id` is the Cesium.Entity for anything built in entities.ts
        // (every one of which is given the matching domain id), and
        // `undefined` for empty space or unpickable primitives such as the
        // OSM imagery itself.
        const entity = picked?.id;
        onSelectRef.current(entity instanceof Cesium.Entity ? String(entity.id) : null);
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

      // Open on the island rather than Cesium's default whole-earth view, so
      // the first frame already looks like the finished product.
      await flyToRegion(viewer, null, {
        immediate: true,
        overview: overviewPoint(sceneRef.current),
        overviewHeightM: overviewHeightMeters(sceneRef.current),
      });

      // Hold the loading overlay until imagery has actually arrived.
      //
      // Revealing the canvas as soon as the viewer exists shows an unlit black
      // sphere for as long as the first tiles take to fetch, which on a cold
      // cache is several seconds and reads unmistakably as "broken" rather
      // than "loading". This cost me a long debugging detour: every screenshot
      // I took of the "black globe" was in fact taken mid-load.
      await waitForTiles(viewer);
      if (!cancelled) setReady(true);
    }

    void setup();

    return () => {
      cancelled = true;
      handler?.destroy();
      const viewer = viewerRef.current;
      viewerRef.current = null;
      cesiumRef.current = null;
      setReady(false);
      if (viewer && !viewer.isDestroyed()) viewer.destroy();
    };
  }, []);

  // Static furniture is rebuilt only when the scene identity changes (a new
  // run), never on every frame tick.
  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (!ready || !viewer || !Cesium || viewer.isDestroyed()) return;
    syncScene(Cesium, viewer, scene);
  }, [ready, scene]);

  // Per-frame state: crop-stage colours, road closures, mission positions,
  // disruption markers and the selection halo. `syncFrame` mutates existing
  // entities rather than rebuilding them, so this is safe to run on every
  // tick of playback.
  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (!ready || !viewer || !Cesium || viewer.isDestroyed()) return;
    syncFrame(Cesium, viewer, scene, frame, atMs, selectedId);
  }, [ready, scene, frame, atMs, selectedId]);

  // The camera flight: only fires when `focusRegion` actually changes value,
  // not on every frame tick that happens to re-run this effect.
  const previousFocusRef = useRef<string | null>(null);
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer || viewer.isDestroyed()) return;
    if (previousFocusRef.current === focusRegion) return;
    previousFocusRef.current = focusRegion;

    if (focusRegion === null) {
      void flyToRegion(viewer, null, {
        overview: overviewPoint(scene),
        overviewHeightM: overviewHeightMeters(scene),
      });
      return;
    }
    const point = resolveFocusPoint(scene, frame, atMs, focusRegion);
    if (point) void flyToRegion(viewer, point);
  }, [ready, focusRegion, scene, frame, atMs]);

  return (
    <div ref={containerRef} style={{ position: "absolute", inset: 0 }}>
      {!ready && <div className="globe-loading">Preparing the globe…</div>}
    </div>
  );
}
