/**
 * The globe's weather overlay (#39).
 *
 * The overlay is drawn by Cesium, which needs a WebGL context no unit test
 * has. What is testable — and what actually carries the acceptance criteria —
 * is the layer either side of that: the pure mapping from a saved frame to
 * drawable descriptors, the entity bookkeeping the layer performs against a
 * viewer, and the panel that reads the same frame in words.
 *
 * The rules being guarded here are the ones a later change could quietly
 * break: that ordinary weather looks different from meaningful weather, that
 * the overlay never invents an island the run did not place, that animation is
 * a function of simulation time so scrubbing is reproducible, that reduced
 * motion is a still image rather than a slower one, and that switching the
 * overlay off hides entities without touching anything else.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { runScenario, STORM_DAY_MM } from "@harvest/simulation";
import type {
  ControlRoomFrame,
  ControlRoomScene,
  ControlRoomWeather,
  TempBand,
  WeatherCondition,
} from "@harvest/simulation";
import React, { useState } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import Legend from "@/components/panels/Legend";
import {
  WEATHER_ENTITY_PREFIX,
  isWeatherEntityId,
  prefersLowerDetail,
  syncWeatherLayer,
} from "@/components/globe/weather";
import type { CesiumModule } from "@/components/globe/entities";
import {
  PULSE_PERIOD_MS,
  buildWeatherOverlay,
  compassPoint,
  downwindBearingDegrees,
  formatIslandName,
  islandFootprints,
  weatherDetailRows,
  weatherLegendRows,
} from "@/lib/weather-overlay";
import type { WeatherOverlayDescriptor } from "@/lib/weather-overlay";

afterEach(cleanup);

// ---------------------------------------------------------------------------
// A real recorded run, so the scene under test is the scene the control room
// actually gets rather than a hand-built fixture that could drift from it.
// ---------------------------------------------------------------------------

const timeline = runScenario({
  scenarioId: "saint-lucia-demo-v1",
  policy: "HARVEST",
  seed: 404,
  captureFrames: true,
}).timeline;

const scene = timeline?.scene as ControlRoomScene;
const frames = (timeline?.frames ?? []) as ControlRoomFrame[];
const baseFrame = frames.at(-1) as ControlRoomFrame;

function reading(overrides: Partial<ControlRoomWeather> = {}): ControlRoomWeather {
  return {
    islandId: "saint-lucia",
    date: "2026-09-10",
    condition: "CLOUD",
    rainMm: 4,
    windKph: 14,
    windFromDegrees: 90,
    cloudCoverFraction: 0.5,
    tempBand: "WARM" as TempBand,
    provenance: "SYNTHETIC",
    // #90 made the physical inputs' origin explicit. This hand-built reading is
    // generated, so it declares the synthetic evidence type.
    evidenceType: "SYNTHETIC",
    forecastProvenance: "MODEL_PREDICTED",
    forecast: [
      {
        date: "2026-09-11",
        leadDays: 1,
        condition: "RAIN",
        rainMm: 16,
        windKph: 20,
        windFromDegrees: 100,
        cloudCoverFraction: 0.8,
        tempBand: "WARM",
        confidence: 0.62,
      },
    ],
    ...overrides,
  };
}

function frameWith(weather: ControlRoomWeather[] | undefined): ControlRoomFrame {
  return { ...baseFrame, weather };
}

const STILL = { atMs: baseFrame.atMs, animated: false } as const;

function describeOne(weather: ControlRoomWeather, animated = false, atMs = baseFrame.atMs): WeatherOverlayDescriptor {
  const built = buildWeatherOverlay(scene, frameWith([weather]), { atMs, animated });
  expect(built).toHaveLength(1);
  return built[0] as WeatherOverlayDescriptor;
}

// ---------------------------------------------------------------------------
// Descriptors
// ---------------------------------------------------------------------------

describe("weather overlay descriptors", () => {
  it("places one descriptor per island, over the geography the scene actually placed", () => {
    const footprint = islandFootprints(scene).get("saint-lucia");
    expect(footprint).toBeDefined();
    const descriptor = describeOne(reading());
    expect(descriptor.islandId).toBe("saint-lucia");
    expect(descriptor.centre).toEqual(footprint?.centre);
    expect(descriptor.discRadiusMeters).toBeGreaterThan(0);
    // Far enough from the equator that a naive metre/degree conversion would
    // show: the centre has to sit inside the island's own bounding box.
    const latitudes = scene.farms.map((farm) => farm.position.latitude);
    expect(descriptor.centre.latitude).toBeGreaterThan(Math.min(...latitudes) - 1);
    expect(descriptor.centre.latitude).toBeLessThan(Math.max(...latitudes) + 1);
  });

  it("draws nothing for an island the run never placed", () => {
    // A reading for an island outside the run's scope has no geography to sit
    // over, so it produces no descriptor rather than a disc over open water.
    const built = buildWeatherOverlay(
      scene,
      frameWith([reading({ islandId: "grenada", condition: "STORM" })]),
      STILL,
    );
    expect(built).toEqual([]);
  });

  it("draws nothing for a replay saved before weather existed", () => {
    expect(buildWeatherOverlay(scene, frameWith(undefined), STILL)).toEqual([]);
    expect(buildWeatherOverlay(scene, frameWith([]), STILL)).toEqual([]);
  });

  it("deepens the disc as the sky closes in", () => {
    const conditions: WeatherCondition[] = ["CLEAR", "CLOUD", "RAIN", "STORM"];
    const alphas = conditions.map(
      (condition) => describeOne(reading({ condition, cloudCoverFraction: 0.6, rainMm: 6 })).discAlpha,
    );
    for (let index = 1; index < alphas.length; index += 1) {
      expect(alphas[index] as number).toBeGreaterThan(alphas[index - 1] as number);
    }
    // Ordinary weather has to be visibly different from meaningful weather,
    // which is the criterion this threshold exists to satisfy.
    expect(alphas[0] as number).toBeLessThan(0.15);
    expect(alphas[3] as number).toBeGreaterThan(0.4);
  });

  it("reads cloud cover and rainfall as well as the condition enum", () => {
    const thin = describeOne(reading({ condition: "RAIN", cloudCoverFraction: 0.1, rainMm: 12 }));
    const thick = describeOne(reading({ condition: "RAIN", cloudCoverFraction: 0.95, rainMm: 12 }));
    expect(thick.discAlpha).toBeGreaterThan(thin.discAlpha);

    const drizzle = describeOne(reading({ condition: "RAIN", cloudCoverFraction: 0.5, rainMm: 12 }));
    const downpour = describeOne(reading({ condition: "RAIN", cloudCoverFraction: 0.5, rainMm: STORM_DAY_MM }));
    expect(downpour.discAlpha).toBeGreaterThan(drizzle.discAlpha);

    // Never opaque: the map underneath has to stay readable.
    expect(downpour.discAlpha).toBeLessThan(0.7);
  });

  it("gives each condition its own colour and borrows no crop-status hue", () => {
    const conditions: WeatherCondition[] = ["CLEAR", "CLOUD", "RAIN", "STORM"];
    const colours = conditions.map((condition) => describeOne(reading({ condition })).discColour);
    expect(new Set(colours).size).toBe(conditions.length);
    // The status ramp in globals.css: one state, one colour, everywhere.
    const statusRamp = ["#377f8c", "#5ba64b", "#7f9c92", "#c45645", "#d99b2b", "#b276e8"];
    for (const colour of colours) expect(statusRamp).not.toContain(colour.toLowerCase());
  });

  it("rings a storm and nothing else", () => {
    expect(describeOne(reading({ condition: "STORM", rainMm: 60, windKph: 70 })).showRing).toBe(true);
    for (const condition of ["CLEAR", "CLOUD", "RAIN"] as WeatherCondition[]) {
      expect(describeOne(reading({ condition })).showRing).toBe(false);
    }
    const storm = describeOne(reading({ condition: "STORM" }));
    expect(storm.ringRadiusMeters).toBeGreaterThan(storm.discRadiusMeters);
  });

  it("turns a wind bearing into an arrow rotation pointing downwind", () => {
    // Meteorological convention: `windFromDegrees` is where the wind comes
    // from, so an arrow showing where it is going points the opposite way.
    expect(downwindBearingDegrees(0)).toBe(180);
    expect(downwindBearingDegrees(270)).toBe(90);

    const northerly = describeOne(reading({ windFromDegrees: 0 }));
    expect(northerly.downwindBearingDegrees).toBe(180);
    // Cesium rotates a billboard counter-clockwise and the icon points north,
    // so a clockwise compass bearing arrives as its negation.
    expect(northerly.windRotationRadians).toBeCloseTo(-Math.PI, 6);

    const westerly = describeOne(reading({ windFromDegrees: 270 }));
    expect(westerly.windRotationRadians).toBeCloseTo(-Math.PI / 2, 6);
  });

  it("scales the wind arrow with wind speed", () => {
    const calm = describeOne(reading({ windKph: 5 }));
    const gale = describeOne(reading({ windKph: 80 }));
    expect(gale.windScale).toBeGreaterThan(calm.windScale);
    expect(calm.windScale).toBeGreaterThan(0);
  });

  it("holds still when animation is off", () => {
    const weather = reading({ condition: "STORM", rainMm: 60, windKph: 70 });
    const early = describeOne(weather, false, baseFrame.atMs);
    const later = describeOne(weather, false, baseFrame.atMs + PULSE_PERIOD_MS / 3);
    // Reduced motion is a still image, not a slower one: the phase is pinned
    // to zero, so nothing drifts and the ring does not pulse.
    expect(early.discCentre).toEqual(early.centre);
    expect(later).toEqual(early);
  });

  it("animates from simulation time alone, so scrubbing is reproducible", () => {
    const weather = reading({ condition: "STORM", rainMm: 60, windKph: 70, windFromDegrees: 90 });
    const atRest = describeOne(weather, true, 0);
    const quarter = describeOne(weather, true, PULSE_PERIOD_MS / 4);
    expect(quarter.discCentre).not.toEqual(quarter.centre);
    expect(quarter.ringRadiusMeters).toBeGreaterThan(atRest.ringRadiusMeters);

    // The same instant always renders the same overlay, which is what makes
    // rewinding and scrubbing return to the state that was there before.
    expect(describeOne(weather, true, PULSE_PERIOD_MS / 4)).toEqual(quarter);
    // One full period later is the same point in the cycle.
    expect(describeOne(weather, true, PULSE_PERIOD_MS)).toEqual(atRest);
  });

  it("drifts the cloud downwind rather than in an arbitrary direction", () => {
    const easterly = describeOne(reading({ windFromDegrees: 270 }), true, PULSE_PERIOD_MS / 4);
    // Wind from the west blows east, so the disc leads its island eastward.
    expect(easterly.discCentre.longitude).toBeGreaterThan(easterly.centre.longitude);
    expect(easterly.discCentre.latitude).toBeCloseTo(easterly.centre.latitude, 6);
  });

  it("describes every island a real recorded run carries", () => {
    const built = buildWeatherOverlay(scene, baseFrame, STILL);
    expect(built.length).toBeGreaterThan(0);
    for (const descriptor of built) {
      expect(descriptor.heightMeters).toBeGreaterThan(0);
      expect(descriptor.discAlpha).toBeGreaterThan(0);
      expect(Number.isFinite(descriptor.windRotationRadians)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// The Cesium layer, against a fake viewer
// ---------------------------------------------------------------------------

class FakeProperty {
  constructor(public readonly value: unknown) {}
}

const fakeCesium = {
  Math: { toRadians: (degrees: number) => (degrees * Math.PI) / 180 },
  Cartesian3: {
    fromDegrees: (longitude: number, latitude: number, height = 0) => ({ longitude, latitude, height }),
    fromDegreesArrayHeights: (values: number[]) => values.slice(),
  },
  Color: {
    fromCssColorString: (css: string) => ({ css, alpha: 1, withAlpha: (alpha: number) => ({ css, alpha }) }),
  },
  ConstantProperty: FakeProperty,
  ConstantPositionProperty: FakeProperty,
  ColorMaterialProperty: FakeProperty,
} as unknown as CesiumModule;

interface FakeEntity {
  id: string;
  show: boolean;
  ellipse?: Record<string, unknown>;
  polyline?: Record<string, unknown>;
  billboard?: Record<string, unknown>;
  position?: unknown;
}

function fakeViewer() {
  const store = new Map<string, FakeEntity>();
  const viewer = {
    isDestroyed: () => false,
    entities: {
      getById: (id: string) => store.get(id),
      add: (options: Omit<FakeEntity, "show"> & { show?: boolean }) => {
        const entity: FakeEntity = { ...options, show: options.show ?? true };
        store.set(options.id, entity);
        return entity;
      },
    },
  };
  return { viewer: viewer as never, store };
}

let webglAvailable = true;

beforeAll(() => {
  // jsdom implements neither a 2D context nor WebGL. Both are stubbed so the
  // layer's real drawing path runs; `webglAvailable` is flipped by the
  // lower-detail test to exercise the fallback deliberately.
  const context2d = new Proxy({}, { get: () => () => undefined });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((kind: string) => {
    if (kind === "2d") return context2d;
    if (kind === "webgl2" || kind === "webgl" || kind === "experimental-webgl") {
      return webglAvailable ? {} : null;
    }
    return null;
  }) as never);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,arrow");
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe("weather layer entities", () => {
  it("names every entity under the weather prefix so clicks can drill through them", () => {
    const { viewer, store } = fakeViewer();
    const descriptors = buildWeatherOverlay(scene, frameWith([reading({ condition: "STORM" })]), STILL);
    syncWeatherLayer(fakeCesium, viewer, descriptors, true);

    const ids = [...store.keys()];
    expect(ids.length).toBe(3); // disc, ring, wind arrow
    for (const id of ids) {
      expect(id.startsWith(WEATHER_ENTITY_PREFIX)).toBe(true);
      expect(isWeatherEntityId(id)).toBe(true);
    }
    // Farms, buyers, vehicles, routes and disruption markers keep their own
    // ids and are therefore never mistaken for overlay entities.
    expect(isWeatherEntityId(scene.farms[0]?.farmId)).toBe(false);
    expect(isWeatherEntityId(undefined)).toBe(false);
  });

  it("draws a disc at the descriptor's radius and rings only a storm", () => {
    const { viewer, store } = fakeViewer();
    const clear = buildWeatherOverlay(scene, frameWith([reading({ condition: "CLEAR" })]), STILL);
    syncWeatherLayer(fakeCesium, viewer, clear, true);
    const discId = `${WEATHER_ENTITY_PREFIX}disc::saint-lucia`;
    const ringId = `${WEATHER_ENTITY_PREFIX}ring::saint-lucia`;
    expect(store.get(discId)?.ellipse?.semiMajorAxis).toBe(clear[0]?.discRadiusMeters);
    expect(store.get(ringId)?.show).toBe(false);

    const storm = buildWeatherOverlay(scene, frameWith([reading({ condition: "STORM" })]), STILL);
    syncWeatherLayer(fakeCesium, viewer, storm, true);
    expect(store.get(ringId)?.show).toBe(true);
    expect(store.get(discId)?.show).toBe(true);
  });

  it("hides every entity when the overlay is switched off, and shows them again", () => {
    const { viewer, store } = fakeViewer();
    const descriptors = buildWeatherOverlay(scene, frameWith([reading({ condition: "STORM" })]), STILL);
    syncWeatherLayer(fakeCesium, viewer, descriptors, true);
    expect([...store.values()].every((entity) => entity.show)).toBe(true);

    syncWeatherLayer(fakeCesium, viewer, descriptors, false);
    expect([...store.values()].some((entity) => entity.show)).toBe(false);
    // Off hides; it never removes. Nothing about the replay changed.
    expect(store.size).toBe(3);

    syncWeatherLayer(fakeCesium, viewer, descriptors, true);
    expect(store.get(`${WEATHER_ENTITY_PREFIX}disc::saint-lucia`)?.show).toBe(true);
  });

  it("hides an island that has left the frame", () => {
    const { viewer, store } = fakeViewer();
    syncWeatherLayer(fakeCesium, viewer, buildWeatherOverlay(scene, frameWith([reading()]), STILL), true);
    expect(store.get(`${WEATHER_ENTITY_PREFIX}disc::saint-lucia`)?.show).toBe(true);

    syncWeatherLayer(fakeCesium, viewer, [], true);
    expect([...store.values()].some((entity) => entity.show)).toBe(false);
  });

  it("falls back to lower detail when the effect cannot get a WebGL context", () => {
    webglAvailable = false;
    try {
      expect(prefersLowerDetail()).toBe(true);
    } finally {
      webglAvailable = true;
    }
  });

  it("falls back to lower detail on a four-core machine", () => {
    const original = Object.getOwnPropertyDescriptor(Navigator.prototype, "hardwareConcurrency");
    Object.defineProperty(navigator, "hardwareConcurrency", { value: 4, configurable: true });
    try {
      expect(prefersLowerDetail()).toBe(true);
      Object.defineProperty(navigator, "hardwareConcurrency", { value: 16, configurable: true });
      expect(prefersLowerDetail()).toBe(false);
    } finally {
      if (original) Object.defineProperty(Navigator.prototype, "hardwareConcurrency", original);
      Reflect.deleteProperty(navigator, "hardwareConcurrency");
    }
  });
});

// ---------------------------------------------------------------------------
// The panel: switch, key, and the reading for the current replay time
// ---------------------------------------------------------------------------

function LegendHarness({ frame }: { frame: ControlRoomFrame }): React.JSX.Element {
  const [enabled, setEnabled] = useState(true);
  return (
    <Legend
      frame={frame}
      weatherLegend={scene.weatherLegend}
      weatherEnabled={enabled}
      onWeatherEnabledChange={setEnabled}
    />
  );
}

describe("weather controls and readout", () => {
  it("offers a custom switch, on by default, with no native checkbox", () => {
    const { container } = render(<LegendHarness frame={frameWith([reading()])} />);
    const toggle = screen.getByRole("switch", { name: /on|off/i });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(toggle.tagName).toBe("BUTTON");
    // The front-end design contract forbids native control chrome.
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it("switches the overlay off and back on", () => {
    render(<LegendHarness frame={frameWith([reading()])} />);
    const toggle = screen.getByRole("switch");
    fireEvent.click(toggle);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });

  it("names every mark the overlay draws", () => {
    render(<LegendHarness frame={frameWith([reading()])} />);
    for (const label of ["Clear", "Cloudy", "Rain", "Storm", "Wind direction"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(weatherLegendRows(scene.weatherLegend)).toHaveLength(5);
  });

  it("reads the selected frame's own values, and follows the playhead", () => {
    const first = reading({ condition: "RAIN", rainMm: 18.4, windKph: 26, windFromDegrees: 45, tempBand: "WARM", date: "2026-09-10" });
    const { rerender } = render(<LegendHarness frame={frameWith([first])} />);
    expect(screen.getByText(/Saint Lucia · 2026-09-10/)).toBeInTheDocument();
    expect(screen.getByText(/Rain · 18\.4 mm rain · 26 kph from NE · Warm/)).toBeInTheDocument();
    expect(screen.getByText(/62% confidence/)).toBeInTheDocument();

    const later = reading({ condition: "STORM", rainMm: 61, windKph: 72, windFromDegrees: 180, tempBand: "COOL", date: "2026-09-11" });
    rerender(<LegendHarness frame={frameWith([later])} />);
    expect(screen.getByText(/Saint Lucia · 2026-09-11/)).toBeInTheDocument();
    expect(screen.getByText(/Storm · 61 mm rain · 72 kph from S · Cool/)).toBeInTheDocument();
  });

  it("keeps the synthetic and model-predicted labels visible", () => {
    render(<LegendHarness frame={frameWith([reading()])} />);
    expect(screen.getByText(/SYNTHETIC realised weather/)).toBeInTheDocument();
    expect(screen.getByText(/MODEL_PREDICTED forecast/)).toBeInTheDocument();
    expect(screen.getByText(/No live weather service/)).toBeInTheDocument();
  });

  it("still renders the crop key alone, for the launch screen", () => {
    render(<Legend />);
    expect(screen.getByText("Ready to harvest")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("words a reading the way a person reads it", () => {
    const rows = weatherDetailRows(frameWith([reading({ windFromDegrees: 315, rainMm: 0 })]), scene.weatherLegend);
    expect(rows[0]?.windText).toContain("from NW");
    expect(rows[0]?.rainText).toBe("0 mm rain");
    expect(compassPoint(0)).toBe("N");
    expect(compassPoint(359)).toBe("N");
    expect(formatIslandName("saint-lucia")).toBe("Saint Lucia");
  });
});
