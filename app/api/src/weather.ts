/**
 * Observed island weather and the shared forecast.
 *
 * One rule shapes this whole file: **only a day that has already occurred is
 * ever written**. Realised weather for a later day stays inside simulation
 * truth and never reaches Postgres, so no query against this table can return
 * it however the `asOf` parameter is bent. That is a stronger guarantee than a
 * filter in the read path, because it does not depend on the read path being
 * written correctly next time.
 *
 * The forecast stored beside each realised day is a deliberately imperfect
 * model of the days ahead. It is labelled `MODEL_PREDICTED` while the realised
 * reading is labelled `SYNTHETIC`, because a prediction and a record are
 * different kinds of claim and `AGENTS.md` requires them to be told apart.
 *
 * No live weather service is contacted from here or from anything that calls
 * it; issue #37 rules one out for demo and test runs.
 */

import { Provenance } from "@prisma/client";
import type { ControlRoomWeather } from "@harvest/simulation";

import type { AuthActor } from "./auth.js";
import { prisma } from "./db.js";
import { httpError } from "./http.js";

/** The island the seeded development world lives on. */
export const DEFAULT_ISLAND_ID = "saint-lucia";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isoDate = (value: Date) => value.toISOString().slice(0, 10);

/**
 * Run scope for a weather read.
 *
 * Identical in shape to the rule the operations snapshot and the event stream
 * already use: a simulated actor is confined to its own run, an operator may
 * name one, and everybody else reads the seeded world. Repeated here rather
 * than imported so that the simulation routes and this product route do not
 * become mutually dependent for one small check.
 */
export function weatherRunScope(actor: AuthActor, requestedRunId: unknown): string | null {
  if (actor.simulationRunId) {
    if (requestedRunId !== undefined && requestedRunId !== actor.simulationRunId) {
      throw httpError(403, "RUN_SCOPE_FORBIDDEN", "A simulated actor cannot access another simulation run.");
    }
    return actor.simulationRunId;
  }
  if (requestedRunId === undefined) return null;
  if (actor.role !== "OPERATIONS" && actor.role !== "ADMIN") {
    throw httpError(403, "RUN_SCOPE_FORBIDDEN", "Only operations or admin actors may select a simulation run.");
  }
  if (typeof requestedRunId !== "string" || !requestedRunId.trim()) {
    throw httpError(400, "VALIDATION_FAILED", "simulationRunId must be a non-empty string.");
  }
  return requestedRunId.trim();
}

export function readIslandId(value: unknown): string {
  if (value === undefined) return DEFAULT_ISLAND_ID;
  if (typeof value !== "string" || !value.trim()) {
    throw httpError(400, "VALIDATION_FAILED", "islandId must be a non-empty string.");
  }
  return value.trim();
}

export function readAsOfDate(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !ISO_DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw httpError(422, "INVALID_WEATHER_DATE", "asOf must be an ISO-8601 calendar date.");
  }
  return value;
}

/**
 * Reads the newest recorded day at or before `asOf`.
 *
 * An `asOf` past the last recorded day returns that last day rather than an
 * empty answer or an error. There is nothing later to hide: the table holds
 * only days that have happened, so the newest row *is* the present. Returning
 * it keeps a client that asks for "today" working in a completed replay,
 * where "today" is months after the run ended.
 */
export async function readIslandWeather(input: {
  islandId: string;
  simulationRunId: string | null;
  asOf?: string;
}) {
  const row = await prisma.weatherObservation.findFirst({
    where: {
      islandId: input.islandId,
      simulationRunId: input.simulationRunId,
      ...(input.asOf ? { observedOn: { lte: new Date(`${input.asOf}T00:00:00Z`) } } : {}),
    },
    orderBy: { observedOn: "desc" },
  });
  if (!row) {
    return {
      islandId: input.islandId,
      asOf: input.asOf ?? isoDate(new Date()),
      ...(input.simulationRunId ? { simulationRunId: input.simulationRunId } : {}),
      forecast: [],
    };
  }
  return {
    islandId: row.islandId,
    asOf: isoDate(row.observedOn),
    ...(input.simulationRunId ? { simulationRunId: input.simulationRunId } : {}),
    current: {
      date: isoDate(row.observedOn),
      condition: row.condition,
      rainMm: row.rainMm,
      windKph: row.windKph,
      windFromDegrees: row.windFromDegrees,
      cloudCoverFraction: row.cloudCoverFraction,
      tempBand: row.tempBand,
      provenance: row.provenance,
    },
    forecast: row.forecast,
  };
}

/**
 * Persists realised island-days that have occurred, with the forecast issued
 * on each of them.
 *
 * The input is exactly what the engine already publishes on a replay frame, so
 * a human on the website and a simulated participant read the same numbers from
 * the same source rather than from two models that agree until they do not.
 * Duplicates are skipped rather than updated: an island-day is immutable once
 * it has happened.
 */
export async function saveIslandWeather(simulationRunId: string | null, days: readonly ControlRoomWeather[]) {
  if (!days.length) return 0;
  const created = await prisma.weatherObservation.createMany({
    data: days.map((day) => ({
      islandId: day.islandId,
      observedOn: new Date(`${day.date}T00:00:00Z`),
      condition: day.condition,
      rainMm: day.rainMm,
      windKph: day.windKph,
      windFromDegrees: day.windFromDegrees,
      cloudCoverFraction: day.cloudCoverFraction,
      tempBand: day.tempBand,
      provenance: Provenance.SYNTHETIC,
      forecast: day.forecast.map((entry) => ({ ...entry, provenance: Provenance.MODEL_PREDICTED })),
      forecastProvenance: Provenance.MODEL_PREDICTED,
      simulationRunId,
    })),
    skipDuplicates: true,
  });
  return created.count;
}
