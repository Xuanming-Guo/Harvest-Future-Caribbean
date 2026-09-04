/**
 * Descriptors for the globe's weather overlay (issue #39).
 *
 * Deliberately free of both React and Cesium. Everything the overlay draws —
 * where an island's weather sits, how opaque its cloud is, which way its wind
 * arrow points, whether a storm ring is drawn and how far through its pulse it
 * is — is computed here as plain data, so the mapping from a saved frame to
 * pixels can be tested without a WebGL context.
 *
 * Three rules shape this file:
 *
 *   1. **Saved replay data only.** Every value comes from `frame.weather`,
 *      which #37 records with the run. Nothing here fetches, and nothing here
 *      reads a day the replay has not reached.
 *   2. **Animation is a function of simulation time, not wall-clock time.**
 *      The pulse and drift phases are derived from the playhead, so pausing
 *      freezes them, scrubbing backwards returns them to exactly the state
 *      they had, and a screenshot at a given instant is reproducible. A
 *      `requestAnimationFrame` phase would satisfy none of that.
 *   3. **Weather borrows no status hue.** `globals.css` maps each `--status-*`
 *      colour to exactly one operational state, so the sky gets its own
 *      palette rather than reusing the teal/green/red ramp that already means
 *      crop stage.
 */

import type {
  ControlRoomFrame,
  ControlRoomScene,
  ControlRoomWeather,
  GeoPoint,
  TempBand,
  WeatherCondition,
  WeatherLegend,
} from "@harvest/simulation";
import { STORM_DAY_MM, STORM_WIND_KPH } from "@harvest/simulation";

// ---------------------------------------------------------------------------
// Palette and geometry constants
// ---------------------------------------------------------------------------

/**
 * Weather's own hues, chosen to collide with nothing in the status ramp.
 *
 * `--status-growing` is a teal (#377f8c) and `--agent` a light violet
 * (#b276e8), so rain is a distinctly bluer blue and storm a deep indigo. A
 * viewer must be able to tell "this island is under a storm" from "this farm's
 * crop is growing" at a glance, and colour is what carries that here.
 */
const CONDITION_STYLE: Record<
  WeatherCondition,
  { colour: string; baseAlpha: number; alphaPerCloud: number }
> = {
  CLEAR: { colour: "#cfe3dc", baseAlpha: 0.04, alphaPerCloud: 0.09 },
  CLOUD: { colour: "#9fb4c9", baseAlpha: 0.11, alphaPerCloud: 0.18 },
  RAIN: { colour: "#5a8fd6", baseAlpha: 0.21, alphaPerCloud: 0.18 },
  STORM: { colour: "#4c3f8f", baseAlpha: 0.31, alphaPerCloud: 0.18 },
};

/** The storm ring, and the wind arrow, in neutral tones no status uses. */
export const STORM_RING_COLOUR = "#8fa8ff";
export const WIND_ARROW_COLOUR = "#dce9e3";

/**
 * Ceiling on disc opacity.
 *
 * Checked in a browser rather than guessed: a full storm at 0.62 tinted the
 * island's terrain, roads and crop colours enough that the map underneath
 * stopped reading as a map. Half is dramatic and still see-through.
 */
const MAX_DISC_ALPHA = 0.5;

/** Extra rainfall opacity, on top of cloud cover, at or above a storm's rain. */
const RAIN_ALPHA_CONTRIBUTION = 0.12;

/** Metres per degree of latitude; good to a fraction of a percent at these scales. */
const METRES_PER_DEGREE = 111_320;

/** Disc size bounds, so a one-farm island still reads and a wide one stays local. */
const MIN_DISC_RADIUS_M = 9_000;
const MAX_DISC_RADIUS_M = 70_000;

/**
 * Pad the island's own footprint, so weather covers the island rather than
 * tracing it. Kept modest: a long, narrow island gives a circle that already
 * spills well out to sea, and padding it further buys nothing but ocean.
 */
const DISC_FOOTPRINT_PADDING = 1.15;

/** The storm ring sits just outside the cloud it belongs to. */
const RING_RADIUS_FACTOR = 1.18;

/**
 * Cloud altitude.
 *
 * Drawn above the terrain rather than draped onto it. A disc classified onto
 * the ground reads as a stain on the island; a disc at cloud height reads as
 * weather over it, which is the thing being shown. Markers already carry
 * `disableDepthTestDistance`, so they stay visible and clickable underneath.
 */
export const CLOUD_HEIGHT_M = 3_000;

/**
 * One full pulse/drift cycle, in simulated milliseconds.
 *
 * Twelve simulated hours is roughly two real seconds at the default 1× speed
 * (the control room plays 21 days in 90 s), which is a heartbeat rather than a
 * strobe. Expressed in simulation time on purpose: see the file header.
 */
export const PULSE_PERIOD_MS = 12 * 60 * 60 * 1_000;

/** How far a cloud mass sways downwind, as a fraction of its own radius. */
const DRIFT_FRACTION = 0.12;

/** How much the storm ring grows at the top of its pulse. */
const RING_PULSE_GROWTH = 0.1;

const RING_ALPHA_MAX = 0.85;
const RING_ALPHA_PULSE = 0.35;

// ---------------------------------------------------------------------------
// Descriptors
// ---------------------------------------------------------------------------

/** Everything the Cesium layer needs to draw one island's weather. */
export interface WeatherOverlayDescriptor {
  islandId: string;
  islandName: string;
  /** ISO date of the realised reading this describes. */
  date: string;
  condition: WeatherCondition;
  /** Island reference centre, before drift is applied. */
  centre: GeoPoint;
  /** Where the cloud disc is actually drawn on this frame. */
  discCentre: GeoPoint;
  discRadiusMeters: number;
  discColour: string;
  discAlpha: number;
  heightMeters: number;
  /** Storms, and only storms, get a ring. */
  showRing: boolean;
  ringColour: string;
  ringRadiusMeters: number;
  ringAlpha: number;
  /** Billboard rotation, radians counter-clockwise, for an arrow drawn pointing north. */
  windRotationRadians: number;
  /** Direction the wind blows *toward*, clockwise from true north. */
  downwindBearingDegrees: number;
  windScale: number;
  windKph: number;
  windFromDegrees: number;
  rainMm: number;
  cloudCoverFraction: number;
  tempBand: TempBand;
}

export interface WeatherOverlayOptions {
  /** The playhead, in simulated milliseconds. Drives pulse and drift. */
  atMs: number;
  /**
   * False under `prefers-reduced-motion` or in lower-detail mode: the phase is
   * pinned to zero, so discs are static and the ring does not pulse.
   */
  animated: boolean;
}

/** An island's reference footprint, derived from the scene's own geography. */
export interface IslandFootprint {
  islandId: string;
  centre: GeoPoint;
  radiusMeters: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Normalises any bearing into [0, 360). */
export function normaliseBearing(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/** The direction the wind is blowing toward, given the direction it blows from. */
export function downwindBearingDegrees(windFromDegrees: number): number {
  return normaliseBearing(windFromDegrees + 180);
}

/** Moves a point `metres` along a compass bearing. Flat-earth maths, fine at island scale. */
export function offsetPoint(from: GeoPoint, bearingDegrees: number, metres: number): GeoPoint {
  if (metres === 0) return from;
  const bearing = toRadians(bearingDegrees);
  const northMetres = Math.cos(bearing) * metres;
  const eastMetres = Math.sin(bearing) * metres;
  const latitude = from.latitude + northMetres / METRES_PER_DEGREE;
  const lonScale = Math.max(0.05, Math.cos(toRadians(from.latitude)));
  return { latitude, longitude: from.longitude + eastMetres / (METRES_PER_DEGREE * lonScale) };
}

/**
 * Island footprints, derived from the scene rather than from a coordinate table.
 *
 * The replay's scene carries no island geometry — only entities that each know
 * which island they are on — so the reference centre is the mean of everything
 * the scenario actually placed there, and the radius is how far the furthest of
 * them sits from that centre. An island the run never populated therefore has
 * no footprint, which is exactly the "outside scope" case the overlay must draw
 * nothing for.
 */
export function islandFootprints(scene: ControlRoomScene): Map<string, IslandFootprint> {
  const points = new Map<string, GeoPoint[]>();
  const add = (islandId: string, point: GeoPoint) => {
    const existing = points.get(islandId);
    if (existing) existing.push(point);
    else points.set(islandId, [point]);
  };

  for (const farm of scene.farms) add(farm.islandId, farm.position);
  for (const buyer of scene.buyers) add(buyer.islandId, buyer.position);
  for (const transporter of scene.transporters) add(transporter.islandId, transporter.homePosition);
  for (const road of scene.roads) {
    add(road.islandId, road.from);
    add(road.islandId, road.to);
  }
  for (const place of scene.referencePlaces) add(place.islandId, place.position);

  const footprints = new Map<string, IslandFootprint>();
  for (const [islandId, islandPoints] of points) {
    if (islandPoints.length === 0) continue;
    const centre: GeoPoint = {
      latitude: islandPoints.reduce((sum, point) => sum + point.latitude, 0) / islandPoints.length,
      longitude: islandPoints.reduce((sum, point) => sum + point.longitude, 0) / islandPoints.length,
    };
    const lonScale = Math.max(0.05, Math.cos(toRadians(centre.latitude)));
    const spread = islandPoints.reduce((furthest, point) => {
      const north = (point.latitude - centre.latitude) * METRES_PER_DEGREE;
      const east = (point.longitude - centre.longitude) * METRES_PER_DEGREE * lonScale;
      return Math.max(furthest, Math.hypot(north, east));
    }, 0);
    footprints.set(islandId, {
      islandId,
      centre,
      radiusMeters: clamp(spread * DISC_FOOTPRINT_PADDING, MIN_DISC_RADIUS_M, MAX_DISC_RADIUS_M),
    });
  }
  return footprints;
}

/**
 * Phase through the pulse cycle, in [0, 1).
 *
 * Zero when animation is off, which is what makes reduced motion a still image
 * rather than a slower one.
 */
export function overlayPhase(atMs: number, animated: boolean): number {
  if (!animated || !Number.isFinite(atMs)) return 0;
  const wrapped = ((atMs % PULSE_PERIOD_MS) + PULSE_PERIOD_MS) % PULSE_PERIOD_MS;
  return wrapped / PULSE_PERIOD_MS;
}

/** Disc opacity: heavier cloud and heavier rain both make the sky read darker. */
export function discAlphaFor(weather: Pick<ControlRoomWeather, "condition" | "cloudCoverFraction" | "rainMm">): number {
  const style = CONDITION_STYLE[weather.condition];
  const cloud = clamp(weather.cloudCoverFraction, 0, 1);
  const rainShare = clamp(weather.rainMm / STORM_DAY_MM, 0, 1);
  return clamp(
    style.baseAlpha + cloud * style.alphaPerCloud + rainShare * RAIN_ALPHA_CONTRIBUTION,
    0,
    MAX_DISC_ALPHA,
  );
}

/** Arrow size: calm air draws a small arrow, a storm's wind a large one. */
export function windScaleFor(windKph: number): number {
  return 0.55 + clamp(windKph / STORM_WIND_KPH, 0, 1.4) * 0.65;
}

/**
 * Turns one frame's saved weather into drawable descriptors.
 *
 * Islands the scene does not place — a reading for an island outside the run's
 * scope, or a replay whose scene was narrowed after recording — produce no
 * descriptor at all rather than a disc floating over open water.
 */
export function buildWeatherOverlay(
  scene: ControlRoomScene,
  frame: ControlRoomFrame,
  options: WeatherOverlayOptions,
): WeatherOverlayDescriptor[] {
  const readings = frame.weather ?? [];
  if (readings.length === 0) return [];

  const footprints = islandFootprints(scene);
  const phase = overlayPhase(options.atMs, options.animated);
  // Starts and ends at zero, so a paused or reduced-motion frame sits at rest
  // rather than at an arbitrary point of the cycle.
  const pulse = (1 - Math.cos(2 * Math.PI * phase)) / 2;
  const sway = Math.sin(2 * Math.PI * phase);

  const descriptors: WeatherOverlayDescriptor[] = [];
  for (const weather of readings) {
    const footprint = footprints.get(weather.islandId);
    if (!footprint) continue;

    const downwind = downwindBearingDegrees(weather.windFromDegrees);
    const driftMeters = options.animated ? footprint.radiusMeters * DRIFT_FRACTION * sway : 0;
    const isStorm = weather.condition === "STORM";

    descriptors.push({
      islandId: weather.islandId,
      islandName: formatIslandName(weather.islandId),
      date: weather.date,
      condition: weather.condition,
      centre: footprint.centre,
      discCentre: offsetPoint(footprint.centre, downwind, driftMeters),
      discRadiusMeters: footprint.radiusMeters,
      discColour: CONDITION_STYLE[weather.condition].colour,
      discAlpha: discAlphaFor(weather),
      heightMeters: CLOUD_HEIGHT_M,
      showRing: isStorm,
      ringColour: STORM_RING_COLOUR,
      ringRadiusMeters: footprint.radiusMeters * RING_RADIUS_FACTOR * (1 + RING_PULSE_GROWTH * pulse),
      ringAlpha: RING_ALPHA_MAX - RING_ALPHA_PULSE * pulse,
      // The icon is drawn pointing north, and Cesium rotates a billboard
      // counter-clockwise, so a clockwise compass bearing is its negation.
      windRotationRadians: -toRadians(downwind),
      downwindBearingDegrees: downwind,
      windScale: windScaleFor(weather.windKph),
      windKph: weather.windKph,
      windFromDegrees: weather.windFromDegrees,
      rainMm: weather.rainMm,
      cloudCoverFraction: weather.cloudCoverFraction,
      tempBand: weather.tempBand,
    });
  }
  return descriptors;
}

// ---------------------------------------------------------------------------
// Readable detail for the current replay time
// ---------------------------------------------------------------------------

const COMPASS_POINTS = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
] as const;

/** Sixteen-point compass label for a bearing in degrees. */
export function compassPoint(degrees: number): string {
  const index = Math.round(normaliseBearing(degrees) / 22.5) % COMPASS_POINTS.length;
  return COMPASS_POINTS[index] as string;
}

/** "saint-lucia" reads as "Saint Lucia"; the replay scene carries no island names. */
export function formatIslandName(islandId: string): string {
  return islandId
    .split("-")
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

const FALLBACK_CONDITION_LABEL: Record<WeatherCondition, string> = {
  CLEAR: "Clear",
  CLOUD: "Cloudy",
  RAIN: "Rain",
  STORM: "Storm",
};

const FALLBACK_TEMP_LABEL: Record<TempBand, string> = {
  COOL: "Cool",
  WARM: "Warm",
  HOT: "Hot",
};

/** Prefers the run's own published legend, so nothing hard-codes a threshold's wording. */
export function conditionLabel(condition: WeatherCondition, legend?: WeatherLegend): string {
  return (
    legend?.conditions.find((entry) => entry.condition === condition)?.label ??
    FALLBACK_CONDITION_LABEL[condition]
  );
}

export function tempBandLabel(tempBand: TempBand, legend?: WeatherLegend): string {
  return (
    legend?.tempBands.find((entry) => entry.tempBand === tempBand)?.label ??
    FALLBACK_TEMP_LABEL[tempBand]
  );
}

/** One island's weather, worded for a person reading the panel. */
export interface WeatherDetailRow {
  islandId: string;
  islandName: string;
  date: string;
  condition: WeatherCondition;
  conditionLabel: string;
  rainText: string;
  windText: string;
  tempText: string;
  /** Null when the saved frame carried no forecast for this island. */
  forecastText: string | null;
}

/**
 * The "Weather now" readout for the frame currently on screen.
 *
 * Reads the same saved frame the globe draws, so the words and the picture
 * cannot disagree, and shows the realised date so it is unambiguous which day
 * of the replay is being described. The forecast line prefers the nearest
 * forecast storm — the thing a coordinator would act on — and otherwise
 * reports tomorrow.
 */
export function weatherDetailRows(frame: ControlRoomFrame, legend?: WeatherLegend): WeatherDetailRow[] {
  return (frame.weather ?? []).map((weather) => {
    const forecast = [...weather.forecast].sort((a, b) => a.leadDays - b.leadDays);
    const chosen = forecast.find((day) => day.condition === "STORM") ?? forecast[0] ?? null;
    return {
      islandId: weather.islandId,
      islandName: formatIslandName(weather.islandId),
      date: weather.date,
      condition: weather.condition,
      conditionLabel: conditionLabel(weather.condition, legend),
      rainText: `${formatNumber(weather.rainMm)} mm rain`,
      windText: `${formatNumber(weather.windKph)} kph from ${compassPoint(weather.windFromDegrees)}`,
      tempText: tempBandLabel(weather.tempBand, legend),
      forecastText: chosen
        ? `${conditionLabel(chosen.condition, legend)} forecast ${chosen.date} · ${Math.round(chosen.confidence * 100)}% confidence`
        : null,
    };
  });
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** Legend rows for the weather key, in the order a viewer reads severity. */
export interface WeatherLegendRow {
  key: string;
  label: string;
  colour: string;
  /** Swatch opacity, matched to what a typical day of that condition draws. */
  alpha: number;
  /** The wind row is an arrow rather than a filled swatch. */
  kind: "DISC" | "RING" | "ARROW";
}

export function weatherLegendRows(legend?: WeatherLegend): WeatherLegendRow[] {
  const conditions: WeatherCondition[] = ["CLEAR", "CLOUD", "RAIN", "STORM"];
  const rows: WeatherLegendRow[] = conditions.map((condition) => ({
    key: condition,
    label: conditionLabel(condition, legend),
    colour: CONDITION_STYLE[condition].colour,
    // A representative day rather than the live value: a key shows what a
    // condition looks like, not what today happens to be.
    alpha: discAlphaFor({
      condition,
      cloudCoverFraction: condition === "CLEAR" ? 0.15 : 0.75,
      rainMm: condition === "STORM" ? STORM_DAY_MM : 0,
    }),
    kind: condition === "STORM" ? "RING" : "DISC",
  }));
  rows.push({ key: "WIND", label: "Wind direction", colour: WIND_ARROW_COLOUR, alpha: 1, kind: "ARROW" });
  return rows;
}
