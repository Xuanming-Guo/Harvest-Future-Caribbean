import { DAY_MS, formatDate } from '../core/time.js';
import type { Scenario, ScenarioContext } from './types.js';
import { CARIBBEAN_ISLANDS_V1, requireCaribbeanIsland } from './caribbean-islands-manifest-v1.js';
import { referencePlacesByCategory, referencePlacesForIslands, referenceSourcesForPlaces } from './reference-places.js';
import type { Buyer, Farm, HiddenCropTruth, ObservedCropBatch, RoadSegment, ScheduledDisruption, Transporter, World } from '../world/types.js';
import { WeatherModel } from '../world/weather.js';

const START_ISO = '2026-09-01T06:00:00Z';
const DURATION_DAYS = 21;
const evidence = 'SYNTHETIC. Manifest identity and licensed public places are offline reference inputs; every actor, quantity, yield, weather, speed, disruption and outcome is synthetic. A nearby reference place does not imply that the real organisation participates in Harvest.';

function haversineKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const radiusKm = 6371;
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(b.latitude - a.latitude);
  const longitudeDelta = radians(b.longitude - a.longitude);
  const chord = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * radiusKm * Math.asin(Math.min(1, Math.sqrt(chord)));
}

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
    const referencePlaces = referencePlacesForIslands(islands.map((island) => island.islandId));
    const referenceDataSources = referenceSourcesForPlaces(referencePlaces);
    const farms = new Map<string, Farm>(); const buyers = new Map<string, Buyer>(); const transporters = new Map<string, Transporter>();
    const roads = new Map<string, RoadSegment>(); const crops = new Map<string, HiddenCropTruth>(); const batches = new Map<string, ObservedCropBatch>();
    const disruptions: ScheduledDisruption[] = []; const rainfallMmByDate = new Map<string, number>();

    for (const island of islands) {
      const stream = context.random.stream(`regional:${island.islandId}`);
      const hub = island.settlements[0]!;
      const market = island.settlements[1]!;
      const islandReferences = referencePlaces.filter((place) => place.islandId === island.islandId);
      const farmReferences = referencePlacesByCategory(islandReferences, 'AGRICULTURAL_AREA');
      const buyerReferences = [
        ...referencePlacesByCategory(islandReferences, 'HOTEL_RESORT').slice(0, 1),
        ...referencePlacesByCategory(islandReferences, 'RESTAURANT').slice(0, 1),
        ...referencePlacesByCategory(islandReferences, 'SUPERMARKET_MARKET').slice(0, 2),
      ];
      const transporterReferences = referencePlacesByCategory(islandReferences, 'PORT_FERRY_TERMINAL');
      const localHub = buyerReferences[0]?.position ?? hub;
      const farmIds: string[] = [];
      for (let index = 0; index < 3; index += 1) {
        const farmId = context.ids.next();
        const roadSegmentId = context.ids.next();
        const reference = farmReferences[index];
        const position = reference?.position ?? {
          latitude: hub.latitude + stream.float(-0.10, 0.10),
          longitude: hub.longitude + stream.float(-0.12, 0.12),
        };
        const referenceDistance = haversineKm(position, localHub) * island.roadWindingFactor;
        roads.set(roadSegmentId, {
          roadSegmentId,
          islandId: island.islandId,
          name: `${island.name} synthetic local farm road ${index + 1}`,
          from: position,
          to: { latitude: localHub.latitude, longitude: localHub.longitude },
          distanceKm: Number(Math.max(1, referenceDistance).toFixed(2)),
          rainSensitivity: Number(stream.float(0.35, 0.8).toFixed(2)),
        });
        farms.set(farmId, {
          farmId,
          islandId: island.islandId,
          name: `${island.name} synthetic smallholding ${index + 1}`,
          position,
          ...(reference ? { referencePlaceId: reference.referencePlaceId } : {}),
          roadSegmentId,
          diligence: Number(stream.float(0.4, 0.9).toFixed(3)),
        });
        farmIds.push(farmId);
      }
      for (const [index, point] of [hub, market].entries()) {
        const buyerId = context.ids.next();
        const reference = buyerReferences[index];
        buyers.set(buyerId, {
          buyerId,
          islandId: island.islandId,
          name: `${island.name} synthetic buyer ${index + 1}`,
          position: reference?.position ?? { latitude: point.latitude, longitude: point.longitude },
          ...(reference ? { referencePlaceId: reference.referencePlaceId } : {}),
          typicalOrderKg: Math.round(stream.float(80, 260)),
          minimumAcceptableFraction: 0.8,
        });
      }
      const transporterId = context.ids.next();
      const transporterReference = transporterReferences[0];
      transporters.set(transporterId, {
        transporterId,
        islandId: island.islandId,
        name: `${island.name} synthetic local carrier`,
        homePosition: transporterReference?.position ?? { latitude: localHub.latitude, longitude: localHub.longitude },
        ...(transporterReference ? { referencePlaceId: transporterReference.referencePlaceId } : {}),
        capacityKg: Math.round(stream.float(250, 550)),
        cruiseSpeedKmh: Math.round(stream.float(28, 42)),
      });
      for (const farmId of farmIds) { const batchId = context.ids.next(); const readyAt = context.startsAt + stream.int(1, 17) * DAY_MS; crops.set(batchId, { batchId, potentialYieldKg: Math.round(stream.float(120, 420)), readyAt, qualityFraction: Number(stream.float(0.7, 0.95).toFixed(3)), dailySpoilageRate: Number(stream.float(0.05, 0.12).toFixed(3)), stage: 'GROWING', harvestedKg: 0, lostKg: 0 }); batches.set(batchId, { batchId, farmId, crop: stream.pick(island.crops) as string, plantedAt: readyAt - stream.int(45, 65) * DAY_MS, expectedReadyFrom: readyAt - 3 * DAY_MS, expectedReadyTo: readyAt + 3 * DAY_MS, areaHectares: Number(stream.float(0.15, 0.6).toFixed(3)), lastReportedStage: 'GROWING', lastObservedAt: null, observations: [], confirmedHarvestedKg: 0, provenance: 'SYNTHETIC' }); }
      for (let day = 0; day <= DURATION_DAYS; day += 1) rainfallMmByDate.set(`${island.islandId}:${formatDate(context.startsAt + day * DAY_MS)}`, Number(Math.max(0, stream.normal(12, 8)).toFixed(2)));
      const roadId = [...roads.values()].find((road) => road.islandId === island.islandId)?.roadSegmentId; if (roadId) disruptions.push({ disruptionId: context.ids.next(), type: 'ROAD', startsAt: context.startsAt + stream.int(7, 14) * DAY_MS, endsAt: context.startsAt + stream.int(15, 18) * DAY_MS, affectedEntityIds: [roadId], severity: Number(stream.float(0.4, 0.85).toFixed(2)), publicDescription: `Heavy rain has disrupted a local ${island.name} farm road.` });
    }
    // Realised weather extends the rainfall above rather than replacing it: the
    // rain values are read back out unchanged, and only wind, temperature and
    // bearing come from a stream of their own. Adding those draws cannot move
    // any existing seeded value, because the streams are independent by name.
    const weather = new WeatherModel({
      islandIds: islands.map((island) => island.islandId),
      startsAt: context.startsAt,
      days: DURATION_DAYS + 1,
      rainfallMm: (islandId, date) => rainfallMmByDate.get(`${islandId}:${date}`) ?? 0,
      realisedStream: context.random.stream('scenario:weather:realised'),
      forecastStream: context.random.stream('weather:forecast'),
    });

    return { farms, buyers, transporters, roads, referencePlaces, referenceDataSources, truth: { crops, disruptions, rainfallMmByDate, weather }, observed: { batches, demands: new Map(), commitments: new Map(), missions: new Map(), disruptions: [], degradedRoadSegmentIds: new Set() } };
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
