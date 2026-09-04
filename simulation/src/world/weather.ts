/**
 * Realised weather and imperfect forecasts.
 *
 * Two objects live here and the difference between them is the whole point of
 * issue #37:
 *
 *   - **Realised weather** is hidden truth until its day occurs. It is what the
 *     crops and the roads actually experience, and the engine is the only thing
 *     allowed to read it for a day that has not happened.
 *   - **A forecast** is observable now, for days that have not happened. It is
 *     a lossy, noised function of the realised series, so it usually points the
 *     right way and sometimes misses a storm entirely. It is the only
 *     forward-looking weather a participant, a policy or an agent ever sees.
 *
 * That asymmetry is what keeps the paired benchmark honest. A policy that could
 * read realised weather three days out would look brilliant for the wrong
 * reason, exactly as a policy that could read a true yield would. So the
 * forecast noise is not decoration: it is the mechanism that stops foresight
 * from leaking through a legitimate-looking channel, and
 * `WeatherModel.realisedOn` refuses a future date rather than trusting callers.
 *
 * Everything here is SYNTHETIC. Realised weather is generated from the
 * scenario's own seeded rainfall stream; forecasts are labelled
 * `MODEL_PREDICTED` because they are the output of a (very small) prediction
 * model rather than a record of anything. No live weather service is contacted
 * from this package or from anything that consumes it.
 */

import { DAY_MS, formatDate, type SimulationInstant } from '../core/time.js';
import type { RandomStream } from '../core/random.js';

/** What the sky is doing, in the smallest vocabulary crops and roads care about. */
export type WeatherCondition = 'CLEAR' | 'CLOUD' | 'RAIN' | 'STORM';

/** Coarse temperature band. Three values is enough to drive dehydration losses. */
export type TempBand = 'COOL' | 'WARM' | 'HOT';

/**
 * One island-day of weather.
 *
 * `windFromDegrees` follows the meteorological convention: the direction the
 * wind blows *from*, clockwise from true north. The control-room overlay in
 * issue #39 needs a direction to draw, and a bearing is the only field that
 * cannot be derived from the others.
 */
export interface WeatherReading {
  condition: WeatherCondition;
  rainMm: number;
  windKph: number;
  windFromDegrees: number;
  /** Sky covered, in [0, 1]. Drives a cloud gradient the four-value enum cannot. */
  cloudCoverFraction: number;
  tempBand: TempBand;
}

/** Realised weather for one island on one date. Hidden truth until the day occurs. */
export interface RealisedWeather extends WeatherReading {
  islandId: string;
  /** ISO-8601 calendar date. */
  date: string;
}

/** One forecast day. Never equal to the realised value it was drawn from. */
export interface ForecastDay extends WeatherReading {
  /** ISO-8601 calendar date being forecast. */
  date: string;
  /** How far ahead of the issue date this is, in whole days. Always >= 1. */
  leadDays: number;
  /** Forecaster's own confidence, in [0, 1]. Decays with lead time. */
  confidence: number;
}

// --------------------------------------------------------------------------
// Classification thresholds. Small, plausible, and documented rather than
// tuned: every one of these is a modelling choice, not a measurement.
// --------------------------------------------------------------------------

/** At or above this daily rainfall the day counts as RAIN rather than CLOUD. */
export const RAIN_DAY_MM = 12;
/** At or above this daily rainfall, or this wind, the day counts as a STORM. */
export const STORM_DAY_MM = 45;
export const STORM_WIND_KPH = 55;
/** Below this the sky is CLEAR; between here and `RAIN_DAY_MM` it is CLOUD. */
export const CLOUD_DAY_MM = 2;

/** How many days ahead a forecast covers. Five is a working farmer's horizon. */
export const FORECAST_HORIZON_DAYS = 5;

/**
 * Skill retained per extra day of lead time.
 *
 * A day-one forecast keeps 78% of the realised signal and blends the rest
 * toward what the last few days looked like; a day-five forecast keeps 29%. The
 * decay is what makes a distant storm easy to miss and a tomorrow storm hard to.
 */
const FORECAST_SKILL_PER_DAY = 0.78;

/**
 * Forecast error at lead one, and how it grows.
 *
 * Error widens with the square root of lead time rather than linearly, which is
 * how a random walk of accumulating error actually behaves. Linear growth was
 * the first thing tried and it produced five-day outlooks of 100 km/h in still
 * air: wrong in a way that reads as a bug rather than as a forecast, which
 * defeats the point of publishing one.
 */
const FORECAST_RAIN_SIGMA_MM = 9;
const FORECAST_WIND_SIGMA_KPH = 7;
const FORECAST_BEARING_SIGMA_DEG = 18;

/**
 * Plausibility bounds on a published forecast.
 *
 * A forecaster who is wrong still publishes a number a farmer recognises. The
 * wind floor exists because air always moves, and the ceilings are simply the
 * top of what this scenario's weather can mean; noise beyond them is error the
 * forecaster would have caught before issuing.
 */
const FORECAST_MIN_WIND_KPH = 3;
const FORECAST_MAX_WIND_KPH = 120;
const FORECAST_MAX_RAIN_MM = 180;
/** How many recent realised days the forecaster averages as its persistence anchor. */
const PERSISTENCE_WINDOW_DAYS = 3;

/** Wind on a settled day, and the extra a wet system brings with it. */
const BASE_WIND_MIN_KPH = 6;
const BASE_WIND_MAX_KPH = 22;
const WIND_PER_RAIN_MM = 0.55;

/** Provenance labels, matching `Provenance` in contracts/common.schema.json. */
export const REALISED_WEATHER_PROVENANCE = 'SYNTHETIC' as const;
export const FORECAST_PROVENANCE = 'MODEL_PREDICTED' as const;

/** Units and thresholds, published to clients so nobody has to guess at a legend. */
export interface WeatherLegend {
  units: { rain: 'mm'; wind: 'kph'; direction: 'degrees_from_true_north_blowing_from' };
  conditions: Array<{ condition: WeatherCondition; label: string; rainMmAtLeast: number; windKphAtLeast?: number }>;
  tempBands: Array<{ tempBand: TempBand; label: string }>;
  forecastHorizonDays: number;
  realisedProvenance: typeof REALISED_WEATHER_PROVENANCE;
  forecastProvenance: typeof FORECAST_PROVENANCE;
  note: string;
}

export const WEATHER_LEGEND: WeatherLegend = {
  units: { rain: 'mm', wind: 'kph', direction: 'degrees_from_true_north_blowing_from' },
  conditions: [
    { condition: 'CLEAR', label: 'Clear', rainMmAtLeast: 0 },
    { condition: 'CLOUD', label: 'Cloudy', rainMmAtLeast: CLOUD_DAY_MM },
    { condition: 'RAIN', label: 'Rain', rainMmAtLeast: RAIN_DAY_MM },
    { condition: 'STORM', label: 'Storm', rainMmAtLeast: STORM_DAY_MM, windKphAtLeast: STORM_WIND_KPH },
  ],
  tempBands: [
    { tempBand: 'COOL', label: 'Cool' },
    { tempBand: 'WARM', label: 'Warm' },
    { tempBand: 'HOT', label: 'Hot' },
  ],
  forecastHorizonDays: FORECAST_HORIZON_DAYS,
  realisedProvenance: REALISED_WEATHER_PROVENANCE,
  forecastProvenance: FORECAST_PROVENANCE,
  note:
    'SYNTHETIC. Realised weather is generated from the run seed; forecasts are a noised model of it and are ' +
    'deliberately imperfect. No live weather service is used anywhere in this system.',
};

/** A day is a storm on either limb: enough rain, or enough wind. */
export function classifyCondition(rainMm: number, windKph: number): WeatherCondition {
  if (rainMm >= STORM_DAY_MM || windKph >= STORM_WIND_KPH) return 'STORM';
  if (rainMm >= RAIN_DAY_MM) return 'RAIN';
  if (rainMm >= CLOUD_DAY_MM) return 'CLOUD';
  return 'CLEAR';
}

const round = (value: number, places: number): number => Number(value.toFixed(places));
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

/** Key for the per-island, per-date maps. Islands are independent systems. */
export function weatherKey(islandId: string, date: string): string {
  return `${islandId}:${date}`;
}

export interface WeatherModelInput {
  /** Islands this run covers. Sorted internally so build order cannot matter. */
  islandIds: readonly string[];
  startsAt: SimulationInstant;
  /** Days of weather to generate, inclusive of the start day. */
  days: number;
  /**
   * Daily rainfall in mm for an island-date, in whatever key shape the scenario
   * already uses. Passing this in rather than regenerating rain keeps existing
   * seeded rainfall values bit-for-bit identical.
   */
  rainfallMm: (islandId: string, date: string) => number;
  /** Stream for the realised fields rainfall does not already fix. */
  realisedStream: RandomStream;
  /** A stream of its own, so forecast noise cannot perturb physical truth. */
  forecastStream: RandomStream;
}

/**
 * Realised weather plus every forecast the run will ever issue.
 *
 * Forecasts are generated up front, in a fixed island-then-issue-date-then-lead
 * order, rather than lazily when somebody asks. Drawing them on demand would
 * make the sequence depend on *who asked and when*, so two runs of one seed
 * could disagree the moment a website added a second request. Precomputing is
 * the difference between reproducible and nearly reproducible.
 */
export class WeatherModel {
  private readonly hiddenRealisedWeather = new Map<string, RealisedWeather>();
  private readonly forecasts = new Map<string, ForecastDay[]>();
  readonly islandIds: readonly string[];
  readonly dates: readonly string[];

  constructor(input: WeatherModelInput) {
    this.islandIds = [...input.islandIds].sort();
    this.dates = Array.from({ length: input.days }, (_, day) => formatDate(input.startsAt + day * DAY_MS));

    for (const islandId of this.islandIds) {
      for (const date of this.dates) {
        this.hiddenRealisedWeather.set(weatherKey(islandId, date), realiseDay(islandId, date, input.rainfallMm(islandId, date), input.realisedStream));
      }
    }

    for (const islandId of this.islandIds) {
      for (const [index, issuedOn] of this.dates.entries()) {
        this.forecasts.set(weatherKey(islandId, issuedOn), this.buildForecast(islandId, index, input.forecastStream));
      }
    }
  }

  /**
   * Realised weather for a date, with no occurrence check.
   *
   * Engine-only: physics may read the day it is currently simulating. Anything
   * facing a participant must go through `realisedUpTo` instead.
   */
  truthOn(islandId: string, date: string): RealisedWeather | null {
    return this.hiddenRealisedWeather.get(weatherKey(islandId, date)) ?? null;
  }

  /**
   * Realised weather for a date, but only once that date has occurred.
   *
   * This is the exposure boundary. Asking for tomorrow returns null rather than
   * throwing, because a legitimate caller near the horizon will ask.
   */
  realisedUpTo(islandId: string, date: string, asOfDate: string): RealisedWeather | null {
    if (date > asOfDate) return null;
    return this.truthOn(islandId, date);
  }

  /** The forecast issued on a date, covering the following days. Never the truth. */
  forecastIssuedOn(islandId: string, asOfDate: string): ForecastDay[] {
    return this.forecasts.get(weatherKey(islandId, asOfDate)) ?? [];
  }

  /** Every date this model covers, for callers that need to enumerate. */
  hasIsland(islandId: string): boolean {
    return this.islandIds.includes(islandId);
  }

  /**
   * One issue date's forecast.
   *
   * The realised value of the target day is the signal; the mean of the last
   * few days that have actually happened is the anchor it decays toward; the
   * forecast stream supplies error that grows with lead time. At lead five the
   * signal is under a third of the blend and the noise is five times its
   * day-one width, which is why a storm five days out is routinely missed and a
   * storm tomorrow rarely is.
   */
  private buildForecast(islandId: string, issuedIndex: number, stream: RandomStream): ForecastDay[] {
    const anchorRain = this.recentMean(islandId, issuedIndex, (reading) => reading.rainMm);
    const anchorWind = this.recentMean(islandId, issuedIndex, (reading) => reading.windKph);

    const days: ForecastDay[] = [];
    for (let lead = 1; lead <= FORECAST_HORIZON_DAYS; lead += 1) {
      const targetDate = this.dates[issuedIndex + lead];
      // Past the horizon there is nothing to forecast. Draws are still made so
      // that a shorter run cannot shift a longer one's stream position.
      const skill = FORECAST_SKILL_PER_DAY ** lead;
      const spread = Math.sqrt(lead);
      const rainNoise = stream.normal(0, FORECAST_RAIN_SIGMA_MM * spread);
      const windNoise = stream.normal(0, FORECAST_WIND_SIGMA_KPH * spread);
      const bearingNoise = stream.normal(0, FORECAST_BEARING_SIGMA_DEG * spread);
      if (targetDate === undefined) continue;

      const truth = this.truthOn(islandId, targetDate);
      if (!truth) continue;

      const rainMm = clamp(skill * truth.rainMm + (1 - skill) * anchorRain + rainNoise, 0, FORECAST_MAX_RAIN_MM);
      const windKph = clamp(
        skill * truth.windKph + (1 - skill) * anchorWind + windNoise,
        FORECAST_MIN_WIND_KPH,
        FORECAST_MAX_WIND_KPH,
      );
      const windFromDegrees = ((skill * truth.windFromDegrees + (1 - skill) * anchorBearing(truth.windFromDegrees) + bearingNoise) % 360 + 360) % 360;

      days.push({
        date: targetDate,
        leadDays: lead,
        condition: classifyCondition(rainMm, windKph),
        rainMm: round(rainMm, 2),
        windKph: round(windKph, 1),
        windFromDegrees: Math.round(windFromDegrees),
        cloudCoverFraction: round(cloudCoverFor(rainMm, windKph), 2),
        tempBand: forecastTempBand(truth.tempBand, rainMm),
        // Confidence is the retained skill, floored so a five-day outlook still
        // reads as a forecast rather than as a coin toss.
        confidence: round(Math.max(0.2, skill), 2),
      });
    }
    return days;
  }

  private recentMean(islandId: string, issuedIndex: number, select: (reading: RealisedWeather) => number): number {
    const from = Math.max(0, issuedIndex - (PERSISTENCE_WINDOW_DAYS - 1));
    let total = 0;
    let count = 0;
    for (let index = from; index <= issuedIndex; index += 1) {
      const date = this.dates[index];
      if (date === undefined) continue;
      const reading = this.truthOn(islandId, date);
      if (!reading) continue;
      total += select(reading);
      count += 1;
    }
    return count > 0 ? total / count : 0;
  }
}

/**
 * The prevailing bearing a forecaster falls back on.
 *
 * The Caribbean trade winds run from the east-north-east almost all year, so a
 * forecaster with no information guesses 75 degrees rather than the mean of a
 * circular quantity, which is not a meaningful average.
 */
function anchorBearing(_realisedBearing: number): number {
  return 75;
}

/** Cloud follows rain, with a wind term so a dry blow is not drawn as clear sky. */
function cloudCoverFor(rainMm: number, windKph: number): number {
  return clamp(0.08 + rainMm / 40 + Math.max(0, windKph - 25) / 90, 0, 1);
}

/**
 * One realised island-day.
 *
 * Rain comes from the scenario's existing seeded rainfall, untouched. Only the
 * fields rainfall does not already fix are drawn here, from a stream of their
 * own, so every previously recorded rainfall value survives this change.
 */
function realiseDay(islandId: string, date: string, rainfallMm: number, stream: RandomStream): RealisedWeather {
  const rainMm = round(Math.max(0, rainfallMm), 2);
  const windKph = round(Math.max(0, stream.float(BASE_WIND_MIN_KPH, BASE_WIND_MAX_KPH) + rainMm * WIND_PER_RAIN_MM), 1);
  const windFromDegrees = stream.int(0, 359);

  // Wet air is cooler air. A soaking day is never HOT, and a dry day usually is
  // in a Caribbean September.
  const heatRoll = stream.next();
  const tempBand: TempBand = rainMm >= RAIN_DAY_MM ? (heatRoll < 0.35 ? 'COOL' : 'WARM') : heatRoll < 0.45 ? 'WARM' : 'HOT';

  return {
    islandId,
    date,
    rainMm,
    windKph,
    windFromDegrees,
    cloudCoverFraction: round(cloudCoverFor(rainMm, windKph), 2),
    tempBand,
    condition: classifyCondition(rainMm, windKph),
  };
}

/** A forecaster predicts the band from its own predicted rain, not from truth. */
function forecastTempBand(realisedBand: TempBand, forecastRainMm: number): TempBand {
  if (forecastRainMm >= RAIN_DAY_MM) return realisedBand === 'HOT' ? 'WARM' : realisedBand;
  return realisedBand === 'COOL' ? 'WARM' : realisedBand;
}

// --------------------------------------------------------------------------
// Physical effects of realised weather.
//
// These rules live beside the weather they act on rather than inside the
// engine, so that the whole of "what weather does" can be read, argued with and
// unit-tested in one place, and the engine keeps only the scheduling.
//
// Every coefficient below is a modelling choice, not a measurement. They are
// deliberately small: the aim is that a wet run and a dry run differ
// *visibly and explainably*, not that this becomes an agronomy model. Issue #37
// is explicit that it is not one.
// --------------------------------------------------------------------------

/** A storm degrades any road at least this rain-sensitive, not only the worst ones. */
export const STORM_ROAD_SENSITIVITY = 0.25;

/**
 * How far a day of weather pushes back readiness, as a fraction of a day.
 *
 * Cucumbers ripen on heat and light, so a dark wet day buys the grower time and
 * a storm buys more. The slip applies only before a batch is ready, and only up
 * to `MAX_WEATHER_READINESS_DELAY_MS`: without a cap, a seed with a long wet
 * spell would push every batch in the scenario past the horizon and the run
 * would measure nothing at all.
 */
export const RAIN_READINESS_DELAY_FRACTION = 0.12;
export const STORM_READINESS_DELAY_FRACTION = 0.3;
export const MAX_WEATHER_READINESS_DELAY_MS = 3 * 24 * 60 * 60 * 1_000;

/**
 * Multipliers on the daily spoilage rate of a batch standing ready in the field.
 *
 * Wet produce rots; hot dry produce dehydrates. Both are gentler than the storm
 * disruption multiplier already in the engine, and they compound with it,
 * because a named storm arriving during a wet week really is worse than either.
 */
export const RAIN_SPOILAGE_MULTIPLIER = 1.25;
export const STORM_SPOILAGE_MULTIPLIER = 1.6;
export const HOT_DRY_SPOILAGE_MULTIPLIER = 1.2;

/** Marketable fraction lost per wet day, absolute. Floored so a crop is never worthless. */
export const RAIN_QUALITY_LOSS = 0.01;
export const STORM_QUALITY_LOSS = 0.025;
export const MINIMUM_QUALITY_FRACTION = 0.4;

/**
 * Road speed a vehicle keeps when it sets out into rain or a storm.
 *
 * The engine applies this at departure rather than at planning, deliberately:
 * planning happens hours or days ahead, and letting a planner use the departure
 * day's realised weather would hand the engine the foresight this whole module
 * spends its length denying the policy.
 */
export const RAIN_TRAVEL_SPEED_FACTOR = 0.85;
export const STORM_TRAVEL_SPEED_FACTOR = 0.6;

/** A wet day is one a grower would call wet: rain or worse. */
export function isWetDay(weather: RealisedWeather | null): boolean {
  return weather?.condition === 'RAIN' || weather?.condition === 'STORM';
}

/** How much of a day's ripening the weather takes away, in milliseconds. */
export function readinessDelayMs(weather: RealisedWeather | null): number {
  if (weather?.condition === 'STORM') return STORM_READINESS_DELAY_FRACTION * 24 * 60 * 60 * 1_000;
  if (weather?.condition === 'RAIN') return RAIN_READINESS_DELAY_FRACTION * 24 * 60 * 60 * 1_000;
  return 0;
}

/**
 * How much faster a ready batch deteriorates under today's realised weather.
 *
 * Wet is worse than dry, and hot-and-dry is worse than mild-and-dry: the first
 * two rot the crop, the third dehydrates it. Deliberately one multiplier rather
 * than a curve.
 */
export function spoilageMultiplier(weather: RealisedWeather | null): number {
  if (!weather) return 1;
  if (weather.condition === 'STORM') return STORM_SPOILAGE_MULTIPLIER;
  if (weather.condition === 'RAIN') return RAIN_SPOILAGE_MULTIPLIER;
  if (weather.tempBand === 'HOT' && weather.rainMm < CLOUD_DAY_MM) return HOT_DRY_SPOILAGE_MULTIPLIER;
  return 1;
}

/** Marketable fraction a wet day costs, whether the batch is ready or still growing. */
export function qualityLoss(weather: RealisedWeather | null): number {
  if (weather?.condition === 'STORM') return STORM_QUALITY_LOSS;
  if (weather?.condition === 'RAIN') return RAIN_QUALITY_LOSS;
  return 0;
}

/** Share of its planned speed a vehicle keeps when it departs into this weather. */
export function travelSpeedFactor(weather: RealisedWeather | null): number {
  if (weather?.condition === 'STORM') return STORM_TRAVEL_SPEED_FACTOR;
  if (weather?.condition === 'RAIN') return RAIN_TRAVEL_SPEED_FACTOR;
  return 1;
}

/**
 * Whether today's weather alone is enough to leave a road degraded.
 *
 * Two limbs: enough rain on a road built to flood, or a storm on a road only
 * moderately sensitive to one. `heavyRainMm` is passed in because the engine
 * owns the older rainfall threshold and this keeps a single value of it.
 */
export function weatherDegradesRoad(
  weather: RealisedWeather | null,
  rainSensitivity: number,
  heavyRainMm: number,
): boolean {
  if (!weather) return false;
  if (weather.rainMm >= heavyRainMm && rainSensitivity > 0.5) return true;
  return weather.condition === 'STORM' && rainSensitivity > STORM_ROAD_SENSITIVITY;
}
