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

/**
 * Esri's World Imagery: global satellite photography, no account, no key.
 *
 * This is the difference between the globe reading as a real place and reading
 * as a road atlas. OpenStreetMap tiles are a *cartographic* rendering — roads,
 * labels, flat green landcover — so at the altitudes this demo flies to, the
 * island looked drawn rather than photographed.
 */
const ESRI_WORLD_IMAGERY =
  "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer";

/**
 * Builds the base imagery layer, best available first.
 *
 * Ordered ion (if a token exists) → Esri satellite → OpenStreetMap. Each step
 * is wrapped because imagery is fetched over the network at construction time,
 * and a demo that shows a blank blue sphere when a third-party tile service is
 * having a bad morning is worse than one that quietly falls back to a map.
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
    const provider = await Cesium.ArcGisMapServerImageryProvider.fromUrl(ESRI_WORLD_IMAGERY, {
      // Nothing in this interface queries the imagery for features, and
      // leaving it on makes every click issue an identify request.
      enablePickFeatures: false,
    });
    return new Cesium.ImageryLayer(provider);
  } catch {
    return new Cesium.ImageryLayer(
      new Cesium.OpenStreetMapImageryProvider({ url: "https://tile.openstreetmap.org/" }),
    );
  }
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
  // Sharper tiles at altitude. The default of 2 is tuned for huge terrain
  // datasets; this scene is one small island.
  globe.maximumScreenSpaceError = 1.5;

  // Optional in the scene's type: absent in 2D and Columbus View, which this
  // viewer never enters, but worth guarding rather than asserting.
  if (scene.skyAtmosphere) scene.skyAtmosphere.show = true;
  scene.fog.enabled = true;

  viewer.clock.shouldAnimate = false;
  viewer.clock.currentTime = Cesium.JulianDate.fromIso8601("2026-09-01T14:30:00Z");
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

  const road = scene.roads.find((candidate) => candidate.roadSegmentId === id);
  if (road) return midpoint(road.from, road.to);

  const mission = frame.missions.find((candidate) => candidate.missionId === id);
  if (mission) return missionPositionAt(mission, atMs) ?? mission.path[0] ?? null;

  return null;
}

export default function CesiumGlobe(props: CesiumGlobeProps): React.JSX.Element {
  const { scene, frame, atMs, selectedId, onSelect, focusRegion } = props;

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
      await flyToRegion(viewer, null, { immediate: true });
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
      void flyToRegion(viewer, null);
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
