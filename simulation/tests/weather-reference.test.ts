/**
 * Recorded Saint Lucia weather as a reference input (issue #90).
 *
 * Five things are worth defending here, and they split cleanly into two kinds.
 *
 * The dataset must be trustworthy on its own terms: complete, numeric, and
 * citable record by record. That half follows `maritime-reference.test.ts`,
 * because the failure it guards against is identical — a dataset that quietly
 * degrades into "some values sourced, some values filled in" while everything
 * downstream keeps producing confident numbers.
 *
 * The engine must then use it without giving anything away: the same seed picks
 * the same recorded year, a recorded day is labelled apart from a generated
 * one, a future day is still unreadable, and a scenario that did not opt in is
 * untouched. The last of those is the one most likely to break silently, so it
 * is asserted against the regional scenarios rather than assumed.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { runScenario } from '../src/engine.js';
import { RandomSource } from '../src/core/random.js';
import { IdFactory } from '../src/core/ids.js';
import { saintLuciaDemoV1 } from '../src/scenario/saint-lucia-demo-v1.js';
import { caribbeanIslandsV1 } from '../src/scenario/caribbean-islands-v1.js';
import {
  REFERENCE_CLOUD_FRACTION,
  REFERENCE_RAIN_MM,
  REFERENCE_STORM_RAIN_MM,
  REFERENCE_STORM_WIND_KPH,
  REFERENCE_WEATHER_EVIDENCE,
  SAINT_LUCIA_WEATHER_REFERENCE,
  SYNTHETIC_WEATHER_EVIDENCE,
  buildWeatherReferenceSeries,
  classifyReferenceCondition,
  loadWeatherReference,
  pickReferenceYear,
  referenceTempBand,
  toReferenceReading,
} from '../src/world/weather-reference.js';
import type { WeatherReferenceFile } from '../src/world/weather-reference.js';

const DATA_PATH = fileURLToPath(new URL(`../data/${SAINT_LUCIA_WEATHER_REFERENCE}.json`, import.meta.url));
const BENCHMARK_SEEDS = [42, 8675309, 7, 19, 23, 31, 101, 202, 303, 404];

const raw = JSON.parse(readFileSync(DATA_PATH, 'utf8')) as WeatherReferenceFile;

const everyDay = () => raw.stations.flatMap((station) => station.years.flatMap((year) => year.days));

/** The demo world for a seed, built directly so hidden truth can be inspected. */
function buildDemoWorld(seed: number) {
  const random = new RandomSource(seed);
  return saintLuciaDemoV1.build({
    random,
    ids: new IdFactory(random.stream('scenario:ids')),
    startsAt: Date.parse(saintLuciaDemoV1.startsAtIso),
  });
}

const referenceSeries = (seed: number) =>
  buildWeatherReferenceSeries({
    datasetId: SAINT_LUCIA_WEATHER_REFERENCE,
    islandIds: ['saint-lucia'],
    stream: new RandomSource(seed).stream('scenario:weather:reference'),
  });

describe('the recorded dataset on disk', () => {
  it('parses with the expected top-level shape and declares its own licence', () => {
    expect(raw.datasetId).toBe(SAINT_LUCIA_WEATHER_REFERENCE);
    expect(raw.version).toBeTruthy();
    expect(raw.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(raw.evidenceType).toBe('PUBLIC_REFERENCE');
    expect(raw.licence.name).toContain('CC BY 4.0');
    expect(raw.licence.url).toMatch(/^https:\/\/creativecommons\.org\/licenses\/by\/4\.0\//);
    expect(raw.licence.statedAt).toMatch(/^https?:\/\//);
    expect(raw.licence.attribution).toContain('Open-Meteo');
    expect(raw.source.url).toMatch(/^https?:\/\//);
    expect(raw.notes.length).toBeGreaterThan(0);
  });

  it('covers the demo scenario window, in three complete years, at two stations', () => {
    expect(raw.coverage.islandIds).toContain('saint-lucia');
    expect(raw.coverage.calendarWindow).toEqual({ fromMonthDay: '09-01', toMonthDay: '09-22' });
    expect(raw.coverage.years.length).toBeGreaterThanOrEqual(3);
    expect(raw.stations.map((station) => station.role)).toContain('PRIMARY');

    for (const station of raw.stations) {
      expect(station.years.map((year) => year.year).sort()).toEqual([...raw.coverage.years].sort());
      for (const year of station.years) {
        expect(year.days.length, `${station.stationId} ${year.year}`).toBe(raw.coverage.daysPerStationYear);
        expect(year.days.map((day) => day.monthDay)).toEqual(
          year.days.map((day) => day.date.slice(5)),
        );
        // The grid cell the API answered from, not the point requested. Recorded
        // so a reader can see this is an area mean rather than a rain gauge.
        expect(Math.abs(year.grid.latitude - station.requested.latitude)).toBeLessThan(0.5);
        expect(Math.abs(year.grid.longitude - station.requested.longitude)).toBeLessThan(0.5);
      }
    }
  });

  it('gives every daily record a real number in every field, with no silent nulls', () => {
    for (const day of everyDay()) {
      expect(day.date, day.date).toMatch(/^\d{4}-09-\d{2}$/);
      expect(Number.isFinite(day.precipitationMm), day.date).toBe(true);
      expect(day.precipitationMm, day.date).toBeGreaterThanOrEqual(0);
      expect(day.windSpeedMaxKph, day.date).toBeGreaterThan(0);
      expect(day.windFromDegrees, day.date).toBeGreaterThanOrEqual(0);
      expect(day.windFromDegrees, day.date).toBeLessThan(360);
      expect(day.cloudCoverMeanPercent, day.date).toBeGreaterThanOrEqual(0);
      expect(day.cloudCoverMeanPercent, day.date).toBeLessThanOrEqual(100);
      expect(day.temperatureMaxC, day.date).toBeGreaterThan(day.temperatureMinC);
    }
  });

  it('carries a complete PUBLIC_REFERENCE citation on every single record', () => {
    for (const day of everyDay()) {
      const reference = day.reference;
      expect(Object.keys(reference).sort()).toEqual(
        ['evidenceType', 'geography', 'licence', 'retrievedAt', 'source'].sort(),
      );
      expect(Object.keys(reference.source).sort()).toEqual(['publisher', 'title', 'url'].sort());
      expect(reference.evidenceType, day.date).toBe('PUBLIC_REFERENCE');
      expect(reference.source.url, day.date).toMatch(/^https:\/\/archive-api\.open-meteo\.com\/v1\/archive\?/);
      expect(reference.licence, day.date).toContain('CC BY 4.0');
      expect(reference.retrievedAt, day.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(reference.geography.trim().length, day.date).toBeGreaterThan(0);
      // The citation must name the year it covers, so a record cannot be moved
      // between station-years and keep a plausible-looking source.
      expect(reference.source.url, day.date).toContain(`start_date=${day.date.slice(0, 4)}-09-01`);
    }
  });

  it('loads through the validating loader and rejects an unknown dataset id', () => {
    const file = loadWeatherReference(SAINT_LUCIA_WEATHER_REFERENCE);
    expect(file.datasetId).toBe(SAINT_LUCIA_WEATHER_REFERENCE);
    expect(loadWeatherReference(SAINT_LUCIA_WEATHER_REFERENCE)).toBe(file);
    expect(() => loadWeatherReference('atlantis-weather.v1')).toThrow(/Unknown weather reference dataset/);
  });
});

describe('mapping a record onto the engine vocabulary', () => {
  it('classifies on the documented thresholds, storming on either limb', () => {
    expect(classifyReferenceCondition(REFERENCE_STORM_RAIN_MM, 10, 0.9)).toBe('STORM');
    expect(classifyReferenceCondition(0, REFERENCE_STORM_WIND_KPH, 0.1)).toBe('STORM');
    expect(classifyReferenceCondition(REFERENCE_RAIN_MM, 10, 0.1)).toBe('RAIN');
    expect(classifyReferenceCondition(0, 10, REFERENCE_CLOUD_FRACTION)).toBe('CLOUD');
    expect(classifyReferenceCondition(0, 10, REFERENCE_CLOUD_FRACTION - 0.01)).toBe('CLEAR');
  });

  it('bands temperature from the recorded daily maximum', () => {
    expect(referenceTempBand(33)).toBe('HOT');
    expect(referenceTempBand(29.5)).toBe('WARM');
    expect(referenceTempBand(26)).toBe('COOL');
  });

  it('keeps every mapped reading inside the engine ranges', () => {
    for (const day of everyDay()) {
      const reading = toReferenceReading(day);
      expect(reading.rainMm).toBeGreaterThanOrEqual(0);
      expect(reading.windKph).toBeGreaterThan(0);
      expect(reading.windFromDegrees).toBeGreaterThanOrEqual(0);
      expect(reading.windFromDegrees).toBeLessThan(360);
      expect(reading.cloudCoverFraction).toBeGreaterThanOrEqual(0);
      expect(reading.cloudCoverFraction).toBeLessThanOrEqual(1);
      expect(['CLEAR', 'CLOUD', 'RAIN', 'STORM']).toContain(reading.condition);
      expect(reading.recordedDate).toBe(day.date);
    }
  });

  /**
   * The honest headline of this dataset, asserted rather than only written down.
   *
   * A daily aggregate over a grid cell is not a squall gauge. If a future
   * refresh brings in a window that does contain a hurricane strike, this test
   * fails and the caveat in `README-weather.md` has to be rewritten instead of
   * being left standing as a stale claim.
   */
  it('records how little severe weather the reanalysis actually contains', () => {
    const readings = everyDay().map(toReferenceReading);
    const storms = readings.filter((reading) => reading.condition === 'STORM');
    expect(storms).toHaveLength(1);
    expect(Math.max(...readings.map((reading) => reading.windKph))).toBeLessThan(REFERENCE_STORM_WIND_KPH);
  });
});

describe('choosing a recorded year', () => {
  it('picks the same year for the same seed, every time', () => {
    for (const seed of BENCHMARK_SEEDS) {
      expect(referenceSeries(seed).selections).toEqual(referenceSeries(seed).selections);
    }
  });

  it('picks a year the dataset actually holds, and spreads across the seeds', () => {
    const years = BENCHMARK_SEEDS.map((seed) => referenceSeries(seed).selections[0]?.year);
    for (const year of years) expect(raw.coverage.years).toContain(year);
    expect(new Set(years).size).toBeGreaterThan(1);
  });

  it('depends on the set of years, not on their order in the file', () => {
    const stream = () => new RandomSource(42).stream('years');
    expect(pickReferenceYear([2023, 2024, 2025], stream())).toBe(pickReferenceYear([2025, 2023, 2024], stream()));
    expect(() => pickReferenceYear([], stream())).toThrow(/empty/);
  });

  it('drives the island from the PRIMARY station', () => {
    const selection = referenceSeries(42).selections[0];
    const primary = raw.stations.find((station) => station.role === 'PRIMARY');
    expect(selection?.stationId).toBe(primary?.stationId);
  });
});

describe('the demo scenario runs on the record', () => {
  it('opts in, and every day of the run is labelled PUBLIC_REFERENCE', () => {
    expect(saintLuciaDemoV1.weatherReference).toBe(SAINT_LUCIA_WEATHER_REFERENCE);

    const frames = runScenario({ scenarioId: saintLuciaDemoV1.scenarioId, policy: 'HARVEST', seed: 42, captureFrames: true })
      .timeline?.frames ?? [];
    const days = frames.flatMap((frame) => frame.weather ?? []);
    expect(days.length).toBeGreaterThan(0);
    for (const day of days) {
      expect(day.evidenceType).toBe(REFERENCE_WEATHER_EVIDENCE);
      // The run is 2026; the record is not. A reader must be able to see which
      // real day a value came from.
      expect(day.recordedDate).toMatch(/^\d{4}-09-\d{2}$/);
      expect(day.recordedDate?.slice(5)).toBe(day.date.slice(5));
      expect(day.recordedDate).not.toBe(day.date);
      // The run stays a synthetic simulation whatever its weather is made of.
      expect(day.provenance).toBe('SYNTHETIC');
      expect(day.forecastProvenance).toBe('MODEL_PREDICTED');
    }
  });

  it('says so in its provenance note, without overclaiming', () => {
    expect(saintLuciaDemoV1.provenanceNote).toContain('SYNTHETIC');
    expect(saintLuciaDemoV1.provenanceNote).toContain('PUBLIC_REFERENCE');
    expect(saintLuciaDemoV1.provenanceNote).toContain('recorded');
  });

  it('agrees with itself: truth.rainfallMmByDate matches the recorded realised rain', () => {
    const world = buildDemoWorld(42);
    for (const date of world.truth.weather.dates) {
      const realised = world.truth.weather.truthOn('saint-lucia', date);
      expect(world.truth.rainfallMmByDate.get(date), date).toBe(realised?.rainMm);
    }
  });

  it('reproduces identical realised weather for one seed, and differs across seeds', () => {
    const realised = (seed: number) =>
      runScenario({ scenarioId: saintLuciaDemoV1.scenarioId, policy: 'HARVEST', seed, captureFrames: true })
        .timeline?.frames.flatMap((frame) => frame.weather ?? []) ?? [];

    expect(JSON.stringify(realised(19))).toBe(JSON.stringify(realised(19)));
    // 19 replays a different recorded year from 7, so the two must not match.
    expect(JSON.stringify(realised(19))).not.toBe(JSON.stringify(realised(7)));
  });

  it('never lets a recorded future day be read before it occurs', () => {
    const world = buildDemoWorld(404);
    const model = world.truth.weather;
    const [first, second] = model.dates;
    expect(model.realisedUpTo('saint-lucia', first as string, first as string)).not.toBeNull();
    expect(model.realisedUpTo('saint-lucia', second as string, first as string)).toBeNull();
    // Recorded or not makes no difference to the exposure rule.
    expect(model.truthOn('saint-lucia', second as string)?.evidenceType).toBe(REFERENCE_WEATHER_EVIDENCE);
  });

  it('still runs all ten benchmark seeds, with weather that does something', () => {
    for (const seed of BENCHMARK_SEEDS) {
      const { metrics } = runScenario({ scenarioId: saintLuciaDemoV1.scenarioId, policy: 'HARVEST', seed });
      expect(metrics.weather.wetDays, `seed ${seed}`).toBeGreaterThan(0);
      expect(metrics.weather.readinessDelayDays, `seed ${seed}`).toBeGreaterThan(0);
      expect(metrics.weather.weatherSpoilageKg, `seed ${seed}`).toBeGreaterThan(0);
    }
  });
});

describe('scenarios that did not opt in are untouched', () => {
  it('leaves the regional islands on the synthetic generator', () => {
    expect(caribbeanIslandsV1.weatherReference).toBeUndefined();

    const frames = runScenario({ scenarioId: caribbeanIslandsV1.scenarioId, policy: 'HARVEST', seed: 42, captureFrames: true })
      .timeline?.frames ?? [];
    const days = frames.flatMap((frame) => frame.weather ?? []);
    expect(days.length).toBeGreaterThan(0);
    for (const day of days) {
      expect(day.evidenceType).toBe(SYNTHETIC_WEATHER_EVIDENCE);
      expect(day.recordedDate).toBeUndefined();
    }
  });
});
