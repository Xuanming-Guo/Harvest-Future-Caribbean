import { DAY_MS, formatDate } from '../core/time.js';
import type { Scenario, ScenarioContext } from './types.js';
import { CARIBBEAN_ISLANDS_V1, requireCaribbeanIsland } from './caribbean-islands-manifest-v1.js';
import type { Buyer, Farm, HiddenCropTruth, ObservedCropBatch, RoadSegment, ScheduledDisruption, Transporter, World } from '../world/types.js';

const START_ISO = '2026-09-01T06:00:00Z';
const DURATION_DAYS = 21;
const evidence = 'SYNTHETIC. Manifest identity, settlement coordinates, timezones and currencies are offline reference inputs; every actor, quantity, yield, weather, speed, disruption and outcome is synthetic.';

export const caribbeanIslandsV1: Scenario = {
  scenarioId: 'caribbean-islands-v1',
  description: 'Manifest-generated independent Caribbean island food systems. Inter-island trade, shipping, ports, customs and currency conversion are intentionally excluded.',
  availableIslandIds: CARIBBEAN_ISLANDS_V1.map((island) => island.islandId),
  startsAtIso: START_ISO,
  durationDays: DURATION_DAYS,
  provenanceNote: evidence,
  build(context: ScenarioContext): World {
    const requested = context.islandIds?.length ? [...context.islandIds] : CARIBBEAN_ISLANDS_V1.map((island) => island.islandId);
    const islands = requested.map(requireCaribbeanIsland).sort((a, b) => a.islandId.localeCompare(b.islandId));
    const farms = new Map<string, Farm>(); const buyers = new Map<string, Buyer>(); const transporters = new Map<string, Transporter>();
    const roads = new Map<string, RoadSegment>(); const crops = new Map<string, HiddenCropTruth>(); const batches = new Map<string, ObservedCropBatch>();
    const disruptions: ScheduledDisruption[] = []; const rainfallMmByDate = new Map<string, number>();

    for (const island of islands) {
      const stream = context.random.stream(`regional:${island.islandId}`);
      const hub = island.settlements[0]!;
      const market = island.settlements[1]!;
      const farmIds: string[] = [];
      for (let index = 0; index < 3; index += 1) {
        const farmId = context.ids.next(); const roadSegmentId = context.ids.next(); const latitude = hub.latitude + stream.float(-0.10, 0.10); const longitude = hub.longitude + stream.float(-0.12, 0.12);
        roads.set(roadSegmentId, { roadSegmentId, islandId: island.islandId, name: `${island.name} local farm road ${index + 1}`, from: { latitude, longitude }, to: { latitude: hub.latitude, longitude: hub.longitude }, distanceKm: Number(stream.float(8, 32).toFixed(2)), rainSensitivity: Number(stream.float(0.35, 0.8).toFixed(2)) });
        farms.set(farmId, { farmId, islandId: island.islandId, name: `${island.name} synthetic smallholding ${index + 1}`, position: { latitude, longitude }, roadSegmentId, diligence: Number(stream.float(0.4, 0.9).toFixed(3)) }); farmIds.push(farmId);
      }
      for (const [index, point] of [hub, market].entries()) { const buyerId = context.ids.next(); buyers.set(buyerId, { buyerId, islandId: island.islandId, name: `${island.name} synthetic buyer ${index + 1}`, position: { latitude: point.latitude, longitude: point.longitude }, typicalOrderKg: Math.round(stream.float(80, 260)), minimumAcceptableFraction: 0.8 }); }
      const transporterId = context.ids.next(); transporters.set(transporterId, { transporterId, islandId: island.islandId, name: `${island.name} synthetic local carrier`, homePosition: { latitude: hub.latitude, longitude: hub.longitude }, capacityKg: Math.round(stream.float(250, 550)), cruiseSpeedKmh: Math.round(stream.float(28, 42)) });
      for (const farmId of farmIds) { const batchId = context.ids.next(); const readyAt = context.startsAt + stream.int(1, 17) * DAY_MS; crops.set(batchId, { batchId, potentialYieldKg: Math.round(stream.float(120, 420)), readyAt, qualityFraction: Number(stream.float(0.7, 0.95).toFixed(3)), dailySpoilageRate: Number(stream.float(0.05, 0.12).toFixed(3)), stage: 'GROWING', harvestedKg: 0, lostKg: 0 }); batches.set(batchId, { batchId, farmId, crop: stream.pick(island.crops) as string, plantedAt: readyAt - stream.int(45, 65) * DAY_MS, expectedReadyFrom: readyAt - 3 * DAY_MS, expectedReadyTo: readyAt + 3 * DAY_MS, areaHectares: Number(stream.float(0.15, 0.6).toFixed(3)), lastReportedStage: 'GROWING', lastObservedAt: null, observations: [], confirmedHarvestedKg: 0, provenance: 'SYNTHETIC' }); }
      for (let day = 0; day <= DURATION_DAYS; day += 1) rainfallMmByDate.set(`${island.islandId}:${formatDate(context.startsAt + day * DAY_MS)}`, Number(Math.max(0, stream.normal(12, 8)).toFixed(2)));
      const roadId = [...roads.values()].find((road) => road.islandId === island.islandId)?.roadSegmentId; if (roadId) disruptions.push({ disruptionId: context.ids.next(), type: 'ROAD', startsAt: context.startsAt + stream.int(7, 14) * DAY_MS, endsAt: context.startsAt + stream.int(15, 18) * DAY_MS, affectedEntityIds: [roadId], severity: Number(stream.float(0.4, 0.85).toFixed(2)), publicDescription: `Heavy rain has disrupted a local ${island.name} farm road.` });
    }
    return { farms, buyers, transporters, roads, truth: { crops, disruptions, rainfallMmByDate }, observed: { batches, demands: new Map(), commitments: new Map(), missions: new Map(), disruptions: [], degradedRoadSegmentIds: new Set() } };
  },
};

/**
 * A focused, independently runnable recipe for each manifest island. The
 * regional recipe remains available for whole-Caribbean runs; these entries
 * let the control room launch and inspect any island without first narrowing
 * a broader scenario by hand.
 */
export const caribbeanIslandScenarios: readonly Scenario[] = CARIBBEAN_ISLANDS_V1.map((island) => ({
  scenarioId: `caribbean-${island.islandId}-v1`,
  description: `Synthetic ${island.name} local food system over three weeks.`,
  availableIslandIds: [island.islandId],
  startsAtIso: START_ISO,
  durationDays: DURATION_DAYS,
  provenanceNote: evidence,
  build(context: ScenarioContext): World {
    return caribbeanIslandsV1.build({ ...context, islandIds: [island.islandId] });
  },
}));
