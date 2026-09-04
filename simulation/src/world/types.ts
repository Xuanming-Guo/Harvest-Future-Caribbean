/**
 * The simulated world.
 *
 * The organising rule of this file is the split between what is *true* and what
 * Harvest has *seen*. `HiddenTruth` holds the biology and the future: actual
 * yields, actual readiness, actual quality, and disruptions that have not
 * happened yet. `ObservedWorld` holds only what an actor has reported or a
 * system could measure by the current simulation time.
 *
 * Keeping these in separate objects rather than as flagged fields on one record
 * makes the leak that matters hard to write by accident. A policy that receives
 * `ObservedWorld` cannot reach a true yield, because the value is not on the
 * object it was handed. That is the difference between an invariant and a
 * comment asking people to be careful.
 *
 * Every observed value carries provenance, matching the `Provenance` enum in
 * `contracts/common.schema.json`. Nothing in this package produces `OBSERVED`
 * data in the real-world sense; a farmer's reading inside a simulated scenario
 * is still synthetic, and the run report says so.
 */

import type { SimulationInstant } from '../core/time.js';
import type { DualCurrencyAmount, MaritimeRoute, ScopedMaritimeNetwork } from './maritime.js';
import type { ForecastDay, RealisedWeather, WeatherModel } from './weather.js';

/** Mirrors `Provenance` in contracts/common.schema.json. */
export type Provenance = 'OBSERVED' | 'INFERRED' | 'SYNTHETIC' | 'STAKEHOLDER_CALIBRATED' | 'MODEL_PREDICTED';

/** Mirrors `ActorRole` in contracts/common.schema.json. */
export type ActorRole =
  | 'FARMER'
  | 'BUYER'
  | 'TRANSPORTER'
  | 'COORDINATOR'
  | 'OPERATIONS'
  | 'ADMIN'
  | 'SIMULATION_SERVICE'
  | 'MODEL_SERVICE';

/** Mirrors `GeoPoint` in contracts/common.schema.json. */
export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/** Mirrors `Quantity` in contracts/common.schema.json; the contract fixes the unit at kg. */
export interface Quantity {
  value: number;
  unit: 'kg';
}

/** Public geography used only as contextual evidence in observable replays. */
export type ReferencePlaceCategory =
  | 'AGRICULTURAL_AREA'
  | 'HOTEL_RESORT'
  | 'RESTAURANT'
  | 'SUPERMARKET_MARKET'
  | 'PORT_FERRY_TERMINAL';

export type ReferencePlaceEvidenceType =
  | 'PUBLIC_REFERENCE_POINT'
  | 'PUBLIC_FEATURE_CENTROID'
  | 'APPROXIMATE_PUBLIC_AREA_CENTROID';

export interface ReferencePlace {
  referencePlaceId: string;
  islandId: string;
  name: string;
  category: ReferencePlaceCategory;
  position: GeoPoint;
  sourceId: string;
  sourceFeatureId: string;
  sourceUrl: string;
  sourceRevision: string;
  retrievedAt: string;
  evidenceType: ReferencePlaceEvidenceType;
  warnings: string[];
}

export interface ReferenceDataSource {
  sourceId: string;
  title: string;
  publisher: string;
  sourceUrl: string;
  licenceName: string;
  licenceUrl: string;
  attribution: string;
  retrievedAt: string;
  revision: string;
  limitations: string[];
}

export type DisruptionType = 'WEATHER' | 'ROAD' | 'VEHICLE' | 'CROP' | 'DEMAND';

/** The lifecycle of a crop batch, from the grower's point of view. */
export type CropStage = 'PLANTED' | 'GROWING' | 'MATURING' | 'READY' | 'HARVESTED' | 'SPOILED';

// --------------------------------------------------------------------------
// Static scenario furniture. These do not change during a run.
// --------------------------------------------------------------------------

export interface Farm {
  farmId: string;
  /** Manifest identity; island systems are intentionally independent. */
  islandId: string;
  name: string;
  position: GeoPoint;
  /** Optional public-reference anchor; the farmer remains synthetic. */
  referencePlaceId?: string;
  /** Which road segment the farm gate sits on, for routing. */
  roadSegmentId: string;
  /**
   * How diligently this farmer reports, in [0, 1]. Drives both how often an
   * observation happens and how noisy it is. Stakeholder-calibrated in intent,
   * synthetic in fact for the hackathon.
   */
  diligence: number;
}

export interface Buyer {
  buyerId: string;
  islandId: string;
  name: string;
  position: GeoPoint;
  /** Optional public-reference anchor; the buyer remains synthetic. */
  referencePlaceId?: string;
  /** Typical order size in kg; actual demand varies around this. */
  typicalOrderKg: number;
  /** How much of an order must arrive for the buyer to treat it as fulfilled. */
  minimumAcceptableFraction: number;
}

export interface Transporter {
  transporterId: string;
  islandId: string;
  name: string;
  homePosition: GeoPoint;
  /** Optional public-reference anchor; the transporter remains synthetic. */
  referencePlaceId?: string;
  capacityKg: number;
  /** Average road speed in km/h under clear conditions. */
  cruiseSpeedKmh: number;
}

export interface RoadSegment {
  roadSegmentId: string;
  islandId: string;
  name: string;
  from: GeoPoint;
  to: GeoPoint;
  distanceKm: number;
  /**
   * How badly rain degrades this segment, in [0, 1]. A high value marks the
   * unsealed interior roads that flood first.
   */
  rainSensitivity: number;
}

// --------------------------------------------------------------------------
// Hidden truth. Never leaves the engine, never enters an event payload.
// --------------------------------------------------------------------------

/** What is actually happening to a batch, whether or not anyone has looked. */
export interface HiddenCropTruth {
  batchId: string;
  /** Marketable kilograms if harvested at the ideal moment with no losses. */
  potentialYieldKg: number;
  /** When the batch actually becomes ready, independent of any estimate. */
  readyAt: SimulationInstant;
  /** Fraction of the potential yield that is marketable, in [0, 1]. */
  qualityFraction: number;
  /** Fraction lost per day once ready and unharvested, in [0, 1]. */
  dailySpoilageRate: number;
  /** Current true stage. */
  stage: CropStage;
  /** Kilograms actually harvested so far. */
  harvestedKg: number;
  /** Kilograms lost to spoilage or rejection so far. */
  lostKg: number;
}

/** A disruption the scenario has decided will happen, possibly not yet visible. */
export interface ScheduledDisruption {
  disruptionId: string;
  type: DisruptionType;
  /** When it starts affecting the world. */
  startsAt: SimulationInstant;
  endsAt: SimulationInstant;
  /** Entities it acts on: road segments, farms, batches, vehicles or buyers. */
  affectedEntityIds: string[];
  /** True magnitude, in [0, 1]. Never published; only its effects are observable. */
  severity: number;
  /** The wording an actor would use on seeing it, once it becomes observable. */
  publicDescription: string;
}

/**
 * Everything the simulation knows and Harvest does not.
 *
 * Passing this object to a policy is a bug. `assertNoTruthLeak` in
 * `observable.ts` is the runtime check that backs up the type-level split.
 */
export interface HiddenTruth {
  crops: Map<string, HiddenCropTruth>;
  disruptions: ScheduledDisruption[];
  /** Daily rainfall in mm, keyed by ISO date. Drives road and crop effects. */
  rainfallMmByDate: Map<string, number>;
  /**
   * Realised weather for every island-day of the run, and the forecasts issued
   * against it.
   *
   * Realised weather for a day that has not occurred is hidden truth in exactly
   * the sense a scheduled disruption is: the engine may act on it, and nothing
   * facing a participant may read it. The forecasts the same object holds are
   * observable, which is why the model lives here rather than being split in
   * two — a forecast is only meaningful beside the series it approximates.
   */
  weather: WeatherModel;
}

// --------------------------------------------------------------------------
// Observed world. Safe to hand to a policy, a projection or an event payload.
// --------------------------------------------------------------------------

/** One reading a farmer reported. Noisy by construction. */
export interface CropObservation {
  observationId: string;
  batchId: string;
  observedAt: SimulationInstant;
  /** The farmer's estimate, which is not the truth and is not meant to be. */
  estimatedYieldKg: number;
  reportedStage: CropStage;
  provenance: Provenance;
}

/** What Harvest currently believes about a batch. */
export interface ObservedCropBatch {
  batchId: string;
  farmId: string;
  crop: string;
  plantedAt: SimulationInstant;
  /** The grower's stated window, before any model refines it. */
  expectedReadyFrom: SimulationInstant;
  expectedReadyTo: SimulationInstant;
  areaHectares: number;
  /** Most recent reported stage, or PLANTED if nobody has reported yet. */
  lastReportedStage: CropStage;
  lastObservedAt: SimulationInstant | null;
  observations: CropObservation[];
  /** Confirmed harvested kilograms, known once picking is reported. */
  confirmedHarvestedKg: number;
  provenance: Provenance;
}

export interface BuyerDemand {
  demandId: string;
  buyerId: string;
  crop: string;
  quantity: Quantity;
  /** The buyer needs it by this instant; later is a miss. */
  neededBy: SimulationInstant;
  createdAt: SimulationInstant;
  status: 'PENDING' | 'COMMITTED' | 'FULFILLED' | 'PARTIALLY_FULFILLED' | 'UNMET';
  /** Kilograms actually accepted on delivery. */
  acceptedKg: number;
  /** Kilograms the buyer had to source elsewhere, typically imported. */
  substitutedKg: number;
}

export interface Commitment {
  commitmentId: string;
  demandId: string;
  /** Per-batch promised kilograms. Multi-farm fulfilment is the normal case. */
  allocations: Array<{ batchId: string; farmId: string; quantityKg: number }>;
  committedAt: SimulationInstant;
  /** Whether a human approval gate was cleared. Baseline never sets this. */
  approvedAt: SimulationInstant | null;
  status: 'PROPOSED' | 'APPROVED' | 'DELIVERED' | 'CANCELLED';
  /**
   * Set when the promised supply sits on a different island from the buyer.
   *
   * Present as a field rather than inferred from the allocations because the
   * approval this commitment needs is a different one — `INTER_ISLAND_COMMITMENT`
   * rather than `ALLOCATION` — and because the route was chosen at proposal
   * time and must not be re-derived later against a network that may have been
   * scoped differently.
   */
  interIsland?: InterIslandCommitmentDetail;
}

export interface InterIslandCommitmentDetail {
  originIslandId: string;
  destinationIslandId: string;
  route: MaritimeRoute;
  /** Approval subject vocabulary shared with `contracts/openapi.yaml`. */
  approvalSubjectType: 'INTER_ISLAND_COMMITMENT';
}

/** Where a consignment has got to. Distinct from the mission's own status. */
export type MaritimeShipmentStatus = 'SCHEDULED' | 'DEPARTED' | 'DELAYED' | 'ARRIVED' | 'DELIVERED' | 'FAILED';

export type MaritimeLegKind = 'PICKUP' | 'SEA' | 'DELIVERY';

/**
 * One leg of a port-to-port produce mission.
 *
 * The two road legs are ordinary local transport. The sea leg is the one that
 * rests on a public reference, and it is the only one that carries
 * `journeyHoursSource`, which says whether the operator published that duration
 * or whether this package substituted its synthetic default.
 */
export interface MaritimeLeg {
  kind: MaritimeLegKind;
  fromLabel: string;
  toLabel: string;
  from: GeoPoint;
  to: GeoPoint;
  startsAt: SimulationInstant;
  endsAt: SimulationInstant;
  /** Sea legs only. */
  journeyHoursSource?: 'PUBLIC_TIMETABLE' | 'SYNTHETIC_DEFAULT';
}

/**
 * The synthetic border checkpoint at the destination port.
 *
 * Not a legal customs model, and `disclaimer` says so on every instance so the
 * caveat travels with the data rather than living only in a README.
 */
export interface CustomsCheckpoint {
  portId: string;
  status: 'PENDING' | 'CLEARED' | 'HELD';
  /** A synthetic paperwork identifier, so the UI has something to show. */
  documentationReference: string;
  inspected: boolean;
  delayHours: number;
  clearedAt: SimulationInstant | null;
  feeXcd: number;
  disclaimer: string;
  provenance: 'SYNTHETIC';
}

/** What one cross-island consignment cost, in both currencies. */
export interface MaritimeShipmentCost {
  freight: DualCurrencyAmount;
  customsFee: DualCurrencyAmount;
  total: DualCurrencyAmount;
}

/**
 * A deterministic port-to-port produce mission.
 *
 * It always accompanies a `DeliveryMission` whose `mode` is `MARITIME`; the
 * mission holds the parts every delivery has (vehicle, load, arrival) and this
 * holds the parts only a sailing has.
 */
export interface MaritimeShipment {
  shipmentId: string;
  missionId: string;
  commitmentId: string;
  demandId: string;
  originIslandId: string;
  destinationIslandId: string;
  route: MaritimeRoute;
  status: MaritimeShipmentStatus;
  /** SYNTHETIC allowance per sailing, not an operator figure. */
  capacityKg: number;
  loadedKg: number;
  legs: MaritimeLeg[];
  customs: CustomsCheckpoint;
  cost: MaritimeShipmentCost;
  scheduledDepartureAt: SimulationInstant;
  scheduledArrivalAt: SimulationInstant;
  actualDepartureAt: SimulationInstant | null;
  actualArrivalAt: SimulationInstant | null;
  deliveredAt: SimulationInstant | null;
  /** Why a sailing failed, in the words a participant would be told. */
  failureReason: string | null;
  /** Hours the realised weather added to the sea leg. */
  weatherDelayHours: number;
}

export interface DeliveryMission {
  missionId: string;
  commitmentId: string;
  transporterId: string;
  status: 'PLANNED' | 'ACTIVE' | 'DELAYED' | 'COMPLETED' | 'CANCELLED';
  /** Road-only, or a farm-port-sea-port-buyer chain. */
  mode: 'ROAD' | 'MARITIME';
  /** Pickup points then the drop-off, in visiting order. */
  path: GeoPoint[];
  plannedDepartureAt: SimulationInstant;
  plannedArrivalAt: SimulationInstant;
  actualArrivalAt: SimulationInstant | null;
  loadedKg: number;
  /**
   * Which of the commitment's allocations this vehicle collects.
   *
   * Every allocation for a road-only commitment, and only the sea half or only
   * the road half for a commitment that splits across a sailing. Carried on the
   * mission rather than recomputed at departure, so the vehicle that leaves is
   * the vehicle that was planned.
   */
  batchIds: string[];
  /** Set only on a `MARITIME` mission. */
  shipmentId?: string;
}

/** A disruption that has become visible. Severity is deliberately absent. */
export interface ObservedDisruption {
  disruptionId: string;
  type: DisruptionType;
  description: string;
  observedAt: SimulationInstant;
  affectedEntityIds: string[];
}

/**
 * The world as Harvest sees it.
 *
 * This is the only world object a policy receives.
 */
export interface ObservedWorld {
  batches: Map<string, ObservedCropBatch>;
  demands: Map<string, BuyerDemand>;
  commitments: Map<string, Commitment>;
  missions: Map<string, DeliveryMission>;
  /**
   * Cross-island consignments, keyed by shipment id.
   *
   * Always empty for a run whose scope has no published link between two of its
   * islands, which includes every one-island run.
   */
  shipments: Map<string, MaritimeShipment>;
  disruptions: ObservedDisruption[];
  /** Road segments currently known to be impassable or slow. */
  degradedRoadSegmentIds: Set<string>;
}

/**
 * Weather as a participant, a policy or an agent may see it.
 *
 * `current` and `realisedOn` refuse a date that has not occurred; `forecast` is
 * the only forward-looking answer any of them gets. Handing out this object
 * rather than the `WeatherModel` is what keeps the exposure rule in one place
 * instead of at every call site.
 */
export interface ObservableWeatherAccess {
  /** Today's realised weather for an island, or null if the run has none. */
  current(islandId: string): RealisedWeather | null;
  /** Realised weather for a date that has already occurred, else null. */
  realisedOn(islandId: string, date: string): RealisedWeather | null;
  /** The forecast issued today, covering the days ahead. Never the truth. */
  forecast(islandId: string): ForecastDay[];
}

// --------------------------------------------------------------------------
// The full world: static furniture, hidden truth, and observation together.
// --------------------------------------------------------------------------

export interface World {
  farms: Map<string, Farm>;
  buyers: Map<string, Buyer>;
  transporters: Map<string, Transporter>;
  roads: Map<string, RoadSegment>;
  referencePlaces: ReferencePlace[];
  referenceDataSources: ReferenceDataSource[];
  /**
   * Ports, published links and exchange rates, already restricted to this
   * run's island scope.
   *
   * Static furniture rather than observed state: it is public reference data
   * that does not change during a run, and scoping it once here is what stops
   * any later code from reaching a port outside the scope.
   */
  maritime: ScopedMaritimeNetwork;
  truth: HiddenTruth;
  observed: ObservedWorld;
}
