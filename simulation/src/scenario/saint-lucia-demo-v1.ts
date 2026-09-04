/**
 * `saint-lucia-demo-v1` — the hero scenario.
 *
 * Cucumber growers in the Mabouya valley supplying hotels and a supermarket
 * around Castries and Rodney Bay, over a three-week window, with a rainy
 * stretch that degrades the interior roads partway through.
 *
 * EVIDENCE STATUS: every number below is SYNTHETIC with one stated exception.
 * Licensed public place references provide geographic context and the shape of
 * the problem follows the project's research notes, but no yield, price, road
 * speed or demand figure here is a measurement.
 *
 * The exception is the weather. Since issue #90 this scenario replays RECORDED
 * daily conditions for Saint Lucia from `data/saint-lucia-weather-reference.v1`
 * (Open-Meteo Historical Weather API, CC BY 4.0), so rain, wind, cloud and
 * temperature are real values from a real September and are labelled
 * `PUBLIC_REFERENCE` day by day. Which recorded year a run replays is chosen
 * deterministically from its seed. That makes the *conditions* real; it makes
 * nothing else real. Every farm, buyer, order, commitment, delivery and outcome
 * downstream of the weather remains invented, and a recorded storm is not
 * evidence that a Harvest delivery failed.
 *
 * Nothing produced by this scenario may be presented as observed impact from a
 * deployed system; `docs/architecture.md` and the repository evidence policy
 * both require that distinction to be explicit, and the run report repeats it.
 *
 * The scenario id matches the one used throughout `contracts/`.
 */

import { IdFactory } from '../core/ids.js';
import { DAY_MS, HOUR_MS, formatDate } from '../core/time.js';
import type { Scenario, ScenarioContext } from './types.js';
import { caribbeanIslandScenarios, caribbeanIslandsV1 } from './caribbean-islands-v1.js';
import { referencePlacesByCategory, referencePlacesForIslands, referenceSourcesForPlaces } from './reference-places.js';
import { WeatherModel } from '../world/weather.js';
import { SAINT_LUCIA_WEATHER_REFERENCE, buildWeatherReferenceSeries } from '../world/weather-reference.js';
import type {
  Buyer,
  Farm,
  HiddenCropTruth,
  ObservedCropBatch,
  RoadSegment,
  ScheduledDisruption,
  Transporter,
  World,
} from '../world/types.js';

const START_ISO = '2026-09-01T06:00:00Z';
const DURATION_DAYS = 21;

/** Synthetic fallback sites used when the reference snapshot lacks a matching category. */
const FARM_SITES = [
  { name: 'Mabouya Valley smallholding', latitude: 13.9503, longitude: -60.9312 },
  { name: 'Dennery ridge plot', latitude: 13.9094, longitude: -60.8919 },
  { name: 'Roseau valley plot', latitude: 13.9581, longitude: -61.0128 },
  { name: 'Marquis basin plot', latitude: 14.0122, longitude: -60.9403 },
  { name: 'Cul de Sac lowland plot', latitude: 13.9847, longitude: -60.9689 },
] as const;

const BUYER_SITES = [
  { name: 'Rodney Bay resort kitchen', latitude: 14.0757, longitude: -60.9497, typicalOrderKg: 220, minimumAcceptableFraction: 0.9 },
  { name: 'Castries supermarket depot', latitude: 14.0101, longitude: -60.9875, typicalOrderKg: 400, minimumAcceptableFraction: 0.8 },
  { name: 'Soufriere hotel group', latitude: 13.8566, longitude: -61.0564, typicalOrderKg: 160, minimumAcceptableFraction: 0.85 },
] as const;

const TRANSPORTER_SITES = [
  { name: 'Castries light truck', latitude: 14.0101, longitude: -60.9875, capacityKg: 600, cruiseSpeedKmh: 38 },
  { name: 'Dennery shared van', latitude: 13.9094, longitude: -60.8919, capacityKg: 350, cruiseSpeedKmh: 32 },
] as const;

/**
 * Great-circle distance in kilometres.
 *
 * Straight-line distance understates Saint Lucian road distance considerably —
 * the interior is mountainous and the roads switchback — so callers apply a
 * winding factor rather than trusting this directly.
 */
function haversineKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const EARTH_RADIUS_KM = 6371;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLat = toRadians(b.latitude - a.latitude);
  const deltaLon = toRadians(b.longitude - a.longitude);
  const halfChord =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(deltaLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(halfChord)));
}

/** Saint Lucian roads wind; a 1.4 multiplier on straight-line distance is a synthetic stand-in. */
const ROAD_WINDING_FACTOR = 1.4;

/**
 * Day index of the heaviest rainfall in the run window.
 *
 * Ties resolve to the earliest day, so the answer depends only on the rainfall
 * values and not on map iteration order.
 */
function wettestDayIndex(rainfallMmByDate: ReadonlyMap<string, number>, startsAt: number, durationDays: number): number {
  let bestDay = 0;
  let bestRain = -1;
  for (let day = 0; day < durationDays; day += 1) {
    const rain = rainfallMmByDate.get(formatDate(startsAt + day * DAY_MS)) ?? 0;
    if (rain > bestRain) {
      bestRain = rain;
      bestDay = day;
    }
  }
  return bestDay;
}

function buildRoads(
  ids: IdFactory,
  sites: readonly { name: string; latitude: number; longitude: number }[],
  hub: { latitude: number; longitude: number },
): Map<string, RoadSegment> {
  const roads = new Map<string, RoadSegment>();

  // One segment per farm-to-hub link. A full road graph is more than the hero
  // scenario needs, and issue #5 owns the map rendering that would justify one.
  for (const [index, site] of sites.entries()) {
    const roadSegmentId = ids.next();
    const straightLineKm = haversineKm(site, hub);
    roads.set(roadSegmentId, {
      roadSegmentId,
      islandId: 'saint-lucia',
      name: `${site.name} to Castries`,
      from: { latitude: site.latitude, longitude: site.longitude },
      to: hub,
      distanceKm: Number((straightLineKm * ROAD_WINDING_FACTOR).toFixed(2)),
      // Four synthetic interior links flood more readily than the fifth.
      rainSensitivity: index === sites.length - 1 ? 0.25 : 0.7,
    });
  }

  return roads;
}

export const saintLuciaDemoV1: Scenario = {
  scenarioId: 'saint-lucia-demo-v1',
  description:
    'Cucumber supply from five Mabouya-area smallholdings to three Castries-area buyers over three weeks, ' +
    'with a rainy period that degrades interior roads and brings forward spoilage.',
  availableIslandIds: ['saint-lucia'],
  startsAtIso: START_ISO,
  durationDays: DURATION_DAYS,
  weatherReference: SAINT_LUCIA_WEATHER_REFERENCE,
  provenanceNote:
    'SYNTHETIC, with one recorded input. Licensed public place references provide geographic context and ' +
    'realised weather replays recorded Saint Lucian daily conditions from data/saint-lucia-weather-reference.v1 ' +
    '(Open-Meteo Historical Weather API, CC BY 4.0), labelled PUBLIC_REFERENCE per day. Every actor, yield, ' +
    'price, demand, road speed and spoilage figure is invented, and forecasts remain MODEL_PREDICTED. A nearby ' +
    'reference does not imply participation, and a recorded weather day is not evidence of any Harvest outcome.',

  build(context: ScenarioContext): World {
    const { ids, random, startsAt } = context;

    // Named streams keep subsystems independent. Adding a farm must not perturb
    // the weather sequence, or the paired runs stop being comparable.
    const farmStream = random.stream('scenario:farms');
    const cropStream = random.stream('scenario:crops');
    const weatherStream = random.stream('scenario:weather');
    const disruptionStream = random.stream('scenario:disruptions');

    // Which recorded September this run replays, drawn from a stream of its own
    // so that adding or removing a year from the dataset cannot shift a single
    // farm, crop or disruption draw. `saintLuciaDemoV1.weatherReference` is read
    // rather than the constant inlined, so a scenario that drops the opt-in
    // silently falls back to the generator instead of half-using the dataset.
    const weatherReference = saintLuciaDemoV1.weatherReference
      ? buildWeatherReferenceSeries({
          datasetId: saintLuciaDemoV1.weatherReference,
          islandIds: ['saint-lucia'],
          stream: random.stream('scenario:weather:reference'),
        })
      : undefined;

    const referencePlaces = referencePlacesForIslands(['saint-lucia']);
    const referenceDataSources = referenceSourcesForPlaces(referencePlaces);
    const farmReferences = referencePlacesByCategory(referencePlaces, 'AGRICULTURAL_AREA');
    const buyerReferences = [
      ...referencePlacesByCategory(referencePlaces, 'HOTEL_RESORT').slice(0, 1),
      ...referencePlacesByCategory(referencePlaces, 'RESTAURANT').slice(0, 1),
      ...referencePlacesByCategory(referencePlaces, 'SUPERMARKET_MARKET').slice(0, 1),
    ];
    const transporterReferences = referencePlacesByCategory(referencePlaces, 'PORT_FERRY_TERMINAL');
    const farmSites = FARM_SITES.map((site, index) => {
      const reference = farmReferences[index];
      return {
        ...site,
        name: `Saint Lucia synthetic smallholding ${index + 1}`,
        latitude: reference?.position.latitude ?? site.latitude,
        longitude: reference?.position.longitude ?? site.longitude,
        referencePlaceId: reference?.referencePlaceId,
      };
    });
    const buyerSites = BUYER_SITES.map((site, index) => {
      const reference = buyerReferences[index];
      return {
        ...site,
        name: `Saint Lucia synthetic buyer ${index + 1}`,
        latitude: reference?.position.latitude ?? site.latitude,
        longitude: reference?.position.longitude ?? site.longitude,
        referencePlaceId: reference?.referencePlaceId,
      };
    });
    const transporterSites = TRANSPORTER_SITES.map((site, index) => {
      const reference = transporterReferences[index];
      return {
        ...site,
        name: `Saint Lucia synthetic carrier ${index + 1}`,
        latitude: reference?.position.latitude ?? site.latitude,
        longitude: reference?.position.longitude ?? site.longitude,
        referencePlaceId: reference?.referencePlaceId,
      };
    });

    const roadHub = buyerSites[0] ?? { latitude: 14.0101, longitude: -60.9875 };
    const roads = buildRoads(ids, farmSites, roadHub);
    const roadIds = [...roads.keys()];

    const farms = new Map<string, Farm>();
    farmSites.forEach((site, index) => {
      const farmId = ids.next();
      farms.set(farmId, {
        farmId,
        islandId: 'saint-lucia',
        name: site.name,
        position: { latitude: site.latitude, longitude: site.longitude },
        ...(site.referencePlaceId ? { referencePlaceId: site.referencePlaceId } : {}),
        roadSegmentId: roadIds[index] as string,
        // Diligence spread is what makes reporting uneven, which is the whole
        // reason Harvest needs to reason about uncertainty at all.
        diligence: Number(farmStream.float(0.35, 0.95).toFixed(3)),
      });
    });

    const buyers = new Map<string, Buyer>();
    for (const site of buyerSites) {
      const buyerId = ids.next();
      buyers.set(buyerId, {
        buyerId,
        islandId: 'saint-lucia',
        name: site.name,
        position: { latitude: site.latitude, longitude: site.longitude },
        ...(site.referencePlaceId ? { referencePlaceId: site.referencePlaceId } : {}),
        typicalOrderKg: site.typicalOrderKg,
        minimumAcceptableFraction: site.minimumAcceptableFraction,
      });
    }

    const transporters = new Map<string, Transporter>();
    for (const site of transporterSites) {
      const transporterId = ids.next();
      transporters.set(transporterId, {
        transporterId,
        islandId: 'saint-lucia',
        name: site.name,
        homePosition: { latitude: site.latitude, longitude: site.longitude },
        ...(site.referencePlaceId ? { referencePlaceId: site.referencePlaceId } : {}),
        capacityKg: site.capacityKg,
        cruiseSpeedKmh: site.cruiseSpeedKmh,
      });
    }

    // One or two cucumber batches per farm, planted before the run opens so
    // some are already close to ready when the scenario starts.
    const crops = new Map<string, HiddenCropTruth>();
    const batches = new Map<string, ObservedCropBatch>();

    for (const farm of farms.values()) {
      const batchCount = cropStream.int(1, 2);
      for (let index = 0; index < batchCount; index += 1) {
        const batchId = ids.next();
        const areaHectares = Number(cropStream.float(0.2, 0.8).toFixed(3));

        // A batch is ONE MARKETABLE PICK-LOT, not a season's output.
        //
        // Cucumbers are picked repeatedly over several weeks; treating a whole
        // season's ~18 t/ha as instantly available on the readiness date put
        // roughly fifteen times more supply into the scenario than there was
        // demand for it. In that world coordination cannot matter — any promise
        // against a ready crop succeeds, and the benchmark measures nothing.
        //
        // Sizing a lot at ~1.2 t/ha leaves total supply modestly above total
        // demand, which is the regime where matching supply to demand is
        // actually the binding problem. The season-level figure belongs to the
        // yield model in issue #7, not here.
        const potentialYieldKg = Number((areaHectares * cropStream.normal(1_200, 260)).toFixed(2));

        // Readiness is drawn *first*, inside the run window, and the planting
        // date is then worked backwards from it.
        //
        // Doing it the intuitive way round — plant 25-45 days before the run
        // and add a 50-65 day growing period — pushes most batches ready well
        // after the three-week horizon. The run then technically completes
        // while almost nothing is ever pickable, both policies fail for the
        // same uninteresting reason, and the scenario exercises none of the
        // intake-to-delivery workflow it exists to demonstrate.
        //
        // Staggering readiness across the window is also what makes the
        // scenario a fair test: some batches are ready early, some late, so a
        // policy has to match supply timing to demand timing rather than
        // finding everything available at once.
        const readyAt = startsAt + cropStream.int(1, DURATION_DAYS - 3) * DAY_MS + cropStream.int(0, 8) * HOUR_MS;
        // Cucumbers run roughly 50-65 days from sowing.
        const plantedAt = readyAt - cropStream.int(50, 65) * DAY_MS;

        crops.set(batchId, {
          batchId,
          potentialYieldKg: Math.max(50, potentialYieldKg),
          readyAt,
          qualityFraction: Number(Math.min(1, Math.max(0.4, cropStream.normal(0.85, 0.08))).toFixed(4)),
          // Cucumbers deteriorate fast once ready and unpicked.
          dailySpoilageRate: Number(cropStream.float(0.06, 0.14).toFixed(4)),
          stage: 'GROWING',
          harvestedKg: 0,
          lostKg: 0,
        });

        // What Harvest starts out believing. The grower's stated window is
        // deliberately wide and offset from the truth: an accurate starting
        // belief would hand the baseline a forecast it has no way to possess.
        const statedCentre = readyAt + cropStream.int(-4, 4) * DAY_MS;
        batches.set(batchId, {
          batchId,
          farmId: farm.farmId,
          crop: 'cucumber',
          plantedAt,
          expectedReadyFrom: statedCentre - 3 * DAY_MS,
          expectedReadyTo: statedCentre + 3 * DAY_MS,
          areaHectares,
          lastReportedStage: 'GROWING',
          lastObservedAt: null,
          observations: [],
          confirmedHarvestedKg: 0,
          provenance: 'SYNTHETIC',
        });
      }
    }

    // Daily rainfall. September is well into the Saint Lucian wet season, so
    // the baseline is damp with a distinctly wet stretch in the second week.
    const rainfallMmByDate = new Map<string, number>();
    const wetSpellStartDay = weatherStream.int(7, 11);
    const wetSpellLengthDays = weatherStream.int(3, 5);

    for (let day = 0; day < DURATION_DAYS + 1; day += 1) {
      const date = formatDate(startsAt + day * DAY_MS);
      const inWetSpell = day >= wetSpellStartDay && day < wetSpellStartDay + wetSpellLengthDays;
      const rainfallMm = inWetSpell
        ? Math.max(0, weatherStream.normal(62, 18))
        : Math.max(0, weatherStream.normal(9, 7));
      rainfallMmByDate.set(date, Number(rainfallMm.toFixed(2)));
    }

    // Where a recorded day exists, it replaces the drawn one.
    //
    // The synthetic draw above still happens, so the seeded stream lands in the
    // same place it always did and the wet-spell figures below stay comparable.
    // The map is then overwritten rather than bypassed because
    // `world.truth.rainfallMmByDate` and `world.truth.weather` must not be able
    // to disagree about how much it rained on a given date; one of them would
    // then be quietly wrong, and there is no way to tell which from the outside.
    if (weatherReference) {
      for (const date of rainfallMmByDate.keys()) {
        const recorded = weatherReference.readingFor('saint-lucia', date);
        if (recorded) rainfallMmByDate.set(date, recorded.rainMm);
      }
    }

    // The wet spell closes an interior road. It is scheduled now but hidden:
    // it only becomes observable when it starts.
    const disruptions: ScheduledDisruption[] = [];
    const floodedRoad = disruptionStream.pick(roadIds.filter((id) => (roads.get(id) as RoadSegment).rainSensitivity > 0.5));
    // On a recorded run the synthetic wet spell no longer exists, so anchoring
    // the flood to it would put "heavy rain has made the road impassable" on a
    // day the record says was dry. The anchor moves to the wettest recorded day
    // in the window instead. This is a *lookup*, not a draw: the same two
    // `disruptionStream` values are consumed either way, so the disruption's
    // offset, duration and severity are untouched and only its day moves.
    const floodAnchorDay = weatherReference ? wettestDayIndex(rainfallMmByDate, startsAt, DURATION_DAYS) : wetSpellStartDay;
    const floodStartsAt = startsAt + floodAnchorDay * DAY_MS + disruptionStream.int(6, 14) * HOUR_MS;

    disruptions.push({
      disruptionId: ids.next(),
      type: 'ROAD',
      startsAt: floodStartsAt,
      endsAt: floodStartsAt + disruptionStream.int(18, 40) * HOUR_MS,
      affectedEntityIds: [floodedRoad as string],
      severity: Number(disruptionStream.float(0.55, 0.95).toFixed(3)),
      publicDescription: 'Heavy rain has made the valley road impassable to loaded vehicles.',
    });

    // A vehicle breakdown, so exception recovery has something to recover from
    // that is not weather.
    const transporterIds = [...transporters.keys()];
    const breakdownStartsAt = startsAt + disruptionStream.int(3, 16) * DAY_MS + disruptionStream.int(5, 11) * HOUR_MS;
    disruptions.push({
      disruptionId: ids.next(),
      type: 'VEHICLE',
      startsAt: breakdownStartsAt,
      endsAt: breakdownStartsAt + disruptionStream.int(6, 20) * HOUR_MS,
      affectedEntityIds: [disruptionStream.pick(transporterIds) as string],
      severity: Number(disruptionStream.float(0.4, 0.9).toFixed(3)),
      publicDescription: 'Vehicle off the road with a mechanical fault.',
    });

    disruptions.sort((a, b) => a.startsAt - b.startsAt);

    // Realised weather is built *on top of* the rainfall drawn above rather
    // than instead of it. `rainfallMm` reads the values back unchanged, so
    // every rainfall figure a previously recorded seed produced still holds;
    // only wind, bearing and temperature are new, and they come from streams of
    // their own so they cannot shift a single existing draw.
    const weather = new WeatherModel({
      islandIds: ['saint-lucia'],
      startsAt,
      days: DURATION_DAYS + 1,
      rainfallMm: (_islandId, date) => rainfallMmByDate.get(date) ?? 0,
      realisedStream: random.stream('scenario:weather:realised'),
      forecastStream: random.stream('weather:forecast'),
      ...(weatherReference ? { reference: weatherReference } : {}),
    });

    return {
      farms,
      buyers,
      transporters,
      roads,
      referencePlaces,
      referenceDataSources,
      truth: { crops, disruptions, rainfallMmByDate, weather },
      observed: {
        batches,
        demands: new Map(),
        commitments: new Map(),
        missions: new Map(),
        disruptions: [],
        degradedRoadSegmentIds: new Set(),
      },
    };
  },
};

export const SCENARIOS: Record<string, Scenario> = {
  [saintLuciaDemoV1.scenarioId]: saintLuciaDemoV1,
  [caribbeanIslandsV1.scenarioId]: caribbeanIslandsV1,
  ...Object.fromEntries(caribbeanIslandScenarios.map((scenario) => [scenario.scenarioId, scenario])),
};

/** Looks up a scenario, listing what exists rather than returning undefined. */
export function requireScenario(scenarioId: string): Scenario {
  const scenario = SCENARIOS[scenarioId];
  if (!scenario) {
    throw new Error(`Unknown scenario '${scenarioId}'. Available: ${Object.keys(SCENARIOS).join(', ')}.`);
  }
  return scenario;
}

export { haversineKm, ROAD_WINDING_FACTOR, START_ISO, DURATION_DAYS };
