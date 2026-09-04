/**
 * Replay frames for the control room.
 *
 * A whole four-week run takes a few milliseconds, so the control room does
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
import type { CropStage, GeoPoint, ReferenceDataSource, ReferencePlace } from './world/types.js';
import type { DecisionRecord } from './policy/types.js';

/** Static furniture, sent once rather than repeated in every frame. */
export interface ControlRoomScene {
  runId: string;
  scenarioId: string;
  policy: 'BASELINE' | 'HARVEST';
  seed: number;
  startsAt: string;
  /**
   * When buyers stop raising orders. The run itself continues to `endsAt` so
   * the last orders raised can be delivered and settled. Optional: timelines
   * saved before the settlement window existed have no ordering horizon of
   * their own, and playback falls back to labelling the whole run.
   */
  demandEndsAt?: string;
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
  /** Repeated here so a consumer cannot render the scene without the label. */
  evidenceLabel: string;
}

export interface SimulationParticipant {
  simulationActorId: string;
  productActorId: string | null;
  role: 'FARMER' | 'BUYER' | 'TRANSPORTER' | 'COORDINATOR';
  displayName: string;
  islandId: string;
}

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
