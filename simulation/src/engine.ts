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
import type { CoordinationPolicy, DecisionRecord, PolicyContext } from './policy/types.js';
import { requireScenario, haversineKm, ROAD_WINDING_FACTOR } from './scenario/saint-lucia-demo-v1.js';
import type { Scenario } from './scenario/types.js';
import { assertNoTruthLeak, toObservableWorld, worldDigest, type ObservableWorldView } from './world/observable.js';
import type {
  ControlRoomBatch,
  ControlRoomDemand,
  ControlRoomFrame,
  ControlRoomMission,
  ControlRoomScene,
  ReplayTimeline,
} from './replay.js';
import type {
  BuyerDemand,
  Commitment,
  DeliveryMission,
  HiddenCropTruth,
  ObservedCropBatch,
  ScheduledDisruption,
  World,
} from './world/types.js';

export type PolicyName = 'BASELINE' | 'HARVEST';
export type RunStatus = 'READY' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'FAILED';

export interface EngineOptions {
  scenarioId: string;
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
  eventsProcessed: number;
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

/** How long a buyer waits past the deadline before sourcing elsewhere. */
const SUBSTITUTION_GRACE_MS = 12 * HOUR_MS;

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
  private observationRequestCount = 0;
  private readonly captureFrames: boolean;
  private readonly frames: ControlRoomFrame[] = [];
  /** How many decisions had been recorded when the previous frame was taken. */
  private decisionsAtLastFrame = 0;

  private clock: SimulationInstant;
  private readonly startsAt: SimulationInstant;
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

    this.random = new RandomSource(options.seed);
    // Identifiers come from their own stream so that adding an entity does not
    // shift weather or yield draws.
    this.ids = new IdFactory(this.random.stream('ids'));

    this.startsAt = parseInstant(this.scenario.startsAtIso);
    this.endsAt = this.startsAt + this.scenario.durationDays * DAY_MS;
    this.clock = this.startsAt;

    // The run id is drawn from the seeded stream, so a rerun of the same seed
    // reproduces it. That is what makes two runs comparable artefact-for-artefact.
    this.runId = this.ids.next();

    this.world = this.scenario.build({ random: this.random, ids: this.ids, startsAt: this.startsAt });

    // Injected disruptions join the scenario's own before anything is
    // scheduled, so they are indistinguishable from generated ones once the run
    // begins. Severity comes from a seeded stream rather than the caller, to
    // keep the outcome out of the hands of whoever is driving the demo.
    if (options.injectedDisruptions?.length) {
      const injectionStream = this.random.stream('injected:disruptions');
      for (const injected of options.injectedDisruptions) {
        const startsAt = this.startsAt + injected.offsetMs;
        if (startsAt > this.endsAt) continue;
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
    this.status = 'RUNNING';

    try {
      while (!this.queue.isEmpty) {
        const event = this.queue.pop() as ScheduledEvent;
        if (event.at > this.endsAt) break;

        this.eventsProcessed += 1;
        if (this.eventsProcessed > this.maxEvents) {
          throw new Error(
            `Run exceeded ${this.maxEvents} events, which means a handler is scheduling faster than the clock advances.`,
          );
        }

        // Time only ever moves forward. The queue guarantees ordering; this
        // guards against a handler mutating the clock directly.
        this.clock = Math.max(this.clock, event.at);
        this.handle(event);
        if (this.captureFrames) this.recordFrame(event.type);
      }

      // Settle anything still outstanding at the horizon.
      this.clock = this.endsAt;
      this.settleOutstandingDemand();
      this.status = 'COMPLETED';
    } catch (error) {
      this.status = 'FAILED';
      throw error;
    }

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
    const rainfallMm = this.world.truth.rainfallMmByDate.get(today) ?? 0;

    // Rain degrades sensitive roads. This is observable: a driver can see a
    // flooded road, so it is allowed to reach the observed world.
    for (const road of this.world.roads.values()) {
      const degraded = rainfallMm >= HEAVY_RAIN_MM && road.rainSensitivity > 0.5;
      if (degraded) {
        this.world.observed.degradedRoadSegmentIds.add(road.roadSegmentId);
      } else if (!this.isRoadDisrupted(road.roadSegmentId)) {
        this.world.observed.degradedRoadSegmentIds.delete(road.roadSegmentId);
      }
    }

    // Advance crop truth. Stage changes are physical; nobody has to see them.
    for (const crop of this.world.truth.crops.values()) {
      if (crop.stage === 'HARVESTED' || crop.stage === 'SPOILED') continue;

      if (this.clock >= crop.readyAt) {
        if (crop.stage !== 'READY') crop.stage = 'READY';

        // Spoilage runs from readiness, whether or not anyone noticed. This is
        // the loss Harvest is trying to avoid, so it must not depend on being
        // observed.
        const daysReady = Math.max(0, (this.clock - crop.readyAt) / DAY_MS);
        if (daysReady > 0) {
          const remaining = Math.max(0, crop.potentialYieldKg - crop.harvestedKg - crop.lostKg);
          const lostToday = remaining * crop.dailySpoilageRate;
          crop.lostKg += lostToday;

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

  private isRoadDisrupted(roadSegmentId: string): boolean {
    for (const runtime of this.disruptionRuntimes.values()) {
      if (runtime.active && runtime.disruption.type === 'ROAD' && runtime.disruption.affectedEntityIds.includes(roadSegmentId)) {
        return true;
      }
    }
    return false;
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

    const observed = this.world.observed.disruptions.at(-1);
    if (!observed) return;

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
        const rainfallMm = this.world.truth.rainfallMmByDate.get(today) ?? 0;
        const road = this.world.roads.get(roadSegmentId);
        // Only clear it if rain is not independently keeping it degraded.
        if (!road || rainfallMm < HEAVY_RAIN_MM || road.rainSensitivity <= 0.5) {
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

      batch.observations.push(observation);
      batch.lastObservedAt = this.clock;
      batch.lastReportedStage = truth.stage;
    }

    const intervalDays = 2 + (1 - farm.diligence) * 12;
    const jitter = stream.float(0.6, 1.4);
    this.schedule(this.clock + intervalDays * jitter * DAY_MS, 'FARMER_OBSERVATION', Priority.Actor, { farmId });
  }

  private onBuyerDemand(buyerId: string): void {
    const buyer = this.world.buyers.get(buyerId);
    if (!buyer) return;

    const stream = this.random.stream(`actor:${buyerId}:demand`);
    const quantityKg = Math.max(20, Math.round(stream.normal(buyer.typicalOrderKg, buyer.typicalOrderKg * 0.2)));
    const neededBy = this.clock + stream.int(3, 7) * DAY_MS;

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

    // Planning happens shortly after the order lands, not instantly: a
    // coordinator is not sitting on the keyboard at 3am.
    this.schedule(this.clock + 30 * MINUTE_MS, 'PLAN_ALLOCATION', Priority.Actor, { demandId: demand.demandId });
    this.schedule(neededBy + SUBSTITUTION_GRACE_MS, 'DEMAND_DEADLINE', Priority.Observation, { demandId: demand.demandId });

    // The buyer orders again later in the run.
    this.schedule(this.clock + stream.int(4, 8) * DAY_MS, 'BUYER_DEMAND', Priority.Actor, { buyerId });
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

    if (!proposal || proposal.allocations.length === 0) return;

    // VALIDATION GATE. The policy's numbers are a request, not an instruction.
    // Each allocation is checked against what the batch can actually still
    // supply, using the *observed* remaining figure rather than hidden truth —
    // the engine is checking internal consistency, not granting foresight.
    const validated: Commitment['allocations'] = [];
    for (const allocation of proposal.allocations) {
      const batch = this.world.observed.batches.get(allocation.batchId);
      if (!batch) continue;
      if (!Number.isFinite(allocation.quantityKg) || allocation.quantityKg <= 0) continue;

      const alreadyCommitted = this.committedKgForBatch(allocation.batchId);
      const latest = batch.observations.at(-1);
      // With no observation at all, fall back to the same remembered
      // per-hectare pick-lot figure the baseline quotes from.
      const observedCeiling = latest ? latest.estimatedYieldKg : batch.areaHectares * 1_500;
      const headroom = Math.max(0, observedCeiling - alreadyCommitted - batch.confirmedHarvestedKg);

      const granted = Math.min(allocation.quantityKg, headroom);
      if (granted <= 0) continue;

      validated.push({ batchId: allocation.batchId, farmId: allocation.farmId, quantityKg: Number(granted.toFixed(2)) });
    }

    if (validated.length === 0) return;

    const commitment: Commitment = {
      commitmentId: this.ids.next(),
      demandId,
      allocations: validated,
      committedAt: this.clock,
      approvedAt: null,
      status: 'PROPOSED',
    };
    this.world.observed.commitments.set(commitment.commitmentId, commitment);
    this.commitmentsProposed += 1;
    this.totalPromisedKg += validated.reduce((total, allocation) => total + allocation.quantityKg, 0);

    if (proposal.requiresApproval) {
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

    this.planMission(commitment);
  }

  private planMission(commitment: Commitment): void {
    const demand = this.world.observed.demands.get(commitment.demandId);
    if (!demand) return;
    const buyer = this.world.buyers.get(demand.buyerId);
    if (!buyer) return;

    const loadKg = commitment.allocations.reduce((total, allocation) => total + allocation.quantityKg, 0);

    // Pick the smallest vehicle that can carry the load; fall back to the
    // largest if nothing fits. Deterministic, and a stable tiebreak on id.
    const fleet = [...this.world.transporters.values()].sort(
      (a, b) => a.capacityKg - b.capacityKg || a.transporterId.localeCompare(b.transporterId),
    );
    const vehicle = fleet.find((candidate) => candidate.capacityKg >= loadKg) ?? fleet.at(-1);
    if (!vehicle) return;

    // Route: each pickup farm in a stable order, then the buyer.
    const pickupFarmIds = [...new Set(commitment.allocations.map((allocation) => allocation.farmId))].sort();
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
    const handlingMs = (pickupFarmIds.length + 1) * 25 * MINUTE_MS;

    // Depart in time to arrive before the deadline, but not before now.
    const desiredArrival = demand.neededBy - HOUR_MS;
    const departAt = Math.max(this.clock + HOUR_MS, desiredArrival - travelMs - handlingMs);
    const arriveAt = departAt + travelMs + handlingMs;

    const mission: DeliveryMission = {
      missionId: this.ids.next(),
      commitmentId: commitment.commitmentId,
      transporterId: vehicle.transporterId,
      status: 'PLANNED',
      path,
      plannedDepartureAt: departAt,
      plannedArrivalAt: arriveAt,
      actualArrivalAt: null,
      loadedKg: 0,
    };
    this.world.observed.missions.set(mission.missionId, mission);

    this.schedule(departAt, 'MISSION_DEPART', Priority.Actor, { missionId: mission.missionId });
    this.schedule(arriveAt, 'MISSION_ARRIVE', Priority.World, { missionId: mission.missionId });
  }

  private onMissionDepart(missionId: string): void {
    const mission = this.world.observed.missions.get(missionId);
    if (!mission || mission.status === 'CANCELLED') return;

    const commitment = this.world.observed.commitments.get(mission.commitmentId);
    if (!commitment || commitment.status === 'CANCELLED') return;

    // Harvest what is actually there. This is where promises meet biology: the
    // engine reads hidden truth, and whatever the policy believed is irrelevant.
    let loaded = 0;
    for (const allocation of commitment.allocations) {
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
    mission.loadedKg = Math.min(loaded, vehicle?.capacityKg ?? loaded);
    mission.status = 'ACTIVE';

    // A degraded road on the route slows the run. Both policies suffer it; only
    // Harvest gets a chance to react, and only once it is observable.
    const anyDegraded = this.world.observed.degradedRoadSegmentIds.size > 0;
    if (anyDegraded) {
      const extraMs = 2 * HOUR_MS;
      mission.plannedArrivalAt += extraMs;
      this.queue.removeWhere(
        (queued) => queued.type === 'MISSION_ARRIVE' && (queued.payload as { missionId: string }).missionId === missionId,
      );
      this.schedule(mission.plannedArrivalAt, 'MISSION_ARRIVE', Priority.World, { missionId });
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
    commitment.status = 'DELIVERED';
    this.commitmentsDelivered += 1;

    // Late arrivals are only partly accepted: a hotel kitchen that needed it
    // for service has already moved on.
    const late = this.clock > demand.neededBy;
    const acceptedKg = late ? mission.loadedKg * 0.5 : mission.loadedKg;

    demand.acceptedKg += acceptedKg;

    const rejected = mission.loadedKg - acceptedKg;
    if (rejected > 0) {
      // Rejected produce is waste. Attribute it to the first allocated batch so
      // the figure lands somewhere accountable rather than vanishing.
      const first = commitment.allocations[0];
      if (first) {
        const truth = this.world.truth.crops.get(first.batchId);
        if (truth) truth.lostKg += rejected;
      }
    }

    this.updateDemandStatus(demand);
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
  }

  private settleOutstandingDemand(): void {
    for (const demand of this.world.observed.demands.values()) {
      if (demand.status !== 'PENDING' && demand.status !== 'COMMITTED') continue;

      const settled = this.updateDemandStatus(demand);
      if (settled === 'FULFILLED') continue;

      const shortfall = Math.max(0, demand.quantity.value - demand.acceptedKg);
      demand.substitutedKg += shortfall;
      if (settled !== 'PARTIALLY_FULFILLED') demand.status = 'UNMET';
    }
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
  private recordFrame(eventType: string): void {
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

    this.frames.push({
      atMs: this.clock,
      at: formatInstant(this.clock),
      eventType,
      actors: projection.actors,
      missions,
      batches,
      demands,
      disruptions: projection.disruptions,
      degradedRoadSegmentIds: [...this.world.observed.degradedRoadSegmentIds].sort(),
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
    });
  }

  private buildScene(): ControlRoomScene {
    return {
      runId: this.runId,
      scenarioId: this.scenario.scenarioId,
      policy: this.policy.name,
      seed: this.seed,
      startsAt: formatInstant(this.startsAt),
      endsAt: formatInstant(this.endsAt),
      farms: [...this.world.farms.values()].map((farm) => ({
        farmId: farm.farmId,
        name: farm.name,
        position: farm.position,
      })),
      buyers: [...this.world.buyers.values()].map((buyer) => ({
        buyerId: buyer.buyerId,
        name: buyer.name,
        position: buyer.position,
      })),
      transporters: [...this.world.transporters.values()].map((transporter) => ({
        transporterId: transporter.transporterId,
        name: transporter.name,
        homePosition: transporter.homePosition,
        capacityKg: transporter.capacityKg,
      })),
      roads: [...this.world.roads.values()].map((road) => ({
        roadSegmentId: road.roadSegmentId,
        name: road.name,
        from: road.from,
        to: road.to,
        distanceKm: road.distanceKm,
      })),
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
      eventsProcessed: this.eventsProcessed,
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

/** Clamps into [0, 1]; rates that drift outside it are a bug worth surfacing as a bound. */
function clampUnit(value: number): number {
  return Number(Math.max(0, Math.min(1, value)).toFixed(6));
}

/** Convenience wrapper: build an engine and run it to completion. */
export function runScenario(options: EngineOptions): RunResult {
  return new SimulationEngine(options).run();
}

export type { HiddenCropTruth, ObservedCropBatch };
