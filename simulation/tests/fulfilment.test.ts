/**
 * The engine defects issue #53 identified, stated as behaviour.
 *
 * None of these assert that Harvest beats the baseline. They assert the
 * mechanisms the fulfilment work added: a mission leaves once the produce is
 * reported ready rather than sitting until the delivery deadline, an order that
 * nobody could fill is matched again when new supply is reported, every demand
 * that ended short is accounted for by exactly one cause, and no order is
 * raised that the run's horizon will not let it settle. Whether those
 * mechanisms win is what `simulation/benchmarks/` records, and it is recorded
 * rather than asserted.
 */

import { describe, expect, it } from 'vitest';

import { SUBSTITUTION_GRACE_MS, UNMET_CAUSES, runScenario, type RunResult } from '../src/engine.js';
import { MAX_READY_HOLD_MS } from '../src/policy/harvest.js';
import { saintLuciaDemoV1 } from '../src/scenario/saint-lucia-demo-v1.js';
import type { ControlRoomDemand } from '../src/replay.js';
import { DAY_MS, HOUR_MS, parseInstant } from '../src/core/time.js';

const SCENARIO = saintLuciaDemoV1.scenarioId;
const SEEDS = [42, 8675309, 7, 19, 31];

/** The ten seeds `benchmarks/README.md` reports, so the tests cover what is published. */
const BENCHMARK_SEEDS = [42, 8675309, 7, 19, 23, 31, 101, 202, 303, 404];

/**
 * The horizon, derived the way the engine derives it.
 *
 * Taken from the scenario rather than from a finished run's `endedAt`, which
 * would make the assertion agree with whatever the run happened to do.
 */
const HORIZON_ENDS_AT = parseInstant(saintLuciaDemoV1.startsAtIso) + saintLuciaDemoV1.durationDays * DAY_MS;

/**
 * Every demand a run ever held, in the order the run first published it.
 *
 * Demands are never removed from the observed world, so the last frame would
 * do; walking every frame is what makes the list independent of that.
 */
function raisedDemands(result: RunResult): ControlRoomDemand[] {
  const byId = new Map<string, ControlRoomDemand>();
  for (const frame of result.timeline?.frames ?? []) {
    for (const demand of frame.demands) byId.set(demand.demandId, demand);
  }
  return [...byId.values()];
}

/**
 * How long each mission was planned to wait between being created and leaving.
 *
 * Missions planned while a disruption was visible are excluded. A road closure
 * or a broken vehicle legitimately postpones a departure, and the question here
 * is what the *schedule* chose, not what the world then did to it.
 */
function undisturbedDepartureWaitsMs(policy: 'BASELINE' | 'HARVEST', seed: number): number[] {
  const result: RunResult = runScenario({ scenarioId: SCENARIO, policy, seed, captureFrames: true });
  const seen = new Set<string>();
  const waits: number[] = [];

  for (const frame of result.timeline?.frames ?? []) {
    const undisturbed = frame.disruptions.length === 0 && frame.degradedRoadSegmentIds.length === 0;
    for (const mission of frame.missions) {
      if (seen.has(mission.missionId)) continue;
      seen.add(mission.missionId);
      if (undisturbed) waits.push(mission.plannedDepartureAt - frame.atMs);
    }
  }

  return waits;
}

describe('collecting supply that is ready', () => {
  it('sends a mission once the batch is reported ready instead of waiting for the deadline', () => {
    const harvestWaits = SEEDS.flatMap((seed) => undisturbedDepartureWaitsMs('HARVEST', seed));
    const baselineWaits = SEEDS.flatMap((seed) => undisturbedDepartureWaitsMs('BASELINE', seed));

    // An empty sample would pass the assertion below without testing anything.
    expect(harvestWaits.length).toBeGreaterThan(0);
    expect(baselineWaits.length).toBeGreaterThan(0);

    // Harvest commits only against batches reported ready, so every one of its
    // missions is collecting produce already spoiling in the field.
    for (const wait of harvestWaits) expect(wait).toBeLessThanOrEqual(MAX_READY_HOLD_MS);

    // The baseline still schedules to arrive shortly before the deadline, which
    // is days of holding. Without this the test would pass on a scenario where
    // nothing ever waited, and would be measuring nothing.
    expect(Math.max(...baselineWaits)).toBeGreaterThan(24 * HOUR_MS);
  });
});

describe('re-matching demand that is still waiting', () => {
  it('plans again for a pending demand after a later ready observation', () => {
    const harvest = runScenario({ scenarioId: SCENARIO, policy: 'HARVEST', seed: 8675309 });

    const sweeps = harvest.decisions.filter((decision) => decision.kind === 'REMATCH_WAITING_DEMAND');
    expect(sweeps.length).toBeGreaterThan(0);

    // The sweep has to lead somewhere: at least one order it revisited must
    // then have been planned, or it is only queueing work that goes nowhere.
    const replanned = sweeps.flatMap((sweep) =>
      String(sweep.evidence.demandIds)
        .split(',')
        .map((demandId) => ({ demandId, at: sweep.at })),
    );
    const proposalsAfterSweep = replanned.filter((entry) =>
      harvest.decisions.some(
        (decision) =>
          decision.kind === 'HARVEST_PROPOSE_ALLOCATION' &&
          decision.evidence.demandId === entry.demandId &&
          decision.at > entry.at,
      ),
    );
    expect(proposalsAfterSweep.length).toBeGreaterThan(0);
  });

  it('leaves the fragmented baseline without a re-match sweep', () => {
    // Nobody holds the whole picture in the baseline, so nothing notices that
    // supply arrived after the buyer gave up. Modelling it otherwise would hand
    // the baseline a coordination capability it does not have.
    for (const seed of SEEDS) {
      const baseline = runScenario({ scenarioId: SCENARIO, policy: 'BASELINE', seed });
      expect(baseline.decisions.filter((decision) => decision.kind === 'REMATCH_WAITING_DEMAND')).toHaveLength(0);
    }
  });

  it('bounds how often new supply can re-trigger planning', () => {
    // The sweep fires on every ready report, so an unbounded version would
    // queue planning faster than the clock advances.
    const harvest = runScenario({ scenarioId: SCENARIO, policy: 'HARVEST', seed: 31337 });
    expect(harvest.status).toBe('COMPLETED');
    expect(harvest.metrics.eventsProcessed).toBeLessThan(5_000);
  });
});

describe('unmet demand causes', () => {
  it('accounts for every demand that ended short with exactly one cause', () => {
    for (const seed of SEEDS) {
      for (const policy of ['BASELINE', 'HARVEST'] as const) {
        const { metrics } = runScenario({ scenarioId: SCENARIO, policy, seed });
        const counted = Object.values(metrics.causeCounts).reduce((total, count) => total + count, 0);

        expect(counted).toBe(metrics.demandsUnmet + metrics.demandsPartiallyMet);
        expect(Object.keys(metrics.causeCounts).sort()).toEqual([...UNMET_CAUSES].sort());
      }
    }
  });

  it('reports causes that name where the workflow actually broke', () => {
    // A histogram that only ever reported one cause would satisfy the sum
    // above while explaining nothing.
    const observed = new Set<string>();
    for (const seed of SEEDS) {
      for (const policy of ['BASELINE', 'HARVEST'] as const) {
        const { metrics } = runScenario({ scenarioId: SCENARIO, policy, seed });
        for (const [cause, count] of Object.entries(metrics.causeCounts)) {
          if (count > 0) observed.add(cause);
        }
      }
    }

    expect(observed.size).toBeGreaterThan(1);
    for (const cause of observed) expect(UNMET_CAUSES).toContain(cause);
  });
});

describe('demand the run cannot settle', () => {
  it('never raises an order whose deadline falls past the horizon', () => {
    let raised = 0;

    for (const seed of BENCHMARK_SEEDS) {
      for (const policy of ['BASELINE', 'HARVEST'] as const) {
        const result = runScenario({ scenarioId: SCENARIO, policy, seed, captureFrames: true });
        const demands = raisedDemands(result);
        expect(demands.length).toBeGreaterThan(0);
        raised += demands.length;

        for (const demand of demands) {
          // The buyer waits the substitution grace past its own deadline, and
          // that is when the demand settles. An order whose grace closes after
          // the horizon can never reach its settlement event.
          expect(demand.neededBy + SUBSTITUTION_GRACE_MS).toBeLessThanOrEqual(HORIZON_ENDS_AT);
        }
      }
    }

    // A guard that suppressed demand generation wholesale would satisfy the
    // bound above while measuring nothing.
    expect(raised).toBeGreaterThan(100);
  });

  it('leaves no demand classified HORIZON_TRUNCATED across the benchmark seeds', () => {
    for (const seed of BENCHMARK_SEEDS) {
      for (const policy of ['BASELINE', 'HARVEST'] as const) {
        const { metrics } = runScenario({ scenarioId: SCENARIO, policy, seed });
        expect(metrics.causeCounts.HORIZON_TRUNCATED).toBe(0);
      }
    }
  });

  it('raises the same demand twice for the same seed', () => {
    // The guard returns early from a handler that also draws the buyer's next
    // order offset. Drawing that offset after the guard instead of before it
    // would leave the run reproducible against itself but shift every later
    // order, so a digest check alone is not enough: compare the orders.
    for (const policy of ['BASELINE', 'HARVEST'] as const) {
      const first = runScenario({ scenarioId: SCENARIO, policy, seed: 8675309, captureFrames: true });
      const second = runScenario({ scenarioId: SCENARIO, policy, seed: 8675309, captureFrames: true });

      expect(second.digest).toBe(first.digest);
      expect(raisedDemands(second)).toEqual(raisedDemands(first));
    }
  });
});
