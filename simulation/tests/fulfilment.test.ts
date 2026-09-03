/**
 * The three coordination defects issue #53 identified, stated as behaviour.
 *
 * None of these assert that Harvest beats the baseline. They assert the
 * mechanisms the fulfilment work added: a mission leaves once the produce is
 * reported ready rather than sitting until the delivery deadline, an order that
 * nobody could fill is matched again when new supply is reported, and every
 * demand that ended short is accounted for by exactly one cause. Whether those
 * mechanisms win is what `simulation/benchmarks/` records, and it is recorded
 * rather than asserted.
 */

import { describe, expect, it } from 'vitest';

import { UNMET_CAUSES, runScenario, type RunResult } from '../src/engine.js';
import { MAX_READY_HOLD_MS } from '../src/policy/harvest.js';
import { saintLuciaDemoV1 } from '../src/scenario/saint-lucia-demo-v1.js';
import { HOUR_MS } from '../src/core/time.js';

const SCENARIO = saintLuciaDemoV1.scenarioId;
const SEEDS = [42, 8675309, 7, 19, 31];

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
