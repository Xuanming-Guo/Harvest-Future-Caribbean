/**
 * Scenario definitions.
 *
 * A scenario is a *recipe*, not a world. It holds the fixed cast and the
 * distributions to draw from; `build` turns it into a concrete world using the
 * run's seeded streams. Two runs of one scenario and seed therefore produce
 * identical worlds, and two runs of one scenario with different seeds produce
 * genuinely different ones.
 *
 * This split is what makes the paired benchmark honest. The baseline and
 * Harvest runs of a pair are built from the same scenario and the same seed, so
 * every difference in the result traces to policy behaviour rather than to a
 * kinder world.
 */

import type { RandomSource } from '../core/random.js';
import type { IdFactory } from '../core/ids.js';
import type { SimulationInstant } from '../core/time.js';
import type { World } from '../world/types.js';

export interface ScenarioContext {
  random: RandomSource;
  ids: IdFactory;
  /** The instant the scenario starts. */
  startsAt: SimulationInstant;
}

export interface Scenario {
  scenarioId: string;
  description: string;
  /** ISO-8601 instant the run clock starts at. */
  startsAtIso: string;
  /** How long the run covers before it is considered finished. */
  durationDays: number;
  /**
   * Where every quantitative assumption in this scenario came from.
   *
   * Required rather than optional, because `docs/architecture.md` obliges every
   * important input to declare whether it is observed, inferred, synthetic,
   * stakeholder-calibrated or model-predicted, and a scenario is nothing but
   * important inputs.
   */
  provenanceNote: string;
  build(context: ScenarioContext): World;
}
