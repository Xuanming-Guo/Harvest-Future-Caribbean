/**
 * Low-poly structures on the globe: farm buildings, crop fields, stores and
 * vehicles.
 *
 * These turn the map from dots on satellite imagery into a place you can watch
 * working — which is the whole argument the pitch rests on. A judge should be
 * able to see crops rot in a field while a buyer imports under the baseline
 * policy, then watch the same produce leave on a truck under Harvest.
 *
 * ## Why procedural geometry rather than glTF models
 *
 * Every shape here is built from Cesium primitives — boxes and extruded
 * polygons. That is not a compromise:
 *
 *   - No third-party binary assets in the repository, so no licence
 *     obligations and nothing large committed. `AGENTS.md` is explicit about
 *     not committing generated or vendored artefacts.
 *   - Colour comes from the theme rather than being baked into a mesh, so a
 *     crop field can shift through the status ramp as its stage changes. A
 *     textured model cannot do that without a second texture per state.
 *   - At the camera distances this view uses, the silhouette is all that
 *     reads. Detail below a few metres is invisible.
 *
 * Swapping in CC0 glTF models later is contained to this file.
 *
 * ## Why there are no people
 *
 * A person is about 1.8 m. At the island overview the camera sits at 78 km,
 * where a figure is far below one pixel; even at the 2 km region zoom it is a
 * couple of pixels of noise. Human activity is conveyed by crops changing
 * state and by the check-in ring, not by rendering figures nobody can see.
 */

import type { Entity, Viewer } from "cesium";
import type {
  ControlRoomBatch,
  ControlRoomFrame,
  ControlRoomScene,
  CropStage,
  GeoPoint,
} from "@harvest/simulation";
import { missionPositionAt } from "@harvest/simulation";

import type { CesiumModule } from "./entities";

// ---------------------------------------------------------------------------
// Palette — mirrors the --status-* custom properties in globals.css. Cesium
// entities have no CSS cascade, so the ramp is duplicated numerically.
// ---------------------------------------------------------------------------

const CROP_COLOUR: Record<CropStage, string> = {
  PLANTED: "#2f5f52",
  GROWING: "#377f8c",
  MATURING: "#4a8f6a",
  READY: "#5ba64b",
  HARVESTED: "#7f9c92",
  SPOILED: "#c45645",
};

const BARN_WALL = "#b4653a";
const BARN_ROOF = "#2c3e3a";
const STORE_WALL = "#d99b2b";
const STORE_ROOF = "#2c3e3a";
const TRUCK_BODY = "#eaf4ef";
const TRUCK_CAB = "#377f8c";
const CHECKIN_RING = "#5ba64b";

/**
 * Structures are hidden beyond this distance.
 *
 * At the island overview a barn is a fraction of a pixel, so drawing them
 * there costs render time and adds visual noise to the one view that most
 * needs to stay legible. The point markers and labels carry that altitude;
 * these take over as the camera descends.
 */
const STRUCTURE_VISIBLE_TO_M = 30_000;

/** Vehicles stay visible a little further out, because motion draws the eye. */
const VEHICLE_VISIBLE_TO_M = 60_000;

/** A grower who reported within this window gets a highlight ring. */
const RECENT_CHECKIN_MS = 36 * 60 * 60 * 1000;

// Building dimensions in metres. Generous rather than literal: a real
// smallholder's shed would be nearly invisible at the altitudes this view
// uses, so these are scaled up to read as landmarks.
const BARN = { length: 46, width: 30, height: 20 };
const STORE = { length: 70, width: 48, height: 26 };
const TRUCK = { length: 34, width: 15, height: 12 };
const FIELD_HALF_WIDTH_M = 85;

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

const METRES_PER_DEGREE_LATITUDE = 111_320;

/**
 * Offsets a point by a distance in metres.
 *
 * The longitude scale shrinks with latitude, so it is corrected by cos(lat).
 * Near 14°N the error from ignoring that would be about 3%, which sounds
 * harmless until a crop field sits visibly off its barn.
 */
function offsetMetres(point: GeoPoint, eastM: number, northM: number): GeoPoint {
  const latitude = point.latitude + northM / METRES_PER_DEGREE_LATITUDE;
  const longitude =
    point.longitude +
    eastM / (METRES_PER_DEGREE_LATITUDE * Math.cos((point.latitude * Math.PI) / 180));
  return { latitude, longitude };
}

/** Compass bearing from one point to another, in radians, for vehicle heading. */
function bearingRadians(from: GeoPoint, to: GeoPoint): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLon = toRad(to.longitude - from.longitude);
  const lat1 = toRad(from.latitude);
  const lat2 = toRad(to.latitude);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return Math.atan2(y, x);
}

function farmStructureId(farmId: string, part: string): string {
  return `structure:${part}:${farmId}`;
}

/**
 * The stage a farm's field should show when it holds several batches.
 *
 * Mirrors the marker's rule so the two never disagree: the most operationally
 * urgent stage wins, because a farm with a ready crop is a farm that needs
 * attention even if it also has three still growing.
 */
const STAGE_PRIORITY: CropStage[] = [
  "READY",
  "SPOILED",
  "MATURING",
  "GROWING",
  "PLANTED",
  "HARVESTED",
];

function fieldStageFor(batches: ControlRoomBatch[], farmId: string): CropStage | null {
  const owned = batches.filter((batch) => batch.farmId === farmId);
  if (owned.length === 0) return null;
  for (const stage of STAGE_PRIORITY) {
    if (owned.some((batch) => batch.lastReportedStage === stage)) return stage;
  }
  return owned[0]?.lastReportedStage ?? null;
}

// ---------------------------------------------------------------------------
// Scene construction
// ---------------------------------------------------------------------------

/**
 * Builds every static structure for a scenario.
 *
 * Called once per run, not per frame. `syncStructureFrame` mutates these in
 * place afterwards.
 *
 * Buildings use `RELATIVE_TO_GROUND` with the position raised by half their
 * height, which is what seats a box on the terrain surface rather than burying
 * its lower half in the hillside.
 */
export function syncStructureScene(
  Cesium: CesiumModule,
  viewer: Viewer,
  scene: ControlRoomScene,
): void {
  const structureRange = new Cesium.DistanceDisplayCondition(0, STRUCTURE_VISIBLE_TO_M);

  for (const farm of scene.farms) {
    const barnAt = offsetMetres(farm.position, -55, 0);

    viewer.entities.add({
      id: farmStructureId(farm.farmId, "barn"),
      position: Cesium.Cartesian3.fromDegrees(barnAt.longitude, barnAt.latitude, BARN.height / 2),
      box: {
        dimensions: new Cesium.Cartesian3(BARN.length, BARN.width, BARN.height),
        material: Cesium.Color.fromCssColorString(BARN_WALL),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString("#07130f"),
        heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        distanceDisplayCondition: structureRange,
      },
    });

    // A flat slab sitting proud of the walls. A true gable would need a custom
    // mesh; an overhanging roof plate gives the same read at this distance for
    // one more box.
    viewer.entities.add({
      id: farmStructureId(farm.farmId, "roof"),
      position: Cesium.Cartesian3.fromDegrees(
        barnAt.longitude,
        barnAt.latitude,
        BARN.height + 2.5,
      ),
      box: {
        dimensions: new Cesium.Cartesian3(BARN.length + 10, BARN.width + 10, 5),
        material: Cesium.Color.fromCssColorString(BARN_ROOF),
        heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        distanceDisplayCondition: structureRange,
      },
    });

    // The crop field. Its colour is the one thing on the globe that changes
    // with the crop's reported stage, so a viewer can read the state of the
    // whole island at a glance without opening anything.
    const centre = offsetMetres(farm.position, 90, 0);
    const corners = [
      offsetMetres(centre, -FIELD_HALF_WIDTH_M, -FIELD_HALF_WIDTH_M * 0.7),
      offsetMetres(centre, FIELD_HALF_WIDTH_M, -FIELD_HALF_WIDTH_M * 0.7),
      offsetMetres(centre, FIELD_HALF_WIDTH_M, FIELD_HALF_WIDTH_M * 0.7),
      offsetMetres(centre, -FIELD_HALF_WIDTH_M, FIELD_HALF_WIDTH_M * 0.7),
    ];

    viewer.entities.add({
      id: farmStructureId(farm.farmId, "field"),
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(
          Cesium.Cartesian3.fromDegreesArray(
            corners.flatMap((corner) => [corner.longitude, corner.latitude]),
          ),
        ),
        material: Cesium.Color.fromCssColorString(CROP_COLOUR.GROWING).withAlpha(0.72),
        // Draped over the terrain rather than extruded.
        //
        // An extruded polygon is planar: given a height and an extruded
        // height it renders a flat slab at a fixed altitude, which on the
        // valley sides here floated in mid-air at one end and buried itself at
        // the other. Classifying against terrain instead paints the field onto
        // the hillside, following every contour. The cost is losing the few
        // metres of extrusion, which was never visible from these altitudes
        // anyway.
        classificationType: Cesium.ClassificationType.TERRAIN,
        distanceDisplayCondition: structureRange,
      },
    });

    // Highlight ring for a farm that has reported recently. This is how grower
    // activity is shown — an event you can see, rather than a figure walking
    // about that would be sub-pixel anyway.
    viewer.entities.add({
      id: farmStructureId(farm.farmId, "checkin"),
      position: Cesium.Cartesian3.fromDegrees(farm.position.longitude, farm.position.latitude, 2),
      ellipse: {
        semiMajorAxis: 210,
        semiMinorAxis: 210,
        material: Cesium.Color.fromCssColorString(CHECKIN_RING).withAlpha(0.18),
        // Draped, for the same reason as the crop field: a flat disc at a
        // fixed altitude cuts through a hillside.
        classificationType: Cesium.ClassificationType.TERRAIN,
        distanceDisplayCondition: structureRange,
      },
      show: false,
    });
  }

  for (const buyer of scene.buyers) {
    const storeAt = offsetMetres(buyer.position, 0, -45);

    viewer.entities.add({
      id: farmStructureId(buyer.buyerId, "store"),
      position: Cesium.Cartesian3.fromDegrees(
        storeAt.longitude,
        storeAt.latitude,
        STORE.height / 2,
      ),
      box: {
        dimensions: new Cesium.Cartesian3(STORE.length, STORE.width, STORE.height),
        material: Cesium.Color.fromCssColorString(STORE_WALL),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString("#07130f"),
        heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        distanceDisplayCondition: structureRange,
      },
    });

    viewer.entities.add({
      id: farmStructureId(buyer.buyerId, "store-roof"),
      position: Cesium.Cartesian3.fromDegrees(
        storeAt.longitude,
        storeAt.latitude,
        STORE.height + 3,
      ),
      box: {
        dimensions: new Cesium.Cartesian3(STORE.length + 12, STORE.width + 12, 6),
        material: Cesium.Color.fromCssColorString(STORE_ROOF),
        heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        distanceDisplayCondition: structureRange,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Per-frame updates
// ---------------------------------------------------------------------------

/**
 * Updates structures for the current frame.
 *
 * Mutates entities in place. This runs on every animation frame during
 * playback, so it must not add or remove entities for anything that persists —
 * only vehicles come and go, and they are pooled by mission id.
 */
export function syncStructureFrame(
  Cesium: CesiumModule,
  viewer: Viewer,
  scene: ControlRoomScene,
  frame: ControlRoomFrame,
  atMs: number,
): void {
  for (const farm of scene.farms) {
    const stage = fieldStageFor(frame.batches, farm.farmId);
    const field = viewer.entities.getById(farmStructureId(farm.farmId, "field"));
    if (field?.polygon && stage) {
      field.polygon.material = new Cesium.ColorMaterialProperty(
        Cesium.Color.fromCssColorString(CROP_COLOUR[stage]).withAlpha(0.82),
      );
    }

    const ring = viewer.entities.getById(farmStructureId(farm.farmId, "checkin"));
    if (ring) {
      const reported = frame.batches
        .filter((batch) => batch.farmId === farm.farmId)
        .map((batch) => batch.lastObservedAt)
        .filter((at): at is number => at !== null);
      const latest = reported.length > 0 ? Math.max(...reported) : null;
      ring.show = latest !== null && atMs - latest <= RECENT_CHECKIN_MS;
    }
  }

  syncVehicles(Cesium, viewer, frame, atMs);
}

/**
 * Places a vehicle for each running mission.
 *
 * Vehicles are the one genuinely transient structure, so they are pooled by
 * mission id and hidden rather than destroyed — creating and disposing
 * entities during playback is exactly the per-frame churn this module avoids
 * everywhere else.
 */
function syncVehicles(
  Cesium: CesiumModule,
  viewer: Viewer,
  frame: ControlRoomFrame,
  atMs: number,
): void {
  const vehicleRange = new Cesium.DistanceDisplayCondition(0, VEHICLE_VISIBLE_TO_M);

  for (const mission of frame.missions) {
    const bodyId = `structure:truck:${mission.missionId}`;
    const cabId = `structure:truck-cab:${mission.missionId}`;
    const position = missionPositionAt(mission, atMs);

    let body: Entity | undefined = viewer.entities.getById(bodyId);
    let cab: Entity | undefined = viewer.entities.getById(cabId);

    if (!body) {
      body = viewer.entities.add({
        id: bodyId,
        position: Cesium.Cartesian3.fromDegrees(0, 0, 0),
        box: {
          dimensions: new Cesium.Cartesian3(TRUCK.length, TRUCK.width, TRUCK.height),
          material: Cesium.Color.fromCssColorString(TRUCK_BODY),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString("#07130f"),
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
          distanceDisplayCondition: vehicleRange,
        },
        show: false,
      });
      cab = viewer.entities.add({
        id: cabId,
        position: Cesium.Cartesian3.fromDegrees(0, 0, 0),
        box: {
          dimensions: new Cesium.Cartesian3(TRUCK.length * 0.34, TRUCK.width, TRUCK.height * 1.15),
          material: Cesium.Color.fromCssColorString(TRUCK_CAB),
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
          distanceDisplayCondition: vehicleRange,
        },
        show: false,
      });
    }

    if (!position || !body || !cab) {
      if (body) body.show = false;
      if (cab) cab.show = false;
      continue;
    }

    // Heading from a point slightly earlier on the route. Sampling the path
    // rather than differencing successive frames keeps the truck pointing the
    // right way while the timeline is paused or being scrubbed backwards.
    const earlier = missionPositionAt(mission, Math.max(mission.plannedDepartureAt, atMs - 120_000));
    const heading = earlier ? bearingRadians(earlier, position) : 0;

    const seat = (entity: Entity, offsetEast: number, height: number) => {
      const at = offsetMetres(position, offsetEast, 0);
      const cartesian = Cesium.Cartesian3.fromDegrees(at.longitude, at.latitude, height);
      entity.position = new Cesium.ConstantPositionProperty(cartesian);
      entity.orientation = new Cesium.ConstantProperty(
        Cesium.Transforms.headingPitchRollQuaternion(
          cartesian,
          new Cesium.HeadingPitchRoll(heading, 0, 0),
        ),
      );
      entity.show = true;
    };

    seat(body, 0, TRUCK.height / 2);
    seat(cab, TRUCK.length * 0.42, (TRUCK.height * 1.15) / 2);
  }
}
