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
  /** Resolved manifest scope. Undefined retains a scenario's default scope. */
  islandIds?: readonly string[];
}

export interface Scenario {
  scenarioId: string;
  description: string;
  /** Manifest islands that this recipe may materialise. */
  availableIslandIds: readonly string[];
  /** ISO-8601 instant the run clock starts at. */
  startsAtIso: string;
  /** How long buyers keep raising demand. The ordering window. */
  durationDays: number;
  /**
   * Extra days the run keeps going after the ordering window closes.
   *
   * An order raised on the last ordering day still needs its deadline, its
   * substitution grace and its settlement event to fall inside the run, or it
   * is scored short for a reason that is the length of the run rather than
   * anything a coordinator did. The alternative — refusing to raise such an
   * order — deletes normal late-window demand from the measurement instead of
   * measuring it.
   */
  settlementDays: number;
  /**
   * Where every quantitative assumption in this scenario came from.
   *
   * Required rather than optional, because `docs/architecture.md` obliges every
   * important input to declare whether it is observed, inferred, synthetic,
   * stakeholder-calibrated or model-predicted, and a scenario is nothing but
   * important inputs.
   */
  provenanceNote: string;
  /**
   * Dataset id of a committed recorded-weather reference this scenario replays.
   *
   * Optional and opt-in. A scenario that omits it keeps the synthetic weather
   * generator unchanged, which is how issue #90 avoids disturbing the regional
   * island scenarios or any digest recorded before it. When present, realised
   * weather for the calendar days the dataset covers is RECORDED and labelled
   * `PUBLIC_REFERENCE` per day; every other input to the scenario stays
   * synthetic and `provenanceNote` must say so.
   */
  weatherReference?: string;
  build(context: ScenarioContext): World;
}
