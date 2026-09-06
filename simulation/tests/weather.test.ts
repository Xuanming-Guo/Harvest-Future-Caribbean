/**
 * Realised weather and imperfect forecasts (issue #37).
 *
 * The four properties worth defending, in the order the issue states them:
 *
 *   1. the same seed reproduces the same weather, forecasts included;
 *   2. a forecast is genuinely wrong sometimes, and never a window onto truth;
 *   3. different realised weather changes the run in an explainable way;
 *   4. the fragmented baseline is not quietly handed the forecast.
 *
 * The third is the one a test can most easily fake, by picking whichever pair
 * of seeds happens to differ. The two seeds below were chosen by measuring
 * `metrics.weather.wetDays` across all ten benchmark seeds and taking the
 * driest and the wettest, before any assertion was written.
 */

import { describe, expect, it, vi } from 'vitest';

import { SimulationEngine, runScenario } from '../src/engine.js';
import { assertNoTruthLeak } from '../src/world/observable.js';
import { saintLuciaDemoV1 } from '../src/scenario/saint-lucia-demo-v1.js';
import {
  FORECAST_HORIZON_DAYS,
  FORECAST_PROVENANCE,
  REALISED_WEATHER_PROVENANCE,
  WEATHER_LEGEND,
  WeatherModel,
  classifyCondition,
} from '../src/world/weather.js';
import { RandomSource } from '../src/core/random.js';
import { DAY_MS, formatDate, parseInstant } from '../src/core/time.js';
import type { ControlRoomFrame } from '../src/replay.js';

const SCENARIO = saintLuciaDemoV1.scenarioId;
const BENCHMARK_SEEDS = [42, 8675309, 7, 19, 23, 31, 101, 202, 303, 404];

/**
 * Driest and wettest of the ten benchmark seeds, by realised wet days.
 *
 * Re-derived after issue #90 pointed the demo at recorded weather, by the same
 * method the original pair was chosen with: measure `metrics.weather.wetDays`
 * across the ten benchmark seeds, then take the extremes, before writing any
 * assertion. The recorded series makes wetness a property of *which September
 * the seed replays* rather than of the seed itself, so the extremes are now
 * ties — every seed that draws 2023 sees 3 wet days and every seed that draws
 * 2024 sees 7. The tie is broken by taking the numerically smallest seed in
 * each class, a rule fixed before the numbers were looked at, so that no seed
 * here was picked for making an assertion pass.
 */
const DRY_SEED = 19;
const WET_SEED = 7;

function capturedFrames(seed: number, policy: 'BASELINE' | 'HARVEST' = 'HARVEST'): ControlRoomFrame[] {
  const result = runScenario({ scenarioId: SCENARIO, policy, seed, captureFrames: true });
  return result.timeline?.frames ?? [];
}

describe('realised weather determinism', () => {
  it('reproduces identical weather and forecasts for one seed', () => {
    const first = capturedFrames(42).map((frame) => frame.weather);
    const second = capturedFrames(42).map((frame) => frame.weather);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('reproduces identical weather effect metrics for one seed', () => {
    const first = runScenario({ scenarioId: SCENARIO, policy: 'HARVEST', seed: WET_SEED });
    const second = runScenario({ scenarioId: SCENARIO, policy: 'HARVEST', seed: WET_SEED });
    expect(second.metrics.weather).toEqual(first.metrics.weather);
  });

  it('gives different seeds different weather', () => {
    const dry = runScenario({ scenarioId: SCENARIO, policy: 'HARVEST', seed: DRY_SEED });
    const wet = runScenario({ scenarioId: SCENARIO, policy: 'HARVEST', seed: WET_SEED });
    expect(wet.metrics.weather.wetDays).toBeGreaterThan(dry.metrics.weather.wetDays);
  });

  it('classifies a day on either limb of a storm', () => {
    // A dry blow is still a storm, and so is a downpour in still air.
    expect(classifyCondition(60, 10)).toBe('STORM');
    expect(classifyCondition(0, 70)).toBe('STORM');
    expect(classifyCondition(20, 10)).toBe('RAIN');
    expect(classifyCondition(5, 10)).toBe('CLOUD');
    expect(classifyCondition(0, 10)).toBe('CLEAR');
  });
});

describe('the forecast never becomes a window onto truth', () => {
  it('refuses realised weather for a day that has not occurred', () => {
    const engine = new SimulationEngine({ scenarioId: SCENARIO, policy: 'HARVEST', seed: 42 });
    const observable = engine.observableWeather;
    const [islandId] = engine.weatherIslandIds;
    expect(islandId).toBeDefined();

    const startsAt = parseInstant(saintLuciaDemoV1.startsAtIso);
    const today = formatDate(startsAt);
    const tomorrow = formatDate(startsAt + DAY_MS);
    expect(observable.realisedOn(islandId as string, today)).not.toBeNull();
    expect(observable.realisedOn(islandId as string, tomorrow)).toBeNull();
    // The forecast for that same day is available, and is a different object.
    const forecast = observable.forecast(islandId as string);
    expect(forecast.map((day) => day.date)).toContain(tomorrow);
  });

  it('never puts a realised reading for a later day into a replay frame', () => {
    for (const frame of capturedFrames(WET_SEED)) {
      for (const island of frame.weather ?? []) {
        expect(island.date <= frame.at.slice(0, 10)).toBe(true);
        for (const day of island.forecast) expect(day.date > island.date).toBe(true);
      }
    }
  });

  it('keeps the weather model out of anything a participant receives', () => {
    const frames = capturedFrames(42);
    expect(() => assertNoTruthLeak(frames, 'replay frames')).not.toThrow();
    // And the guard would notice if a future caller handed the model over whole:
    // the model stores realised weather for days that have not happened, so the
    // whole object is future truth however innocuous the field it arrived in.
    const random = new RandomSource(42);
    const startsAt = parseInstant(saintLuciaDemoV1.startsAtIso);
    const model = new WeatherModel({
      islandIds: ['saint-lucia'],
      startsAt,
      days: 3,
      rainfallMm: () => 10,
      realisedStream: random.stream('probe:realised'),
      forecastStream: random.stream('probe:forecast'),
    });
    expect(() => assertNoTruthLeak({ payload: model }, 'planted leak')).toThrow(/Hidden simulation truth leaked/);
  });

  it('gets the forecast wrong, and more wrong further out', () => {
    // Error is measured against the realised day the forecast was aiming at,
    // taken from the frame that later published it. A forecast that agreed with
    // truth would score zero here and would mean the noise had stopped working.
    const realised = new Map<string, number>();
    const errorsByLead = new Map<number, number[]>();
    for (const frame of capturedFrames(WET_SEED)) {
      for (const island of frame.weather ?? []) realised.set(`${island.islandId}:${island.date}`, island.rainMm);
    }
    for (const frame of capturedFrames(WET_SEED)) {
      for (const island of frame.weather ?? []) {
        for (const day of island.forecast) {
          const truth = realised.get(`${island.islandId}:${day.date}`);
          if (truth === undefined) continue;
          const bucket = errorsByLead.get(day.leadDays) ?? [];
          bucket.push(Math.abs(day.rainMm - truth));
          errorsByLead.set(day.leadDays, bucket);
        }
      }
    }
    const mean = (lead: number) => {
      const values = errorsByLead.get(lead) ?? [];
      return values.reduce((total, value) => total + value, 0) / Math.max(1, values.length);
    };
    expect(mean(1)).toBeGreaterThan(0);
    expect(mean(FORECAST_HORIZON_DAYS)).toBeGreaterThan(mean(1));
  });

  it('both misses storms and forecasts storms that never arrive', () => {
    // Across the benchmark seeds the forecast must fail in both directions,
    // otherwise it is a biased oracle rather than an imperfect forecast.
    let missedStorms = 0;
    let phantomStorms = 0;
    for (const seed of [42, 8675309, 7, 19, 23, 31, 101, 202, 303, 404]) {
      const frames = capturedFrames(seed);
      const realised = new Map<string, string>();
      for (const frame of frames) {
        for (const island of frame.weather ?? []) realised.set(`${island.islandId}:${island.date}`, island.condition);
      }
      for (const frame of frames) {
        for (const island of frame.weather ?? []) {
          for (const day of island.forecast) {
            const truth = realised.get(`${island.islandId}:${day.date}`);
            if (truth === undefined) continue;
            if (truth === 'STORM' && day.condition !== 'STORM') missedStorms += 1;
            if (truth !== 'STORM' && day.condition === 'STORM') phantomStorms += 1;
          }
        }
      }
    }
    expect(missedStorms).toBeGreaterThan(0);
    expect(phantomStorms).toBeGreaterThan(0);
  });
});

describe('provenance', () => {
  it('labels a realised record and a forecast as different kinds of claim', () => {
    const island = capturedFrames(42).at(-1)?.weather?.[0];
    expect(island?.provenance).toBe(REALISED_WEATHER_PROVENANCE);
    expect(island?.provenance).toBe('SYNTHETIC');
    expect(island?.forecastProvenance).toBe(FORECAST_PROVENANCE);
    expect(island?.forecastProvenance).toBe('MODEL_PREDICTED');
  });

  it('ships the legend a client would otherwise have to hard-code', () => {
    const result = runScenario({ scenarioId: SCENARIO, policy: 'HARVEST', seed: 42, captureFrames: true });
    const legend = result.timeline?.scene.weatherLegend;
    expect(legend).toEqual(WEATHER_LEGEND);
    expect(legend?.note).toContain('No live weather service');
  });
});

describe('realised weather changes the run', () => {
  it('slows readiness and costs more grade in a wet run than a dry one', () => {
    const dry = runScenario({ scenarioId: SCENARIO, policy: 'HARVEST', seed: DRY_SEED }).metrics.weather;
    const wet = runScenario({ scenarioId: SCENARIO, policy: 'HARVEST', seed: WET_SEED }).metrics.weather;

    expect(wet.wetDays).toBeGreaterThan(dry.wetDays);
    expect(wet.readinessDelayDays).toBeGreaterThan(dry.readinessDelayDays);
    expect(wet.qualityLost).toBeGreaterThan(dry.qualityLost);
  });

  /**
   * Mission delay is deliberately NOT asserted to order with wetness.
   *
   * It did under the synthetic generator, whose wet spells covered a fifth of
   * the run at 60 mm a day. The recorded series has three to seven wet days in
   * twenty-two, so whether any of them coincides with a departure is a property
   * of the delivery schedule rather than of how wet the run was, and the two
   * stopped ordering together the moment the weather became real: the driest
   * benchmark seed delays one mission and the wettest delays none.
   *
   * Weakening the claim to "some mission, on some seed" is what the evidence
   * supports. Hunting for a seed pair that restored the stronger ordering would
   * have made the test a statement about the search rather than about the
   * physics.
   */
  it('still lets departure-day weather delay missions somewhere across the benchmark seeds', () => {
    const delayed = BENCHMARK_SEEDS.reduce(
      (total, seed) => total + runScenario({ scenarioId: SCENARIO, policy: 'HARVEST', seed }).metrics.weather.weatherDelayedMissions,
      0,
    );
    expect(delayed).toBeGreaterThan(0);
  });

  it('attributes some spoilage to the weather on every benchmark seed', () => {
    for (const seed of BENCHMARK_SEEDS) {
      const { weather } = runScenario({ scenarioId: SCENARIO, policy: 'HARVEST', seed }).metrics;
      expect(weather.wetDays).toBeGreaterThan(0);
      expect(weather.weatherSpoilageKg).toBeGreaterThan(0);
      expect(weather.readinessDelayDays).toBeGreaterThan(0);
    }
  });
});

const actsOnForecastStorm = (seed: number): boolean =>
  runScenario({ scenarioId: SCENARIO, policy: 'HARVEST', seed }).decisions.some(
    (decision) => decision.kind === 'HARVEST_PULL_PICKUP_FORWARD' && decision.evidence.source === 'FORECAST',
  );

describe('forecasts inform decisions without touching physics', () => {
  // Forward commitments change when planning happens, so a particular seed is
  // no longer a stable way to exercise this branch. Use an explicit forecast
  // fixture while leaving realised weather and the benchmark seeds untouched.
  it('still lets the Harvest policy respond to a forecast storm without changing realised weather', () => {
    const before = capturedFrames(42);
    const original = WeatherModel.prototype.forecastIssuedOn;
    const forecast = vi.spyOn(WeatherModel.prototype, 'forecastIssuedOn').mockImplementation(function (this: WeatherModel, islandId, date) {
      return original.call(this, islandId, date).map((day) => ({ ...day, condition: 'STORM' }));
    });
    try {
      const result = runScenario({ scenarioId: SCENARIO, policy: 'HARVEST', seed: 42, captureFrames: true });
      expect(result.decisions.some((decision) => decision.kind === 'HARVEST_PULL_PICKUP_FORWARD' && decision.evidence.source === 'FORECAST')).toBe(true);
      const realised = (frames: ControlRoomFrame[]) => [...new Map(frames.flatMap((frame) => (frame.weather ?? []).map((day) => [day.date, { rain: day.rainMm, wind: day.windKph, condition: day.condition }] as const))).entries()];
      expect(realised(result.timeline?.frames ?? [])).toEqual(realised(before));
    } finally {
      forecast.mockRestore();
    }
  });

  it('records that no benchmark seed reaches that path under recorded weather', () => {
    expect(BENCHMARK_SEEDS.filter(actsOnForecastStorm)).toEqual([]);
  });

  it('leaves the baseline blind to the forecast', () => {
    for (const seed of BENCHMARK_SEEDS) {
      const decisions = runScenario({ scenarioId: SCENARIO, policy: 'BASELINE', seed }).decisions;
      expect(decisions.some((decision) => decision.evidence.source === 'FORECAST')).toBe(false);
      expect(decisions.some((decision) => decision.kind === 'HARVEST_PULL_PICKUP_FORWARD')).toBe(false);
    }
  });
});
