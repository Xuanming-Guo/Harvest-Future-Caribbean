/**
 * Simulation time.
 *
 * Simulation time is epoch milliseconds and has nothing to do with wall-clock
 * time. `Date.now()` must never reach a decision inside the engine: it would
 * make a rerun of the same seed produce a different world, which is exactly the
 * property the acceptance criteria for this area turn on.
 *
 * The engine holds the only clock. Handlers read it and schedule relative to
 * it; they never construct "now" for themselves.
 */

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/** Epoch milliseconds, as carried on every queue entry. */
export type SimulationInstant = number;

/** Parses an ISO-8601 instant, rejecting anything unparseable rather than yielding NaN. */
export function parseInstant(iso: string): SimulationInstant {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) {
    throw new RangeError(`'${iso}' is not a parseable ISO-8601 instant.`);
  }
  return parsed;
}

/** Formats to the ISO-8601 UTC form the contracts expect for `date-time`. */
export function formatInstant(instant: SimulationInstant): string {
  return new Date(instant).toISOString();
}

/** Formats to the ISO-8601 calendar-date form the contracts expect for `date`. */
export function formatDate(instant: SimulationInstant): string {
  return new Date(instant).toISOString().slice(0, 10);
}

/**
 * Hour of day in UTC, 0-23.
 *
 * Saint Lucia is UTC-4 year round with no daylight saving, so scenarios express
 * local working hours directly as fixed UTC offsets rather than carrying a
 * timezone library for one fixed offset.
 */
export function hourOfDay(instant: SimulationInstant): number {
  return new Date(instant).getUTCHours();
}

/** Whole days between two instants, truncated. */
export function daysBetween(from: SimulationInstant, to: SimulationInstant): number {
  return Math.trunc((to - from) / DAY_MS);
}
