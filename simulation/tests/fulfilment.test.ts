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
import type { ControlRoomDemand, ControlRoomFrame } from '../src/replay.js';
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
const STARTS_AT = parseInstant(saintLuciaDemoV1.startsAtIso);
/** Last instant a buyer may raise an order. */
const ORDERING_ENDS_AT = STARTS_AT + saintLuciaDemoV1.durationDays * DAY_MS;
/** Last instant of the run: the ordering window plus the settlement window. */
const RUN_ENDS_AT = ORDERING_ENDS_AT + saintLuciaDemoV1.settlementDays * DAY_MS;

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
 * How long the produce a mission collected had been sitting reported-ready when
 * the vehicle finally left, for every complete collection in a run.
 *
 * The batches a departure picked from are the ones whose confirmed harvest rose
 * in that frame, and readiness is the first frame each of those batches reported
 * READY. Both are observable replay state, which is the point: the claim is
 * about what a viewer of the run can see, not about engine internals.
 *
 * The hold runs from the later of the mission appearing and the produce being
 * reported ready, because those are the two things a departure waits on. A
 * forward promise is created long before the crop is pickable and a ready crop
 * may sit unsold before anyone promises it; neither is a vehicle idling, and
 * idling once both are true is exactly what must not happen.
 *
 * Two kinds of departure are left out, because neither is a hold the schedule
 * chose. A mission whose planned departure was ever moved *later* was pushed
 * back by the world: that is what a road closure or a broken vehicle does. And a
 * mission that came away with less than a pickup per stop was waiting on a
 * grower who never reported, which is a promise that failed rather than produce
 * left sitting.
 */
function readyToDepartureWaitsMs(policy: 'BASELINE' | 'HARVEST', seed: number): number[] {
  const result: RunResult = runScenario({ scenarioId: SCENARIO, policy, seed, captureFrames: true });
  const firstReadyAt = new Map<string, number>();
  const harvestedSoFar = new Map<string, number>();
  const plannedDeparture = new Map<string, number>();
  const departed = new Set<string>();
  const firstSeenAt = new Map<string, number>();
  const postponed = new Set<string>();
  const waits: number[] = [];

  for (const frame of (result.timeline?.frames ?? []) as ControlRoomFrame[]) {
    const leaving: ControlRoomFrame['missions'] = [];
    for (const mission of frame.missions) {
      const previous = plannedDeparture.get(mission.missionId);
      if (previous !== undefined && mission.plannedDepartureAt > previous) postponed.add(mission.missionId);
      plannedDeparture.set(mission.missionId, mission.plannedDepartureAt);
      if (!firstSeenAt.has(mission.missionId)) firstSeenAt.set(mission.missionId, frame.atMs);
      if (mission.status !== 'PLANNED' && !departed.has(mission.missionId)) {
        departed.add(mission.missionId);
        leaving.push(mission);
      }
    }

    const collected: string[] = [];
    for (const batch of frame.batches) {
      const before = harvestedSoFar.get(batch.batchId) ?? 0;
      if (batch.confirmedHarvestedKg > before + 0.001) collected.push(batch.batchId);
      harvestedSoFar.set(batch.batchId, batch.confirmedHarvestedKg);
    }

    const mission = leaving.length === 1 ? leaving[0] as ControlRoomFrame['missions'][number] : undefined;
    // The route is one stop per pickup farm plus the buyer, so a complete
    // collection picked from as many batches as the route has pickups.
    const complete = mission !== undefined && collected.length === mission.path.length - 1;
    if (mission && complete && !postponed.has(mission.missionId)) {
      const readyAt = collected.map((batchId) => firstReadyAt.get(batchId));
      if (readyAt.every((at): at is number => at !== undefined)) {
        // The hold starts when both halves are true: the promise exists and the
        // produce is there. Produce ready before anybody promised it was never
        // held by this mission, and a promise made before the crop was ready is
        // waiting on biology rather than on a coordinator.
        const collectableFrom = Math.max(firstSeenAt.get(mission.missionId) ?? frame.atMs, ...readyAt);
        waits.push(frame.atMs - collectableFrom);
      }
    }

    for (const batch of frame.batches) {
      if (batch.lastReportedStage === 'READY' && !firstReadyAt.has(batch.batchId)) {
        firstReadyAt.set(batch.batchId, batch.lastObservedAt ?? frame.atMs);
      }
    }
  }

  return waits;
}

describe('collecting supply that is ready', () => {
  it('sends a mission once the batch is reported ready instead of waiting for the deadline', () => {
    const harvestWaits = SEEDS.flatMap((seed) => readyToDepartureWaitsMs('HARVEST', seed));
    const baselineWaits = SEEDS.flatMap((seed) => readyToDepartureWaitsMs('BASELINE', seed));

    // An empty sample would pass the assertions below without testing anything.
    expect(harvestWaits.length).toBeGreaterThan(0);
    expect(baselineWaits.length).toBeGreaterThan(0);

    // Whether the promise was made against a ready crop or a growing one, the
    // vehicle leaves once the growers say the load is there, so the typical
    // collection sits well inside the hold the policy allows itself.
    const median = [...harvestWaits].sort((a, b) => a - b)[Math.floor(harvestWaits.length / 2)] as number;
    expect(median).toBeLessThanOrEqual(MAX_READY_HOLD_MS);

    // Harvest's slowest collection is still faster than the baseline's fastest.
    // Stated as a separation rather than a per-mission bound because a mission
    // promised two batches on one farm waits for both, and a replay frame
    // cannot say which of a farm's batches a commitment drew on. That case can
    // exceed the hold; it never approaches the baseline.
    expect(Math.max(...harvestWaits)).toBeLessThan(Math.min(...baselineWaits));

    // The baseline still schedules to arrive shortly before the deadline, which
    // is days of holding. Without this the test would pass on a scenario where
    // nothing ever waited, and would be measuring nothing.
    expect(Math.max(...baselineWaits)).toBeGreaterThan(24 * HOUR_MS);
  });

  it('brings a forward promise forward when the grower reports the crop ready', () => {
    // The mechanism only exists because Harvest now promises crops that are
    // still growing, so this asserts both halves: that such promises are made at
    // all, and that the pickup they schedule against the deadline is pulled back
    // to the readiness report rather than left sitting there.
    let forwardPromises = 0;
    let broughtForward = 0;

    for (const seed of BENCHMARK_SEEDS) {
      const result = runScenario({ scenarioId: SCENARIO, policy: 'HARVEST', seed, captureFrames: true });
      forwardPromises += result.decisions.filter(
        (decision) => decision.kind === 'HARVEST_PROPOSE_ALLOCATION' && Number(decision.evidence.forwardPromises ?? 0) > 0,
      ).length;

      const plannedDeparture = new Map<string, number>();
      for (const frame of result.timeline?.frames ?? []) {
        for (const mission of frame.missions) {
          const previous = plannedDeparture.get(mission.missionId);
          if (previous !== undefined && mission.plannedDepartureAt < previous) broughtForward += 1;
          plannedDeparture.set(mission.missionId, mission.plannedDepartureAt);
        }
      }
    }

    expect(forwardPromises).toBeGreaterThan(0);
    expect(broughtForward).toBeGreaterThan(0);
  });

  it('leaves the fragmented baseline collecting at the deadline', () => {
    // Nobody there is watching for a ready report, so no departure ever moves
    // earlier. Modelling it otherwise would hand the baseline a coordination
    // capability it does not have.
    for (const seed of SEEDS) {
      const baseline = runScenario({ scenarioId: SCENARIO, policy: 'BASELINE', seed, captureFrames: true });
      const plannedDeparture = new Map<string, number>();
      for (const frame of baseline.timeline?.frames ?? []) {
        for (const mission of frame.missions) {
          const previous = plannedDeparture.get(mission.missionId);
          if (previous !== undefined) expect(mission.plannedDepartureAt).toBeGreaterThanOrEqual(previous);
          plannedDeparture.set(mission.missionId, mission.plannedDepartureAt);
        }
      }
    }
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
  it('gives every order it raises the days it asked for', () => {
    let raised = 0;
    let pastTheOrderingWindow = 0;

    for (const seed of BENCHMARK_SEEDS) {
      for (const policy of ['BASELINE', 'HARVEST'] as const) {
        const result = runScenario({ scenarioId: SCENARIO, policy, seed, captureFrames: true });
        const demands = raisedDemands(result);
        expect(demands.length).toBeGreaterThan(0);
        raised += demands.length;

        for (const demand of demands) {
          // The buyer waits the substitution grace past its own deadline, and
          // that is when the demand settles. The settlement window is sized so
          // that every deadline the ordering window can draw reaches it.
          expect(demand.neededBy + SUBSTITUTION_GRACE_MS).toBeLessThanOrEqual(RUN_ENDS_AT);
          if (demand.neededBy > ORDERING_ENDS_AT) pastTheOrderingWindow += 1;
        }
      }
    }

    // The bound above would also be satisfied by refusing to raise late orders
    // at all, which is exactly the measurement defect this replaced. Orders due
    // after the ordering window closes have to exist and be scored.
    expect(pastTheOrderingWindow).toBeGreaterThan(0);
    expect(raised).toBeGreaterThan(100);
  });

  it('settles an order raised on the last days of the ordering window', () => {
    // The concrete case: a buyer ordering on day 20 for delivery a week later
    // is a normal order. It used to be deleted before it was raised.
    const lateWindowStart = ORDERING_ENDS_AT - 2 * DAY_MS;
    let lateOrders = 0;

    for (const seed of BENCHMARK_SEEDS) {
      const result = runScenario({ scenarioId: SCENARIO, policy: 'HARVEST', seed, captureFrames: true });
      const settled = raisedDemands(result).filter((demand) => demand.neededBy - 3 * DAY_MS >= lateWindowStart);
      for (const demand of settled) {
        expect(demand.status).not.toBe('PENDING');
        expect(demand.status).not.toBe('COMMITTED');
      }
      lateOrders += settled.length;
    }

    expect(lateOrders).toBeGreaterThan(0);
  });

  it('leaves no demand classified HORIZON_TRUNCATED across the benchmark seeds', () => {
    // Zero because every order raised is followed through to settlement, not
    // because late orders are withheld from the measurement.
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
