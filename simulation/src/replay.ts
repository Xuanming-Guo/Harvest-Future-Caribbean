/**
 * Replay frames for the control room.
 *
 * A whole twenty-one-day run takes a few milliseconds, so the control room does
 * not need to drive the engine in real time. The engine runs once, records a
 * frame after every event, and the interface replays that timeline. Play,
 * pause, speed, scrub and reset then become array indexing rather than
 * simulation control, which is why the timeline can be scrubbed backwards at
 * all — a live engine cannot run in reverse.
 *
 * Everything in this file is OBSERVABLE state. A frame is handed to a browser,
 * so hidden truth reaching one would publish it to anyone with developer tools
 * open. `assertNoTruthLeak` is run over the recorded timeline in the tests, and
 * the shapes below are built by naming fields rather than by spreading engine
 * objects, so a new hidden field cannot ride along.
 *
 * One deliberate addition over the `ObservableWorld` contract: missions carry
 * their planned departure and arrival instants. The contract's `ObservableRoute`
 * has only a path and a status, which is enough to draw a line but not enough
 * to animate a vehicle along it. Timings are observable — a buyer knows when a
 * delivery is due — so this widens the projection without weakening it.
 */

import type { SimulationInstant } from './core/time.js';
import type { ObservableActor, ObservableDisruptionView } from './world/observable.js';
import type { MaritimeAttribution, ScopedMaritimeNetwork } from './world/maritime.js';
import type {
  CropStage,
  CustomsCheckpoint,
  GeoPoint,
  MaritimeLeg,
  MaritimeShipmentCost,
  MaritimeShipmentStatus,
  ReferenceDataSource,
  ReferencePlace,
} from './world/types.js';
import type { ForecastDay, TempBand, WeatherCondition, WeatherLegend } from './world/weather.js';
import type { DecisionRecord } from './policy/types.js';

/** Static furniture, sent once rather than repeated in every frame. */
export interface ControlRoomScene {
  runId: string;
  scenarioId: string;
  policy: 'BASELINE' | 'HARVEST';
  seed: number;
  startsAt: string;
  endsAt: string;
  farms: Array<{ farmId: string; islandId: string; name: string; position: GeoPoint; referencePlaceId?: string }>;
  /**
   * `minimumAcceptableFraction` is the buyer's own stated policy, not hidden
   * truth: it is what they would tell a supplier when placing the order.
   */
  buyers: Array<{ buyerId: string; islandId: string; name: string; position: GeoPoint; minimumAcceptableFraction: number; referencePlaceId?: string }>;
  transporters: Array<{ transporterId: string; islandId: string; name: string; homePosition: GeoPoint; capacityKg: number; referencePlaceId?: string }>;
  roads: Array<{ roadSegmentId: string; islandId: string; name: string; from: GeoPoint; to: GeoPoint; distanceKm: number }>;
  /** Licensed public geography, never a claim of Product participation. */
  referencePlaces: ReferencePlace[];
  referenceDataSources: ReferenceDataSource[];
  /** Run-scoped Product API identities. Baseline participants have no product actor. */
  participants: SimulationParticipant[];
  /**
   * Units, thresholds and provenance for the weather carried on every frame.
   *
   * Sent once with the scene rather than repeated per frame, because it is
   * constant, and published at all so that a client drawing rain, cloud, storm
   * and wind does not have to hard-code the thresholds the engine used. A
   * viewer has to be able to tell ordinary weather from meaningful weather, and
   * that is a question about thresholds.
   *
   * Optional so replays saved before this field existed still load.
   */
  weatherLegend?: WeatherLegend;
  /**
   * The maritime network this run may use, already restricted to its scope.
   *
   * Sent with the scene rather than per frame because it is public reference
   * data that does not change during a run, and sent *at all* so the control
   * room can draw the ports and sea links a shipment moves along without
   * shipping the whole 34-port dataset to a browser that only selected two
   * islands. A one-island run carries a network with no links, and the globe
   * then draws no sea route, which is the correct picture.
   *
   * Optional so replays saved before issue #40 still load.
   */
  maritime?: ScopedMaritimeNetwork;
  /**
   * Source, publisher, licence and retrieval date for that network.
   *
   * Separate from `referenceDataSources`, which covers the OpenStreetMap places
   * snapshot. Ferry operators and central banks are different publishers under
   * different terms, and merging them would attribute one's data to the other.
   */
  maritimeAttributions?: MaritimeAttribution[];
  /**
   * The one-line split between what the maritime data proves and what it does
   * not, carried with the scene so an interface cannot draw a ferry route
   * without also having the sentence that says a route is not a produce
   * service.
   */
  maritimeDisclaimer?: string;
  /** Repeated here so a consumer cannot render the scene without the label. */
  evidenceLabel: string;
}

/**
 * One cross-island consignment at one replay instant.
 *
 * Deliberately field-by-field rather than a spread of the engine's shipment, so
 * that the hidden per-sailing failure draw cannot ride along into a browser.
 * The two provenance fields are both present on every record because a shipment
 * mixes two kinds of claim: the ports, the link and the exchange rate are cited
 * public references, and everything about the schedule, the price, the customs
 * behaviour and the outcome is synthetic.
 */
export interface ControlRoomShipment {
  shipmentId: string;
  missionId: string;
  commitmentId: string;
  demandId: string;
  originIslandId: string;
  destinationIslandId: string;
  originPortId: string;
  destinationPortId: string;
  linkId: string;
  operator: string;
  status: MaritimeShipmentStatus;
  /** SYNTHETIC allowance per sailing, not an operator figure. */
  capacityKg: number;
  loadedKg: number;
  legs: MaritimeLeg[];
  customs: CustomsCheckpoint;
  cost: MaritimeShipmentCost;
  scheduledDepartureAt: number;
  scheduledArrivalAt: number;
  actualDepartureAt: number | null;
  actualArrivalAt: number | null;
  deliveredAt: number | null;
  failureReason: string | null;
  weatherDelayHours: number;
  /** Ports, link and rates. */
  networkProvenance: 'PUBLIC_REFERENCE';
  /** Schedule, capacity, price, customs behaviour and outcome. */
  operationsProvenance: 'SYNTHETIC';
}

export interface SimulationParticipant {
  simulationActorId: string;
  productActorId: string | null;
  role: 'FARMER' | 'BUYER' | 'TRANSPORTER' | 'COORDINATOR';
  displayName: string;
  islandId: string;
}

/**
 * Which harvest-estimation method produced a forecast during a run.
 * `DETERMINISTIC_FALLBACK` is the rule-based fixture, never learned output.
 */
export type SimulationEstimationMode = 'LEARNED_MODEL' | 'DETERMINISTIC_FALLBACK';

export interface SimulationAgentAction {
  actionId: string;
  at: string;
  simulationActorId: string;
  productActorId: string;
  role: SimulationParticipant['role'];
  toolName: string;
  status: 'SUCCEEDED' | 'REJECTED';
  summary: string;
  traceId?: string;
  entityId?: string;
  eventIds: string[];
  adapter: string;
  /**
   * Harvest-estimation method behind a forecast-producing tool call. Optional
   * so saved frames from before the per-run toggle still replay.
   */
  estimationMode?: SimulationEstimationMode;
  /** Whether this tool crossed an approval boundary in the synthetic run. */
  approval: 'NONE' | 'SYNTHETIC_PARTICIPANT';
  correlationId?: string;
  causationId?: string;
}

export interface SimulationOperationsSnapshot {
  activeListings: number;
  openDemands: number;
  ordersByStatus: Record<string, number>;
  orderOutcomes: SimulationOrderOutcomes;
  deliveryAcceptedKg: number;
  approvedCommitmentCount: number;
  completedMissionCount: number;
  /**
   * Delivered orders whose payment term has expired with no recorded payment.
   * Optional so saved frames from before payment tracking still replay.
   */
  paymentOverdueCount?: number;
  activeMissionIds: string[];
  openExceptionIds: string[];
}

/** Product API order outcomes as of one observable replay instant. */
export interface SimulationOrderOutcomes {
  total: number;
  fulfilled: number;
  partiallyFulfilled: number;
  unfulfilled: number;
  pending: number;
  /**
   * Why each unfulfilled or partially fulfilled order missed, keyed by the
   * Product API's `OrderOutcomeCause` vocabulary, plus `HORIZON_TRUNCATED` for
   * an order whose deadline falls after the run window closes. Optional so
   * saved frames from before this field existed still replay.
   */
  causes?: Record<string, number>;
}

/**
 * Observable weather for one island at one replay instant.
 *
 * Everything a control-room overlay needs to draw the sky and nothing it does
 * not: today's realised conditions, and the forecast issued today. Realised
 * weather for a *later* frame is never here, which is what stops a saved replay
 * from being a route to hidden future weather.
 *
 * `windFromDegrees` is the meteorological convention, the direction the wind
 * blows *from*, clockwise from true north. `cloudCoverFraction` is carried
 * alongside `condition` because a four-value enum cannot drive a gradient.
 */
export interface ControlRoomWeather {
  islandId: string;
  /** ISO-8601 calendar date of the realised reading. */
  date: string;
  condition: WeatherCondition;
  rainMm: number;
  windKph: number;
  windFromDegrees: number;
  cloudCoverFraction: number;
  tempBand: TempBand;
  /** Realised weather is a synthetic record. */
  provenance: 'SYNTHETIC';
  /** A forecast is a synthetic prediction, which is a different kind of claim. */
  forecastProvenance: 'MODEL_PREDICTED';
  forecast: ForecastDay[];
}

/** A delivery mission, with the timings needed to animate it. */
export interface ControlRoomMission {
  missionId: string;
  commitmentId: string;
  transporterId: string;
  status: 'PLANNED' | 'ACTIVE' | 'DELAYED' | 'COMPLETED' | 'CANCELLED';
  path: GeoPoint[];
  plannedDepartureAt: number;
  plannedArrivalAt: number;
  actualArrivalAt: number | null;
  loadedKg: number;
  /**
   * Road-only, or a farm-port-sea-port-buyer chain.
   *
   * Optional so replays saved before issue #40 still load; a missing value
   * means the road-only behaviour those replays recorded.
   */
  mode?: 'ROAD' | 'MARITIME';
}

/** A crop batch as Harvest sees it. No true yield, no true readiness. */
export interface ControlRoomBatch {
  batchId: string;
  farmId: string;
  crop: string;
  lastReportedStage: CropStage;
  lastObservedAt: number | null;
  observationCount: number;
  /** The grower's most recent estimate, which is a report and not a fact. */
  latestEstimateKg: number | null;
  confirmedHarvestedKg: number;
}

export interface ControlRoomDemand {
  demandId: string;
  buyerId: string;
  crop: string;
  quantityKg: number;
  neededBy: number;
  status: 'PENDING' | 'COMMITTED' | 'FULFILLED' | 'PARTIALLY_FULFILLED' | 'UNMET';
  acceptedKg: number;
  substitutedKg: number;
}

/** Running totals, so the interface can chart progress without recomputing. */
export interface ControlRoomTotals {
  acceptedKg: number;
  substitutedKg: number;
  promisedKg: number;
  demandsFullyMet: number;
  demandsUnmet: number;
  commitmentsApproved: number;
  observationRequests: number;
}

/**
 * One moment in the run.
 *
 * `eventType` is what caused the frame, which is what lets the interface
 * explain a change in words instead of making someone read a log — the
 * acceptance criterion for this issue.
 */
export interface ControlRoomFrame {
  atMs: SimulationInstant;
  at: string;
  eventType: string;
  actors: ObservableActor[];
  missions: ControlRoomMission[];
  batches: ControlRoomBatch[];
  demands: ControlRoomDemand[];
  disruptions: ObservableDisruptionView[];
  degradedRoadSegmentIds: string[];
  /**
   * Observable weather per island at this instant.
   *
   * Optional so frames saved before issue #37 still replay; present on every
   * frame a current engine records.
   */
  weather?: ControlRoomWeather[];
  /**
   * Cross-island consignments as of this instant.
   *
   * Optional, and always absent in practice for a one-island run: a run whose
   * scoped network has no links cannot produce one.
   */
  shipments?: ControlRoomShipment[];
  /** Decisions recorded since the previous frame. */
  newDecisions: DecisionRecord[];
  /** Product API actions performed by simulated participants during this frame. */
  agentActions?: SimulationAgentAction[];
  /** Run-scoped Product API state after those actions. */
  operationsSnapshot?: SimulationOperationsSnapshot;
  totals: ControlRoomTotals;
}

export interface ReplayTimeline {
  scene: ControlRoomScene;
  frames: ControlRoomFrame[];
}

/**
 * Reduces a large replay to periodic world-state checkpoints without losing
 * agent actions, disruptions, the opening frame, the settled result, or any
 * decision records. Regional frames each repeat the complete visible world;
 * retaining every small physical event would otherwise make a browser replay
 * impractically large while adding no extra state that a later checkpoint does
 * not contain.
 */
export function compactReplayTimeline(timeline: ReplayTimeline, checkpointIntervalMs: number): ReplayTimeline {
  if (!Number.isFinite(checkpointIntervalMs) || checkpointIntervalMs <= 0 || timeline.frames.length < 3) return timeline;

  const compacted: ControlRoomFrame[] = [];
  let pendingDecisions: DecisionRecord[] = [];
  let lastCheckpointAt = Number.NEGATIVE_INFINITY;
  const lastIndex = timeline.frames.length - 1;

  for (const [index, frame] of timeline.frames.entries()) {
    const critical = index === 0 || index === lastIndex || frame.eventType.startsWith('DISRUPTION_') || Boolean(frame.agentActions?.length);
    const due = frame.atMs - lastCheckpointAt >= checkpointIntervalMs;
    if (!critical && !due) {
      pendingDecisions.push(...frame.newDecisions);
      continue;
    }
    compacted.push({ ...frame, newDecisions: [...pendingDecisions, ...frame.newDecisions] });
    pendingDecisions = [];
    lastCheckpointAt = frame.atMs;
  }

  return { ...timeline, frames: compacted };
}

/**
 * Interpolates a position along a mission path.
 *
 * Frames land on events, which are irregular and sometimes hours apart. Drawing
 * a vehicle only at those instants makes it teleport. This gives the control
 * room a position for any instant between departure and arrival, so movement
 * reads as movement.
 *
 * Distance is treated as uniform per segment rather than weighted by real
 * length: the visual difference over a handful of Saint Lucian waypoints does
 * not justify the arithmetic, and nothing downstream measures it.
 */
export function interpolateAlongPath(path: GeoPoint[], progress: number): GeoPoint | null {
  if (path.length === 0) return null;
  if (path.length === 1) return path[0] as GeoPoint;

  const clamped = Math.max(0, Math.min(1, progress));
  const segments = path.length - 1;
  const scaled = clamped * segments;
  const index = Math.min(segments - 1, Math.floor(scaled));
  const withinSegment = scaled - index;

  const from = path[index] as GeoPoint;
  const to = path[index + 1] as GeoPoint;

  return {
    latitude: from.latitude + (to.latitude - from.latitude) * withinSegment,
    longitude: from.longitude + (to.longitude - from.longitude) * withinSegment,
  };
}

/**
 * Where a mission's vehicle is at a given instant, or null if it is not running.
 *
 * Returns null for a cancelled mission and for one that has not departed, so
 * the caller can fall back to the transporter's depot rather than drawing a
 * vehicle sitting on a farm it has not reached.
 */
export function missionPositionAt(mission: ControlRoomMission, atMs: number): GeoPoint | null {
  if (mission.status === 'CANCELLED') return null;
  if (atMs < mission.plannedDepartureAt) return null;

  const arrival = mission.actualArrivalAt ?? mission.plannedArrivalAt;
  const span = arrival - mission.plannedDepartureAt;
  if (span <= 0) return mission.path.at(-1) ?? null;

  const progress = (atMs - mission.plannedDepartureAt) / span;
  if (progress >= 1) return mission.path.at(-1) ?? null;

  return interpolateAlongPath(mission.path, progress);
}

/**
 * The frame at or immediately before an instant.
 *
 * A binary search rather than a scan: the timeline is queried on every animation
 * frame while the clock is running, and a linear walk over a few hundred frames
 * sixty times a second is wasted work in a render loop.
 */
export function frameAt(frames: ControlRoomFrame[], atMs: number): ControlRoomFrame | null {
  if (frames.length === 0) return null;
  if (atMs <= (frames[0] as ControlRoomFrame).atMs) return frames[0] as ControlRoomFrame;

  let low = 0;
  let high = frames.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((frames[middle] as ControlRoomFrame).atMs <= atMs) low = middle;
    else high = middle - 1;
  }
  return frames[low] as ControlRoomFrame;
}

/**
 * Where a vessel is on its sea leg at a given instant, or null.
 *
 * Null before the boat sails, after it berths, and for a sailing that failed —
 * so the control room draws a moving marker only while there is genuinely
 * something at sea. The road legs are covered by `missionPositionAt` on the
 * accompanying mission, which is why this deliberately answers only for the
 * middle leg rather than for the whole itinerary.
 *
 * Interpolation is linear between the two ports, which is a straight rhumb-ish
 * line rather than a real track. Nothing downstream measures it, and pretending
 * to a real vessel track would be inventing evidence the dataset does not hold.
 */
export function vesselPositionAt(shipment: ControlRoomShipment, atMs: number): GeoPoint | null {
  if (shipment.status === 'FAILED') return null;
  const seaLeg = shipment.legs.find((leg) => leg.kind === 'SEA');
  if (!seaLeg) return null;
  if (atMs < seaLeg.startsAt || atMs > seaLeg.endsAt) return null;

  const span = seaLeg.endsAt - seaLeg.startsAt;
  const progress = span <= 0 ? 1 : (atMs - seaLeg.startsAt) / span;
  return interpolateAlongPath([seaLeg.from, seaLeg.to], progress);
}
