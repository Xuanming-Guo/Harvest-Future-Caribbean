/**
 * Builders and per-frame updaters for the globe's entity collection.
 *
 * `frame` changes up to sixty times a second during playback, so this module
 * is deliberately upsert-shaped: `syncScene` builds the static furniture
 * (farms, buyers, roads) once per scenario, and `syncFrame` mutates the same
 * entities in place every tick rather than tearing the collection down and
 * rebuilding it. Rebuilding sixty times a second is the stutter this issue
 * explicitly warns against.
 *
 * Like `camera.ts`, this file only ever imports Cesium's *types*. The runtime
 * module is handed in by the caller (`CesiumGlobe`, which already holds it
 * after its own dynamic import) so this file never risks loading Cesium
 * before `window.CESIUM_BASE_URL` is set.
 */

import type { Entity, Viewer } from "cesium";
import type {
  ControlRoomBatch,
  ControlRoomFrame,
  ControlRoomScene,
  CropStage,
  GeoPoint,
  ReferencePlaceCategory,
} from "@harvest/simulation";
import { missionPositionAt, vesselPositionAt } from "@harvest/simulation";

/** The live Cesium module, as returned by `await import('cesium')`. */
export type CesiumModule = typeof import("cesium");

// Imported after the CesiumModule declaration because structures.ts imports
// that type back from here.
import { syncStructureFrame, syncStructureScene } from "./structures";

// ---------------------------------------------------------------------------
// Colour vocabulary — mirrors the `--status-*` custom properties in
// globals.css exactly. Cesium entities are plain JS objects with no CSS
// cascade, so the ramp has to be duplicated numerically rather than read from
// the DOM; keeping it colocated with the code that consumes it keeps the two
// copies easy to compare by eye.
// ---------------------------------------------------------------------------

const STAGE_COLOUR: Record<CropStage, string> = {
  PLANTED: "#377f8c",
  GROWING: "#377f8c",
  MATURING: "#377f8c",
  READY: "#5ba64b",
  HARVESTED: "#7f9c92",
  SPOILED: "#c45645",
};

/** Most operationally urgent stage first — see `farmStageFor` below. */
const STAGE_PRIORITY: CropStage[] = ["READY", "SPOILED", "MATURING", "GROWING", "PLANTED", "HARVESTED"];

const BUYER_COLOUR = "#d99b2b";
// The maritime layer reads as one family: a cool blue for the published network
// (ports and sea links) and the warmer vehicle amber for a vessel that is
// actually carrying something, so a moving consignment is never mistaken for a
// route that merely exists.
const PORT_COLOUR = "#56a7bd";
const SEA_LINK_COLOUR = "#4d8fa6";
const SEA_ROUTE_COLOUR = "#7fd0e6";
const VESSEL_COLOUR = "#d99b2b";
const SHIPMENT_FAILED_COLOUR = "#c45645";
const PORT_PIXEL_SIZE = 9;
const DISRUPTION_COLOUR = "#c45645";
const ROAD_COLOUR = "#8faea2";
const ROAD_DEGRADED_COLOUR = "#c45645";
const SELECTION_HALO_COLOUR = "#eaf4ef";
const REFERENCE_COLOUR: Record<ReferencePlaceCategory, string> = {
  AGRICULTURAL_AREA: "#86a96f",
  HOTEL_RESORT: "#a78ad1",
  RESTAURANT: "#d98263",
  SUPERMARKET_MARKET: "#d9b34c",
  PORT_FERRY_TERMINAL: "#56a7bd",
};

const FARM_PIXEL_SIZE = 12;
const BUYER_ICON_PIXELS = 26;
const SELECTED_PIXEL_BONUS = 6;

// ---------------------------------------------------------------------------
// Small canvas icons. Generated once and cached — Cesium billboards want an
// image, and there are no external asset files to reach for here (no new
// dependencies, no ion token), so a few lines of canvas drawing stands in for
// a sprite sheet.
// ---------------------------------------------------------------------------

let buyerIconCache: string | null = null;

/** A diamond, so a buyer is never confused with a farm's circular marker at a glance. */
function buyerIcon(): string {
  if (buyerIconCache) return buyerIconCache;
  const canvas = document.createElement("canvas");
  canvas.width = BUYER_ICON_PIXELS;
  canvas.height = BUYER_ICON_PIXELS;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const mid = BUYER_ICON_PIXELS / 2;
  ctx.fillStyle = BUYER_COLOUR;
  ctx.strokeStyle = "#0d1f1a";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(mid, 1);
  ctx.lineTo(BUYER_ICON_PIXELS - 1, mid);
  ctx.lineTo(mid, BUYER_ICON_PIXELS - 1);
  ctx.lineTo(1, mid);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  buyerIconCache = canvas.toDataURL();
  return buyerIconCache;
}

let disruptionIconCache: string | null = null;

/** A warning triangle — deliberately the noisiest shape on the globe. */
function disruptionIcon(): string {
  if (disruptionIconCache) return disruptionIconCache;
  const size = 28;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.fillStyle = DISRUPTION_COLOUR;
  ctx.strokeStyle = "#eaf4ef";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(size / 2, 2);
  ctx.lineTo(size - 2, size - 3);
  ctx.lineTo(2, size - 3);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#eaf4ef";
  ctx.font = "bold 15px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("!", size / 2, size - 6);
  disruptionIconCache = canvas.toDataURL();
  return disruptionIconCache;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function midpoint(a: GeoPoint, b: GeoPoint): GeoPoint {
  return { latitude: (a.latitude + b.latitude) / 2, longitude: (a.longitude + b.longitude) / 2 };
}

/**
 * The stage a farm's marker should show when it has more than one batch.
 *
 * There is no engine-defined tie-break for "which batch represents the farm",
 * so this picks the most operationally urgent one — a farm with a READY batch
 * reads as ready even if it also has three GROWING ones, because READY is the
 * state that demands attention right now.
 */
function farmStageFor(batches: ControlRoomBatch[], farmId: string): CropStage | null {
  const farmBatches = batches.filter((batch) => batch.farmId === farmId);
  if (farmBatches.length === 0) return null;
  for (const stage of STAGE_PRIORITY) {
    if (farmBatches.some((batch) => batch.lastReportedStage === stage)) return stage;
  }
  return farmBatches[0]?.lastReportedStage ?? null;
}

function isSelected(id: string, selectedId: string | null): boolean {
  return selectedId !== null && id === selectedId;
}

// ---------------------------------------------------------------------------
// Scene (static furniture): farms, buyers, roads. Rebuilt only when the scene
// itself changes (a new run), never per animation frame.
// ---------------------------------------------------------------------------

export function syncScene(Cesium: CesiumModule, viewer: Viewer, scene: ControlRoomScene): void {
  viewer.entities.removeAll();

  // Public-reference context is deliberately smaller and quieter than the
  // synthetic participants. Labels appear only at close range; selecting a
  // marker keeps its source and disclaimer in the Inspector.
  for (const place of scene.referencePlaces) {
    viewer.entities.add({
      id: place.referencePlaceId,
      name: place.name,
      position: Cesium.Cartesian3.fromDegrees(place.position.longitude, place.position.latitude),
      point: {
        pixelSize: 6,
        color: Cesium.Color.fromCssColorString(REFERENCE_COLOUR[place.category]).withAlpha(0.82),
        outlineColor: Cesium.Color.fromCssColorString("#071310"),
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
      label: {
        text: place.name,
        font: "500 10px 'DM Sans', sans-serif",
        fillColor: Cesium.Color.fromCssColorString("#d8e6df"),
        outlineColor: Cesium.Color.fromCssColorString("#071310"),
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.TOP,
        pixelOffset: new Cesium.Cartesian2(0, 8),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 50_000),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
    });
  }

  for (const farm of scene.farms) {
    viewer.entities.add({
      id: farm.farmId,
      name: farm.name,
      position: Cesium.Cartesian3.fromDegrees(farm.position.longitude, farm.position.latitude),
      point: {
        pixelSize: FARM_PIXEL_SIZE,
        color: Cesium.Color.fromCssColorString(STAGE_COLOUR.GROWING),
        outlineColor: Cesium.Color.fromCssColorString("#0d1f1a"),
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        // Sit on the terrain surface. Positions carry no elevation of their
        // own, so with real relief an unclamped marker is buried inside the
        // hill it belongs to.
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
      label: {
        text: farm.name,
        font: "600 12px 'DM Sans', sans-serif",
        fillColor: Cesium.Color.fromCssColorString("#eaf4ef"),
        outlineColor: Cesium.Color.fromCssColorString("#071310"),
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.TOP,
        pixelOffset: new Cesium.Cartesian2(0, 10),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 200_000),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        // Sit on the terrain surface. Positions carry no elevation of their
        // own, so with real relief an unclamped marker is buried inside the
        // hill it belongs to.
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
    });
  }

  for (const buyer of scene.buyers) {
    viewer.entities.add({
      id: buyer.buyerId,
      name: buyer.name,
      position: Cesium.Cartesian3.fromDegrees(buyer.position.longitude, buyer.position.latitude),
      billboard: {
        image: buyerIcon(),
        width: BUYER_ICON_PIXELS,
        height: BUYER_ICON_PIXELS,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        // Sit on the terrain surface. Positions carry no elevation of their
        // own, so with real relief an unclamped marker is buried inside the
        // hill it belongs to.
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
      label: {
        text: buyer.name,
        font: "600 12px 'DM Sans', sans-serif",
        fillColor: Cesium.Color.fromCssColorString("#eaf4ef"),
        outlineColor: Cesium.Color.fromCssColorString("#071310"),
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.TOP,
        pixelOffset: new Cesium.Cartesian2(0, 16),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 200_000),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        // Sit on the terrain surface. Positions carry no elevation of their
        // own, so with real relief an unclamped marker is buried inside the
        // hill it belongs to.
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
    });
  }

  for (const road of scene.roads) {
    viewer.entities.add({
      id: road.roadSegmentId,
      name: road.name,
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray([
          road.from.longitude,
          road.from.latitude,
          road.to.longitude,
          road.to.latitude,
        ]),
        width: 3,
        material: Cesium.Color.fromCssColorString(ROAD_COLOUR),
        clampToGround: true,
      },
    });
  }

  syncMaritimeScene(Cesium, viewer, scene);

  // Buildings, fields and check-in rings. Added after the markers so that the
  // markers, which carry the labels and selection, remain the topmost thing a
  // click can land on.
  syncStructureScene(Cesium, viewer, scene);
}

/**
 * Ports and published sea links, drawn once per scene.
 *
 * Both are PUBLIC REFERENCE: a port exists and a scheduled service between two
 * ports exists. Neither is evidence that produce moves on that route, which is
 * why the link is drawn as a thin dashed line rather than as a solid corridor —
 * it is a possibility, not a delivery. A scene with no links (any one-island
 * run) draws nothing here, which is the correct picture.
 */
function syncMaritimeScene(Cesium: CesiumModule, viewer: Viewer, scene: ControlRoomScene): void {
  const network = scene.maritime;
  if (!network) return;

  const portById = new Map(network.ports.map((port) => [port.id, port] as const));

  for (const port of network.ports) {
    viewer.entities.add({
      id: `port::${port.id}`,
      name: port.name,
      position: Cesium.Cartesian3.fromDegrees(port.longitude, port.latitude),
      point: {
        pixelSize: PORT_PIXEL_SIZE,
        color: Cesium.Color.fromCssColorString(PORT_COLOUR),
        outlineColor: Cesium.Color.fromCssColorString("#071310"),
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
      label: {
        text: port.name,
        font: "500 11px 'DM Sans', sans-serif",
        fillColor: Cesium.Color.fromCssColorString("#cfe6ef"),
        outlineColor: Cesium.Color.fromCssColorString("#071310"),
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.TOP,
        pixelOffset: new Cesium.Cartesian2(0, 10),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 400_000),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
    });
  }

  for (const link of network.links) {
    const from = portById.get(link.fromPortId);
    const to = portById.get(link.toPortId);
    if (!from || !to) continue;
    viewer.entities.add({
      id: `sea-link::${link.id}`,
      name: `${link.operator} — ${from.name} to ${to.name}`,
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray([from.longitude, from.latitude, to.longitude, to.latitude]),
        width: 2,
        material: new Cesium.PolylineDashMaterialProperty({
          color: Cesium.Color.fromCssColorString(SEA_LINK_COLOUR).withAlpha(0.55),
          dashLength: 18,
        }),
        // Deliberately not clamped: a sea link crosses open water, where
        // clamping to terrain buries the line under the ocean surface.
        clampToGround: false,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Per-frame updates: farm stage colour, road closures, missions, disruptions,
// and the selection halo. Called on every `frame`/`atMs`/`selectedId` change;
// every entity here already exists (created by `syncScene` or a previous call
// to this function), so this only ever mutates properties in place.
// ---------------------------------------------------------------------------

export function syncFrame(
  Cesium: CesiumModule,
  viewer: Viewer,
  scene: ControlRoomScene,
  frame: ControlRoomFrame,
  atMs: number,
  selectedId: string | null,
): void {
  syncReferencePlaces(Cesium, viewer, scene, selectedId);
  syncFarms(Cesium, viewer, scene, frame, selectedId);
  syncBuyers(Cesium, viewer, scene, selectedId);
  syncRoads(Cesium, viewer, scene, frame);
  syncMissions(Cesium, viewer, frame, atMs, selectedId);
  syncShipments(Cesium, viewer, frame, atMs, selectedId);
  syncDisruptions(Cesium, viewer, scene, frame, selectedId);
  syncStructureFrame(Cesium, viewer, scene, frame, atMs);
}

function syncReferencePlaces(Cesium: CesiumModule, viewer: Viewer, scene: ControlRoomScene, selectedId: string | null): void {
  for (const place of scene.referencePlaces) {
    const entity = viewer.entities.getById(place.referencePlaceId);
    if (!entity?.point || !entity.label) continue;
    const selected = isSelected(place.referencePlaceId, selectedId);
    entity.point.pixelSize = new Cesium.ConstantProperty(selected ? 12 : 6);
    entity.point.outlineColor = new Cesium.ConstantProperty(
      Cesium.Color.fromCssColorString(selected ? SELECTION_HALO_COLOUR : "#071310"),
    );
    entity.point.outlineWidth = new Cesium.ConstantProperty(selected ? 3 : 1);
    entity.label.distanceDisplayCondition = new Cesium.ConstantProperty(
      new Cesium.DistanceDisplayCondition(0, selected ? Number.POSITIVE_INFINITY : 50_000),
    );
  }
}

function syncFarms(
  Cesium: CesiumModule,
  viewer: Viewer,
  scene: ControlRoomScene,
  frame: ControlRoomFrame,
  selectedId: string | null,
): void {
  for (const farm of scene.farms) {
    const entity = viewer.entities.getById(farm.farmId);
    if (!entity?.point) continue;
    const stage = farmStageFor(frame.batches, farm.farmId);
    const colour = stage ? STAGE_COLOUR[stage] : STAGE_COLOUR.GROWING;
    const selected = isSelected(farm.farmId, selectedId);
    entity.point.color = new Cesium.ConstantProperty(Cesium.Color.fromCssColorString(colour));
    entity.point.pixelSize = new Cesium.ConstantProperty(FARM_PIXEL_SIZE + (selected ? SELECTED_PIXEL_BONUS : 0));
    entity.point.outlineColor = new Cesium.ConstantProperty(
      Cesium.Color.fromCssColorString(selected ? SELECTION_HALO_COLOUR : "#0d1f1a"),
    );
    entity.point.outlineWidth = new Cesium.ConstantProperty(selected ? 3 : 2);
  }
}

function syncBuyers(Cesium: CesiumModule, viewer: Viewer, scene: ControlRoomScene, selectedId: string | null): void {
  for (const buyer of scene.buyers) {
    const entity = viewer.entities.getById(buyer.buyerId);
    if (!entity?.billboard) continue;
    // Selection reads as a larger icon rather than a colour change — buyers
    // have one colour by definition, unlike farms whose colour already
    // carries crop-stage meaning.
    const selected = isSelected(buyer.buyerId, selectedId);
    const size = BUYER_ICON_PIXELS * (selected ? 1.3 : 1);
    entity.billboard.width = new Cesium.ConstantProperty(size);
    entity.billboard.height = new Cesium.ConstantProperty(size);
  }
}

function syncRoads(Cesium: CesiumModule, viewer: Viewer, scene: ControlRoomScene, frame: ControlRoomFrame): void {
  const degraded = new Set(frame.degradedRoadSegmentIds);
  for (const road of scene.roads) {
    const entity = viewer.entities.getById(road.roadSegmentId);
    if (!entity?.polyline) continue;
    const isDegraded = degraded.has(road.roadSegmentId);
    entity.polyline.material = isDegraded
      ? new Cesium.PolylineDashMaterialProperty({
          color: Cesium.Color.fromCssColorString(ROAD_DEGRADED_COLOUR),
          dashLength: 12,
        })
      : new Cesium.ColorMaterialProperty(Cesium.Color.fromCssColorString(ROAD_COLOUR));
    entity.polyline.width = new Cesium.ConstantProperty(isDegraded ? 4 : 3);
  }
}

function syncMissions(
  Cesium: CesiumModule,
  viewer: Viewer,
  frame: ControlRoomFrame,
  atMs: number,
  selectedId: string | null,
): void {
  for (const mission of frame.missions) {
    const drawPath = mission.status === "PLANNED" || mission.status === "ACTIVE" || mission.status === "DELAYED";
    const pathEntity = ensurePolylineEntity(Cesium, viewer, mission.missionId, mission.path);
    if (pathEntity.polyline) {
      pathEntity.show = drawPath && mission.path.length >= 2;
      const selected = isSelected(mission.missionId, selectedId);
      pathEntity.polyline.width = new Cesium.ConstantProperty(selected ? 4 : 2);
      pathEntity.polyline.material = new Cesium.ColorMaterialProperty(
        Cesium.Color.fromCssColorString(selected ? SELECTION_HALO_COLOUR : "#5ba64b").withAlpha(0.8),
      );
    }

    // Never a vehicle for a completed or cancelled mission, and never one
    // before departure or after `missionPositionAt` reports the mission is
    // not currently running — that helper already encodes those rules.
    const vehicleId = `${mission.missionId}::vehicle`;
    const position = mission.status === "COMPLETED" || mission.status === "CANCELLED"
      ? null
      : missionPositionAt(mission, atMs);

    let vehicle = viewer.entities.getById(vehicleId);
    if (!vehicle) {
      vehicle = viewer.entities.add({
        id: vehicleId,
        point: {
          pixelSize: 10,
          color: Cesium.Color.fromCssColorString("#d99b2b"),
          outlineColor: Cesium.Color.fromCssColorString("#0d1f1a"),
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
      });
    }
    vehicle.show = position !== null;
    if (position) {
      vehicle.position = new Cesium.ConstantPositionProperty(
        Cesium.Cartesian3.fromDegrees(position.longitude, position.latitude),
      );
    }
    if (vehicle.point) {
      const selected = isSelected(mission.missionId, selectedId);
      vehicle.point.pixelSize = new Cesium.ConstantProperty(selected ? 14 : 10);
    }
  }
}

/** Ids of vessel markers ever created, so a finished sailing can be hidden. */
const vesselEntityIds = new Set<string>();

/**
 * The live sea legs and the vessels on them.
 *
 * A shipment draws a brighter dashed line over its published link while it is
 * in progress, and a vessel marker that moves along that line between departure
 * and berthing. A failed sailing turns its route red and shows no vessel: there
 * is nothing out there any more, and drawing one would be inventing a position.
 */
function syncShipments(
  Cesium: CesiumModule,
  viewer: Viewer,
  frame: ControlRoomFrame,
  atMs: number,
  selectedId: string | null,
): void {
  const live = new Set<string>();

  for (const shipment of frame.shipments ?? []) {
    const seaLeg = shipment.legs.find((leg) => leg.kind === "SEA");
    if (!seaLeg) continue;
    const routeId = `sea-route::${shipment.shipmentId}`;
    const selected = isSelected(shipment.shipmentId, selectedId) || isSelected(shipment.missionId, selectedId);
    const failed = shipment.status === "FAILED";

    const route = ensureSeaRouteEntity(Cesium, viewer, routeId, seaLeg.from, seaLeg.to);
    if (route.polyline) {
      route.polyline.material = new Cesium.PolylineDashMaterialProperty({
        color: Cesium.Color.fromCssColorString(failed ? SHIPMENT_FAILED_COLOUR : SEA_ROUTE_COLOUR).withAlpha(selected ? 1 : 0.85),
        dashLength: 14,
      });
      route.polyline.width = new Cesium.ConstantProperty(selected ? 5 : 3);
    }
    route.show = true;
    route.name = `${shipment.operator} · ${shipment.status.toLowerCase()}`;

    const vesselId = `vessel::${shipment.shipmentId}`;
    live.add(vesselId);
    const position = vesselPositionAt(shipment, atMs);
    let vessel = viewer.entities.getById(vesselId);
    if (!vessel) {
      vessel = viewer.entities.add({
        id: vesselId,
        name: `${shipment.operator} consignment`,
        point: {
          pixelSize: 11,
          color: Cesium.Color.fromCssColorString(VESSEL_COLOUR),
          outlineColor: Cesium.Color.fromCssColorString("#0d1f1a"),
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      vesselEntityIds.add(vesselId);
    }
    vessel.show = position !== null;
    if (position) {
      vessel.position = new Cesium.ConstantPositionProperty(
        Cesium.Cartesian3.fromDegrees(position.longitude, position.latitude),
      );
    }
    if (vessel.point) vessel.point.pixelSize = new Cesium.ConstantProperty(selected ? 15 : 11);
  }

  // A replay scrubbed backwards past a sailing must not leave its vessel behind.
  for (const vesselId of vesselEntityIds) {
    if (live.has(vesselId)) continue;
    const stale = viewer.entities.getById(vesselId);
    if (stale) stale.show = false;
  }
}

function ensureSeaRouteEntity(Cesium: CesiumModule, viewer: Viewer, id: string, from: GeoPoint, to: GeoPoint): Entity {
  const existing = viewer.entities.getById(id);
  if (existing) return existing;
  return viewer.entities.add({
    id,
    polyline: {
      positions: Cesium.Cartesian3.fromDegreesArray([from.longitude, from.latitude, to.longitude, to.latitude]),
      width: 3,
      material: Cesium.Color.fromCssColorString(SEA_ROUTE_COLOUR),
      clampToGround: false,
    },
  });
}

function ensurePolylineEntity(Cesium: CesiumModule, viewer: Viewer, id: string, path: GeoPoint[]): Entity {
  let entity = viewer.entities.getById(id);
  const positions =
    path.length >= 2
      ? Cesium.Cartesian3.fromDegreesArray(path.flatMap((point) => [point.longitude, point.latitude]))
      : [];
  if (!entity) {
    entity = viewer.entities.add({
      id,
      polyline: {
        positions,
        width: 2,
        material: Cesium.Color.fromCssColorString("#5ba64b").withAlpha(0.8),
        clampToGround: true,
      },
    });
  } else if (entity.polyline) {
    entity.polyline.positions = new Cesium.ConstantProperty(positions);
  }
  return entity;
}

/** Ids of disruption markers ever created, so a resolved one can be hidden rather than left dangling. */
const disruptionEntityIds = new Set<string>();

function syncDisruptions(
  Cesium: CesiumModule,
  viewer: Viewer,
  scene: ControlRoomScene,
  frame: ControlRoomFrame,
  selectedId: string | null,
): void {
  const activeIds = new Set<string>();

  for (const disruption of frame.disruptions) {
    // The observable contract deliberately withholds which entity a
    // disruption affects (that would leak hidden truth about severity and
    // targeting). A ROAD disruption is resolvable anyway, because its effect
    // is separately published as `degradedRoadSegmentIds` — anything else
    // (WEATHER/VEHICLE/CROP/OTHER) has no publishable position and is
    // deliberately left off the map rather than guessed at.
    const position = resolveDisruptionPosition(scene, frame, disruption.type);
    if (!position) continue;

    activeIds.add(disruption.eventId);
    let entity = viewer.entities.getById(disruption.eventId);
    if (!entity) {
      entity = viewer.entities.add({
        id: disruption.eventId,
        name: disruption.description,
        billboard: {
          image: disruptionIcon(),
          width: 28,
          height: 28,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
      });
      disruptionEntityIds.add(disruption.eventId);
    }
    entity.position = new Cesium.ConstantPositionProperty(
      Cesium.Cartesian3.fromDegrees(position.longitude, position.latitude),
    );
    entity.show = true;
    if (entity.billboard) {
      const selected = isSelected(disruption.eventId, selectedId);
      const size = 28 * (selected ? 1.3 : 1);
      entity.billboard.width = new Cesium.ConstantProperty(size);
      entity.billboard.height = new Cesium.ConstantProperty(size);
    }
  }

  // A disruption whose road has since re-opened stops being resolvable; hide
  // its marker rather than leaving a stale warning icon on a clear road.
  for (const id of disruptionEntityIds) {
    if (activeIds.has(id)) continue;
    const entity = viewer.entities.getById(id);
    if (entity) entity.show = false;
  }
}

/**
 * Best-effort position for a disruption, given only its type.
 *
 * Only ROAD disruptions are resolvable: a currently-degraded road segment is
 * itself observable (`frame.degradedRoadSegmentIds`), so its midpoint is a
 * fair stand-in for "where this is happening" without needing the hidden
 * `affectedEntityIds` the engine keeps to itself.
 */
function resolveDisruptionPosition(
  scene: ControlRoomScene,
  frame: ControlRoomFrame,
  type: string,
): GeoPoint | null {
  if (type !== "ROAD") return null;
  const degradedId = frame.degradedRoadSegmentIds[0];
  if (!degradedId) return null;
  const road = scene.roads.find((candidate) => candidate.roadSegmentId === degradedId);
  if (!road) return null;
  return midpoint(road.from, road.to);
}
