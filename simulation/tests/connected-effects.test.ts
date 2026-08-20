import { describe, expect, it } from 'vitest';

import { DAY_MS } from '../src/core/time.js';
import { SimulationEngine, runScenario } from '../src/engine.js';
import { saintLuciaDemoV1 } from '../src/scenario/saint-lucia-demo-v1.js';

const SCENARIO = saintLuciaDemoV1.scenarioId;

function advanceUntilDemand(engine: SimulationEngine) {
  for (;;) {
    const next = engine.nextEventAt;
    if (next === null) throw new Error('Scenario ended before producing demand.');
    const frames = engine.advanceTo(next);
    const demand = frames.flatMap((frame) => frame.demands).find((item) => item.status === 'PENDING');
    if (demand) return demand;
  }
}

describe('stepped simulation execution', () => {
  it('is equivalent to an ordinary complete run', () => {
    const ordinary = runScenario({ scenarioId: SCENARIO, policy: 'HARVEST', seed: 123, captureFrames: true });
    const stepped = new SimulationEngine({ scenarioId: SCENARIO, policy: 'HARVEST', seed: 123, captureFrames: true });
    stepped.start();
    const { startsAt, endsAt } = stepped.horizon;
    for (let at = startsAt + DAY_MS; at < endsAt; at += DAY_MS) stepped.advanceTo(at);
    const completed = stepped.finish();

    expect(completed.digest).toBe(ordinary.digest);
    expect(completed.metrics).toEqual(ordinary.metrics);
    expect(completed.timeline).toEqual(ordinary.timeline);
  });

  it('waits for Product effects instead of running duplicate internal coordination', () => {
    const engine = new SimulationEngine({
      scenarioId: SCENARIO,
      policy: 'HARVEST',
      seed: 42,
      captureFrames: true,
      coordinationMode: 'EXTERNAL_PRODUCT_API',
    });
    engine.start();
    engine.advanceTo(engine.horizon.endsAt);

    expect(engine.observableWorld.routes).toHaveLength(0);
    expect(engine.finish().metrics.commitmentsApproved).toBe(0);
  });
});

describe('validated Product effects', () => {
  it('creates deterministic future work and applies each event only once', () => {
    const engine = new SimulationEngine({
      scenarioId: SCENARIO,
      policy: 'HARVEST',
      seed: 99,
      captureFrames: true,
      coordinationMode: 'EXTERNAL_PRODUCT_API',
    });
    engine.start();
    const demand = advanceUntilDemand(engine);
    const batch = engine.checkpoint('TEST_CONTEXT').batches[0];
    const farm = engine.controlRoomScene.farms.find((item) => item.farmId === batch?.farmId);
    const buyer = engine.controlRoomScene.buyers.find((item) => item.buyerId === demand.buyerId);
    const transporter = engine.controlRoomScene.transporters[0];
    if (!batch || !farm || !buyer || !transporter) throw new Error('Scenario furniture missing.');

    const allocation = {
      eventId: '10000000-0000-4000-8000-000000000001',
      cursor: '1',
      atMs: engine.currentTime,
      type: 'ALLOCATION_APPROVED' as const,
      demandId: demand.demandId,
      allocations: [{ batchId: batch.batchId, quantityKg: 20 }],
    };
    expect(engine.applyProductEffect(allocation)).toMatchObject({ applied: true, reason: 'APPLIED' });
    expect(engine.applyProductEffect(allocation)).toEqual({ applied: false, reason: 'DUPLICATE' });

    const accepted = engine.applyProductEffect({
      eventId: '10000000-0000-4000-8000-000000000002',
      cursor: '2',
      atMs: engine.currentTime,
      type: 'MISSION_ACCEPTED',
      productMissionId: '20000000-0000-4000-8000-000000000001',
      demandId: demand.demandId,
      transporterId: transporter.transporterId,
      path: [farm.position, buyer.position],
      plannedDepartureAt: engine.currentTime + 60_000,
      plannedArrivalAt: engine.currentTime + 120_000,
    });
    expect(accepted).toMatchObject({ applied: true, reason: 'APPLIED' });
    expect(accepted.simulationMissionId).toBeDefined();

    const frames = engine.advanceTo(engine.currentTime + 120_000);
    expect(frames.some((frame) => frame.eventType === 'MISSION_DEPART')).toBe(true);
    expect(frames.some((frame) => frame.eventType === 'MISSION_ARRIVE')).toBe(true);
  });

  it('reschedules only a future arrival and suppresses physical echoes', () => {
    const engine = new SimulationEngine({
      scenarioId: SCENARIO,
      policy: 'HARVEST',
      seed: 101,
      captureFrames: true,
      coordinationMode: 'EXTERNAL_PRODUCT_API',
    });
    engine.start();
    const demand = advanceUntilDemand(engine);
    const batch = engine.checkpoint('TEST_CONTEXT').batches[0]!;
    const farm = engine.controlRoomScene.farms.find((item) => item.farmId === batch.farmId)!;
    const buyer = engine.controlRoomScene.buyers.find((item) => item.buyerId === demand.buyerId)!;
    const transporter = engine.controlRoomScene.transporters[0]!;
    const productMissionId = '20000000-0000-4000-8000-000000000002';
    engine.applyProductEffect({ eventId: '10000000-0000-4000-8000-000000000010', cursor: '10', atMs: engine.currentTime, type: 'ALLOCATION_APPROVED', demandId: demand.demandId, allocations: [{ batchId: batch.batchId, quantityKg: 10 }] });
    engine.applyProductEffect({ eventId: '10000000-0000-4000-8000-000000000011', cursor: '11', atMs: engine.currentTime, type: 'MISSION_ACCEPTED', productMissionId, demandId: demand.demandId, transporterId: transporter.transporterId, path: [farm.position, buyer.position], plannedDepartureAt: engine.currentTime + 60_000, plannedArrivalAt: engine.currentTime + 120_000 });
    const delayedArrival = engine.currentTime + 240_000;
    expect(engine.applyProductEffect({ eventId: '10000000-0000-4000-8000-000000000012', cursor: '12', atMs: engine.currentTime, type: 'MISSION_DELAYED', productMissionId, plannedArrivalAt: delayedArrival })).toMatchObject({ applied: true });
    expect(engine.applyProductEffect({ eventId: '10000000-0000-4000-8000-000000000013', cursor: '13', atMs: engine.currentTime, type: 'NO_PHYSICAL_EFFECT', origin: 'PHYSICAL_ECHO' })).toEqual({ applied: false, reason: 'PHYSICAL_ECHO' });

    const frames = engine.advanceTo(delayedArrival);
    const arrival = frames.find((frame) => frame.eventType === 'MISSION_ARRIVE');
    expect(arrival?.atMs).toBe(delayedArrival);
  });

  it('does not let Product recovery shorten a physical disruption delay', () => {
    const seed = 303;
    const probe = new SimulationEngine({ scenarioId: SCENARIO, policy: 'HARVEST', seed });
    const transporterId = probe.controlRoomScene.transporters[0]!.transporterId;
    const engine = new SimulationEngine({
      scenarioId: SCENARIO,
      policy: 'HARVEST',
      seed,
      captureFrames: true,
      coordinationMode: 'EXTERNAL_PRODUCT_API',
      injectedDisruptions: [{
        type: 'VEHICLE',
        offsetMs: 0,
        durationMs: 21 * DAY_MS,
        affectedEntityIds: [transporterId],
        publicDescription: 'Test vehicle unavailable.',
      }],
    });
    engine.start();
    const demand = advanceUntilDemand(engine);
    const batch = engine.checkpoint('TEST_CONTEXT').batches[0]!;
    const farm = engine.controlRoomScene.farms.find((item) => item.farmId === batch.farmId)!;
    const buyer = engine.controlRoomScene.buyers.find((item) => item.buyerId === demand.buyerId)!;
    const productMissionId = '20000000-0000-4000-8000-000000000003';

    engine.applyProductEffect({ eventId: '10000000-0000-4000-8000-000000000020', cursor: '20', atMs: engine.currentTime, type: 'ALLOCATION_APPROVED', demandId: demand.demandId, allocations: [{ batchId: batch.batchId, quantityKg: 10 }] });
    engine.applyProductEffect({ eventId: '10000000-0000-4000-8000-000000000021', cursor: '21', atMs: engine.currentTime, type: 'MISSION_ACCEPTED', productMissionId, demandId: demand.demandId, transporterId, path: [farm.position, buyer.position], plannedDepartureAt: engine.currentTime + 60_000, plannedArrivalAt: engine.currentTime + 120_000 });
    const physicallyAllowedArrival = engine.checkpoint('AFTER_BREAKDOWN').missions[0]!.plannedArrivalAt;

    engine.applyProductEffect({ eventId: '10000000-0000-4000-8000-000000000022', cursor: '22', atMs: engine.currentTime, type: 'MISSION_DELAYED', productMissionId, plannedArrivalAt: engine.currentTime + 180_000 });
    const recoveredArrival = engine.checkpoint('AFTER_RECOVERY').missions[0]!.plannedArrivalAt;

    expect(recoveredArrival).toBe(physicallyAllowedArrival);
  });
});
