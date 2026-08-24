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
}

export interface DeliveryMission {
  missionId: string;
  commitmentId: string;
  transporterId: string;
  status: 'PLANNED' | 'ACTIVE' | 'DELAYED' | 'COMPLETED' | 'CANCELLED';
  /** Pickup points then the drop-off, in visiting order. */
  path: GeoPoint[];
  plannedDepartureAt: SimulationInstant;
  plannedArrivalAt: SimulationInstant;
  actualArrivalAt: SimulationInstant | null;
  loadedKg: number;
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
  disruptions: ObservedDisruption[];
  /** Road segments currently known to be impassable or slow. */
  degradedRoadSegmentIds: Set<string>;
}

// --------------------------------------------------------------------------
// The full world: static furniture, hidden truth, and observation together.
// --------------------------------------------------------------------------

export interface World {
  farms: Map<string, Farm>;
  buyers: Map<string, Buyer>;
  transporters: Map<string, Transporter>;
  roads: Map<string, RoadSegment>;
  truth: HiddenTruth;
  observed: ObservedWorld;
}
