/**
 * The discrete-event engine.
 *
 * The engine owns the clock, the queue and the world. It advances by popping
 * the next scheduled event, moving simulation time to that instant, and running
 * a handler that may mutate the world and schedule further events. When the
 * queue empties or time passes the scenario horizon, the run is over.
 *
 * Two rules keep it honest:
 *
 *   1. **The engine owns physical reality; the policy owns coordination.**
 *      Whether a cucumber is ready is the engine's business, drawn from hidden
 *      truth. Whether to promise it to a buyer is the policy's. Mixing the two
 *      would let a policy change what the world does, and the benchmark would
 *      be comparing two different worlds.
 *
 *   2. **Every quantity the policy proposes is revalidated here.** `AGENTS.md`
 *      requires quantities, reservations, allocation and state transitions to
 *      be deterministic and validated. A policy proposes; the engine checks the
 *      proposal against real availability and rejects what does not hold. That
 *      stays true when a policy is replaced by an agent.
 *
 * Nothing here reads wall-clock time or unseeded randomness.
 */

import { IdFactory } from './core/ids.js';
import { EventQueue, Priority, type ScheduledEvent } from './core/queue.js';
import { RandomSource } from './core/random.js';
import { DAY_MS, HOUR_MS, MINUTE_MS, formatDate, formatInstant, parseInstant, type SimulationInstant } from './core/time.js';
import { baselinePolicy } from './policy/baseline.js';
import { harvestPolicy } from './policy/harvest.js';
import type { CoordinationPolicy, DecisionRecord, InterIslandFill, PolicyContext } from './policy/types.js';
import { requireScenario, haversineKm, ROAD_WINDING_FACTOR } from './scenario/saint-lucia-demo-v1.js';
import { CARIBBEAN_ISLANDS_V1 } from './scenario/caribbean-islands-manifest-v1.js';
import type { Scenario } from './scenario/types.js';
import { assertNoTruthLeak, toObservableWorld, worldDigest, type ObservableWorldView } from './world/observable.js';
import type {
  ControlRoomBatch,
  ControlRoomDemand,
  ControlRoomFrame,
  ControlRoomMission,
  ControlRoomScene,
  ControlRoomShipment,
  ControlRoomWeather,
  ReplayTimeline,
  SimulationAgentAction,
  SimulationOperationsSnapshot,
} from './replay.js';
import {
  COMPARISON_CURRENCY,
  CUSTOMS_BASE_DELAY_HOURS,
  CUSTOMS_DISCLAIMER,
  CUSTOMS_INSPECTION_EXTRA_HOURS,
  CUSTOMS_INSPECTION_PROBABILITY,
  CUSTOMS_FIXED_FEE_XCD,
  MARITIME_SYNTHETIC_DISCLAIMER,
  PORT_HANDLING_HOURS,
  SAILING_CAPACITY_KG,
  SAILING_FAILURE_PROBABILITY,
  findPort,
  maritimeAttributions,
  portPosition,
  routesBetween,
  shipmentCostXcd,
  toDualCurrency,
} from './world/maritime.js';
import type { MaritimeRoute } from './world/maritime.js';
import type {
  BuyerDemand,
  Commitment,
  CustomsCheckpoint,
  DeliveryMission,
  GeoPoint,
  HiddenCropTruth,
  InterIslandCommitmentDetail,
  MaritimeLeg,
  MaritimeShipment,
  ObservableWeatherAccess,
  ObservedCropBatch,
  ScheduledDisruption,
  World,
} from './world/types.js';
import {
  FORECAST_PROVENANCE,
  MAX_WEATHER_READINESS_DELAY_MS,
  MINIMUM_QUALITY_FRACTION,
  REALISED_WEATHER_PROVENANCE,
  WEATHER_LEGEND,
  isWetDay,
  qualityLoss,
  readinessDelayMs,
  spoilageMultiplier,
  travelSpeedFactor,
  weatherDegradesRoad,
} from './world/weather.js';
import type { RealisedWeather } from './world/weather.js';

export type PolicyName = 'BASELINE' | 'HARVEST';
export type RunStatus = 'READY' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'FAILED';
export type CoordinationMode = 'INTERNAL_POLICY' | 'EXTERNAL_PRODUCT_API';

interface ProductEffectEnvelope {
  /** Product API domain-event UUID. Used only for deduplication, never as a seeded world identity. */
  eventId: string;
  /** Monotonic Product API outbox cursor, represented as decimal text for JSON safety. */
  cursor: string;
  /** Effective simulation instant for this already-validated Product API event. */
  atMs: SimulationInstant;
  /** Physical echoes are recorded as consumed but cannot mutate the world twice. */
  origin?: 'PRODUCT' | 'PHYSICAL_ECHO';
}

export type ProductSimulationEffect =
  | (ProductEffectEnvelope & {
      type: 'NO_PHYSICAL_EFFECT' | 'OBSERVATION_BOUND' | 'ORDER_BOUND';
    })
  | (ProductEffectEnvelope & {
      type: 'ALLOCATION_APPROVED';
      demandId: string;
      allocations: Array<{ batchId: string; quantityKg: number }>;
    })
  | (ProductEffectEnvelope & {
      type: 'MISSION_ACCEPTED';
      productMissionId: string;
      demandId: string;
      transporterId: string;
      path: GeoPoint[];
      plannedDepartureAt: SimulationInstant;
      plannedArrivalAt: SimulationInstant;
    })
  | (ProductEffectEnvelope & {
      type: 'MISSION_DELAYED';
      productMissionId: string;
      plannedArrivalAt: SimulationInstant;
    })
  | (ProductEffectEnvelope & {
      type: 'DELIVERY_ACCEPTED';
      productMissionId: string;
      demandId: string;
      acceptedKg: number;
      rejectedKg: number;
    })
  | (ProductEffectEnvelope & {
      type: 'ORDER_FULFILLED' | 'ORDER_PARTIALLY_FULFILLED' | 'ORDER_REJECTED';
      demandId: string;
    })
  | (ProductEffectEnvelope & {
      type: 'ALLOCATION_INVALIDATED' | 'ORDER_CANCELLED';
      demandId: string;
    })
  /**
   * Every human approval on one inter-island commitment has been granted.
   *
   * This is the only route by which a connected run can put produce on a boat.
   * The engine proposes; the Product API collects the approvals; and until this
   * effect arrives there is no commitment and no shipment, so an inter-island
   * promise cannot bind anyone by any other path.
   */
  | (ProductEffectEnvelope & {
      type: 'INTER_ISLAND_COMMITMENT_APPROVED';
      proposalId: string;
    });

export interface ProductEffectResult {
  applied: boolean;
  reason: 'APPLIED' | 'DUPLICATE' | 'PHYSICAL_ECHO' | 'IGNORED' | 'REJECTED';
  simulationMissionId?: string;
  simulationShipmentId?: string;
}

/**
 * A cross-island fill the engine wants, before anybody has approved it.
 *
 * Deliberately not world state. It carries no commitment id and no shipment,
 * because nothing exists yet: it is a request for a decision, and the decision
 * is a human one taken through the Product API.
 */
export interface InterIslandProposalView {
  proposalId: string;
  demandId: string;
  buyerId: string;
  originIslandId: string;
  destinationIslandId: string;
  linkId: string;
  originPortId: string;
  destinationPortId: string;
  operator: string;
  seaLegHours: number;
  journeyHoursSource: 'PUBLIC_TIMETABLE' | 'SYNTHETIC_DEFAULT';
  lines: Array<{ batchId: string; farmId: string; quantityKg: number }>;
  quantityKg: number;
  rationale: string;
  proposedAt: SimulationInstant;
}

/** Observable causal link used by the connected Product API bridge. */
export interface DisruptionMissionImpact {
  disruptionId: string;
  missionId: string;
}

export interface EngineOptions {
  /**
   * Optional storage identity supplied by the Product API.
   *
   * The engine still consumes its deterministic run-id draw so supplying this
   * value cannot shift any scenario/entity identifiers or random streams.
   */
  runId?: string;
  scenarioId: string;
  /** Resolved island scope supplied by the Product API for regional scenarios. */
  islandIds?: readonly string[];
  policy: PolicyName;
  seed: number;
  /** Hard cap on events processed, so a scheduling bug fails fast instead of hanging. */
  maxEvents?: number;
  /**
   * Record an observable frame after every event, for the control room.
   *
   * Off by default. The benchmark runs thousands of scenarios and has no use
   * for a few hundred frames of projection per run.
   */
  captureFrames?: boolean;
  /**
   * In connected Harvest runs the Product API owns coordination. The engine
   * still produces biology, weather, demand and disruptions, but it waits for
   * validated Product events before creating commitments or routes.
   */
  coordinationMode?: CoordinationMode;
  /**
   * Extra disruptions injected into the scenario before it starts.
   *
   * This backs the control room's event-injection control. They are ordinary
   * scheduled disruptions, so an injected road closure behaves exactly like one
   * the scenario generated, and an injected run stays as reproducible as any
   * other — the same injection plus the same seed gives the same world.
   */
  injectedDisruptions?: InjectedDisruption[];
}

/**
 * A disruption requested from outside the scenario.
 *
 * Severity is deliberately not settable. It is hidden truth, and letting an
 * interface choose it would let whoever is driving the demo dial the outcome.
 * The engine derives it from a seeded stream instead.
 */
export interface InjectedDisruption {
  type: 'WEATHER' | 'ROAD' | 'VEHICLE' | 'CROP' | 'DEMAND';
  /** Milliseconds after the scenario start. */
  offsetMs: number;
  durationMs: number;
  affectedEntityIds: string[];
  publicDescription: string;
}

/**
 * Why one demand ended short.
 *
 * A fulfilment rate says how often the system failed; this vocabulary says
 * where. The order is the ladder `classifyDemand` walks, from the earliest
 * point in the chain that can fail to the latest, so a demand nothing was ever
 * promised against is not also counted as a late delivery.
 */
export const UNMET_CAUSES = [
  /**
   * The run's horizon closed before the buyer's window did.
   *
   * The run now keeps going for a settlement window after buyers stop
   * ordering, long enough for the latest deadline the ordering window can
   * produce, so on the hero scenario this stays at zero because every order
   * raised is followed through rather than because late orders are withheld.
   * It is kept as a guard: a scenario with a shorter settlement window, an
   * injected effect or a future demand source could reintroduce one, and
   * letting such an order fall through to `MISSION_LATE` would read as a
   * coordination failure that never happened.
   */
  'HORIZON_TRUNCATED',
  /** Nothing was promised: no batch had evidence recent enough to commit against. */
  'NO_READY_SUPPLY',
  /**
   * Supply existed on another in-scope island, and the reviewed dataset records
   * no published sailing that could bring it over.
   *
   * The point of recording this separately is that it is not a coordination
   * failure. Harvest looked, found crop, and had nowhere to put it on a boat.
   * Collapsing it into `NO_READY_SUPPLY` would say no supply existed, and
   * collapsing it into `INSUFFICIENT_SUPPLY` would say the promise was too
   * small; both would hide the fact that the missing thing was a route, and
   * issue #40 is explicit that a missing route must never be invented.
   */
  'NO_PUBLIC_ROUTE',
  /** A human approval gate declined the promise. */
  'APPROVAL_REJECTED',
  /**
   * A cross-island consignment was approved, sailed, and did not arrive.
   *
   * Distinct from `SPOILED_BEFORE_PICKUP` because nothing rotted: the crop was
   * picked, put on a boat and lost. Scoring it as spoilage would blame the
   * field for a transport failure.
   */
  'SHIPMENT_FAILED',
  /** Nothing reached the buyer in time: the delivery arrived late or never ran. */
  'MISSION_LATE',
  /**
   * The vehicle went, but the crop it was promised from had still not been
   * reported ready when it left, so there was nothing to pick.
   *
   * Distinct from spoilage: nothing was lost, the promise was simply dated
   * ahead of the field. This is the way a forward promise fails.
   */
  'NOT_READY_IN_TIME',
  /** The vehicle arrived, but the field no longer held what had been promised. */
  'SPOILED_BEFORE_PICKUP',
  /** The load arrived and part of it was refused at the gate. */
  'DELIVERY_REJECTED',
  /** Everything promised was delivered and accepted; the promise was too small. */
  'INSUFFICIENT_SUPPLY',
] as const;

export type UnmetCause = (typeof UNMET_CAUSES)[number];

/** Rounding slack when comparing kilogram figures for a cause. */
const CAUSE_TOLERANCE_KG = 0.5;

function emptyCauseCounts(): Record<UnmetCause, number> {
  return Object.fromEntries(UNMET_CAUSES.map((cause) => [cause, 0])) as Record<UnmetCause, number>;
}

/** Mirrors `BenchmarkMetrics` in contracts/openapi.yaml, plus run diagnostics. */
export interface RunMetrics {
  /** Share of demanded kilograms met from local farms, in [0, 1]. */
  localProcurementRate: number;
  /** Share of demands fully met by their deadline, in [0, 1]. */
  fulfilmentRate: number;
  /** Kilograms lost to spoilage or rejection. */
  wasteQuantity: { value: number; unit: 'kg' };
  // Diagnostics below are not part of the contract schema; they explain the
  // headline numbers rather than replacing them.
  totalDemandedKg: number;
  totalAcceptedKg: number;
  totalSubstitutedKg: number;
  totalPromisedKg: number;
  commitmentsProposed: number;
  commitmentsApproved: number;
  commitmentsDelivered: number;
  demandsFullyMet: number;
  demandsPartiallyMet: number;
  demandsUnmet: number;
  missionsCompleted: number;
  missionsCancelled: number;
  /** Times the policy asked a grower to go and look. Zero for the baseline. */
  observationRequests: number;
  /**
   * One cause per demand that ended unmet or partially met, so the headline
   * rate can be read against where the workflow actually broke. Sums to
   * `demandsUnmet + demandsPartiallyMet`.
   */
  causeCounts: Record<UnmetCause, number>;
  eventsProcessed: number;
  /**
   * What the realised weather did to this run.
   *
   * Recorded because "different weather changes the outcome" is an acceptance
   * criterion, and a criterion nobody can measure is a claim rather than a
   * result. Every figure here is a *counterfactual against the same run with
   * mild weather*, not a share of the total, so a run whose weather did nothing
   * reports zeros.
   */
  weather: WeatherEffectMetrics;
  /**
   * What the maritime layer did. All zeros for a one-island run, which is the
   * point: a run with no scoped links cannot produce a shipment.
   */
  maritime: MaritimeEffectMetrics;
}

export interface MaritimeEffectMetrics {
  /** Published links available to this run after scoping. Zero for one island. */
  scopedLinks: number;
  /** Ports on in-scope islands. */
  scopedPorts: number;
  shipmentsProposed: number;
  shipmentsApproved: number;
  shipmentsDelivered: number;
  shipmentsFailed: number;
  shippedKg: number;
  /** Sailings the realised weather lengthened. */
  weatherDelayedSailings: number;
  /** Sailings the synthetic checkpoint inspected rather than waving through. */
  customsInspections: number;
  /** Total synthetic freight and clearance cost, in XCD. */
  totalCostXcd: number;
  /** Demands that needed a route the scoped dataset does not record. */
  demandsWithoutPublicRoute: number;
}

export interface WeatherEffectMetrics {
  /** Island-days realised as RAIN or STORM. */
  wetDays: number;
  /** Island-days realised as STORM, a subset of `wetDays`. */
  stormDays: number;
  /** Total ripening pushed back across every batch, in days. */
  readinessDelayDays: number;
  /** Marketable fraction taken off batches by wet weather, summed across batches. */
  qualityLost: number;
  /** Kilograms of the run's waste that the weather multiplier added. */
  weatherSpoilageKg: number;
  /** Missions that left into rain or a storm and were slowed by it. */
  weatherDelayedMissions: number;
}

export interface RunResult {
  runId: string;
  scenarioId: string;
  policy: PolicyName;
  seed: number;
  status: RunStatus;
  startedAt: string;
  endedAt: string;
  metrics: RunMetrics;
  /** Stable hash of the final world, hidden truth included. Determinism check. */
  digest: string;
  decisions: DecisionRecord[];
  /** Repeated on every result so no consumer can mistake this for measured impact. */
  evidenceLabel: string;
  provenanceNote: string;
  /** Present only when `captureFrames` was set. */
  timeline?: ReplayTimeline;
}

const EVIDENCE_LABEL =
  'SYNTHETIC SIMULATED COUNTERFACTUAL. Produced by a seeded simulation, not measured from a deployed ' +
  'system. Not evidence of real-world impact.';

/** Above this daily rainfall a rain-sensitive road is treated as degraded. */
const HEAVY_RAIN_MM = 45;

// --------------------------------------------------------------------------
// Weather levers that belong to coordination rather than to physics.
//
// The physical rules — how rain slows ripening, how a storm rots a ready crop,
// how wet tarmac slows a van — live in `world/weather.ts` beside the weather
// they act on. What stays here is the one lever that reads a *forecast*, which
// is a scheduling decision and not a fact about the world.
// --------------------------------------------------------------------------

/**
 * How far ahead a forecast storm pulls a pickup forward, and how little of the
 * ready-hold window survives when one is coming.
 *
 * This reads the forecast, which may be wrong, and it only ever brings a
 * collection forward inside the bounds the deadline already sets, so acting on
 * a forecast that misses costs a slightly early pickup rather than a broken
 * promise.
 */
const STORM_FORECAST_WINDOW_DAYS = 2;
const STORM_FORECAST_HOLD_MS = 2 * HOUR_MS;

/**
 * How long a buyer waits past the deadline before sourcing elsewhere.
 *
 * It is also the tail the run has to be able to watch: a demand settles at
 * `neededBy + SUBSTITUTION_GRACE_MS`, so a deadline leaving less than the grace
 * before the horizon has no settlement event to reach.
 *
 * Exported so `tests/fulfilment.test.ts` can assert the generation guard
 * against the real constant rather than a copy of it that could drift.
 */
export const SUBSTITUTION_GRACE_MS = 12 * HOUR_MS;

/** Maximum extra journey time produced by the hidden severity of a storm. */
const MAX_STORM_TRAVEL_DELAY_MS = 4 * HOUR_MS;

/** Maximum share of an unharvested crop that one crop incident can destroy. */
const MAX_CROP_DAMAGE_FRACTION = 0.3;

/**
 * How often a connected run looks for supply on another island.
 *
 * Once a day rather than on every order, because a sailing is a slow, lumpy
 * decision and re-asking hourly would fill the trace with the same answer.
 */
const INTER_ISLAND_REVIEW_INTERVAL_MS = DAY_MS;

/**
 * Provenance labels carried by everything the maritime layer emits.
 *
 * Two labels rather than one, because a shipment record mixes two kinds of
 * claim: the port, the link and the exchange rate are cited public references,
 * while the schedule, the capacity, the price, the customs behaviour and the
 * outcome are invented. A consumer that receives one label for the whole record
 * cannot tell them apart, so both travel together.
 */
const MARITIME_NETWORK_PROVENANCE = 'PUBLIC_REFERENCE' as const;
const MARITIME_OPERATIONS_PROVENANCE = 'SYNTHETIC' as const;

interface DisruptionRuntime {
  disruption: ScheduledDisruption;
  active: boolean;
}

export class SimulationEngine {
  readonly runId: string;
  readonly scenario: Scenario;
  readonly policy: CoordinationPolicy;
  readonly seed: number;

  private readonly random: RandomSource;
  private readonly ids: IdFactory;
  private readonly queue = new EventQueue();
  private readonly world: World;
  private readonly decisions: DecisionRecord[] = [];
  private readonly disruptionRuntimes = new Map<string, DisruptionRuntime>();
  private readonly maxEvents: number;
  /** Farm id to the instant its outstanding observation request will land. */
  private readonly pendingObservationRequests = new Map<string, SimulationInstant>();
  /** How many times planning has been retried for a demand, to bound replanning. */
  private readonly planAttempts = new Map<string, number>();
  /** How many times newly reported supply has re-triggered planning for a demand. */
  private readonly rematchAttempts = new Map<string, number>();
  /** Why a demand ended short, recorded as it settles. */
  private readonly demandCauses = new Map<string, UnmetCause>();
  /** Readiness already lost to weather per batch, so the cap is a total and not a per-day one. */
  private readonly weatherReadinessDelayMs = new Map<string, number>();
  /** Marketable fraction the weather has taken off batches, summed across the run. */
  private weatherQualityLost = 0;
  /** Kilograms of spoilage the weather multiplier added over mild-weather decay. */
  private weatherSpoilageKg = 0;
  /** Missions whose journey the departure-day weather lengthened. */
  private weatherDelayedMissions = 0;
  /**
   * Demands for which supply existed on another in-scope island and the
   * reviewed dataset recorded no published sailing to bring it over.
   *
   * Recorded at planning time rather than derived at settlement, because by the
   * time a demand settles the batches that were ready on the other island may
   * have been picked and the evidence for the missing route would be gone.
   */
  private readonly noPublicRouteDemands = new Set<string>();
  private shipmentsProposed = 0;
  private shipmentsApproved = 0;
  private shipmentsDelivered = 0;
  private shipmentsFailed = 0;
  private weatherDelayedSailings = 0;
  private customsInspections = 0;
  /** Which of a commitment's allocations travel by sea, decided once at proposal time. */
  private readonly seaBatchIdsByCommitment = new Map<string, string[]>();
  /**
   * Cross-island fills waiting on a human decision, in connected mode.
   *
   * Held here rather than in the observed world because they are not yet part
   * of the world: no commitment, no mission, no shipment. A proposal that is
   * never approved leaves no trace beyond the decision record that says it was
   * asked for and refused.
   */
  private readonly interIslandProposals = new Map<string, { view: InterIslandProposalView; fill: InterIslandFill }>();
  /** Demands an inter-island fill has already been proposed for, so review does not loop. */
  private readonly interIslandProposedDemandIds = new Set<string>();
  /**
   * Whether each booked sailing is going to fail, drawn once when it is booked.
   *
   * Kept beside the shipment rather than on it, because it is hidden truth in
   * exactly the sense a scheduled disruption is: the run knows, and nothing
   * facing a participant may.
   */
  private readonly sailingFailures = new Map<string, boolean>();
  /** Batch to island, memoised: every weather effect needs it and the mapping is static. */
  private readonly islandByBatchId = new Map<string, string>();
  private observationRequestCount = 0;
  private readonly captureFrames: boolean;
  private readonly coordinationMode: CoordinationMode;
  private readonly frames: ControlRoomFrame[] = [];
  /** How many decisions had been recorded when the previous frame was taken. */
  private decisionsAtLastFrame = 0;
  private readonly appliedProductEventIds = new Set<string>();
  private lastProductCursor = 0n;
  private readonly productDemandOutcomes = new Map<string, BuyerDemand['status']>();
  private readonly commitmentByDemandId = new Map<string, string>();
  private readonly missionByProductId = new Map<string, string>();
  /** Safe causal facts for the Product bridge; severity and other truth stay private. */
  private readonly disruptionMissionImpacts: DisruptionMissionImpact[] = [];
  private readonly disruptionMissionImpactKeys = new Set<string>();
  private settled = false;

  private clock: SimulationInstant;
  private readonly startsAt: SimulationInstant;
  /** Last instant a buyer may raise an order. The ordering window closes here. */
  private readonly demandEndsAt: SimulationInstant;
  /** Last instant of the run, ordering window plus settlement window. */
  private readonly endsAt: SimulationInstant;
  private status: RunStatus = 'READY';
  private eventsProcessed = 0;
  private totalPromisedKg = 0;
  private commitmentsProposed = 0;
  private commitmentsApproved = 0;
  private commitmentsDelivered = 0;
  private missionsCompleted = 0;
  private missionsCancelled = 0;

  constructor(options: EngineOptions) {
    this.scenario = requireScenario(options.scenarioId);
    this.policy = options.policy === 'HARVEST' ? harvestPolicy : baselinePolicy;
    this.seed = options.seed;
    this.maxEvents = options.maxEvents ?? 250_000;
    this.captureFrames = options.captureFrames ?? false;
    this.coordinationMode = options.coordinationMode ?? 'INTERNAL_POLICY';

    this.random = new RandomSource(options.seed);
    // Identifiers come from their own stream so that adding an entity does not
    // shift weather or yield draws.
    this.ids = new IdFactory(this.random.stream('ids'));

    this.startsAt = parseInstant(this.scenario.startsAtIso);
    // Two horizons, not one. Buyers order until `demandEndsAt`; the run keeps
    // running to `endsAt` so the last orders raised can be delivered, settled
    // and scored inside the window they were given.
    this.demandEndsAt = this.startsAt + this.scenario.durationDays * DAY_MS;
    this.endsAt = this.demandEndsAt + this.scenario.settlementDays * DAY_MS;
    this.clock = this.startsAt;

    // Always consume the deterministic id draw. The Product API may replace
    // the public/storage identity, but doing so must not shift entity ids or
    // any other seeded output inside the run.
    const deterministicRunId = this.ids.next();
    this.runId = options.runId ?? deterministicRunId;

    this.world = this.scenario.build({ random: this.random, ids: this.ids, startsAt: this.startsAt, islandIds: options.islandIds });

    // Injected disruptions join the scenario's own before anything is
    // scheduled, so they are indistinguishable from generated ones once the run
    // begins. Severity comes from a seeded stream rather than the caller, to
    // keep the outcome out of the hands of whoever is driving the demo.
    if (options.injectedDisruptions?.length) {
      const injectionStream = this.random.stream('injected:disruptions');
      for (const injected of options.injectedDisruptions) {
        const startsAt = this.startsAt + injected.offsetMs;
        if (startsAt >= this.endsAt) continue;
        this.world.truth.disruptions.push({
          disruptionId: this.ids.next(),
          type: injected.type,
          startsAt,
          endsAt: Math.min(this.endsAt, startsAt + Math.max(HOUR_MS, injected.durationMs)),
          affectedEntityIds: [...injected.affectedEntityIds],
          severity: Number(injectionStream.float(0.4, 0.95).toFixed(3)),
          publicDescription: injected.publicDescription,
        });
      }
      this.world.truth.disruptions.sort((a, b) => a.startsAt - b.startsAt);
    }

    for (const disruption of this.world.truth.disruptions) {
      this.disruptionRuntimes.set(disruption.disruptionId, { disruption, active: false });
    }

    this.seedInitialEvents();
  }

  get currentTime(): SimulationInstant {
    return this.clock;
  }

  get observableWorld(): ObservableWorldView {
    const view = toObservableWorld(this.runId, this.clock, this.world);
    // Belt and braces: the projection is built from an allow-list, and this
    // asserts the allow-list was not widened by accident.
    assertNoTruthLeak(view, 'observable world projection');
    return view;
  }

  /** Static, observable scene used to bootstrap Product API participants. */
  get controlRoomScene(): ControlRoomScene {
    return this.buildScene();
  }

  /**
   * Cross-island consignments as a replay frame would carry them.
   *
   * The connected bridge needs the legs and the customs checkpoint to store a
   * Product API record, and it must be the *same* projection a replay frame
   * uses or the two would be able to disagree. Sharing the builder is what
   * makes "the Product record and the replay frame agree" a property rather
   * than a coincidence.
   */
  get observableShipments(): ControlRoomShipment[] {
    return this.createShipmentFrame();
  }

  /** Scenario horizon for deterministic day stepping. */
  get horizon(): { startsAt: SimulationInstant; demandEndsAt: SimulationInstant; endsAt: SimulationInstant } {
    return { startsAt: this.startsAt, demandEndsAt: this.demandEndsAt, endsAt: this.endsAt };
  }

  /** Next queued physical instant, or null once only horizon settlement remains. */
  get nextEventAt(): SimulationInstant | null {
    return this.queue.peek()?.at ?? null;
  }

  /**
   * Missions whose physical schedule was changed by an observed disruption.
   *
   * This is intentionally narrower than hidden disruption truth. The connected
   * Product API uses it to report a delivery exception only after the engine
   * has established a real causal effect.
   */
  get observedDisruptionMissionImpacts(): readonly DisruptionMissionImpact[] {
    return this.disruptionMissionImpacts.map((impact) => ({ ...impact }));
  }

  // ------------------------------------------------------------------
  // Scheduling
  // ------------------------------------------------------------------

  private schedule(at: SimulationInstant, type: string, priority: Priority, payload: unknown): void {
    // Never schedule beyond the horizon: the run would pop events it has no
    // intention of honouring and the queue would never drain.
    if (at > this.endsAt) return;
    this.queue.push({ at, type, priority, payload }, this.clock);
  }

  private seedInitialEvents(): void {
    // Daily world tick: weather, crop advance, spoilage.
    this.schedule(this.startsAt, 'WORLD_TICK', Priority.World, {});

    // Farmer observations. A diligent grower reports every couple of days; a
    // distracted one may go a fortnight. This is the source of the uncertainty
    // both policies have to cope with.
    const observationStream = this.random.stream('actors:observations');
    for (const farm of [...this.world.farms.values()].sort((a, b) => a.farmId.localeCompare(b.farmId))) {
      const intervalDays = 2 + (1 - farm.diligence) * 12;
      const firstOffset = observationStream.float(0, intervalDays) * DAY_MS;
      this.schedule(this.startsAt + firstOffset, 'FARMER_OBSERVATION', Priority.Actor, { farmId: farm.farmId });
    }

    // Buyer demand, recurring through the run.
    const demandStream = this.random.stream('actors:demand');
    for (const buyer of [...this.world.buyers.values()].sort((a, b) => a.buyerId.localeCompare(b.buyerId))) {
      const firstOffset = demandStream.int(0, 3) * DAY_MS + demandStream.int(6, 10) * HOUR_MS;
      this.schedule(this.startsAt + firstOffset, 'BUYER_DEMAND', Priority.Actor, { buyerId: buyer.buyerId });
    }

    // In connected mode the Product API owns local matching, so the regional
    // decision needs an occasion of its own. Scheduled only when the scoped
    // network actually has a sailing to offer, which is why a one-island run
    // gains no event, processes no extra work, and is bit-for-bit unchanged.
    if (this.coordinationMode === 'EXTERNAL_PRODUCT_API' && this.world.maritime.links.length > 0) {
      this.schedule(this.startsAt + INTER_ISLAND_REVIEW_INTERVAL_MS, 'INTER_ISLAND_REVIEW', Priority.Actor, {});
    }

    // Disruptions become observable when they start, not before.
    for (const disruption of this.world.truth.disruptions) {
      this.schedule(disruption.startsAt, 'DISRUPTION_START', Priority.World, { disruptionId: disruption.disruptionId });
      this.schedule(disruption.endsAt, 'DISRUPTION_END', Priority.World, { disruptionId: disruption.disruptionId });
    }
  }

  // ------------------------------------------------------------------
  // Main loop
  // ------------------------------------------------------------------

  run(): RunResult {
    this.start();
    return this.finish();
  }

  /** Starts a stepped run without consuming the future queue. */
  start(): void {
    if (this.status === 'READY') this.status = 'RUNNING';
    if (this.status !== 'RUNNING') throw new Error(`Cannot start a simulation in ${this.status} state.`);
  }

  /**
   * Processes every physical event through `targetAt`, returning only the new
   * observable frames. External callers can then execute one Product API cycle
   * before advancing into the next day.
   */
  advanceTo(targetAt: SimulationInstant): ControlRoomFrame[] {
    this.start();
    if (!Number.isFinite(targetAt)) throw new RangeError('Simulation target time must be finite.');
    if (targetAt < this.clock) throw new RangeError('Simulation time cannot move backwards.');
    const target = Math.min(targetAt, this.endsAt);
    const frameStart = this.frames.length;

    try {
      while (!this.queue.isEmpty && (this.queue.peek() as ScheduledEvent).at <= target) {
        const event = this.queue.pop() as ScheduledEvent;
        this.eventsProcessed += 1;
        if (this.eventsProcessed > this.maxEvents) {
          throw new Error(
            `Run exceeded ${this.maxEvents} events, which means a handler is scheduling faster than the clock advances.`,
          );
        }
        this.clock = Math.max(this.clock, event.at);
        this.handle(event);
        if (this.captureFrames) this.recordFrame(event.type);
      }
      this.clock = Math.max(this.clock, target);
    } catch (error) {
      this.status = 'FAILED';
      throw error;
    }

    return this.frames.slice(frameStart);
  }

  /** Adds a safe replay checkpoint after one external Product API cycle. */
  checkpoint(
    eventType: string,
    agentActions: SimulationAgentAction[] = [],
    operationsSnapshot?: SimulationOperationsSnapshot,
  ): ControlRoomFrame {
    if (this.status !== 'RUNNING') throw new Error(`Cannot checkpoint a simulation in ${this.status} state.`);
    const frame = this.createFrame(eventType);
    if (agentActions.length) frame.agentActions = structuredClone(agentActions);
    if (operationsSnapshot) frame.operationsSnapshot = structuredClone(operationsSnapshot);
    if (this.captureFrames) this.frames.push(frame);
    return frame;
  }

  /** Completes a stepped run at the horizon. */
  finish(): RunResult {
    if (this.status === 'COMPLETED') return this.result();
    this.advanceTo(this.endsAt);
    if (!this.settled) {
      this.settleOutstandingDemand();
      this.settled = true;
      if (this.captureFrames) this.recordFrame('RUN_SETTLED');
    }
    this.status = 'COMPLETED';
    return this.result();
  }

  private handle(event: ScheduledEvent): void {
    switch (event.type) {
      case 'WORLD_TICK':
        return this.onWorldTick();
      case 'FARMER_OBSERVATION':
        return this.onFarmerObservation((event.payload as { farmId: string }).farmId);
      case 'BUYER_DEMAND':
        return this.onBuyerDemand((event.payload as { buyerId: string }).buyerId);
      case 'PLAN_ALLOCATION':
        return this.onPlanAllocation((event.payload as { demandId: string }).demandId);
      case 'APPROVAL_GATE':
        return this.onApprovalGate((event.payload as { commitmentId: string }).commitmentId);
      case 'MISSION_DEPART':
        return this.onMissionDepart((event.payload as { missionId: string }).missionId);
      case 'MISSION_ARRIVE':
        return this.onMissionArrive((event.payload as { missionId: string }).missionId);
      case 'SHIPMENT_SAIL':
        return this.onShipmentSail((event.payload as { missionId: string }).missionId);
      case 'SHIPMENT_CLEAR':
        return this.onShipmentClear((event.payload as { missionId: string }).missionId);
      case 'INTER_ISLAND_REVIEW':
        return this.onInterIslandReview();
      case 'DISRUPTION_START':
        return this.onDisruptionStart((event.payload as { disruptionId: string }).disruptionId);
      case 'DISRUPTION_END':
        return this.onDisruptionEnd((event.payload as { disruptionId: string }).disruptionId);
      case 'DEMAND_DEADLINE':
        return this.onDemandDeadline((event.payload as { demandId: string }).demandId);
      default:
        throw new Error(`No handler for event type '${event.type}'.`);
    }
  }

  // ------------------------------------------------------------------
  // World handlers: physical reality, driven by hidden truth
  // ------------------------------------------------------------------

  private onWorldTick(): void {
    const today = formatDate(this.clock);
    const stormSeverity = Math.max(
      0,
      ...[...this.disruptionRuntimes.values()]
        .filter((runtime) => runtime.active && runtime.disruption.type === 'WEATHER')
        .map((runtime) => runtime.disruption.severity),
    );

    // Rain degrades sensitive roads, and a storm takes out roads that ordinary
    // rain would not. This is observable: a driver can see a flooded road, so
    // it is allowed to reach the observed world.
    for (const road of this.world.roads.values()) {
      const weather = this.realisedWeatherToday(road.islandId, today);
      if (weatherDegradesRoad(weather, road.rainSensitivity, HEAVY_RAIN_MM)) {
        this.world.observed.degradedRoadSegmentIds.add(road.roadSegmentId);
      } else if (!this.isRoadDisrupted(road.roadSegmentId)) {
        this.world.observed.degradedRoadSegmentIds.delete(road.roadSegmentId);
      }
    }

    // Advance crop truth. Stage changes are physical; nobody has to see them.
    for (const crop of this.world.truth.crops.values()) {
      if (crop.stage === 'HARVESTED' || crop.stage === 'SPOILED') continue;

      const weather = this.realisedWeatherToday(this.islandForBatch(crop.batchId), today);

      // Ripening slows in the wet. Applied before the stage branch below, so a
      // batch that would have tipped into READY today stays MATURING for the
      // whole tick rather than being ready and delayed in the same breath.
      if (this.clock < crop.readyAt && isWetDay(weather)) {
        const alreadySlipped = this.weatherReadinessDelayMs.get(crop.batchId) ?? 0;
        const slipMs = Math.min(readinessDelayMs(weather), MAX_WEATHER_READINESS_DELAY_MS - alreadySlipped);
        if (slipMs > 0) {
          crop.readyAt += slipMs;
          this.weatherReadinessDelayMs.set(crop.batchId, alreadySlipped + slipMs);
        }
      }

      // Wet weather costs marketable grade whether the batch is standing ready
      // or still growing: split and blemished fruit is refused at the gate.
      const gradeLost = qualityLoss(weather);
      if (gradeLost > 0) {
        const before = crop.qualityFraction;
        crop.qualityFraction = Math.max(MINIMUM_QUALITY_FRACTION, Number((crop.qualityFraction - gradeLost).toFixed(6)));
        this.weatherQualityLost += before - crop.qualityFraction;
      }

      if (this.clock >= crop.readyAt) {
        if (crop.stage !== 'READY') crop.stage = 'READY';

        // Spoilage runs from readiness, whether or not anyone noticed. This is
        // the loss Harvest is trying to avoid, so it must not depend on being
        // observed.
        const daysReady = Math.max(0, (this.clock - crop.readyAt) / DAY_MS);
        if (daysReady > 0) {
          const remaining = Math.max(0, crop.potentialYieldKg - crop.harvestedKg - crop.lostKg);
          // A visible storm accelerates deterioration, but multiple overlapping
          // fronts do not compound into an implausible exponential penalty.
          // The strongest active seeded severity sets the multiplier.
          const withoutWeather = Math.min(remaining, remaining * crop.dailySpoilageRate * (1 + stormSeverity));
          const lostToday = Math.min(
            remaining,
            remaining * crop.dailySpoilageRate * (1 + stormSeverity) * spoilageMultiplier(weather),
          );
          crop.lostKg += lostToday;
          this.weatherSpoilageKg += lostToday - withoutWeather;

          if (crop.potentialYieldKg - crop.harvestedKg - crop.lostKg <= 0.5) {
            crop.stage = 'SPOILED';
            const batch = this.world.observed.batches.get(crop.batchId);
            if (batch) batch.lastReportedStage = 'SPOILED';
          }
        }
      } else if (this.clock >= crop.readyAt - 7 * DAY_MS) {
        crop.stage = 'MATURING';
      } else {
        crop.stage = 'GROWING';
      }
    }

    this.schedule(this.clock + DAY_MS, 'WORLD_TICK', Priority.World, {});
  }

  // ------------------------------------------------------------------
  // Weather
  // ------------------------------------------------------------------

  /**
   * Realised weather for an island on a date, for the engine's own use.
   *
   * Physics may read the day it is simulating; nothing facing a participant
   * may. `observableWeather` below is the boundary that enforces the second
   * half of that sentence, and it is the only weather a policy, a replay frame
   * or the Product API ever receives.
   */
  private realisedWeatherToday(islandId: string | null, date: string): RealisedWeather | null {
    if (!islandId) return null;
    return this.world.truth.weather.truthOn(islandId, date);
  }

  private islandForBatch(batchId: string): string | null {
    const cached = this.islandByBatchId.get(batchId);
    if (cached !== undefined) return cached;
    const farmId = this.world.observed.batches.get(batchId)?.farmId;
    const islandId = farmId ? this.world.farms.get(farmId)?.islandId : undefined;
    if (islandId === undefined) return null;
    this.islandByBatchId.set(batchId, islandId);
    return islandId;
  }

  /** The island a mission is working on, taken from where it is picking up. */
  private islandForMission(mission: DeliveryMission): string | null {
    const commitment = this.world.observed.commitments.get(mission.commitmentId);
    const farmId = commitment?.allocations[0]?.farmId;
    return farmId ? this.world.farms.get(farmId)?.islandId ?? null : null;
  }

  /**
   * The weather any observer may have: realised days that have occurred, and
   * forecasts for the ones that have not.
   *
   * Public because the connected Product API writes exactly this into run-scoped
   * storage each frame, so a human on the website and a simulated participant
   * read the same numbers from the same place rather than from two models that
   * agree until they do not.
   */
  get observableWeather(): ObservableWeatherAccess {
    const model = this.world.truth.weather;
    const asOf = () => formatDate(this.clock);
    return {
      current: (islandId) => model.realisedUpTo(islandId, asOf(), asOf()),
      realisedOn: (islandId, date) => model.realisedUpTo(islandId, date, asOf()),
      forecast: (islandId) => model.forecastIssuedOn(islandId, asOf()),
    };
  }

  /**
   * The realised weather's effect on this run, counted rather than asserted.
   *
   * `wetDays` walks the whole realised series up to the clock rather than only
   * the days something happened on, because a run in which every batch was
   * already harvested before a wet week still had a wet week.
   */
  private weatherEffectMetrics(): WeatherEffectMetrics {
    let wetDays = 0;
    let stormDays = 0;
    const today = formatDate(this.clock);
    for (const islandId of this.weatherIslandIds) {
      for (const date of this.world.truth.weather.dates) {
        if (date > today) break;
        const reading = this.world.truth.weather.truthOn(islandId, date);
        if (!reading) continue;
        if (reading.condition === 'STORM') stormDays += 1;
        if (isWetDay(reading)) wetDays += 1;
      }
    }
    const delayMs = [...this.weatherReadinessDelayMs.values()].reduce((total, value) => total + value, 0);
    return {
      wetDays,
      stormDays,
      readinessDelayDays: Number((delayMs / DAY_MS).toFixed(3)),
      qualityLost: Number(this.weatherQualityLost.toFixed(6)),
      weatherSpoilageKg: Number(this.weatherSpoilageKg.toFixed(2)),
      weatherDelayedMissions: this.weatherDelayedMissions,
    };
  }

  /** Islands this run actually covers, sorted, so weather publication is bounded. */
  get weatherIslandIds(): readonly string[] {
    return [...new Set([...this.world.farms.values()].map((farm) => farm.islandId))].sort();
  }

  private isRoadDisrupted(roadSegmentId: string): boolean {
    for (const runtime of this.disruptionRuntimes.values()) {
      if (runtime.active && runtime.disruption.type === 'ROAD' && runtime.disruption.affectedEntityIds.includes(roadSegmentId)) {
        return true;
      }
    }
    return false;
  }

  private recordDisruptionMissionImpact(disruptionId: string, missionId: string): void {
    const key = `${disruptionId}:${missionId}`;
    if (this.disruptionMissionImpactKeys.has(key)) return;
    this.disruptionMissionImpactKeys.add(key);
    this.disruptionMissionImpacts.push({ disruptionId, missionId });
  }

  private missionUsesAffectedRoad(mission: DeliveryMission, disruption: ScheduledDisruption): boolean {
    const affected = new Set(disruption.affectedEntityIds);
    const commitment = this.world.observed.commitments.get(mission.commitmentId);
    if (!commitment) return false;
    return commitment.allocations.some((allocation) => {
      const farm = this.world.farms.get(allocation.farmId);
      return farm ? affected.has(farm.roadSegmentId) : false;
    });
  }

  private replaceMissionSchedule(mission: DeliveryMission, includeDeparture: boolean): void {
    this.queue.removeWhere((event) => {
      const queuedMissionId = (event.payload as { missionId?: string }).missionId;
      return queuedMissionId === mission.missionId &&
        (event.type === 'MISSION_ARRIVE' || (includeDeparture && event.type === 'MISSION_DEPART'));
    });
    if (includeDeparture) {
      this.schedule(mission.plannedDepartureAt, 'MISSION_DEPART', Priority.Actor, { missionId: mission.missionId });
    }
    this.schedule(mission.plannedArrivalAt, 'MISSION_ARRIVE', Priority.World, { missionId: mission.missionId });
  }

  private postponeMissionUntil(
    mission: DeliveryMission,
    availableAt: SimulationInstant,
    disruptionId: string,
  ): boolean {
    if (mission.status === 'COMPLETED' || mission.status === 'CANCELLED' || mission.plannedArrivalAt <= this.clock) {
      return false;
    }
    // A flooded farm track does not reschedule a scheduled ferry, and the sea
    // leg already carries its own weather effect. Postponing a sailing here
    // would also leave its customs event on the old instant, which is a wrong
    // itinerary rather than a delayed one.
    if (mission.mode === 'MARITIME') return false;

    if (mission.plannedDepartureAt >= this.clock) {
      if (mission.plannedDepartureAt >= availableAt) return false;
      const delayMs = availableAt - mission.plannedDepartureAt;
      mission.plannedDepartureAt = availableAt;
      mission.plannedArrivalAt += delayMs;
      this.replaceMissionSchedule(mission, true);
    } else {
      const delayedArrival = Math.max(mission.plannedArrivalAt, availableAt);
      if (delayedArrival <= mission.plannedArrivalAt) return false;
      mission.plannedArrivalAt = delayedArrival;
      mission.status = 'DELAYED';
      this.replaceMissionSchedule(mission, false);
    }

    this.recordDisruptionMissionImpact(disruptionId, mission.missionId);
    return true;
  }

  private slowMission(
    mission: DeliveryMission,
    delayMs: number,
    disruptionId: string,
  ): boolean {
    if (
      delayMs <= 0 ||
      mission.status === 'COMPLETED' ||
      mission.status === 'CANCELLED' ||
      mission.plannedArrivalAt <= this.clock
    ) {
      return false;
    }
    mission.plannedArrivalAt += delayMs;
    if (mission.plannedDepartureAt < this.clock) mission.status = 'DELAYED';
    this.replaceMissionSchedule(mission, false);
    this.recordDisruptionMissionImpact(disruptionId, mission.missionId);
    return true;
  }

  private applyDisruptionToMission(runtime: DisruptionRuntime, mission: DeliveryMission): boolean {
    const { disruption } = runtime;
    if (mission.plannedDepartureAt >= disruption.endsAt || mission.plannedArrivalAt <= disruption.startsAt) {
      return false;
    }

    switch (disruption.type) {
      case 'ROAD':
        return this.missionUsesAffectedRoad(mission, disruption)
          ? this.postponeMissionUntil(mission, disruption.endsAt, disruption.disruptionId)
          : false;
      case 'VEHICLE':
        return disruption.affectedEntityIds.includes(mission.transporterId)
          ? this.postponeMissionUntil(mission, disruption.endsAt, disruption.disruptionId)
          : false;
      case 'WEATHER':
        return this.slowMission(
          mission,
          Math.round(disruption.severity * MAX_STORM_TRAVEL_DELAY_MS),
          disruption.disruptionId,
        );
      case 'CROP':
      case 'DEMAND':
        return false;
    }
  }

  private applyActiveDisruptionsToMission(mission: DeliveryMission): void {
    for (const runtime of [...this.disruptionRuntimes.values()].sort((left, right) =>
      left.disruption.disruptionId.localeCompare(right.disruption.disruptionId))) {
      if (!runtime.active) continue;
      this.applyDisruptionToMission(runtime, mission);
    }
  }

  private applyCropDamage(disruption: ScheduledDisruption): void {
    const affected = new Set(disruption.affectedEntityIds);
    for (const batch of [...this.world.observed.batches.values()].sort((left, right) =>
      left.batchId.localeCompare(right.batchId))) {
      if (!affected.has(batch.farmId) && !affected.has(batch.batchId)) continue;
      const crop = this.world.truth.crops.get(batch.batchId);
      if (!crop || crop.stage === 'HARVESTED' || crop.stage === 'SPOILED') continue;
      const remaining = Math.max(0, crop.potentialYieldKg - crop.harvestedKg - crop.lostKg);
      crop.lostKg += remaining * disruption.severity * MAX_CROP_DAMAGE_FRACTION;
      if (crop.potentialYieldKg - crop.harvestedKg - crop.lostKg <= 0.5) crop.stage = 'SPOILED';
    }
  }

  private onDisruptionStart(disruptionId: string): void {
    const runtime = this.disruptionRuntimes.get(disruptionId);
    if (!runtime) return;
    runtime.active = true;

    // Only now does it become observable, and only its description — never its
    // severity, which stays hidden truth.
    this.world.observed.disruptions.push({
      disruptionId,
      type: runtime.disruption.type,
      description: runtime.disruption.publicDescription,
      observedAt: this.clock,
      affectedEntityIds: [...runtime.disruption.affectedEntityIds],
    });

    if (runtime.disruption.type === 'ROAD') {
      for (const roadSegmentId of runtime.disruption.affectedEntityIds) {
        this.world.observed.degradedRoadSegmentIds.add(roadSegmentId);
      }
    }

    if (runtime.disruption.type === 'CROP') this.applyCropDamage(runtime.disruption);

    for (const mission of [...this.world.observed.missions.values()].sort((left, right) =>
      left.missionId.localeCompare(right.missionId))) {
      this.applyDisruptionToMission(runtime, mission);
    }

    const observed = this.world.observed.disruptions.at(-1);
    if (!observed) return;

    // Connected Harvest runs hand the visible disruption to Product API
    // participants. The physical engine must not independently choose a
    // recovery as well, or two coordinators would reschedule the same mission.
    if (this.coordinationMode === 'EXTERNAL_PRODUCT_API') return;

    // Hand it to the policy. The proposal is advisory; the engine applies it.
    assertNoTruthLeak(observed, 'disruption handed to policy');
    const proposal = this.policy.respondToDisruption(this.policyContext(), observed);

    if (proposal.action === 'NONE') return;

    for (const missionId of proposal.affectedMissionIds) {
      const mission = this.world.observed.missions.get(missionId);
      if (!mission || mission.status === 'COMPLETED' || mission.status === 'CANCELLED') continue;

      switch (proposal.action) {
        case 'REROUTE':
        case 'RESCHEDULE': {
          // A coordinated response costs time but saves the delivery. The delay
          // is deterministic, derived from the disruption's true severity —
          // which the engine may read even though the policy may not.
          const delayMs = Math.round(runtime.disruption.severity * 8 * HOUR_MS);
          mission.status = 'DELAYED';
          mission.plannedArrivalAt += delayMs;
          this.queue.removeWhere(
            (queued) => queued.type === 'MISSION_ARRIVE' && (queued.payload as { missionId: string }).missionId === missionId,
          );
          this.schedule(mission.plannedArrivalAt, 'MISSION_ARRIVE', Priority.World, { missionId });
          break;
        }
        case 'REALLOCATE':
        case 'CANCEL': {
          mission.status = 'CANCELLED';
          this.missionsCancelled += 1;
          this.queue.removeWhere(
            (queued) =>
              (queued.type === 'MISSION_ARRIVE' || queued.type === 'MISSION_DEPART') &&
              (queued.payload as { missionId: string }).missionId === missionId,
          );
          break;
        }
      }
      // No 'NONE' case: the early return above already excluded it, and the
      // compiler confirms the switch is exhaustive without it.
    }
  }

  private onDisruptionEnd(disruptionId: string): void {
    const runtime = this.disruptionRuntimes.get(disruptionId);
    if (!runtime) return;
    runtime.active = false;

    if (runtime.disruption.type === 'ROAD') {
      for (const roadSegmentId of runtime.disruption.affectedEntityIds) {
        const today = formatDate(this.clock);
        const road = this.world.roads.get(roadSegmentId);
        const weather = road ? this.realisedWeatherToday(road.islandId, today) : null;
        // Only clear it if the weather is not independently keeping it degraded.
        if (!road || !weatherDegradesRoad(weather, road.rainSensitivity, HEAVY_RAIN_MM)) {
          this.world.observed.degradedRoadSegmentIds.delete(roadSegmentId);
        }
      }
    }
  }

  // ------------------------------------------------------------------
  // Actor handlers
  // ------------------------------------------------------------------

  private onFarmerObservation(farmId: string): void {
    const farm = this.world.farms.get(farmId);
    if (!farm) return;

    // Any outstanding ask for this farm has now been answered.
    this.pendingObservationRequests.delete(farmId);

    const stream = this.random.stream(`actor:${farmId}:observation`);

    const farmBatches = [...this.world.observed.batches.values()]
      .filter((batch) => batch.farmId === farmId)
      .sort((a, b) => a.batchId.localeCompare(b.batchId));

    // Crops this report moves into READY for the first time. New promisable
    // supply is the trigger for looking again at demand nobody could fill.
    const newlyReadyCrops = new Set<string>();

    for (const batch of farmBatches) {
      const truth = this.world.truth.crops.get(batch.batchId);
      if (!truth || truth.stage === 'HARVESTED') continue;

      // The grower's estimate is the truth seen through noise. A diligent
      // grower is closer to it; nobody is exact. This is the single most
      // important modelling choice in the scenario: if the estimate were
      // accurate, there would be no problem for Harvest to solve.
      const noiseFraction = (1 - farm.diligence) * 0.45 + 0.08;
      const marketable = Math.max(0, (truth.potentialYieldKg - truth.lostKg) * truth.qualityFraction);
      const estimate = Math.max(0, marketable * stream.normal(1, noiseFraction));

      const observation = {
        observationId: this.ids.next(),
        batchId: batch.batchId,
        observedAt: this.clock,
        estimatedYieldKg: Number(estimate.toFixed(2)),
        // The grower reports the stage they perceive, which for an unready crop
        // can be optimistic.
        reportedStage: truth.stage,
        provenance: 'SYNTHETIC' as const,
      };

      const previousStage = batch.lastReportedStage;
      batch.observations.push(observation);
      batch.lastObservedAt = this.clock;
      batch.lastReportedStage = truth.stage;
      if (previousStage !== 'READY' && truth.stage === 'READY') newlyReadyCrops.add(batch.crop);
    }

    if (newlyReadyCrops.size > 0) {
      this.rematchWaitingDemand(newlyReadyCrops);
      this.collectReportedReadyMissions();
    }

    const intervalDays = 2 + (1 - farm.diligence) * 12;
    const jitter = stream.float(0.6, 1.4);
    this.schedule(this.clock + intervalDays * jitter * DAY_MS, 'FARMER_OBSERVATION', Priority.Actor, { farmId });
  }

  /** Sweep-triggered planning attempts per demand, bounded apart from replans. */
  private static readonly MAX_REMATCH_ATTEMPTS = 3;

  /**
   * Plans again for demand still waiting, after new ready supply was reported.
   *
   * Planning otherwise fires once per demand, thirty minutes after the order
   * arrives, plus a few replans while the policy is chasing observations. A
   * batch reported ready on day nine is therefore invisible to an order placed
   * on day eight that nobody could fill at the time, even though the two now
   * match — the order simply waits out its deadline beside supply that exists.
   *
   * One bounded pass per trigger: each waiting demand for that crop, oldest
   * deadline first, at most `MAX_REMATCH_ATTEMPTS` times over the whole run, so
   * a steady drip of grower reports cannot spin the queue.
   */
  private rematchWaitingDemand(crops: ReadonlySet<string>): void {
    // In a connected run the Product API owns matching, and the engine must not
    // queue a second coordinator against the same orders.
    if (this.coordinationMode !== 'INTERNAL_POLICY') return;
    if (!this.policy.capabilities.rematchOnNewSupply) return;

    const waiting = [...this.world.observed.demands.values()]
      .filter((demand) => demand.status === 'PENDING')
      .filter((demand) => crops.has(demand.crop))
      .filter((demand) => demand.neededBy > this.clock)
      .filter((demand) => (this.rematchAttempts.get(demand.demandId) ?? 0) < SimulationEngine.MAX_REMATCH_ATTEMPTS)
      // Oldest deadline first, then id: the queue order must not depend on Map
      // iteration remaining incidental.
      .sort((a, b) => a.neededBy - b.neededBy || a.demandId.localeCompare(b.demandId));

    if (waiting.length === 0) return;

    for (const demand of waiting) {
      this.rematchAttempts.set(demand.demandId, (this.rematchAttempts.get(demand.demandId) ?? 0) + 1);
      this.schedule(this.clock + 15 * MINUTE_MS, 'PLAN_ALLOCATION', Priority.Actor, { demandId: demand.demandId });
    }

    this.decisions.push({
      at: this.clock,
      kind: 'REMATCH_WAITING_DEMAND',
      summary: `New ready supply was reported, so ${waiting.length} waiting order(s) were matched again.`,
      evidence: {
        crops: [...crops].sort().join(','),
        demandsReplanned: waiting.length,
        demandIds: waiting.map((demand) => demand.demandId).join(','),
      },
    });
  }

  private onBuyerDemand(buyerId: string): void {
    const buyer = this.world.buyers.get(buyerId);
    if (!buyer) return;

    const stream = this.random.stream(`actor:${buyerId}:demand`);
    const quantityKg = Math.max(20, Math.round(stream.normal(buyer.typicalOrderKg, buyer.typicalOrderKg * 0.2)));
    const neededBy = this.clock + stream.int(3, 7) * DAY_MS;
    // Drawn before the ordering-window guard below rather than after it, so
    // this buyer's rhythm, and every later draw on its stream, is the same
    // whether or not this particular order is raised.
    const nextOrderAt = this.clock + stream.int(4, 8) * DAY_MS;

    // Orders are raised inside the ordering window only. The deadline is not
    // consulted: the settlement window exists precisely so that a deadline
    // running past the ordering window is a normal order rather than one the
    // run has to refuse. The buyer keeps its later check-ins either way, which
    // is what lets a connected run keep approving and dispatching through the
    // settlement window.
    if (this.clock <= this.demandEndsAt) {
      const demand: BuyerDemand = {
        demandId: this.ids.next(),
        buyerId,
        crop: 'cucumber',
        quantity: { value: quantityKg, unit: 'kg' },
        neededBy,
        createdAt: this.clock,
        status: 'PENDING',
        acceptedKg: 0,
        substitutedKg: 0,
      };
      this.world.observed.demands.set(demand.demandId, demand);

      // In a connected run, the matching/approval workflow happens through the
      // Product API and returns as validated Product events. Internal policy
      // planning remains unchanged for headless and baseline comparisons.
      if (this.coordinationMode === 'INTERNAL_POLICY') {
        this.schedule(this.clock + 30 * MINUTE_MS, 'PLAN_ALLOCATION', Priority.Actor, { demandId: demand.demandId });
      }
      this.schedule(neededBy + SUBSTITUTION_GRACE_MS, 'DEMAND_DEADLINE', Priority.Observation, { demandId: demand.demandId });
    }

    // The buyer orders again later in the run, whether or not this order stood.
    this.schedule(nextOrderAt, 'BUYER_DEMAND', Priority.Actor, { buyerId });
  }

  /**
   * Can the run watch this deadline through to its own settlement?
   *
   * `schedule` drops anything past the horizon, so a demand whose
   * `DEMAND_DEADLINE` falls outside the window never fires one: it sits
   * PENDING until `settleOutstandingDemand` sweeps it up and scores it short.
   * Counting that against a coordinator measures the length of the run rather
   * than the policy.
   *
   * The settlement window is what makes this true by construction on the hero
   * scenario: the latest deadline the last ordering day can draw, plus the
   * substitution grace, still lands before `endsAt`. This stays as a guard, so
   * a scenario with too short a settlement window, or an injected effect,
   * cannot have such an order silently recorded as a late delivery instead.
   */
  private settlesWithinHorizon(neededBy: SimulationInstant): boolean {
    return neededBy + SUBSTITUTION_GRACE_MS <= this.endsAt;
  }

  // ------------------------------------------------------------------
  // Coordination handlers: policy proposes, engine validates
  // ------------------------------------------------------------------

  /**
   * Builds the context handed to the policy for one call.
   *
   * `requestedObservations` collects any asks the policy makes during that
   * call, so the caller can tell whether it is worth replanning once the
   * answers arrive.
   */
  private policyContext(requestedObservations?: Set<string>): PolicyContext {
    return {
      now: this.clock,
      observed: this.world.observed,
      farms: this.world.farms,
      buyers: this.world.buyers,
      transporters: this.world.transporters,
      roads: this.world.roads,
      ids: this.ids,
      random: this.random.stream('policy'),
      weather: this.observableWeather,
      // Already restricted to the run scope when the scenario built the world,
      // so a policy cannot reach a port or a link outside it.
      maritime: this.world.maritime,
      record: (decision) => {
        this.decisions.push({ ...decision, at: this.clock });
      },
      requestObservation: (batchId) => {
        const responseAt = this.scheduleObservationRequest(batchId);
        if (responseAt !== null) requestedObservations?.add(batchId);
      },
    };
  }

  /**
   * Brings a grower's next report forward, returning when it will land.
   *
   * An ask is not free and it is not instant. A diligent grower walks the field
   * the same day; a distracted one takes a day and a half. That latency is the
   * real cost of relying on human reporting, and flattening it to zero would
   * hand the Harvest policy an advantage no deployment would have.
   *
   * Returns null when there is nobody to ask or the batch is already finished.
   */
  private scheduleObservationRequest(batchId: string): SimulationInstant | null {
    const batch = this.world.observed.batches.get(batchId);
    if (!batch) return null;
    if (batch.lastReportedStage === 'HARVESTED' || batch.lastReportedStage === 'SPOILED') return null;

    const farm = this.world.farms.get(batch.farmId);
    if (!farm) return null;

    // Only one outstanding ask per farm at a time; a coordinator who phones
    // five times in an hour does not get five field walks.
    const existing = this.pendingObservationRequests.get(farm.farmId);
    if (existing !== undefined && existing > this.clock) return existing;

    const responseDelayMs = (6 + (1 - farm.diligence) * 36) * HOUR_MS;
    const responseAt = this.clock + responseDelayMs;
    if (responseAt > this.endsAt) return null;

    this.pendingObservationRequests.set(farm.farmId, responseAt);
    this.observationRequestCount += 1;
    this.schedule(responseAt, 'FARMER_OBSERVATION', Priority.Actor, { farmId: farm.farmId });
    return responseAt;
  }

  /** Planning retries per demand, so a policy that always asks cannot spin forever. */
  private static readonly MAX_PLAN_ATTEMPTS = 3;

  private onPlanAllocation(demandId: string): void {
    const demand = this.world.observed.demands.get(demandId);
    if (!demand || demand.status !== 'PENDING') return;

    // One live commitment per demand.
    //
    // Defensive rather than load-bearing today: a demand stays PENDING until
    // its commitment clears approval, so in principle a replan firing inside
    // that window would commit the same order twice, and the status check
    // above would not catch it because the status has not moved yet. With the
    // current timings approval (+2h) always precedes the earliest replan
    // (+6h), so this never triggers. It is here because those two constants
    // have no reason to stay ordered, and the failure would be silent
    // double-selling of a farmer's crop.
    const alreadyCommitted = [...this.world.observed.commitments.values()].some(
      (commitment) => commitment.demandId === demandId && commitment.status !== 'CANCELLED',
    );
    if (alreadyCommitted) return;

    const attempts = (this.planAttempts.get(demandId) ?? 0) + 1;
    this.planAttempts.set(demandId, attempts);

    const requested = new Set<string>();
    const proposal = this.policy.planAllocation(this.policyContext(requested), demand);

    // The policy asked growers to go and look. Come back once those reports
    // have landed rather than committing on evidence it has just said it does
    // not trust — provided there is still time before the buyer needs it.
    if (requested.size > 0 && attempts < SimulationEngine.MAX_PLAN_ATTEMPTS) {
      const answersBy = Math.max(
        ...[...requested]
          .map((batchId) => this.world.observed.batches.get(batchId)?.farmId)
          .filter((farmId): farmId is string => farmId !== undefined)
          .map((farmId) => this.pendingObservationRequests.get(farmId) ?? this.clock),
      );
      const replanAt = answersBy + 30 * MINUTE_MS;
      if (replanAt < demand.neededBy) {
        this.schedule(replanAt, 'PLAN_ALLOCATION', Priority.Actor, { demandId });
        // Only defer if nothing could be promised now. A partial promise is
        // still worth locking in while the rest is chased up.
        if (!proposal || proposal.allocations.length === 0) return;
      }
    }

    if (!proposal || proposal.allocations.length === 0) {
      this.recordNoPublicRouteIfNeeded(demand, 0);
      return;
    }

    // VALIDATION GATE. The policy's numbers are a request, not an instruction.
    // Each allocation is checked against what the batch can actually still
    // supply, using the *observed* remaining figure rather than hidden truth —
    // the engine is checking internal consistency, not granting foresight.
    // A cross-island proposal is re-checked against the scoped network here,
    // not trusted. The policy chose a route; the engine confirms that the route
    // it chose is one the reviewed dataset actually records between two islands
    // this run selected, in the direction claimed. `AGENTS.md` requires routing
    // and state transitions to be deterministic and validated, and a route is
    // routing.
    const seaBatchIds = new Set(proposal.interIsland?.batchIds ?? []);
    const validatedRoute = proposal.interIsland
      ? this.validateInterIslandRoute(demand, proposal.interIsland.originIslandId, proposal.interIsland.route)
      : null;
    if (proposal.interIsland && !validatedRoute) seaBatchIds.clear();

    const validated: Commitment['allocations'] = [];
    for (const allocation of proposal.allocations) {
      const batch = this.world.observed.batches.get(allocation.batchId);
      if (!batch) continue;
      if (!Number.isFinite(allocation.quantityKg) || allocation.quantityKg <= 0) continue;

      // An allocation off the buyer's island is only ever admissible as part of
      // a validated sailing. Without one it is dropped rather than quietly
      // delivered by road across open water.
      const sourceIslandId = this.world.farms.get(allocation.farmId)?.islandId;
      const buyerIslandId = this.world.buyers.get(demand.buyerId)?.islandId;
      if (sourceIslandId !== undefined && buyerIslandId !== undefined && sourceIslandId !== buyerIslandId) {
        if (!validatedRoute || !seaBatchIds.has(allocation.batchId)) continue;
        if (sourceIslandId !== validatedRoute.originIslandId) continue;
      }

      const alreadyCommitted = this.committedKgForBatch(allocation.batchId);
      const latest = batch.observations.at(-1);
      // With no observation at all, fall back to the same remembered
      // per-hectare pick-lot figure the baseline quotes from.
      const observedCeiling = latest ? latest.estimatedYieldKg : batch.areaHectares * 1_500;
      const headroom = Math.max(0, observedCeiling - alreadyCommitted - batch.confirmedHarvestedKg);

      const granted = Number(Math.min(allocation.quantityKg, headroom).toFixed(2));
      if (granted <= 0) continue;

      validated.push({ batchId: allocation.batchId, farmId: allocation.farmId, quantityKg: Number(granted.toFixed(2)) });
    }

    if (validated.length === 0) {
      this.recordNoPublicRouteIfNeeded(demand, 0);
      return;
    }

    const promisedKg = validated.reduce((total, allocation) => total + allocation.quantityKg, 0);
    this.recordNoPublicRouteIfNeeded(demand, promisedKg);

    const crossesWater =
      validatedRoute !== null && validated.some((allocation) => seaBatchIds.has(allocation.batchId));
    const interIsland: InterIslandCommitmentDetail | null =
      crossesWater && validatedRoute
        ? {
            originIslandId: validatedRoute.originIslandId,
            destinationIslandId: validatedRoute.destinationIslandId,
            route: validatedRoute,
            approvalSubjectType: 'INTER_ISLAND_COMMITMENT',
          }
        : null;

    const commitment: Commitment = {
      commitmentId: this.ids.next(),
      demandId,
      allocations: validated,
      committedAt: this.clock,
      approvedAt: null,
      status: 'PROPOSED',
      ...(interIsland ? { interIsland } : {}),
    };
    this.world.observed.commitments.set(commitment.commitmentId, commitment);
    this.commitmentsProposed += 1;
    this.totalPromisedKg += promisedKg;

    if (interIsland) {
      this.shipmentsProposed += 1;
      this.seaBatchIdsByCommitment.set(
        commitment.commitmentId,
        validated.filter((allocation) => seaBatchIds.has(allocation.batchId)).map((allocation) => allocation.batchId),
      );
    }

    // An inter-island commitment always takes the approval gate, whatever the
    // policy asked for. `AGENTS.md` lists inter-island commitments among the
    // decisions that require human approval, so the engine will not let a
    // proposal opt out of one.
    if (proposal.requiresApproval || interIsland) {
      // A human approval gate takes real time, and that latency is part of what
      // the benchmark should capture.
      this.schedule(this.clock + 2 * HOUR_MS, 'APPROVAL_GATE', Priority.Actor, { commitmentId: commitment.commitmentId });
    } else {
      this.confirmCommitment(commitment);
    }
  }

  private committedKgForBatch(batchId: string): number {
    let total = 0;
    for (const commitment of this.world.observed.commitments.values()) {
      if (commitment.status === 'CANCELLED') continue;
      for (const allocation of commitment.allocations) {
        if (allocation.batchId === batchId) total += allocation.quantityKg;
      }
    }
    return total;
  }

  private onApprovalGate(commitmentId: string): void {
    const commitment = this.world.observed.commitments.get(commitmentId);
    if (!commitment || commitment.status !== 'PROPOSED') return;

    const approved = this.policy.approveCommitment(this.policyContext(), commitment);
    if (!approved) {
      commitment.status = 'CANCELLED';
      return;
    }
    this.confirmCommitment(commitment);
  }

  private confirmCommitment(commitment: Commitment): void {
    commitment.status = 'APPROVED';
    commitment.approvedAt = this.clock;
    this.commitmentsApproved += 1;

    const demand = this.world.observed.demands.get(commitment.demandId);
    if (demand) demand.status = 'COMMITTED';

    const seaBatchIds = new Set(this.seaBatchIdsByCommitment.get(commitment.commitmentId) ?? []);
    if (seaBatchIds.size === 0 || !commitment.interIsland) {
      this.planMission(commitment, commitment.allocations);
      return;
    }

    // The approval has cleared, so the sailing may now be booked. Before this
    // point no shipment object exists at all — "an inter-island commitment
    // cannot bind without approval" is enforced by there being nothing to bind,
    // rather than by a flag something could forget to read.
    this.shipmentsApproved += 1;
    const road = commitment.allocations.filter((allocation) => !seaBatchIds.has(allocation.batchId));
    const sea = commitment.allocations.filter((allocation) => seaBatchIds.has(allocation.batchId));
    if (road.length > 0) this.planMission(commitment, road);
    if (sea.length > 0) this.planMaritimeShipment(commitment, commitment.interIsland, sea);
  }

  /**
   * When a commitment's batches were first reported ready, or null.
   *
   * Null unless every allocated batch carries a READY report: a mission cannot
   * be brought forward on the strength of one pickup being ready while another
   * is not. The answer is the latest of those first reports, because that is
   * when the whole load became collectable.
   *
   * Deliberately built from `observations`, which is observed state. Reading
   * `HiddenCropTruth.readyAt` here would schedule against a readiness nobody has
   * seen, which is the foresight the benchmark exists to rule out.
   */
  private reportedReadyAt(allocations: Commitment['allocations']): SimulationInstant | null {
    for (const allocation of allocations) {

      const batch = this.world.observed.batches.get(allocation.batchId);
      if (!batch || batch.lastReportedStage !== 'READY') return null;
    }
    return this.firstReportedReadyAt(allocations);
  }

  /**
   * When every allocated batch had first been reported ready, or null if one
   * of them never was.
   *
   * Unlike `reportedReadyAt` this ignores what the batches report *now*, which
   * is what a settled run needs: a batch that was picked reports HARVESTED
   * afterwards, and asking whether it had been ready at pickup time is exactly
   * the question `classifyDemand` has to answer.
   */
  private firstReportedReadyAt(allocations: Commitment['allocations']): SimulationInstant | null {
    let latest: SimulationInstant | null = null;
    for (const allocation of allocations) {
      const batch = this.world.observed.batches.get(allocation.batchId);
      const firstReady = batch?.observations.find((observation) => observation.reportedStage === 'READY');
      if (!firstReady) return null;
      latest = latest === null ? firstReady.observedAt : Math.max(latest, firstReady.observedAt);
    }
    return latest;
  }

  /**
   * Loading and unloading time for a route, one stop per pickup plus the drop.
   *
   * The same 25 minutes a stop that `planMission` allows, read off the route
   * itself so a mission built by the Product API is costed the same way as one
   * the engine planned.
   */
  private handlingMsForPath(stopCount: number): number {
    return stopCount * 25 * MINUTE_MS;
  }

  /**
   * Brings a planned pickup forward once every batch it collects is reported
   * ready, and reschedules the run around the new departure.
   *
   * This is the forward-promise half of the rule `planMission` applies when a
   * commitment is made against produce that is already ready. A promise made
   * against a growing crop is planned to leave at the deadline, because on the
   * day it was made nothing was collectable; the moment the grower reports the
   * field ready, holding to that plan leaves promised produce spoiling for
   * days. Readiness only ever moves a departure earlier, and it is the
   * grower's report rather than the hidden `readyAt`, so it buys coordination
   * and not foresight.
   */
  private collectReportedReadyMissions(): void {
    const { collectOnReadiness, maxHoldMs } = this.policy.capabilities;
    if (!collectOnReadiness) return;

    for (const mission of [...this.world.observed.missions.values()].sort((left, right) =>
      left.missionId.localeCompare(right.missionId))) {
      if (mission.mode === 'MARITIME' || mission.status !== 'PLANNED' || mission.plannedDepartureAt <= this.clock) continue;
      const commitment = this.world.observed.commitments.get(mission.commitmentId);
      if (!commitment || commitment.status !== 'APPROVED') continue;

      const reportedReadyAt = this.reportedReadyAt(commitment.allocations.filter((line) => !mission.batchIds || mission.batchIds.includes(line.batchId)));
      if (reportedReadyAt === null) continue;
      if (mission.plannedDepartureAt - reportedReadyAt <= maxHoldMs) continue;

      const departAt = Math.max(this.clock + HOUR_MS, reportedReadyAt + this.handlingMsForPath(mission.path.length));
      if (departAt >= mission.plannedDepartureAt) continue;

      const journeyMs = mission.plannedArrivalAt - mission.plannedDepartureAt;
      mission.plannedDepartureAt = departAt;
      mission.plannedArrivalAt = departAt + journeyMs;
      this.replaceMissionSchedule(mission, true);
      // The earlier slot may sit inside a closure or breakdown that the later
      // one avoided, so the world gets to push back on the new plan.
      this.applyActiveDisruptionsToMission(mission);
    }
  }

  private planMission(commitment: Commitment, allocations: Commitment['allocations']): void {

    const demand = this.world.observed.demands.get(commitment.demandId);
    if (!demand) return;
    const buyer = this.world.buyers.get(demand.buyerId);
    if (!buyer) return;

    const loadKg = allocations.reduce((total, allocation) => total + allocation.quantityKg, 0);

    // Pick the smallest vehicle that can carry the load; fall back to the
    // largest if nothing fits. Deterministic, and a stable tiebreak on id.
    const fleet = [...this.world.transporters.values()].sort(
      (a, b) => a.capacityKg - b.capacityKg || a.transporterId.localeCompare(b.transporterId),
    );
    const vehicle = fleet.find((candidate) => candidate.capacityKg >= loadKg) ?? fleet.at(-1);
    if (!vehicle) return;

    // Route: each pickup farm in a stable order, then the buyer.
    const pickupFarmIds = [...new Set(allocations.map((allocation) => allocation.farmId))].sort();
    const path = [
      ...pickupFarmIds.map((farmId) => this.world.farms.get(farmId)?.position).filter((position) => position !== undefined),
      buyer.position,
    ];
    if (path.length < 2) return;

    let distanceKm = 0;
    for (let index = 1; index < path.length; index += 1) {
      distanceKm += haversineKm(path[index - 1] as { latitude: number; longitude: number }, path[index] as { latitude: number; longitude: number });
    }
    distanceKm *= ROAD_WINDING_FACTOR;

    const travelMs = (distanceKm / vehicle.cruiseSpeedKmh) * HOUR_MS;
    // Load and unload time, one stop per pickup plus the drop.
    const handlingMs = this.handlingMsForPath(pickupFarmIds.length + 1);

    // Depart in time to arrive before the deadline, but not before now.
    const desiredArrival = demand.neededBy - HOUR_MS;
    const deadlineDeparture = Math.max(this.clock + HOUR_MS, desiredArrival - travelMs - handlingMs);

    // Just-in-time pickup is the wrong default for a crop losing six to
    // fourteen percent of itself a day. Once every allocated batch has been
    // *reported* ready, waiting for the deadline leaves produce spoiling in the
    // field that the buyer is already promised, so a policy that coordinates
    // collection sends the vehicle as soon as one can be there.
    //
    // Readiness only ever brings a departure forward: the deadline stays the
    // upper bound, and the readiness figure is the grower's report rather than
    // the hidden `readyAt`, so this buys no foresight.
    const { collectOnReadiness, maxHoldMs, readsForecast } = this.policy.capabilities;
    const reportedReadyAt = collectOnReadiness ? this.reportedReadyAt(allocations) : null;

    // A forecast storm shortens how long a reported-ready batch may sit. This
    // is the one place a forecast touches behaviour, and it is coordination
    // rather than biology: it moves a vehicle, never a crop. It can also be
    // wrong, because the forecast can be wrong, and the cost of being wrong is
    // an early pickup rather than a broken promise.
    const islandId = this.world.farms.get(allocations[0]?.farmId ?? '')?.islandId ?? null;
    const stormForecast =
      readsForecast && islandId
        ? this.observableWeather
            .forecast(islandId)
            .find((day) => day.condition === 'STORM' && day.leadDays <= STORM_FORECAST_WINDOW_DAYS)
        : undefined;
    const effectiveHoldMs = stormForecast ? Math.min(maxHoldMs, STORM_FORECAST_HOLD_MS) : maxHoldMs;
    if (stormForecast) {
      this.decisions.push({
        at: this.clock,
        kind: 'HARVEST_PULL_PICKUP_FORWARD',
        summary: `Storm forecast for ${stormForecast.date}; collection brought forward rather than held to the deadline.`,
        evidence: {
          commitmentId: commitment.commitmentId,
          islandId: islandId ?? 'unknown',
          forecastDate: stormForecast.date,
          leadDays: stormForecast.leadDays,
          confidence: stormForecast.confidence,
          source: 'FORECAST',
        },
      });
    }

    let departAt = deadlineDeparture;
    if (reportedReadyAt !== null && deadlineDeparture - reportedReadyAt > effectiveHoldMs) {
      const promptDeparture = Math.max(this.clock + HOUR_MS, reportedReadyAt + handlingMs);
      departAt = Math.min(deadlineDeparture, promptDeparture);
    }

    const arriveAt = departAt + travelMs + handlingMs;

    const mission: DeliveryMission = {
      missionId: this.ids.next(),
      commitmentId: commitment.commitmentId,
      transporterId: vehicle.transporterId,
      status: 'PLANNED',
      mode: 'ROAD',
      path,
      plannedDepartureAt: departAt,
      plannedArrivalAt: arriveAt,
      actualArrivalAt: null,
      loadedKg: 0,
      batchIds: allocations.map((allocation) => allocation.batchId),
    };
    this.world.observed.missions.set(mission.missionId, mission);

    this.schedule(departAt, 'MISSION_DEPART', Priority.Actor, { missionId: mission.missionId });
    this.schedule(arriveAt, 'MISSION_ARRIVE', Priority.World, { missionId: mission.missionId });
    this.applyActiveDisruptionsToMission(mission);
  }

  private onMissionDepart(missionId: string): void {
    const mission = this.world.observed.missions.get(missionId);
    if (!mission || mission.status === 'CANCELLED') return;

    const commitment = this.world.observed.commitments.get(mission.commitmentId);
    if (!commitment || commitment.status === 'CANCELLED') return;

    // Harvest what is actually there. This is where promises meet biology: the
    // engine reads hidden truth, and whatever the policy believed is irrelevant.
    //
    // Only this vehicle's own allocations are picked. For a road-only
    // commitment that is all of them; for one that splits across a sailing the
    // road van must not also empty the fields on the other island.
    const carried = new Set(mission.batchIds);
    let loaded = 0;
    for (const allocation of commitment.allocations) {
      if (!carried.has(allocation.batchId)) continue;
      const truth = this.world.truth.crops.get(allocation.batchId);
      const batch = this.world.observed.batches.get(allocation.batchId);
      if (!truth || !batch) continue;

      // Nothing to pick if the crop is not ready yet, however confident the
      // promise was. An over-optimistic commitment simply comes up short.
      if (truth.stage !== 'READY') continue;

      const marketableRemaining = Math.max(
        0,
        (truth.potentialYieldKg - truth.lostKg) * truth.qualityFraction - truth.harvestedKg,
      );
      const picked = Math.min(allocation.quantityKg, marketableRemaining);
      if (picked <= 0) continue;

      truth.harvestedKg += picked;
      batch.confirmedHarvestedKg += picked;
      loaded += picked;

      if (truth.potentialYieldKg - truth.harvestedKg - truth.lostKg <= 0.5) {
        truth.stage = 'HARVESTED';
        batch.lastReportedStage = 'HARVESTED';
      }
    }

    const vehicle = this.world.transporters.get(mission.transporterId);
    const shipment = mission.shipmentId ? this.world.observed.shipments.get(mission.shipmentId) : undefined;
    // A sailing has its own synthetic allowance on top of the truck's, and the
    // smaller of the two is what actually leaves the island.
    mission.loadedKg = Math.min(loaded, vehicle?.capacityKg ?? loaded, shipment?.capacityKg ?? Number.POSITIVE_INFINITY);
    mission.status = 'ACTIVE';
    if (shipment) shipment.loadedKg = mission.loadedKg;

    // Weather on the day the vehicle actually sets out slows the journey. Read
    // here rather than at planning time because at planning time it has not
    // happened yet, and letting the planner use it would be the engine handing
    // itself the foresight the whole design denies the policy.
    //
    // The mission stays ACTIVE rather than becoming DELAYED. It is leaving on
    // time and simply travelling slower, which is a later arrival and not a
    // stalled mission — and `DELAYED` is the status the connected Product API
    // flow reads as "this vehicle did not set out", which would strand the
    // pickup updates that follow.
    //
    // A maritime mission is exempt here and is slowed on its sea leg instead,
    // in `onShipmentSail`. Applying both would charge one consignment twice for
    // the same weather, and the sea leg is where a storm actually bites.
    const weather = this.realisedWeatherToday(this.islandForMission(mission), formatDate(this.clock));
    const speedFactor = mission.mode === 'MARITIME' ? 1 : travelSpeedFactor(weather);
    if (speedFactor < 1) {
      const remainingMs = Math.max(0, mission.plannedArrivalAt - this.clock);
      const extraMs = Math.round(remainingMs * (1 / speedFactor - 1));
      if (extraMs > 0) {
        mission.plannedArrivalAt += extraMs;
        this.weatherDelayedMissions += 1;
        this.replaceMissionSchedule(mission, false);
      }
    }
  }

  private onMissionArrive(missionId: string): void {
    const mission = this.world.observed.missions.get(missionId);
    if (!mission || mission.status === 'CANCELLED' || mission.status === 'COMPLETED') return;

    const commitment = this.world.observed.commitments.get(mission.commitmentId);
    if (!commitment) return;
    const demand = this.world.observed.demands.get(commitment.demandId);
    if (!demand) return;

    mission.status = 'COMPLETED';
    mission.actualArrivalAt = this.clock;
    this.missionsCompleted += 1;

    // A sailing is delivered at the buyer's gate, not at the quay, so the
    // shipment settles here rather than at the customs checkpoint.
    const shipment = mission.shipmentId ? this.world.observed.shipments.get(mission.shipmentId) : undefined;
    if (shipment && shipment.status !== 'FAILED') {
      shipment.status = 'DELIVERED';
      shipment.deliveredAt = this.clock;
      this.shipmentsDelivered += 1;
    }

    // Arrival is a physical fact. In connected mode the transporter posts the
    // actual picked-up amount and the buyer accepts it through the Product API;
    // only that resulting event may settle the commitment and buyer demand.
    if (this.coordinationMode === 'EXTERNAL_PRODUCT_API') return;

    // A commitment that splits across a road van and a sailing has two vehicles
    // out, and it is not delivered until both have finished. With one vehicle
    // this is the same statement it always was.
    if (this.commitmentOutstanding(commitment.commitmentId)) {
      this.settleArrival(mission, demand);
      return;
    }
    commitment.status = 'DELIVERED';
    this.commitmentsDelivered += 1;

    this.settleArrival(mission, demand);
  }

  /** Whether any vehicle carrying part of a commitment is still out. */
  private commitmentOutstanding(commitmentId: string): boolean {
    for (const mission of this.world.observed.missions.values()) {
      if (mission.commitmentId !== commitmentId) continue;
      if (mission.status !== 'COMPLETED' && mission.status !== 'CANCELLED') return true;
    }
    return false;
  }

  /** Books one arrived load against the buyer's order. */
  private settleArrival(mission: DeliveryMission, demand: BuyerDemand): void {
    // Late arrivals are only partly accepted: a hotel kitchen that needed it
    // for service has already moved on.
    const late = this.clock > demand.neededBy;
    const acceptedKg = late ? mission.loadedKg * 0.5 : mission.loadedKg;

    demand.acceptedKg += acceptedKg;

    const rejected = mission.loadedKg - acceptedKg;
    if (rejected > 0) {
      // Rejected produce is waste. Attribute it to the first batch this vehicle
      // carried so the figure lands somewhere accountable rather than vanishing.
      const first = mission.batchIds[0];
      if (first) {
        const truth = this.world.truth.crops.get(first);
        if (truth) truth.lostKg += rejected;
      }
    }

    this.updateDemandStatus(demand);
  }

  // ------------------------------------------------------------------
  // Validated Product API effects for connected Harvest execution
  // ------------------------------------------------------------------

  /**
   * Applies one already-validated Product event exactly once.
   *
   * Product UUIDs live only in the dedupe/mapping layer. Physical commitments
   * and missions always consume the seeded `IdFactory`, preserving repeatable
   * world identities and digests across database instances.
   */
  applyProductEffect(effect: ProductSimulationEffect): ProductEffectResult {
    if (this.coordinationMode !== 'EXTERNAL_PRODUCT_API') {
      return { applied: false, reason: 'REJECTED' };
    }
    if (this.status !== 'RUNNING' || effect.atMs !== this.clock) {
      return { applied: false, reason: 'REJECTED' };
    }
    if (this.appliedProductEventIds.has(effect.eventId)) {
      return { applied: false, reason: 'DUPLICATE' };
    }
    if (!/^\d+$/.test(effect.cursor)) return { applied: false, reason: 'REJECTED' };
    const cursor = BigInt(effect.cursor);
    if (cursor <= this.lastProductCursor) return { applied: false, reason: 'REJECTED' };

    this.appliedProductEventIds.add(effect.eventId);
    this.lastProductCursor = cursor;
    if (effect.origin === 'PHYSICAL_ECHO') return { applied: false, reason: 'PHYSICAL_ECHO' };

    switch (effect.type) {
      case 'NO_PHYSICAL_EFFECT':
      case 'OBSERVATION_BOUND':
      case 'ORDER_BOUND':
        return { applied: false, reason: 'IGNORED' };
      case 'ALLOCATION_APPROVED':
        return this.applyAllocationApproved(effect);
      case 'MISSION_ACCEPTED':
        return this.applyMissionAccepted(effect);
      case 'MISSION_DELAYED':
        return this.applyMissionDelayed(effect);
      case 'DELIVERY_ACCEPTED':
        return this.applyDeliveryAccepted(effect);
      case 'ORDER_FULFILLED':
      case 'ORDER_PARTIALLY_FULFILLED':
      case 'ORDER_REJECTED': {
        const demand = this.world.observed.demands.get(effect.demandId);
        if (!demand) return { applied: false, reason: 'REJECTED' };
        const status = effect.type === 'ORDER_FULFILLED' ? 'FULFILLED'
          : effect.type === 'ORDER_PARTIALLY_FULFILLED' ? 'PARTIALLY_FULFILLED' : 'UNMET';
        this.productDemandOutcomes.set(effect.demandId, status);
        demand.status = status;
        return { applied: true, reason: 'APPLIED' };
      }
      case 'INTER_ISLAND_COMMITMENT_APPROVED':
        return this.applyInterIslandApproved(effect);
      case 'ALLOCATION_INVALIDATED':
      case 'ORDER_CANCELLED':
        return this.cancelDemandWork(effect.demandId);
    }
  }

  private applyAllocationApproved(
    effect: Extract<ProductSimulationEffect, { type: 'ALLOCATION_APPROVED' }>,
  ): ProductEffectResult {
    const demand = this.world.observed.demands.get(effect.demandId);
    if (!demand || demand.status !== 'PENDING' || this.commitmentByDemandId.has(effect.demandId)) {
      return { applied: false, reason: 'REJECTED' };
    }

    const allocations: Commitment['allocations'] = [];
    for (const requested of effect.allocations) {
      if (!Number.isFinite(requested.quantityKg) || requested.quantityKg <= 0) continue;
      const batch = this.world.observed.batches.get(requested.batchId);
      if (!batch) continue;
      allocations.push({
        batchId: batch.batchId,
        farmId: batch.farmId,
        quantityKg: Number(requested.quantityKg.toFixed(2)),
      });
    }
    if (allocations.length === 0) return { applied: false, reason: 'REJECTED' };

    const commitment: Commitment = {
      commitmentId: this.ids.next(),
      demandId: effect.demandId,
      allocations,
      committedAt: this.clock,
      approvedAt: this.clock,
      status: 'APPROVED',
    };
    this.world.observed.commitments.set(commitment.commitmentId, commitment);
    this.commitmentByDemandId.set(effect.demandId, commitment.commitmentId);
    demand.status = 'COMMITTED';
    this.commitmentsProposed += 1;
    this.commitmentsApproved += 1;
    this.totalPromisedKg += allocations.reduce((sum, allocation) => sum + allocation.quantityKg, 0);
    return { applied: true, reason: 'APPLIED' };
  }

  private applyMissionAccepted(
    effect: Extract<ProductSimulationEffect, { type: 'MISSION_ACCEPTED' }>,
  ): ProductEffectResult {
    const commitmentId = this.commitmentByDemandId.get(effect.demandId);
    const commitment = commitmentId ? this.world.observed.commitments.get(commitmentId) : undefined;
    const transporter = this.world.transporters.get(effect.transporterId);
    if (!commitment || commitment.status !== 'APPROVED' || !transporter || effect.path.length < 2) {
      return { applied: false, reason: 'REJECTED' };
    }
    const existingMissionId = this.missionByProductId.get(effect.productMissionId);
    if (existingMissionId) {
      return { applied: false, reason: 'DUPLICATE', simulationMissionId: existingMissionId };
    }

    // When the vehicle actually leaves.
    //
    // The Product API offers a mission the moment its commitment is approved,
    // which under forward promises can be days before the crop is pickable, so
    // the accepting transporter's "now plus a minute" is not a departure time.
    // The engine applies the same rule it applies to its own missions: leave
    // once the growers have reported the whole load ready, never sooner than an
    // hour from now, and never later than the last departure that still makes
    // the buyer's deadline. If nobody reports it ready, the vehicle goes at
    // that last moment anyway and collects whatever is truly in the field.
    const journeyMs = Math.max(MINUTE_MS, effect.plannedArrivalAt - effect.plannedDepartureAt);
    const earliestDeparture = Math.max(this.clock + MINUTE_MS, effect.plannedDepartureAt);
    const demand = this.world.observed.demands.get(effect.demandId);
    const deadlineDeparture = demand
      ? Math.max(earliestDeparture, demand.neededBy - HOUR_MS - journeyMs)
      : earliestDeparture;

    const reportedReadyAt = this.policy.capabilities.collectOnReadiness ? this.reportedReadyAt(commitment.allocations) : null;
    const promptDeparture = reportedReadyAt === null
      ? deadlineDeparture
      : Math.max(this.clock + HOUR_MS, reportedReadyAt + this.handlingMsForPath(effect.path.length));

    const departure = Math.max(earliestDeparture, Math.min(deadlineDeparture, promptDeparture));
    const arrival = departure + journeyMs;
    const mission: DeliveryMission = {
      missionId: this.ids.next(),
      commitmentId: commitment.commitmentId,
      transporterId: transporter.transporterId,
      status: 'PLANNED',
      mode: 'ROAD',
      path: effect.path.map((point) => ({ latitude: point.latitude, longitude: point.longitude })),
      plannedDepartureAt: departure,
      plannedArrivalAt: arrival,
      actualArrivalAt: null,
      loadedKg: 0,
      batchIds: commitment.allocations.map((allocation) => allocation.batchId),
    };
    this.world.observed.missions.set(mission.missionId, mission);
    this.missionByProductId.set(effect.productMissionId, mission.missionId);
    this.schedule(departure, 'MISSION_DEPART', Priority.Actor, { missionId: mission.missionId });
    this.schedule(arrival, 'MISSION_ARRIVE', Priority.World, { missionId: mission.missionId });
    this.applyActiveDisruptionsToMission(mission);
    return { applied: true, reason: 'APPLIED', simulationMissionId: mission.missionId };
  }

  private applyMissionDelayed(
    effect: Extract<ProductSimulationEffect, { type: 'MISSION_DELAYED' }>,
  ): ProductEffectResult {
    const missionId = this.missionByProductId.get(effect.productMissionId);
    const mission = missionId ? this.world.observed.missions.get(missionId) : undefined;
    if (!mission || mission.status === 'COMPLETED' || mission.status === 'CANCELLED') {
      return { applied: false, reason: 'REJECTED' };
    }
    // Recovery may add coordination time, but it cannot make the vehicle arrive
    // earlier than the physical engine already permits after a closure, storm
    // or breakdown.
    const arrival = Math.max(this.clock + MINUTE_MS, mission.plannedArrivalAt, effect.plannedArrivalAt);
    mission.status = 'DELAYED';
    mission.plannedArrivalAt = arrival;
    this.queue.removeWhere(
      (event) => event.type === 'MISSION_ARRIVE' && (event.payload as { missionId: string }).missionId === mission.missionId,
    );
    this.schedule(arrival, 'MISSION_ARRIVE', Priority.World, { missionId: mission.missionId });
    return { applied: true, reason: 'APPLIED', simulationMissionId: mission.missionId };
  }

  private applyDeliveryAccepted(
    effect: Extract<ProductSimulationEffect, { type: 'DELIVERY_ACCEPTED' }>,
  ): ProductEffectResult {
    const missionId = this.missionByProductId.get(effect.productMissionId);
    const mission = missionId ? this.world.observed.missions.get(missionId) : undefined;
    const commitmentId = this.commitmentByDemandId.get(effect.demandId);
    const commitment = commitmentId ? this.world.observed.commitments.get(commitmentId) : undefined;
    const demand = this.world.observed.demands.get(effect.demandId);
    if (!mission || mission.status !== 'COMPLETED' || !commitment || !demand) {
      return { applied: false, reason: 'REJECTED' };
    }
    const accepted = Math.max(0, Math.min(effect.acceptedKg, mission.loadedKg));
    const rejected = Math.max(0, Math.min(effect.rejectedKg, mission.loadedKg - accepted));
    demand.acceptedKg = Number((demand.acceptedKg + accepted).toFixed(2));
    if (rejected > 0) {
      const first = commitment.allocations[0];
      const truth = first ? this.world.truth.crops.get(first.batchId) : undefined;
      if (truth) truth.lostKg += rejected;
    }
    commitment.status = 'DELIVERED';
    this.commitmentsDelivered += 1;
    this.updateDemandStatus(demand);
    return { applied: true, reason: 'APPLIED', simulationMissionId: mission.missionId };
  }

  private cancelDemandWork(demandId: string): ProductEffectResult {
    const commitmentId = this.commitmentByDemandId.get(demandId);
    const commitment = commitmentId ? this.world.observed.commitments.get(commitmentId) : undefined;
    if (!commitment || commitment.status === 'DELIVERED' || commitment.status === 'CANCELLED') {
      return { applied: false, reason: 'IGNORED' };
    }
    commitment.status = 'CANCELLED';
    for (const mission of this.world.observed.missions.values()) {
      if (mission.commitmentId !== commitment.commitmentId || mission.status === 'COMPLETED') continue;
      mission.status = 'CANCELLED';
      this.missionsCancelled += 1;
      this.queue.removeWhere(
        (event) =>
          (event.type === 'MISSION_DEPART' || event.type === 'MISSION_ARRIVE') &&
          (event.payload as { missionId: string }).missionId === mission.missionId,
      );
    }
    const demand = this.world.observed.demands.get(demandId);
    if (demand && demand.status === 'COMMITTED') demand.status = 'PENDING';
    return { applied: true, reason: 'APPLIED' };
  }

  /**
   * Recomputes and stores the demand's status, returning it.
   *
   * It returns the new value rather than leaving callers to re-read the field:
   * TypeScript narrows `demand.status` at the call site and cannot see that
   * this method reassigns it, so a caller that re-read the field would be
   * comparing against a stale narrowed type. Returning the result keeps the
   * caller honest and the compiler informed.
   */
  private updateDemandStatus(demand: BuyerDemand): BuyerDemand['status'] {
    // The Product API owns connected outcomes. Its final events must survive
    // later deadline/settlement passes instead of being promoted by the
    // standalone buyer's minimum-acceptable-fraction scoring rule.
    const productOutcome = this.productDemandOutcomes.get(demand.demandId);
    if (productOutcome) {
      demand.status = productOutcome;
      return productOutcome;
    }
    const buyer = this.world.buyers.get(demand.buyerId);
    const threshold = (buyer?.minimumAcceptableFraction ?? 0.9) * demand.quantity.value;

    if (demand.acceptedKg >= threshold) {
      demand.status = 'FULFILLED';
    } else if (demand.acceptedKg > 0) {
      demand.status = 'PARTIALLY_FULFILLED';
    }
    return demand.status;
  }

  private onDemandDeadline(demandId: string): void {
    const demand = this.world.observed.demands.get(demandId);
    if (!demand) return;

    const settled = this.updateDemandStatus(demand);
    if (settled === 'FULFILLED') return;

    // Whatever local supply did not cover, the buyer imports. That substitution
    // is the economic cost of unreliable local coordination, and it is the
    // headline number the baseline loses on.
    const shortfall = Math.max(0, demand.quantity.value - demand.acceptedKg);
    if (shortfall > 0) {
      demand.substitutedKg += shortfall;
      if (demand.status === 'PENDING' || demand.status === 'COMMITTED') demand.status = 'UNMET';
    }

    this.demandCauses.set(demandId, this.classifyDemand(demand));
  }

  private settleOutstandingDemand(): void {
    for (const demand of this.world.observed.demands.values()) {
      if (demand.status !== 'PENDING' && demand.status !== 'COMMITTED') continue;

      const settled = this.updateDemandStatus(demand);
      if (settled === 'FULFILLED') continue;

      const shortfall = Math.max(0, demand.quantity.value - demand.acceptedKg);
      demand.substitutedKg += shortfall;
      if (settled !== 'PARTIALLY_FULFILLED') demand.status = 'UNMET';

      this.demandCauses.set(demand.demandId, this.classifyDemand(demand));
    }
  }

  /**
   * Why one demand ended short, as a single cause.
   *
   * A ladder rather than a set of tallies: a demand nothing was ever promised
   * against would otherwise also register as a late delivery and a short load,
   * and the histogram would count the same failure three times. The first rung
   * that matches is the one that broke, so the counts sum to the number of
   * demands that missed.
   *
   * This reads physical and observed state, which the engine may do; it never
   * reaches a policy, and it changes nothing about the run.
   */
  private classifyDemand(demand: BuyerDemand): UnmetCause {
    // The run closed before the buyer's window did, so this order was never
    // given a chance rather than being coordinated badly. The settlement
    // window makes this rung unreachable on the hero scenario. It stays
    // because another scenario's window could be too short, and such an order
    // must not be mistaken for a late delivery.
    if (!this.settlesWithinHorizon(demand.neededBy)) return 'HORIZON_TRUNCATED';

    const commitments = [...this.world.observed.commitments.values()].filter(
      (candidate) => candidate.demandId === demand.demandId,
    );
    const commitment = commitments.find((candidate) => candidate.status !== 'CANCELLED') ?? commitments.at(-1);
    // Nothing was promised at all. If Harvest had found crop on another
    // in-scope island and no published sailing to bring it over, that is a
    // missing route rather than missing supply, and it is recorded as one.
    if (!commitment) {
      return this.noPublicRouteDemands.has(demand.demandId) ? 'NO_PUBLIC_ROUTE' : 'NO_READY_SUPPLY';
    }
    if (commitment.status === 'CANCELLED' && commitment.approvedAt === null) return 'APPROVAL_REJECTED';

    // A sailing that was approved, loaded and lost. Checked before the delivery
    // rungs so a lost consignment is not scored as spoilage or lateness.
    if (this.commitmentShipmentFailed(commitment.commitmentId)) return 'SHIPMENT_FAILED';

    // Every vehicle this commitment put on the road or on a boat. One for an
    // ordinary commitment; two when part of it crossed by sea.
    const missions = [...this.world.observed.missions.values()].filter(
      (mission) => mission.commitmentId === commitment.commitmentId,
    );
    const completed = missions.filter((mission) => mission.status === 'COMPLETED');
    // Nothing reached the buyer in time: the run ended with the vehicle still
    // out, the mission was cancelled, or it arrived after the window closed.
    if (completed.length === 0) return 'MISSION_LATE';
    const latestArrival = completed.reduce<SimulationInstant | null>(
      (latest, mission) =>
        mission.actualArrivalAt === null ? latest : latest === null ? mission.actualArrivalAt : Math.max(latest, mission.actualArrivalAt),
      null,
    );
    if (latestArrival !== null && latestArrival > demand.neededBy) return 'MISSION_LATE';

    const committedKg = commitment.allocations.reduce((total, allocation) => total + allocation.quantityKg, 0);
    const loadedKg = completed.reduce((total, mission) => total + mission.loadedKg, 0);
    if (loadedKg + CAUSE_TOLERANCE_KG < committedKg) {
      const unreadyPickup = completed.some((mission) => {
        const allocations = commitment.allocations.filter((line) => !mission.batchIds || mission.batchIds.includes(line.batchId));
        const readyAt = this.firstReportedReadyAt(allocations);
        return readyAt === null || readyAt > mission.plannedDepartureAt;
      });
      return unreadyPickup ? 'NOT_READY_IN_TIME' : 'SPOILED_BEFORE_PICKUP';
    }
    if (demand.acceptedKg + CAUSE_TOLERANCE_KG < loadedKg) return 'DELIVERY_REJECTED';


    // Promised, collected, delivered and accepted in full: the promise itself
    // was smaller than the order. Unless the reason it was smaller was that
    // supply sat on an island with no sailing to here.
    return this.noPublicRouteDemands.has(demand.demandId) ? 'NO_PUBLIC_ROUTE' : 'INSUFFICIENT_SUPPLY';
  }

  /** Whether a commitment put a consignment on a boat that never arrived. */
  private commitmentShipmentFailed(commitmentId: string): boolean {
    for (const shipment of this.world.observed.shipments.values()) {
      if (shipment.commitmentId === commitmentId && shipment.status === 'FAILED') return true;
    }
    return false;
  }

  // ------------------------------------------------------------------
  // Inter-island trade: scoping, sailings, customs and currency
  //
  // Everything below is inert for a run whose scoped network has no links,
  // which includes every one-island run. That is deliberate rather than
  // incidental: it is what lets issue #40 land without moving a single figure
  // in the Saint Lucia benchmark.
  // ------------------------------------------------------------------

  /**
   * Re-checks a policy's chosen sailing against the scoped network.
   *
   * The policy proposes a route; this decides whether that route exists. It is
   * the same discipline the quantity validation above applies to kilograms, and
   * for the same reason: a route is routing, and `AGENTS.md` requires routing to
   * be deterministic and validated rather than taken on trust from a proposal.
   *
   * Returns the route as the *dataset* records it, not as the proposal stated
   * it, so a proposal cannot smuggle in a shorter journey time or a port that
   * belongs to an island this run did not select.
   */
  private validateInterIslandRoute(
    demand: BuyerDemand,
    originIslandId: string,
    proposed: MaritimeRoute,
  ): MaritimeRoute | null {
    const buyer = this.world.buyers.get(demand.buyerId);
    if (!buyer) return null;
    if (originIslandId === buyer.islandId) return null;
    const options = routesBetween(this.world.maritime, originIslandId, buyer.islandId);
    return (
      options.find(
        (option) =>
          option.linkId === proposed.linkId &&
          option.originPortId === proposed.originPortId &&
          option.destinationPortId === proposed.destinationPortId,
      ) ?? null
    );
  }

  /**
   * Records that an order went short because no published sailing existed.
   *
   * Only ever true when there really was crop to fetch: it checks that some
   * other in-scope island is carrying observably ready supply of the right crop
   * and that the scoped dataset records no link from any of them to the buyer.
   * A run that is simply short of produce is not relabelled as a routing
   * problem, and a policy that does not coordinate across islands never reaches
   * this at all.
   */
  private recordNoPublicRouteIfNeeded(demand: BuyerDemand, promisedKg: number): void {
    if (!this.policy.capabilities.coordinatesAcrossIslands) return;
    if (promisedKg + CAUSE_TOLERANCE_KG >= demand.quantity.value) return;
    const buyer = this.world.buyers.get(demand.buyerId);
    if (!buyer) return;

    const islandsWithSupply = new Set<string>();
    for (const batch of this.world.observed.batches.values()) {
      if (batch.crop !== demand.crop) continue;
      if (batch.lastReportedStage !== 'READY') continue;
      const islandId = this.world.farms.get(batch.farmId)?.islandId;
      if (islandId === undefined || islandId === buyer.islandId) continue;
      islandsWithSupply.add(islandId);
    }
    if (islandsWithSupply.size === 0) return;

    for (const islandId of islandsWithSupply) {
      if (routesBetween(this.world.maritime, islandId, buyer.islandId).length > 0) return;
    }
    this.noPublicRouteDemands.add(demand.demandId);
  }

  /**
   * Books one approved cross-island consignment onto a published sailing.
   *
   * Three legs: a local pickup run to the origin port, the sea leg the dataset
   * records, and a local delivery run from the destination port to the buyer.
   * The whole itinerary is laid out here, at planning time, from seeded draws
   * taken once, so a replay can be scrubbed to any instant and the answer is
   * the same. Only the weather effect on the sea leg is applied later, at
   * sailing, because at planning time that day has not happened.
   */
  private planMaritimeShipment(
    commitment: Commitment,
    detail: InterIslandCommitmentDetail,
    allocations: Commitment['allocations'],
  ): void {
    const demand = this.world.observed.demands.get(commitment.demandId);
    if (!demand) return;
    const buyer = this.world.buyers.get(demand.buyerId);
    if (!buyer) return;

    // The scope is applied to the network once, when the world is built, so a
    // port that is missing here is a port this run may not use. No substitute
    // is looked for and no line is drawn.
    const originPort = findPort(this.world.maritime, detail.route.originPortId);
    const destinationPort = findPort(this.world.maritime, detail.route.destinationPortId);
    if (!originPort || !destinationPort) return;

    const loadKg = allocations.reduce((total, allocation) => total + allocation.quantityKg, 0);
    const pickupFarmIds = [...new Set(allocations.map((allocation) => allocation.farmId))].sort();
    const pickupPoints = pickupFarmIds
      .map((farmId) => this.world.farms.get(farmId)?.position)
      .filter((position): position is GeoPoint => position !== undefined);
    if (pickupPoints.length === 0) return;

    // The road legs are driven by a carrier on the island the produce is
    // leaving; the sea leg is the operator's. Same smallest-that-fits rule the
    // local planner uses, with a stable tiebreak on id.
    const originFleet = [...this.world.transporters.values()]
      .filter((transporter) => transporter.islandId === detail.originIslandId)
      .sort((a, b) => a.capacityKg - b.capacityKg || a.transporterId.localeCompare(b.transporterId));
    const vehicle = originFleet.find((candidate) => candidate.capacityKg >= loadKg) ?? originFleet.at(-1);
    if (!vehicle) return;

    const originPortPosition = portPosition(originPort);
    const destinationPortPosition = portPosition(destinationPort);

    let pickupKm = 0;
    const pickupChain = [...pickupPoints, originPortPosition];
    for (let index = 1; index < pickupChain.length; index += 1) {
      pickupKm += haversineKm(pickupChain[index - 1] as GeoPoint, pickupChain[index] as GeoPoint);
    }
    pickupKm *= ROAD_WINDING_FACTOR;
    const deliveryKm = haversineKm(destinationPortPosition, buyer.position) * ROAD_WINDING_FACTOR;

    const pickupMs = (pickupKm / vehicle.cruiseSpeedKmh) * HOUR_MS + pickupFarmIds.length * 25 * MINUTE_MS;
    const deliveryMs = (deliveryKm / vehicle.cruiseSpeedKmh) * HOUR_MS + 25 * MINUTE_MS;
    const portHandlingMs = PORT_HANDLING_HOURS * HOUR_MS;
    const seaMs = detail.route.seaLegHours * HOUR_MS;

    // Two draws from one dedicated stream, taken in a fixed order. A stream of
    // its own means adding shipments cannot shift a yield, a rainfall or an
    // identifier drawn anywhere else in the run.
    const stream = this.random.stream('maritime:shipments');
    const sailingFails = stream.next() < SAILING_FAILURE_PROBABILITY;
    const inspected = stream.next() < CUSTOMS_INSPECTION_PROBABILITY;
    const customsDelayHours = CUSTOMS_BASE_DELAY_HOURS + (inspected ? CUSTOMS_INSPECTION_EXTRA_HOURS : 0);
    const customsMs = customsDelayHours * HOUR_MS;

    const totalMs = pickupMs + portHandlingMs + seaMs + portHandlingMs + customsMs + deliveryMs;
    const desiredArrival = demand.neededBy - HOUR_MS;
    const deadlineDeparture = Math.max(this.clock + HOUR_MS, desiredArrival - totalMs);

    // Same readiness rule as a local run: once every allocated batch has been
    // reported ready, do not leave it standing in a field on the far island
    // waiting for a deadline.
    const { collectOnReadiness, maxHoldMs } = this.policy.capabilities;
    const reportedReadyAt = collectOnReadiness ? this.reportedReadyAt(allocations) : null;
    let departAt = deadlineDeparture;
    if (reportedReadyAt !== null && deadlineDeparture - reportedReadyAt > maxHoldMs) {
      departAt = Math.min(deadlineDeparture, Math.max(this.clock + HOUR_MS, reportedReadyAt + pickupMs));
    }

    const sailAt = departAt + pickupMs + portHandlingMs;
    const portArrivalAt = sailAt + seaMs;
    const clearedAt = portArrivalAt + portHandlingMs + customsMs;
    const arriveAt = clearedAt + deliveryMs;

    const legs: MaritimeLeg[] = [
      {
        kind: 'PICKUP',
        fromLabel: this.world.farms.get(pickupFarmIds[0] as string)?.name ?? 'origin farm',
        toLabel: originPort.name,
        from: pickupPoints[0] as GeoPoint,
        to: originPortPosition,
        startsAt: departAt,
        endsAt: sailAt,
      },
      {
        kind: 'SEA',
        fromLabel: originPort.name,
        toLabel: destinationPort.name,
        from: originPortPosition,
        to: destinationPortPosition,
        startsAt: sailAt,
        endsAt: portArrivalAt,
        journeyHoursSource: detail.route.journeyHoursSource,
      },
      {
        kind: 'DELIVERY',
        fromLabel: destinationPort.name,
        toLabel: buyer.name,
        from: destinationPortPosition,
        to: buyer.position,
        startsAt: clearedAt,
        endsAt: arriveAt,
      },
    ];

    const cost = shipmentCostXcd(loadKg);
    const localCurrency = islandCurrency(detail.destinationIslandId);
    const dual = (amountXcd: number) =>
      toDualCurrency(this.world.maritime, amountXcd, localCurrency) ??
      // XCD is always in scope, so this only fires for an island whose own
      // currency the dataset has no rate for; the comparison value is then the
      // only honest thing to show and both halves say XCD.
      (toDualCurrency(this.world.maritime, amountXcd, COMPARISON_CURRENCY) as NonNullable<
        ReturnType<typeof toDualCurrency>
      >);

    const shipmentId = this.ids.next();
    const missionId = this.ids.next();

    const customs: CustomsCheckpoint = {
      portId: destinationPort.id,
      status: 'PENDING',
      documentationReference: `SYN-CUSTOMS-${shipmentId.slice(0, 8).toUpperCase()}`,
      inspected,
      delayHours: customsDelayHours,
      clearedAt: null,
      feeXcd: CUSTOMS_FIXED_FEE_XCD,
      disclaimer: CUSTOMS_DISCLAIMER,
      provenance: MARITIME_OPERATIONS_PROVENANCE,
    };

    const shipment: MaritimeShipment = {
      shipmentId,
      missionId,
      commitmentId: commitment.commitmentId,
      demandId: demand.demandId,
      originIslandId: detail.originIslandId,
      destinationIslandId: detail.destinationIslandId,
      route: detail.route,
      status: 'SCHEDULED',
      capacityKg: SAILING_CAPACITY_KG,
      loadedKg: 0,
      legs,
      customs,
      cost: {
        freight: dual(cost.freightXcd),
        customsFee: dual(cost.customsFeeXcd),
        total: dual(cost.totalXcd),
      },
      scheduledDepartureAt: sailAt,
      scheduledArrivalAt: portArrivalAt,
      actualDepartureAt: null,
      actualArrivalAt: null,
      deliveredAt: null,
      failureReason: null,
      weatherDelayHours: 0,
    };

    const mission: DeliveryMission = {
      missionId,
      commitmentId: commitment.commitmentId,
      transporterId: vehicle.transporterId,
      status: 'PLANNED',
      mode: 'MARITIME',
      path: [...pickupPoints, originPortPosition, destinationPortPosition, buyer.position],
      plannedDepartureAt: departAt,
      plannedArrivalAt: arriveAt,
      actualArrivalAt: null,
      loadedKg: 0,
      batchIds: allocations.map((allocation) => allocation.batchId),
      shipmentId,
    };

    this.world.observed.shipments.set(shipmentId, shipment);
    this.world.observed.missions.set(missionId, mission);
    this.sailingFailures.set(shipmentId, sailingFails);

    this.decisions.push({
      at: this.clock,
      kind: 'HARVEST_BOOK_SAILING',
      summary:
        `Booked ${loadKg.toFixed(0)} kg from ${detail.originIslandId} to ${detail.destinationIslandId} on ` +
        `${detail.route.operator}, ${originPort.name} to ${destinationPort.name}, after inter-island approval.`,
      evidence: {
        commitmentId: commitment.commitmentId,
        shipmentId,
        linkId: detail.route.linkId,
        seaLegHours: detail.route.seaLegHours,
        journeyHoursSource: detail.route.journeyHoursSource,
        capacityKg: SAILING_CAPACITY_KG,
        customsDelayHours,
        totalCostXcd: cost.totalXcd,
        networkProvenance: MARITIME_NETWORK_PROVENANCE,
        operationsProvenance: MARITIME_OPERATIONS_PROVENANCE,
      },
    });

    this.schedule(departAt, 'MISSION_DEPART', Priority.Actor, { missionId });
    this.schedule(sailAt, 'SHIPMENT_SAIL', Priority.World, { missionId });
    this.schedule(clearedAt, 'SHIPMENT_CLEAR', Priority.World, { missionId });
    this.schedule(arriveAt, 'MISSION_ARRIVE', Priority.World, { missionId });
  }

  /**
   * The consignment leaves the origin port.
   *
   * This is where the realised weather of the sailing day acts, for the same
   * reason it acts on a departing van rather than on a planned one: at planning
   * time the day had not happened, and letting the planner read it would hand
   * the engine the foresight the design denies every policy.
   */
  private onShipmentSail(missionId: string): void {
    const mission = this.world.observed.missions.get(missionId);
    if (!mission || mission.status === 'CANCELLED' || mission.status === 'COMPLETED') return;
    const shipment = mission.shipmentId ? this.world.observed.shipments.get(mission.shipmentId) : undefined;
    if (!shipment || shipment.status === 'FAILED') return;

    shipment.status = 'DEPARTED';
    shipment.actualDepartureAt = this.clock;

    const weather = this.realisedWeatherToday(shipment.originIslandId, formatDate(this.clock));
    const speedFactor = travelSpeedFactor(weather);
    if (speedFactor >= 1) return;

    const seaLeg = shipment.legs.find((leg) => leg.kind === 'SEA');
    if (!seaLeg) return;
    const remainingMs = Math.max(0, seaLeg.endsAt - this.clock);
    const extraMs = Math.round(remainingMs * (1 / speedFactor - 1));
    if (extraMs <= 0) return;

    seaLeg.endsAt += extraMs;
    shipment.scheduledArrivalAt += extraMs;
    shipment.weatherDelayHours = Number((extraMs / HOUR_MS).toFixed(2));
    shipment.status = 'DELAYED';
    for (const leg of shipment.legs) {
      if (leg.kind !== 'DELIVERY') continue;
      leg.startsAt += extraMs;
      leg.endsAt += extraMs;
    }
    mission.plannedArrivalAt += extraMs;
    this.weatherDelayedSailings += 1;
    this.rescheduleShipment(mission, shipment);
  }

  /**
   * The consignment reaches the destination port and meets the checkpoint.
   *
   * The checkpoint is SYNTHETIC and is not a legal customs model; its delay was
   * drawn at planning time and is already built into this event's instant, so
   * all that happens here is that the paperwork is marked cleared, or the
   * sailing is written off.
   */
  private onShipmentClear(missionId: string): void {
    const mission = this.world.observed.missions.get(missionId);
    if (!mission || mission.status === 'CANCELLED' || mission.status === 'COMPLETED') return;
    const shipment = mission.shipmentId ? this.world.observed.shipments.get(mission.shipmentId) : undefined;
    if (!shipment) return;

    shipment.actualArrivalAt = this.clock;

    if (this.sailingFailures.get(shipment.shipmentId) === true) {
      shipment.status = 'FAILED';
      shipment.customs.status = 'HELD';
      shipment.failureReason =
        'The consignment did not come off the vessel in a saleable state. SYNTHETIC outcome, not a recorded incident.';
      this.shipmentsFailed += 1;

      // Cargo that was picked and lost is waste, and it is attributed to the
      // batch it came off so the figure lands somewhere accountable.
      const lostKg = mission.loadedKg;
      if (lostKg > 0) {
        const first = mission.batchIds[0];
        const truth = first ? this.world.truth.crops.get(first) : undefined;
        if (truth) truth.lostKg += lostKg;
      }

      mission.status = 'CANCELLED';
      this.missionsCancelled += 1;
      this.queue.removeWhere((event) => {
        const queuedMissionId = (event.payload as { missionId?: string }).missionId;
        return queuedMissionId === mission.missionId && event.type === 'MISSION_ARRIVE';
      });
      return;
    }

    shipment.status = 'ARRIVED';
    shipment.customs.status = 'CLEARED';
    shipment.customs.clearedAt = this.clock;
    if (shipment.customs.inspected) this.customsInspections += 1;
  }

  /** Re-queues the two remaining events of a sailing after its schedule moved. */
  private rescheduleShipment(mission: DeliveryMission, shipment: MaritimeShipment): void {
    const deliveryLeg = shipment.legs.find((leg) => leg.kind === 'DELIVERY');
    this.queue.removeWhere((event) => {
      const queuedMissionId = (event.payload as { missionId?: string }).missionId;
      return queuedMissionId === mission.missionId && (event.type === 'SHIPMENT_CLEAR' || event.type === 'MISSION_ARRIVE');
    });
    if (deliveryLeg) this.schedule(deliveryLeg.startsAt, 'SHIPMENT_CLEAR', Priority.World, { missionId: mission.missionId });
    this.schedule(mission.plannedArrivalAt, 'MISSION_ARRIVE', Priority.World, { missionId: mission.missionId });
  }

  private maritimeEffectMetrics(): MaritimeEffectMetrics {
    let shippedKg = 0;
    let totalCostXcd = 0;
    for (const shipment of this.world.observed.shipments.values()) {
      shippedKg += shipment.loadedKg;
      totalCostXcd += shipment.cost.total.comparisonAmount;
    }
    return {
      scopedLinks: this.world.maritime.links.length,
      scopedPorts: this.world.maritime.ports.length,
      shipmentsProposed: this.shipmentsProposed,
      shipmentsApproved: this.shipmentsApproved,
      shipmentsDelivered: this.shipmentsDelivered,
      shipmentsFailed: this.shipmentsFailed,
      shippedKg: Number(shippedKg.toFixed(2)),
      weatherDelayedSailings: this.weatherDelayedSailings,
      customsInspections: this.customsInspections,
      totalCostXcd: Number(totalCostXcd.toFixed(2)),
      demandsWithoutPublicRoute: this.noPublicRouteDemands.size,
    };
  }

  /** Observable shipment view for one replay frame. */
  private createShipmentFrame(): ControlRoomShipment[] {
    return [...this.world.observed.shipments.values()]
      .sort((a, b) => a.shipmentId.localeCompare(b.shipmentId))
      .map((shipment) => ({
        shipmentId: shipment.shipmentId,
        missionId: shipment.missionId,
        commitmentId: shipment.commitmentId,
        demandId: shipment.demandId,
        originIslandId: shipment.originIslandId,
        destinationIslandId: shipment.destinationIslandId,
        originPortId: shipment.route.originPortId,
        destinationPortId: shipment.route.destinationPortId,
        linkId: shipment.route.linkId,
        operator: shipment.route.operator,
        status: shipment.status,
        capacityKg: shipment.capacityKg,
        loadedKg: Number(shipment.loadedKg.toFixed(2)),
        legs: shipment.legs.map((leg) => ({
          ...leg,
          from: { ...leg.from },
          to: { ...leg.to },
        })),
        customs: { ...shipment.customs },
        cost: {
          freight: { ...shipment.cost.freight },
          customsFee: { ...shipment.cost.customsFee },
          total: { ...shipment.cost.total },
        },
        scheduledDepartureAt: shipment.scheduledDepartureAt,
        scheduledArrivalAt: shipment.scheduledArrivalAt,
        actualDepartureAt: shipment.actualDepartureAt,
        actualArrivalAt: shipment.actualArrivalAt,
        deliveredAt: shipment.deliveredAt,
        failureReason: shipment.failureReason,
        weatherDelayHours: shipment.weatherDelayHours,
        networkProvenance: MARITIME_NETWORK_PROVENANCE,
        operationsProvenance: MARITIME_OPERATIONS_PROVENANCE,
      }));
  }

  /**
   * Cross-island fills waiting on a human decision.
   *
   * The connected Product API bridge reads this, raises a real
   * `INTER_ISLAND_COMMITMENT` approval for each one, and hands back an
   * `INTER_ISLAND_COMMITMENT_APPROVED` effect only if every approver agrees.
   * Nothing here is world state, so a proposal nobody approves simply expires.
   */
  get pendingInterIslandProposals(): readonly InterIslandProposalView[] {
    return [...this.interIslandProposals.values()]
      .map((entry) => ({ ...entry.view, lines: entry.view.lines.map((line) => ({ ...line })) }))
      .sort((a, b) => a.proposedAt - b.proposedAt || a.proposalId.localeCompare(b.proposalId));
  }

  /**
   * Looks for supply on another in-scope island for orders the local island has
   * not covered.
   *
   * Connected mode only. In internal-policy mode the same decision is taken
   * inside `planAllocation`, where local and regional supply are weighed
   * together; here local matching belongs to the Product API, so the regional
   * question is asked separately and its answer is a proposal rather than a
   * commitment.
   */
  private onInterIslandReview(): void {
    // Keep the daily cadence going regardless of what this pass finds.
    this.schedule(this.clock + INTER_ISLAND_REVIEW_INTERVAL_MS, 'INTER_ISLAND_REVIEW', Priority.Actor, {});

    const planner = this.policy.planInterIslandFill;
    if (!planner || !this.policy.capabilities.coordinatesAcrossIslands) return;
    if (this.world.maritime.links.length === 0) return;

    const demands = [...this.world.observed.demands.values()]
      .filter((demand) => demand.status === 'PENDING' || demand.status === 'COMMITTED')
      .filter((demand) => demand.neededBy > this.clock)
      .filter((demand) => !this.interIslandProposedDemandIds.has(demand.demandId))
      .sort((a, b) => a.demandId.localeCompare(b.demandId));

    for (const demand of demands) {
      const buyer = this.world.buyers.get(demand.buyerId);
      if (!buyer) continue;

      // Whatever the Product API has already committed locally counts against
      // the order, so a sailing is only ever proposed for the genuine gap.
      let committedKg = 0;
      for (const commitment of this.world.observed.commitments.values()) {
        if (commitment.demandId !== demand.demandId || commitment.status === 'CANCELLED') continue;
        committedKg += commitment.allocations.reduce((total, allocation) => total + allocation.quantityKg, 0);
      }
      const shortfallKg = demand.quantity.value - committedKg;
      if (shortfallKg <= 0) continue;

      const fill = planner(this.policyContext(), demand, buyer.islandId, shortfallKg);
      if (!fill) {
        this.recordNoPublicRouteIfNeeded(demand, committedKg);
        continue;
      }

      const route = this.validateInterIslandRoute(demand, fill.proposal.originIslandId, fill.proposal.route);
      if (!route) continue;

      const quantityKg = Number(fill.allocations.reduce((total, line) => total + line.quantityKg, 0).toFixed(2));
      if (quantityKg <= 0) continue;

      const proposalId = this.ids.next();
      this.interIslandProposals.set(proposalId, {
        fill,
        view: {
          proposalId,
          demandId: demand.demandId,
          buyerId: demand.buyerId,
          originIslandId: route.originIslandId,
          destinationIslandId: route.destinationIslandId,
          linkId: route.linkId,
          originPortId: route.originPortId,
          destinationPortId: route.destinationPortId,
          operator: route.operator,
          seaLegHours: route.seaLegHours,
          journeyHoursSource: route.journeyHoursSource,
          lines: fill.allocations.map((allocation) => ({ ...allocation })),
          quantityKg,
          rationale: fill.proposal.rationale,
          proposedAt: this.clock,
        },
      });
      this.interIslandProposedDemandIds.add(demand.demandId);
      this.shipmentsProposed += 1;

      this.decisions.push({
        at: this.clock,
        kind: 'HARVEST_PROPOSE_INTER_ISLAND',
        summary:
          `Local supply left ${shortfallKg.toFixed(0)} kg short, so ${quantityKg.toFixed(0)} kg was proposed from ` +
          `${route.originIslandId} on ${route.operator}, pending inter-island approval.`,
        evidence: {
          demandId: demand.demandId,
          proposalId,
          originIslandId: route.originIslandId,
          destinationIslandId: route.destinationIslandId,
          linkId: route.linkId,
          originPortId: route.originPortId,
          destinationPortId: route.destinationPortId,
          seaLegHours: route.seaLegHours,
          journeyHoursSource: route.journeyHoursSource,
          quantityKg,
          rationale: fill.proposal.rationale,
          approvalSubjectType: 'INTER_ISLAND_COMMITMENT',
        },
      });
    }
  }

  /**
   * Turns an approved proposal into a real commitment and a real sailing.
   *
   * The commitment is created already approved, because the approval it needed
   * has just happened outside the engine, through the Product API, from named
   * human participants. Anything short of that never reaches here.
   */
  private applyInterIslandApproved(
    effect: Extract<ProductSimulationEffect, { type: 'INTER_ISLAND_COMMITMENT_APPROVED' }>,
  ): ProductEffectResult {
    const entry = this.interIslandProposals.get(effect.proposalId);
    if (!entry) return { applied: false, reason: 'REJECTED' };
    const demand = this.world.observed.demands.get(entry.view.demandId);
    if (!demand || demand.status === 'FULFILLED' || demand.status === 'UNMET') {
      return { applied: false, reason: 'REJECTED' };
    }
    const route = this.validateInterIslandRoute(demand, entry.view.originIslandId, entry.fill.proposal.route);
    if (!route) return { applied: false, reason: 'REJECTED' };

    // Revalidate the quantities exactly as the internal path does. An approval
    // decided two hours ago is not a licence to promise crop that has since
    // been picked.
    const validated: Commitment['allocations'] = [];
    for (const allocation of entry.fill.allocations) {
      const batch = this.world.observed.batches.get(allocation.batchId);
      if (!batch) continue;
      const alreadyCommitted = this.committedKgForBatch(allocation.batchId);
      const latest = batch.observations.at(-1);
      const observedCeiling = latest ? latest.estimatedYieldKg : batch.areaHectares * 1_500;
      const headroom = Math.max(0, observedCeiling - alreadyCommitted - batch.confirmedHarvestedKg);
      const granted = Number(Math.min(allocation.quantityKg, headroom).toFixed(2));
      if (granted <= 0) continue;
      validated.push({ batchId: allocation.batchId, farmId: allocation.farmId, quantityKg: Number(granted.toFixed(2)) });
    }
    if (validated.length === 0) return { applied: false, reason: 'REJECTED' };

    this.interIslandProposals.delete(effect.proposalId);

    const interIsland: InterIslandCommitmentDetail = {
      originIslandId: route.originIslandId,
      destinationIslandId: route.destinationIslandId,
      route,
      approvalSubjectType: 'INTER_ISLAND_COMMITMENT',
    };
    const commitment: Commitment = {
      commitmentId: this.ids.next(),
      demandId: demand.demandId,
      allocations: validated,
      committedAt: this.clock,
      approvedAt: this.clock,
      status: 'APPROVED',
      interIsland,
    };
    this.world.observed.commitments.set(commitment.commitmentId, commitment);
    this.commitmentsProposed += 1;
    this.commitmentsApproved += 1;
    this.shipmentsApproved += 1;
    this.totalPromisedKg += validated.reduce((total, allocation) => total + allocation.quantityKg, 0);
    this.seaBatchIdsByCommitment.set(commitment.commitmentId, validated.map((allocation) => allocation.batchId));
    if (demand.status === 'PENDING') demand.status = 'COMMITTED';

    this.planMaritimeShipment(commitment, interIsland, validated);

    const shipment = [...this.world.observed.shipments.values()].find(
      (candidate) => candidate.commitmentId === commitment.commitmentId,
    );
    if (!shipment) return { applied: false, reason: 'REJECTED' };
    return { applied: true, reason: 'APPLIED', simulationMissionId: shipment.missionId, simulationShipmentId: shipment.shipmentId };
  }

  // ------------------------------------------------------------------
  // Control-room replay
  // ------------------------------------------------------------------

  /**
   * Records one observable frame.
   *
   * Every field is copied by name. Spreading the engine's own objects would be
   * shorter and would publish hidden truth the first time somebody added a
   * field to `HiddenCropTruth`, so the verbosity is the point.
   */
  private createFrame(eventType: string): ControlRoomFrame {
    const missions: ControlRoomMission[] = [...this.world.observed.missions.values()].map((mission) => ({
      missionId: mission.missionId,
      commitmentId: mission.commitmentId,
      transporterId: mission.transporterId,
      status: mission.status,
      path: mission.path.map((point) => ({ latitude: point.latitude, longitude: point.longitude })),
      plannedDepartureAt: mission.plannedDepartureAt,
      plannedArrivalAt: mission.plannedArrivalAt,
      actualArrivalAt: mission.actualArrivalAt,
      loadedKg: Number(mission.loadedKg.toFixed(2)),
      mode: mission.mode,
    }));

    const batches: ControlRoomBatch[] = [...this.world.observed.batches.values()].map((batch) => {
      const latest = batch.observations.at(-1);
      return {
        batchId: batch.batchId,
        farmId: batch.farmId,
        crop: batch.crop,
        lastReportedStage: batch.lastReportedStage,
        lastObservedAt: batch.lastObservedAt,
        observationCount: batch.observations.length,
        latestEstimateKg: latest ? Number(latest.estimatedYieldKg.toFixed(2)) : null,
        confirmedHarvestedKg: Number(batch.confirmedHarvestedKg.toFixed(2)),
      };
    });

    const demands: ControlRoomDemand[] = [...this.world.observed.demands.values()].map((demand) => ({
      demandId: demand.demandId,
      buyerId: demand.buyerId,
      crop: demand.crop,
      quantityKg: demand.quantity.value,
      neededBy: demand.neededBy,
      status: demand.status,
      acceptedKg: Number(demand.acceptedKg.toFixed(2)),
      substitutedKg: Number(demand.substitutedKg.toFixed(2)),
    }));

    const newDecisions = this.decisions.slice(this.decisionsAtLastFrame);
    this.decisionsAtLastFrame = this.decisions.length;

    const acceptedKg = demands.reduce((total, demand) => total + demand.acceptedKg, 0);
    const substitutedKg = demands.reduce((total, demand) => total + demand.substitutedKg, 0);

    const projection = toObservableWorld(this.runId, this.clock, this.world);

    return {
      atMs: this.clock,
      at: formatInstant(this.clock),
      eventType,
      actors: projection.actors,
      missions,
      batches,
      demands,
      disruptions: projection.disruptions,
      degradedRoadSegmentIds: [...this.world.observed.degradedRoadSegmentIds].sort(),
      weather: this.createWeatherFrame(),
      // Omitted rather than sent empty, so a one-island replay is byte-for-byte
      // the shape it was before issue #40.
      ...(this.world.observed.shipments.size > 0 ? { shipments: this.createShipmentFrame() } : {}),
      newDecisions,
      totals: {
        acceptedKg: Number(acceptedKg.toFixed(2)),
        substitutedKg: Number(substitutedKg.toFixed(2)),
        promisedKg: Number(this.totalPromisedKg.toFixed(2)),
        demandsFullyMet: demands.filter((demand) => demand.status === 'FULFILLED').length,
        demandsUnmet: demands.filter((demand) => demand.status === 'UNMET').length,
        commitmentsApproved: this.commitmentsApproved,
        observationRequests: this.observationRequestCount,
      },
    };
  }

  /**
   * Observable weather for every island in the run, as of this frame.
   *
   * Today's realised conditions plus today's forecast, and nothing else. A
   * replay is handed to a browser, so a realised value for a day the frame has
   * not reached would publish hidden truth to anybody with developer tools
   * open. Both halves carry their own provenance because they are different
   * kinds of claim: one is a synthetic record, the other a synthetic prediction.
   * The record additionally carries `evidenceType`, which says whether the
   * conditions it records were generated or taken from a recorded reference —
   * a third distinction, and the one issue #90 adds.
   */
  private createWeatherFrame(): ControlRoomWeather[] {
    const observable = this.observableWeather;
    const frames: ControlRoomWeather[] = [];
    for (const islandId of this.weatherIslandIds) {
      const current = observable.current(islandId);
      if (!current) continue;
      frames.push({
        islandId,
        date: current.date,
        condition: current.condition,
        rainMm: current.rainMm,
        windKph: current.windKph,
        windFromDegrees: current.windFromDegrees,
        cloudCoverFraction: current.cloudCoverFraction,
        tempBand: current.tempBand,
        provenance: REALISED_WEATHER_PROVENANCE,
        evidenceType: current.evidenceType,
        ...(current.recordedDate ? { recordedDate: current.recordedDate } : {}),
        forecastProvenance: FORECAST_PROVENANCE,
        forecast: observable.forecast(islandId).map((day) => ({ ...day })),
      });
    }
    return frames;
  }

  private recordFrame(eventType: string): void {
    this.frames.push(this.createFrame(eventType));
  }

  private buildScene(): ControlRoomScene {
    return {
      runId: this.runId,
      scenarioId: this.scenario.scenarioId,
      policy: this.policy.name,
      seed: this.seed,
      startsAt: formatInstant(this.startsAt),
      demandEndsAt: formatInstant(this.demandEndsAt),
      endsAt: formatInstant(this.endsAt),
      farms: [...this.world.farms.values()].map((farm) => ({
        farmId: farm.farmId,
        islandId: farm.islandId,
        name: farm.name,
        position: farm.position,
        ...(farm.referencePlaceId ? { referencePlaceId: farm.referencePlaceId } : {}),
      })),
      buyers: [...this.world.buyers.values()].map((buyer) => ({
        buyerId: buyer.buyerId,
        islandId: buyer.islandId,
        name: buyer.name,
        position: buyer.position,
        minimumAcceptableFraction: buyer.minimumAcceptableFraction,
        ...(buyer.referencePlaceId ? { referencePlaceId: buyer.referencePlaceId } : {}),
      })),
      transporters: [...this.world.transporters.values()].map((transporter) => ({
        transporterId: transporter.transporterId,
        islandId: transporter.islandId,
        name: transporter.name,
        homePosition: transporter.homePosition,
        capacityKg: transporter.capacityKg,
        ...(transporter.referencePlaceId ? { referencePlaceId: transporter.referencePlaceId } : {}),
      })),
      roads: [...this.world.roads.values()].map((road) => ({
        roadSegmentId: road.roadSegmentId,
        islandId: road.islandId,
        name: road.name,
        from: road.from,
        to: road.to,
        distanceKm: road.distanceKm,
      })),
      referencePlaces: this.world.referencePlaces.map((place) => ({
        ...place,
        position: { ...place.position },
        warnings: [...place.warnings],
      })),
      referenceDataSources: this.world.referenceDataSources.map((source) => ({
        ...source,
        limitations: [...source.limitations],
      })),
      participants: [
        ...[...this.world.farms.values()].map((farm) => ({
          simulationActorId: farm.farmId,
          productActorId: null,
          role: 'FARMER' as const,
          displayName: farm.name,
          islandId: farm.islandId,
        })),
        ...[...this.world.buyers.values()].map((buyer) => ({
          simulationActorId: buyer.buyerId,
          productActorId: null,
          role: 'BUYER' as const,
          displayName: buyer.name,
          islandId: buyer.islandId,
        })),
        ...[...this.world.transporters.values()].map((transporter) => ({
          simulationActorId: transporter.transporterId,
          productActorId: null,
          role: 'TRANSPORTER' as const,
          displayName: transporter.name,
          islandId: transporter.islandId,
        })),
      ],
      weatherLegend: WEATHER_LEGEND,
      maritime: {
        ...this.world.maritime,
        islandIds: [...this.world.maritime.islandIds],
        ports: this.world.maritime.ports.map((port) => ({ ...port })),
        links: this.world.maritime.links.map((link) => ({ ...link })),
        rates: this.world.maritime.rates.map((rate) => ({ ...rate, islandIds: [...rate.islandIds] })),
      },
      maritimeAttributions: maritimeAttributions(this.world.maritime),
      maritimeDisclaimer: MARITIME_SYNTHETIC_DISCLAIMER,
      evidenceLabel: EVIDENCE_LABEL,
    };
  }

  // ------------------------------------------------------------------
  // Results
  // ------------------------------------------------------------------

  private result(): RunResult {
    const demands = [...this.world.observed.demands.values()];
    const totalDemandedKg = demands.reduce((total, demand) => total + demand.quantity.value, 0);
    const totalAcceptedKg = demands.reduce((total, demand) => total + demand.acceptedKg, 0);
    const totalSubstitutedKg = demands.reduce((total, demand) => total + demand.substitutedKg, 0);

    const wasteKg = [...this.world.truth.crops.values()].reduce((total, crop) => total + crop.lostKg, 0);

    const demandsFullyMet = demands.filter((demand) => demand.status === 'FULFILLED').length;
    const demandsPartiallyMet = demands.filter((demand) => demand.status === 'PARTIALLY_FULFILLED').length;
    const demandsUnmet = demands.filter((demand) => demand.status === 'UNMET').length;

    // One cause per demand that ended short, taken from what was recorded as it
    // settled. A demand that a late arrival pushed over the line after its
    // deadline keeps no cause, so the histogram always sums to the misses.
    const causeCounts = emptyCauseCounts();
    for (const demand of demands) {
      if (demand.status !== 'UNMET' && demand.status !== 'PARTIALLY_FULFILLED') continue;
      causeCounts[this.demandCauses.get(demand.demandId) ?? this.classifyDemand(demand)] += 1;
    }

    const metrics: RunMetrics = {
      localProcurementRate: totalDemandedKg > 0 ? clampUnit(totalAcceptedKg / totalDemandedKg) : 0,
      fulfilmentRate: demands.length > 0 ? clampUnit(demandsFullyMet / demands.length) : 0,
      wasteQuantity: { value: Number(wasteKg.toFixed(2)), unit: 'kg' },
      totalDemandedKg: Number(totalDemandedKg.toFixed(2)),
      totalAcceptedKg: Number(totalAcceptedKg.toFixed(2)),
      totalSubstitutedKg: Number(totalSubstitutedKg.toFixed(2)),
      totalPromisedKg: Number(this.totalPromisedKg.toFixed(2)),
      commitmentsProposed: this.commitmentsProposed,
      commitmentsApproved: this.commitmentsApproved,
      commitmentsDelivered: this.commitmentsDelivered,
      demandsFullyMet,
      demandsPartiallyMet,
      demandsUnmet,
      missionsCompleted: this.missionsCompleted,
      missionsCancelled: this.missionsCancelled,
      observationRequests: this.observationRequestCount,
      causeCounts,
      eventsProcessed: this.eventsProcessed,
      weather: this.weatherEffectMetrics(),
      maritime: this.maritimeEffectMetrics(),
    };

    return {
      runId: this.runId,
      scenarioId: this.scenario.scenarioId,
      policy: this.policy.name,
      seed: this.seed,
      status: this.status,
      startedAt: formatInstant(this.startsAt),
      endedAt: formatInstant(this.clock),
      metrics,
      digest: worldDigest(this.world),
      decisions: this.decisions,
      evidenceLabel: EVIDENCE_LABEL,
      provenanceNote: this.scenario.provenanceNote,
      timeline: this.captureFrames ? { scene: this.buildScene(), frames: this.frames } : undefined,
    };
  }
}

/**
 * The currency one manifest island uses, falling back to the comparison one.
 *
 * A scenario may name an island the manifest does not carry, and quoting a
 * price in a currency this package cannot convert would be worse than quoting
 * it in XCD and saying so.
 */
function islandCurrency(islandId: string): string {
  return CARIBBEAN_ISLANDS_V1.find((island) => island.islandId === islandId)?.currency ?? COMPARISON_CURRENCY;
}

/** Clamps into [0, 1]; rates that drift outside it are a bug worth surfacing as a bound. */
function clampUnit(value: number): number {
  return Number(Math.max(0, Math.min(1, value)).toFixed(6));
}

/** Convenience wrapper: build an engine and run it to completion. */
export function runScenario(options: EngineOptions): RunResult {
  return new SimulationEngine(options).run();
}

export type { HiddenCropTruth, ObservedCropBatch };
