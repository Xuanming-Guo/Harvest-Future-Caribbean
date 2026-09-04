/**
 * The globe's weather layer (issue #39).
 *
 * Draws, per island and per replay frame, the smallest combination that makes
 * the sky readable: a translucent cloud/rain disc whose opacity comes from
 * cloud cover and rainfall, a pulsing ring around a storm, and an arrow
 * pointing the way the wind is blowing.
 *
 * Like `entities.ts` this module is upsert-shaped — `syncWeatherLayer` mutates
 * the same entities every tick rather than rebuilding them — and it only ever
 * imports Cesium's *types*; the runtime module is handed in by `CesiumGlobe`,
 * which already holds it.
 *
 * ## Why these entities are never picked
 *
 * The overlay covers the whole island, so if it were pickable it would swallow
 * every click meant for a farm, buyer, vehicle, route or disruption marker
 * underneath it. Entity graphics have no `allowPicking` flag (that lives on
 * Cesium's lower-level primitives), so the layer gives every entity an id under
 * `weather::` and the click handler drills through anything carrying that
 * prefix. Both halves matter: the prefix is what makes an overlay entity
 * recognisable, and drilling is what keeps the thing beneath it selectable
 * rather than merely deselecting.
 */

import type { Entity, Viewer } from "cesium";

import type { CesiumModule } from "./entities";
import { WIND_ARROW_COLOUR, type WeatherOverlayDescriptor } from "@/lib/weather-overlay";

/** Every entity this layer owns is named under this prefix. Nothing else may use it. */
export const WEATHER_ENTITY_PREFIX = "weather::";

export function isWeatherEntityId(id: unknown): boolean {
  return typeof id === "string" && id.startsWith(WEATHER_ENTITY_PREFIX);
}

/** Points around the storm ring. Sixty-four is smooth at every altitude the camera reaches. */
const RING_SEGMENTS = 64;

const RING_WIDTH_PIXELS = 3;
const ARROW_ICON_PIXELS = 44;

/** Metres per degree of latitude, matching `weather-overlay.ts`. */
const METRES_PER_DEGREE = 111_320;

let arrowIconCache: string | null = null;

/**
 * A north-pointing arrow, drawn once into a canvas and cached.
 *
 * North-pointing because Cesium rotates a billboard counter-clockwise about
 * its centre, so an arrow whose rest position is "up" can be aimed at any
 * compass bearing by negating it — which is exactly what
 * `WeatherOverlayDescriptor.windRotationRadians` carries. Drawn rather than
 * imported so the repository gains no binary asset and no licence obligation.
 */
function windArrowIcon(): string {
  if (arrowIconCache) return arrowIconCache;
  const size = ARROW_ICON_PIXELS;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const mid = size / 2;
  ctx.strokeStyle = "#0d1f1a";
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // Outline first, then the pale fill over it, so the arrow survives being
  // drawn over both a bright cloud disc and dark open water.
  for (const [colour, width] of [["#0d1f1a", 6] as const, [WIND_ARROW_COLOUR, 3] as const]) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(mid, size - 5);
    ctx.lineTo(mid, 6);
    ctx.moveTo(mid - 7, 14);
    ctx.lineTo(mid, 5);
    ctx.lineTo(mid + 7, 14);
    ctx.stroke();
  }
  arrowIconCache = canvas.toDataURL();
  return arrowIconCache;
}

function discId(islandId: string): string {
  return `${WEATHER_ENTITY_PREFIX}disc::${islandId}`;
}

function ringId(islandId: string): string {
  return `${WEATHER_ENTITY_PREFIX}ring::${islandId}`;
}

function windId(islandId: string): string {
  return `${WEATHER_ENTITY_PREFIX}wind::${islandId}`;
}

/** Ids this layer has created, so an island that drops out can be hidden rather than left behind. */
const weatherEntityIds = new Set<string>();

function ringPositions(Cesium: CesiumModule, descriptor: WeatherOverlayDescriptor): number[] {
  const { centre, ringRadiusMeters, heightMeters } = descriptor;
  const lonScale = Math.max(0.05, Math.cos(Cesium.Math.toRadians(centre.latitude)));
  const coordinates: number[] = [];
  for (let step = 0; step <= RING_SEGMENTS; step += 1) {
    const angle = (step / RING_SEGMENTS) * 2 * Math.PI;
    const north = Math.cos(angle) * ringRadiusMeters;
    const east = Math.sin(angle) * ringRadiusMeters;
    coordinates.push(
      centre.longitude + east / (METRES_PER_DEGREE * lonScale),
      centre.latitude + north / METRES_PER_DEGREE,
      heightMeters,
    );
  }
  return coordinates;
}

/**
 * Upserts the layer for one frame.
 *
 * `visible === false` hides every entity and returns; it never removes them and
 * never touches anything outside the `weather::` namespace, which is what makes
 * the on/off control purely presentational. The replay data is untouched either
 * way — turning the overlay off hides discs, it does not change a run.
 */
export function syncWeatherLayer(
  Cesium: CesiumModule,
  viewer: Viewer,
  descriptors: WeatherOverlayDescriptor[],
  visible: boolean,
): void {
  if (viewer.isDestroyed()) return;

  if (!visible) {
    for (const id of weatherEntityIds) {
      const entity = viewer.entities.getById(id);
      if (entity) entity.show = false;
    }
    return;
  }

  const live = new Set<string>();

  for (const descriptor of descriptors) {
    live.add(syncDisc(Cesium, viewer, descriptor).id);
    live.add(syncRing(Cesium, viewer, descriptor).id);
    const arrow = syncWindArrow(Cesium, viewer, descriptor);
    if (arrow) live.add(arrow.id);
  }

  // An island that has left the frame (a narrowed scope, a replay without
  // weather) keeps its entities but stops showing them.
  for (const id of weatherEntityIds) {
    if (live.has(id)) continue;
    const entity = viewer.entities.getById(id);
    if (entity) entity.show = false;
  }
}

function remember(entity: Entity): Entity {
  weatherEntityIds.add(String(entity.id));
  return entity;
}

function syncDisc(Cesium: CesiumModule, viewer: Viewer, descriptor: WeatherOverlayDescriptor): Entity {
  const id = discId(descriptor.islandId);
  const position = Cesium.Cartesian3.fromDegrees(
    descriptor.discCentre.longitude,
    descriptor.discCentre.latitude,
    descriptor.heightMeters,
  );
  const colour = Cesium.Color.fromCssColorString(descriptor.discColour).withAlpha(descriptor.discAlpha);

  let entity = viewer.entities.getById(id);
  if (!entity) {
    entity = remember(
      viewer.entities.add({
        id,
        position,
        ellipse: {
          semiMajorAxis: descriptor.discRadiusMeters,
          semiMinorAxis: descriptor.discRadiusMeters,
          // An explicit height draws the disc at cloud altitude instead of
          // classifying it onto the terrain, where it would read as a stain on
          // the island rather than as weather above it.
          height: descriptor.heightMeters,
          material: colour,
          outline: false,
        },
      }),
    );
    return entity;
  }

  entity.show = true;
  entity.position = new Cesium.ConstantPositionProperty(position);
  if (entity.ellipse) {
    entity.ellipse.semiMajorAxis = new Cesium.ConstantProperty(descriptor.discRadiusMeters);
    entity.ellipse.semiMinorAxis = new Cesium.ConstantProperty(descriptor.discRadiusMeters);
    entity.ellipse.height = new Cesium.ConstantProperty(descriptor.heightMeters);
    entity.ellipse.material = new Cesium.ColorMaterialProperty(colour);
  }
  return entity;
}

function syncRing(Cesium: CesiumModule, viewer: Viewer, descriptor: WeatherOverlayDescriptor): Entity {
  const id = ringId(descriptor.islandId);
  const positions = Cesium.Cartesian3.fromDegreesArrayHeights(ringPositions(Cesium, descriptor));
  const colour = Cesium.Color.fromCssColorString(descriptor.ringColour).withAlpha(descriptor.ringAlpha);

  let entity = viewer.entities.getById(id);
  if (!entity) {
    entity = remember(
      viewer.entities.add({
        id,
        polyline: {
          positions,
          // A polyline rather than an outlined ellipse: Cesium's `outlineWidth`
          // is ignored on Windows ANGLE, so an outlined ellipse would be a
          // hairline on exactly the demo hardware this has to run on.
          width: RING_WIDTH_PIXELS,
          material: colour,
        },
      }),
    );
    entity.show = descriptor.showRing;
    return entity;
  }

  entity.show = descriptor.showRing;
  if (entity.polyline) {
    entity.polyline.positions = new Cesium.ConstantProperty(positions);
    entity.polyline.material = new Cesium.ColorMaterialProperty(colour);
  }
  return entity;
}

function syncWindArrow(
  Cesium: CesiumModule,
  viewer: Viewer,
  descriptor: WeatherOverlayDescriptor,
): Entity | null {
  const image = windArrowIcon();
  // No 2D canvas context (a headless or hardened environment): draw the rest of
  // the layer rather than failing the whole sync.
  if (!image) return null;

  const id = windId(descriptor.islandId);
  const position = Cesium.Cartesian3.fromDegrees(
    descriptor.centre.longitude,
    descriptor.centre.latitude,
    descriptor.heightMeters,
  );

  let entity = viewer.entities.getById(id);
  if (!entity) {
    entity = remember(
      viewer.entities.add({
        id,
        position,
        billboard: {
          image,
          width: ARROW_ICON_PIXELS,
          height: ARROW_ICON_PIXELS,
          rotation: descriptor.windRotationRadians,
          scale: descriptor.windScale,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      }),
    );
    return entity;
  }

  entity.show = true;
  entity.position = new Cesium.ConstantPositionProperty(position);
  if (entity.billboard) {
    entity.billboard.rotation = new Cesium.ConstantProperty(descriptor.windRotationRadians);
    entity.billboard.scale = new Cesium.ConstantProperty(descriptor.windScale);
  }
  return entity;
}

/**
 * Whether this machine should animate the overlay.
 *
 * Two independent reasons to say no, and both are about the demo staying
 * usable rather than about taste:
 *
 *   - four or fewer logical cores is the supported low end, where sixty
 *     property writes a second on top of Cesium's own render loop is the
 *     difference between a smooth globe and a stuttering one;
 *   - a machine that cannot create a WebGL context for the effect cannot draw
 *     the animated version at all.
 *
 * The overlay still draws in this mode — static discs, a static ring, an arrow.
 * Only the motion goes.
 */
export function prefersLowerDetail(): boolean {
  if (typeof navigator !== "undefined") {
    const cores = navigator.hardwareConcurrency;
    if (typeof cores === "number" && cores > 0 && cores <= 4) return true;
  }
  return !canCreateWeatherContext();
}

/**
 * Probes whether a WebGL context can be created for the effect.
 *
 * Deliberately its own throwaway canvas rather than a question asked of the
 * live viewer: this runs before the layer draws anything, and a browser that
 * refuses a second context here is one that will refuse the effect too.
 * Any throw is treated as "no", because the point of the probe is to fall back
 * quietly rather than to diagnose.
 */
function canCreateWeatherContext(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    const context =
      canvas.getContext("webgl2") ??
      canvas.getContext("webgl") ??
      canvas.getContext("experimental-webgl");
    return context !== null;
  } catch {
    return false;
  }
}
