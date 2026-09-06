/**
 * Camera choreography for the control room globe.
 *
 * The product ask (issue #5) is specifically Google-Earth-like: moving between
 * regions should read as a single continuous journey over a real globe, not a
 * cut between two flat maps. `flyToRegion` is the one function that produces
 * that journey — everything else in the globe just tells it where to go.
 *
 * This module never imports the Cesium runtime at the top level. `CesiumGlobe`
 * is careful to set `window.CESIUM_BASE_URL` before Cesium's modules first
 * execute; a static `import ... from 'cesium'` here would run at module-graph
 * evaluation time, which can happen before that guard is in place if this file
 * is pulled in by a static import elsewhere. `flyToRegion` is only ever called
 * once a `Viewer` already exists, so the dynamic import below simply resolves
 * an already-loaded module — no behavioural cost, just a safer load order.
 */

import type { Viewer } from "cesium";

/** A minimal geographic point, matching `GeoPoint` from `@harvest/simulation`. */
export interface RegionTarget {
  latitude: number;
  longitude: number;
}

/** Saint Lucia overview: `target: null` returns here rather than to nowhere. */
/**
 * The island overview.
 *
 * Centred on the mid-latitude of the *actors*, not of the island. The
 * scenario's northernmost buyer sits at 14.076 (Rodney Bay) and its
 * southernmost at 13.857 (Soufriere), so centring on the island's own midpoint
 * pushed Rodney Bay off the top edge — the opening shot of the demo was missing
 * a buyer.
 *
 * The height is generous for the same reason: the chrome panels overlay roughly
 * 660 px of the viewport's width, so the usable window onto the globe is a good
 * deal narrower than the canvas, and a framing that looks correct against the
 * full canvas clips against the visible part of it.
 */
const ISLAND_OVERVIEW: RegionTarget = { latitude: 13.97, longitude: -60.97 };
const ISLAND_OVERVIEW_HEIGHT_M = 78_000;

/** High enough that the globe's curvature and limb are visible — this is the
 * "fly out" leg of the journey, not just a tall zoom. */
const TRANSIT_HEIGHT_M = 12_000_000;

/** Close enough to read as an oblique aerial view of a farm or depot. */
const APPROACH_HEIGHT_M = 4_000;
const APPROACH_PITCH_DEGREES = -35;
const OVERVIEW_PITCH_DEGREES = -90;

const TRANSIT_DURATION_S = 1.4;
const APPROACH_DURATION_S = 1.8;

/**
 * Guards against overlapping flights. Cesium has no built-in flight queue —
 * calling `flyTo` again while one is animating just fights the previous call
 * for the camera. Incrementing a token on every call and checking it in the
 * completion callback lets a later call silently supersede an earlier one
 * instead of both fighting for the same camera.
 */
let flightToken = 0;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Flies the camera to a region, or to the island overview when `target` is
 * `null`.
 *
 * A region-to-region move is deliberately two `flyTo` legs rather than one:
 * first out to `TRANSIT_HEIGHT_M` above the rough midpoint of the journey
 * (the "fly out and rotate" the user asked for), then down into the
 * destination at an oblique pitch (the "zoom into the new region"). A single
 * `flyTo` from A to B would arc smoothly between the two altitudes and never
 * read as leaving the surface.
 */
export async function flyToRegion(
  viewer: Viewer,
  target: RegionTarget | null,
  options?: { immediate?: boolean; overview?: RegionTarget; overviewHeightM?: number },
): Promise<void> {
  if (viewer.isDestroyed()) return;

  const Cesium = await import("cesium");
  if (viewer.isDestroyed()) return; // the viewer can die while this import resolves

  const token = ++flightToken;
  const destination = target ?? options?.overview ?? ISLAND_OVERVIEW;
  const destinationHeight = target ? APPROACH_HEIGHT_M : options?.overviewHeightM ?? ISLAND_OVERVIEW_HEIGHT_M;
  const destinationPitch = target ? APPROACH_PITCH_DEGREES : OVERVIEW_PITCH_DEGREES;
  const immediate = options?.immediate === true || prefersReducedMotion() || document.hidden;

  const finalDestination = Cesium.Cartesian3.fromDegrees(
    destination.longitude,
    destination.latitude,
    destinationHeight,
  );
  const finalOrientation = {
    heading: 0,
    pitch: Cesium.Math.toRadians(destinationPitch),
    roll: 0,
  };

  if (immediate) {
    viewer.camera.setView({ destination: finalDestination, orientation: finalOrientation });
    return;
  }

  // Rough midpoint between where the camera currently looks and where it is
  // going. It does not need to be a true great-circle midpoint — it only has
  // to sit visibly between the two, high enough up, for the earth to appear
  // to rotate underneath it during the transit leg.
  const currentCarto = Cesium.Cartographic.fromCartesian(viewer.camera.positionWC);
  const originLongitude = Cesium.Math.toDegrees(currentCarto.longitude);
  const originLatitude = Cesium.Math.toDegrees(currentCarto.latitude);
  const midLongitude = (originLongitude + destination.longitude) / 2;
  const midLatitude = (originLatitude + destination.latitude) / 2;

  return new Promise<void>((resolve) => {
    const settle = () => resolve();

    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(midLongitude, midLatitude, TRANSIT_HEIGHT_M),
      orientation: { heading: 0, pitch: Cesium.Math.toRadians(OVERVIEW_PITCH_DEGREES), roll: 0 },
      duration: TRANSIT_DURATION_S,
      complete: () => {
        // A newer call superseded this one, or the viewer died mid-flight:
        // stop here rather than starting the descent leg into a stale target.
        if (viewer.isDestroyed() || token !== flightToken) {
          settle();
          return;
        }
        viewer.camera.flyTo({
          destination: finalDestination,
          orientation: finalOrientation,
          duration: APPROACH_DURATION_S,
          complete: settle,
          cancel: settle,
        });
      },
      cancel: settle,
    });
  });
}
