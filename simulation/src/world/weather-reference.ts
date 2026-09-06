/**
 * Recorded weather as an offline reference input (issue #90).
 *
 * Everything else in `world/weather.ts` is invented. This file is the one
 * exception: it loads a reviewed, versioned, committed snapshot of **recorded**
 * daily weather for Saint Lucia and hands it to the weather model as the
 * realised series, so the demo runs on conditions that actually occurred rather
 * than on a seeded draw that merely looks Caribbean.
 *
 * Three rules hold the change together, and each exists to stop a specific way
 * this could go wrong:
 *
 *   - **Offline only.** The dataset is a file in `simulation/data/`. Nothing
 *     here opens a socket, so a run is reproducible on a plane and a benchmark
 *     cannot silently change because a weather service revised a value.
 *   - **Opt-in per scenario.** A scenario declares `weatherReference`. A
 *     scenario that does not keeps the synthetic generator exactly as it was,
 *     so the twenty-eight regional islands and every previously recorded digest
 *     are untouched by this change.
 *   - **Labelled apart.** A day that came from the record carries
 *     `evidenceType: 'PUBLIC_REFERENCE'`; a generated day carries
 *     `'SYNTHETIC'`. `AGENTS.md` requires observed and synthetic data to be
 *     told apart, and a run that mixes both must be able to say which is which
 *     per day rather than per run.
 *
 * **What a recorded day is evidence of.** It is evidence about the weather over
 * a model grid cell on that date. It is not evidence that any farm, order,
 * commitment, delivery or outcome in this simulation occurred. The scenario
 * built on top of it is still SYNTHETIC end to end, in exactly the way the
 * repository's existing licensed place references give the demo real
 * coordinates without making its actors real.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { RandomStream } from '../core/random.js';
import type { TempBand, WeatherCondition } from './weather.js';

/** The evidence label a realised day carries when it came from the record. */
export const REFERENCE_WEATHER_EVIDENCE = 'PUBLIC_REFERENCE' as const;
/** The evidence label a realised day carries when the generator invented it. */
export const SYNTHETIC_WEATHER_EVIDENCE = 'SYNTHETIC' as const;

/**
 * How a realised day came to exist.
 *
 * Deliberately a *separate* field from `Provenance` in
 * `contracts/common.schema.json`, which stays untouched by this change. The
 * repository already draws this distinction the same way: a maritime port or a
 * reference place carries `evidenceType: 'PUBLIC_REFERENCE'` while the scenario
 * built around it is still labelled SYNTHETIC. Recorded weather is the same
 * kind of claim — a real input to an invented world — so it is labelled the
 * same way rather than by widening a shared enum that a Postgres column and an
 * OpenAPI schema both depend on.
 */
export type WeatherEvidenceType = typeof SYNTHETIC_WEATHER_EVIDENCE | typeof REFERENCE_WEATHER_EVIDENCE;

// --------------------------------------------------------------------------
// The dataset on disk.
// --------------------------------------------------------------------------

/** Provenance carried by every record, mirroring the maritime reference file. */
export interface WeatherReferenceCitation {
  source: { title: string; url: string; publisher: string };
  licence: string;
  retrievedAt: string;
  geography: string;
  evidenceType: typeof REFERENCE_WEATHER_EVIDENCE;
}

/** One recorded calendar day at one station. Units are named in the field names. */
export interface WeatherReferenceDay {
  /** ISO-8601 calendar date the record is *for*, in the year it was recorded. */
  date: string;
  /** `MM-DD`. Days are matched to a run on this, never on the year. */
  monthDay: string;
  precipitationMm: number;
  windSpeedMaxKph: number;
  windFromDegrees: number;
  cloudCoverMeanPercent: number;
  temperatureMaxC: number;
  temperatureMinC: number;
  reference: WeatherReferenceCitation;
}

export interface WeatherReferenceStationYear {
  year: number;
  requestUrl: string;
  retrievedAt: string;
  grid: { latitude: number; longitude: number; elevationM: number };
  timezone: string;
  utcOffsetSeconds: number;
  units: Record<string, string>;
  days: WeatherReferenceDay[];
}

export interface WeatherReferenceStation {
  stationId: string;
  name: string;
  /**
   * `PRIMARY` drives the simulation for its island. `CORROBORATING` is carried
   * so that a single grid cell is never mistaken for island-wide truth, and so
   * a reader can see how much two cells on one small island disagree.
   */
  role: 'PRIMARY' | 'CORROBORATING';
  islandId: string;
  requested: { latitude: number; longitude: number };
  years: WeatherReferenceStationYear[];
}

export interface WeatherReferenceFile {
  datasetId: string;
  version: string;
  generatedAt: string;
  coverage: {
    islandIds: string[];
    calendarWindow: { fromMonthDay: string; toMonthDay: string };
    years: number[];
    daysPerStationYear: number;
  };
  source: Record<string, string>;
  licence: Record<string, string>;
  evidenceType: typeof REFERENCE_WEATHER_EVIDENCE;
  notes: string[];
  stations: WeatherReferenceStation[];
}

/** Dataset ids a scenario may name. One today; the shape allows more islands. */
export const SAINT_LUCIA_WEATHER_REFERENCE = 'saint-lucia-weather-reference.v1';

const KNOWN_DATASETS = new Set<string>([SAINT_LUCIA_WEATHER_REFERENCE]);

const cache = new Map<string, WeatherReferenceFile>();

/**
 * Reads and validates a reference dataset, once per process.
 *
 * Validation is not ceremony. A silently truncated or half-null dataset would
 * degrade into "some days recorded, some days invented" without anything
 * failing, and the run would still produce a confident number. Failing loudly
 * at load is the only point at which that is cheap to notice.
 */
export function loadWeatherReference(datasetId: string): WeatherReferenceFile {
  const cached = cache.get(datasetId);
  if (cached) return cached;

  if (!KNOWN_DATASETS.has(datasetId)) {
    throw new Error(
      `Unknown weather reference dataset '${datasetId}'. Available: ${[...KNOWN_DATASETS].join(', ')}.`,
    );
  }

  const file = JSON.parse(readFileSync(resolveDataPath(`${datasetId}.json`), 'utf8')) as WeatherReferenceFile;
  assertUsableReference(file, datasetId);
  cache.set(datasetId, file);
  return file;
}

/**
 * Finds `simulation/data/<fileName>` from wherever this module is running.
 *
 * The obvious one-liner — `fileURLToPath(new URL('../../data/x', import.meta.url))`
 * — is correct under Node from both `src/` and `dist/`, and wrong under a
 * bundler. Vitest and Vite serve a source module as `http://.../@fs/C:/...`, so
 * `import.meta.url` is not a `file:` URL at all and the resolved path comes out
 * as nonsense like `C:\@fs\C:\Users\...`. The control-room test suite imports
 * `@harvest/simulation` and runs this scenario, so that is not a hypothetical.
 *
 * Rather than special-casing one bundler's URL scheme, each candidate is
 * checked against the filesystem and the first that exists wins. The last
 * resort walks up from the working directory, which covers a test runner
 * started anywhere inside the repository. If none resolves, the error names
 * every path tried, because "cannot find the dataset" is otherwise one of the
 * least debuggable failures there is.
 */
function resolveDataPath(fileName: string): string {
  const candidates: string[] = [];

  try {
    candidates.push(fileURLToPath(new URL(`../../data/${fileName}`, import.meta.url)));
  } catch {
    // Not a file: URL. The fallbacks below handle it.
  }

  // A bundler-served module URL, e.g. `http://host/@fs/C:/repo/simulation/src/world/x.ts`.
  const moduleUrl = import.meta.url;
  const fsIndex = moduleUrl.indexOf('/@fs/');
  if (fsIndex >= 0) {
    const realModulePath = decodeURIComponent(moduleUrl.slice(fsIndex + '/@fs/'.length).split('?')[0] as string);
    candidates.push(resolve(dirname(realModulePath), '..', '..', 'data', fileName));
  }

  for (let directory = process.cwd(), depth = 0; depth < 8; depth += 1) {
    candidates.push(join(directory, 'data', fileName));
    candidates.push(join(directory, 'simulation', 'data', fileName));
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  throw new Error(
    `Could not find weather reference data file '${fileName}'. Tried:\n  ${candidates.join('\n  ')}`,
  );
}

/** Throws unless every record is present, numeric and carries its citation. */
export function assertUsableReference(file: WeatherReferenceFile, datasetId: string): void {
  if (file.datasetId !== datasetId) {
    throw new Error(`Weather reference '${datasetId}' declares datasetId '${file.datasetId}'.`);
  }
  if (file.evidenceType !== REFERENCE_WEATHER_EVIDENCE) {
    throw new Error(`Weather reference '${datasetId}' must declare evidenceType '${REFERENCE_WEATHER_EVIDENCE}'.`);
  }
  if (file.stations.length === 0) throw new Error(`Weather reference '${datasetId}' has no stations.`);

  for (const station of file.stations) {
    const years = station.years.map((year) => year.year);
    if (new Set(years).size !== years.length) {
      throw new Error(`Weather reference station '${station.stationId}' repeats a year.`);
    }
    for (const year of station.years) {
      if (year.days.length !== file.coverage.daysPerStationYear) {
        throw new Error(
          `Weather reference station '${station.stationId}' year ${year.year} has ${year.days.length} days, ` +
            `expected ${file.coverage.daysPerStationYear}.`,
        );
      }
      for (const day of year.days) {
        for (const field of NUMERIC_DAY_FIELDS) {
          if (!Number.isFinite(day[field])) {
            throw new Error(`Weather reference ${station.stationId} ${day.date} has no usable '${field}'.`);
          }
        }
        if (day.reference?.evidenceType !== REFERENCE_WEATHER_EVIDENCE) {
          throw new Error(`Weather reference ${station.stationId} ${day.date} is missing its PUBLIC_REFERENCE citation.`);
        }
      }
    }
  }
}

const NUMERIC_DAY_FIELDS = [
  'precipitationMm',
  'windSpeedMaxKph',
  'windFromDegrees',
  'cloudCoverMeanPercent',
  'temperatureMaxC',
  'temperatureMinC',
] as const satisfies readonly (keyof WeatherReferenceDay)[];

// --------------------------------------------------------------------------
// Mapping a record onto the engine's four-value vocabulary.
//
// These thresholds are deliberately NOT the ones `classifyCondition` uses on
// synthetic days, and the difference is the most important modelling choice in
// this file, so it is stated rather than buried.
//
// The synthetic generator draws a wet spell around 62 mm/day, so its RAIN line
// sits at 12 mm and its STORM line at 45 mm. A daily aggregate from a numerical
// model grid cell does not behave like that. It is an area mean over roughly a
// hundred square kilometres of a small island, and it smooths the afternoon
// squall that a farmer would unhesitatingly call rain into a single-digit
// figure. Across all six station-years in the committed dataset the wettest day
// is 31.3 mm and the windiest is 24.6 km/h. Applying the synthetic thresholds
// to recorded values would classify almost the entire window as CLEAR and
// delete the weather physics the scenario exists to exercise — not because
// Saint Lucia had no weather, but because the two number series are not the
// same kind of measurement.
//
// So the recorded series gets its own lower lines, plus a cloud limb the
// synthetic path cannot have (the generator derives cloud from rain, whereas
// the record measures it independently and it is the field that best separates
// an overcast day from a bright one).
// --------------------------------------------------------------------------

/** A storm on either limb: enough recorded rain, or enough recorded wind. */
export const REFERENCE_STORM_RAIN_MM = 20;
export const REFERENCE_STORM_WIND_KPH = 45;
/** At or above this, the day is RAIN. */
export const REFERENCE_RAIN_MM = 5;
/** Below the rain line, this much recorded cloud still makes the day CLOUD. */
export const REFERENCE_CLOUD_FRACTION = 0.6;
/** Bands from the recorded daily maximum temperature. */
export const REFERENCE_HOT_MIN_C = 31;
export const REFERENCE_COOL_MAX_C = 28;

/**
 * The condition a recorded day maps to.
 *
 * The storm limb is an OR, matching `classifyCondition`, not an AND. A squall
 * that dumps 30 mm without a gale is a storm to a grower with produce standing
 * in a field, and so is a gale that arrives dry. It also matters empirically:
 * under an AND rule no day in any of the six committed station-years qualifies
 * as a storm, because the daily-maximum wind never reaches 45 km/h at this
 * resolution, and the scenario would quietly lose its storm physics altogether.
 * Under the OR rule exactly one recorded day qualifies. That is a small number
 * and it is reported rather than tuned away: it is what the record says.
 */
export function classifyReferenceCondition(
  rainMm: number,
  windKph: number,
  cloudCoverFraction: number,
): WeatherCondition {
  if (rainMm >= REFERENCE_STORM_RAIN_MM || windKph >= REFERENCE_STORM_WIND_KPH) return 'STORM';
  if (rainMm >= REFERENCE_RAIN_MM) return 'RAIN';
  if (cloudCoverFraction >= REFERENCE_CLOUD_FRACTION) return 'CLOUD';
  return 'CLEAR';
}

/** Band from the recorded daily maximum, not from rain as the generator does. */
export function referenceTempBand(temperatureMaxC: number): TempBand {
  if (temperatureMaxC >= REFERENCE_HOT_MIN_C) return 'HOT';
  if (temperatureMaxC < REFERENCE_COOL_MAX_C) return 'COOL';
  return 'WARM';
}

/** A recorded day, in the shape the weather model consumes. */
export interface ReferenceDayReading {
  rainMm: number;
  windKph: number;
  windFromDegrees: number;
  cloudCoverFraction: number;
  tempBand: TempBand;
  condition: WeatherCondition;
  /** The date the value was actually recorded on, which is not the run's date. */
  recordedDate: string;
}

/** Maps one dataset record onto the engine's realised-weather fields. */
export function toReferenceReading(day: WeatherReferenceDay): ReferenceDayReading {
  const rainMm = round(Math.max(0, day.precipitationMm), 2);
  const windKph = round(Math.max(0, day.windSpeedMaxKph), 1);
  const cloudCoverFraction = round(clamp(day.cloudCoverMeanPercent / 100, 0, 1), 2);
  return {
    rainMm,
    windKph,
    windFromDegrees: Math.round(((day.windFromDegrees % 360) + 360) % 360),
    cloudCoverFraction,
    tempBand: referenceTempBand(day.temperatureMaxC),
    condition: classifyReferenceCondition(rainMm, windKph, cloudCoverFraction),
    recordedDate: day.date,
  };
}

// --------------------------------------------------------------------------
// Choosing which recorded year a run replays.
// --------------------------------------------------------------------------

/**
 * A resolved reference series, ready for `WeatherModel` to read.
 *
 * `readingFor` returns null for an island or a date the dataset does not cover,
 * and the model falls back to the generator for exactly those days. That
 * fallback is what lets a run be partly recorded without pretending otherwise:
 * the per-day evidence label is what says which is which.
 */
export interface WeatherReferenceSeries {
  datasetId: string;
  /** The station whose record drives each island, and the year it replays. */
  selections: ReadonlyArray<{ islandId: string; stationId: string; stationName: string; year: number }>;
  readingFor(islandId: string, date: string): ReferenceDayReading | null;
}

/**
 * Picks a recorded year from a seeded stream.
 *
 * Sorted first, so the choice depends on the *set* of years available and not
 * on the order they happen to sit in the file. Adding a year to the dataset
 * will change which year a given seed replays — that is intended, and it is why
 * the dataset is versioned and the benchmark records the version it ran
 * against.
 */
export function pickReferenceYear(years: readonly number[], stream: RandomStream): number {
  if (years.length === 0) throw new Error('Cannot pick a reference year from an empty list.');
  const sorted = [...years].sort((a, b) => a - b);
  const index = stream.int(0, sorted.length - 1);
  return sorted[index] as number;
}

export interface WeatherReferenceSeriesInput {
  datasetId: string;
  /** Islands this run covers. Islands the dataset does not cover are skipped. */
  islandIds: readonly string[];
  /** A stream of its own, so the year choice cannot perturb any other draw. */
  stream: RandomStream;
}

/**
 * Resolves a dataset plus a seed into one concrete series for this run.
 *
 * Islands are handled in sorted order and each draws its own year, so adding an
 * island cannot shift an earlier island's choice.
 */
export function buildWeatherReferenceSeries(input: WeatherReferenceSeriesInput): WeatherReferenceSeries {
  const file = loadWeatherReference(input.datasetId);
  const byIsland = new Map<string, { stationId: string; stationName: string; year: number; days: Map<string, ReferenceDayReading> }>();
  const selections: Array<{ islandId: string; stationId: string; stationName: string; year: number }> = [];

  for (const islandId of [...input.islandIds].sort()) {
    const station =
      file.stations.find((candidate) => candidate.islandId === islandId && candidate.role === 'PRIMARY') ??
      file.stations.find((candidate) => candidate.islandId === islandId);
    if (!station) continue;

    const year = pickReferenceYear(station.years.map((entry) => entry.year), input.stream);
    const stationYear = station.years.find((entry) => entry.year === year);
    if (!stationYear) continue;

    const days = new Map<string, ReferenceDayReading>();
    for (const day of stationYear.days) days.set(day.monthDay, toReferenceReading(day));

    byIsland.set(islandId, { stationId: station.stationId, stationName: station.name, year, days });
    selections.push({ islandId, stationId: station.stationId, stationName: station.name, year });
  }

  return {
    datasetId: file.datasetId,
    selections,
    readingFor(islandId: string, date: string): ReferenceDayReading | null {
      const island = byIsland.get(islandId);
      if (!island) return null;
      return island.days.get(date.slice(5)) ?? null;
    },
  };
}

const round = (value: number, places: number): number => Number(value.toFixed(places));
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
