/**
 * Coordination policies.
 *
 * A policy decides what the *system* does when something happens: which farms
 * to draw on for an order, whether to promise a quantity at all, and what to do
 * when a road closes. It does not decide what the world does — biology, weather
 * and traffic belong to the engine.
 *
 * That division is the point. Swapping the policy while holding the scenario
 * and seed fixed isolates coordination as the only variable, which is what
 * issue #11's paired benchmark needs in order to claim anything.
 *
 * A policy receives `PolicyContext`, which exposes the observed world and the
 * static cast. It has no route to `HiddenTruth`. A policy that could read a
 * true yield would trivially beat the baseline and prove nothing.
 */

import type { RandomStream } from '../core/random.js';
import type { IdFactory } from '../core/ids.js';
import type { SimulationInstant } from '../core/time.js';
import type {
  Buyer,
  BuyerDemand,
  Commitment,
  Farm,
  ObservedCropBatch,
  ObservedDisruption,
  ObservedWorld,
  RoadSegment,
  Transporter,
} from '../world/types.js';

/** A decision a policy took, recorded for the agent trace and the benchmark. */
export interface DecisionRecord {
  at: SimulationInstant;
  kind: string;
  /** One line a human can read in a trace. Never private chain-of-thought. */
  summary: string;
  /** The evidence the decision rested on. */
  evidence: Record<string, string | number | boolean>;
}

/**
 * What a policy may see and do.
 *
 * Deliberately narrow. Everything here is either read-only observed state or a
 * request the engine validates before applying, so a policy cannot mutate the
 * world behind the engine's back.
 */
export interface PolicyContext {
  readonly now: SimulationInstant;
  readonly observed: ObservedWorld;
  readonly farms: ReadonlyMap<string, Farm>;
  readonly buyers: ReadonlyMap<string, Buyer>;
  readonly transporters: ReadonlyMap<string, Transporter>;
  readonly roads: ReadonlyMap<string, RoadSegment>;
  readonly ids: IdFactory;
  /** A stream reserved for policy decisions, independent of world generation. */
  readonly random: RandomStream;
  /** Records a decision for the trace. */
  record(decision: Omit<DecisionRecord, 'at'>): void;
  /**
   * Asks the grower to go and look at a batch, and report back.
   *
   * This is a coordination lever, not a way to see the truth. It brings the
   * *next observation* forward; the reading that comes back is as noisy as any
   * other, and how fast it arrives depends on how diligent that grower is.
   *
   * It exists because a policy that only waits for evidence cannot work.
   * Growers report every few days to a fortnight, while buyers want an answer
   * within a week, so a batch routinely becomes ready and is never reported as
   * ready before the deadline passes. Being able to ask is the difference
   * between conservatism that protects a buyer and conservatism that simply
   * declines every order.
   *
   * The engine decides what an ask actually costs and when the answer lands.
   */
  requestObservation(batchId: string): void;
}

/**
 * A proposed allocation, before the engine validates it.
 *
 * The engine re-checks every quantity against available supply and rejects the
 * proposal outright if it does not hold. `AGENTS.md` requires quantities,
 * reservations and allocation to be deterministic and validated, so a policy
 * proposes and the engine decides — even when the policy is plain code today
 * and an agent tomorrow.
 */
export interface AllocationProposal {
  demandId: string;
  allocations: Array<{ batchId: string; farmId: string; quantityKg: number }>;
  /**
   * Whether this policy routes commitments through a human approval gate.
   *
   * `docs/architecture.md` requires approval before a commitment. The Harvest
   * policy models that gate explicitly; the fragmented baseline models today's
   * reality, where a grower says yes on the phone and nobody records anything.
   */
  requiresApproval: boolean;
}

/** How a policy responds to an observed disruption. */
export interface RecoveryProposal {
  disruptionId: string;
  action: 'REROUTE' | 'RESCHEDULE' | 'REALLOCATE' | 'CANCEL' | 'NONE';
  affectedMissionIds: string[];
  summary: string;
}

export interface CoordinationPolicy {
  readonly name: 'BASELINE' | 'HARVEST';
  readonly description: string;

  /**
   * Called when a buyer posts demand. Returning `null` means no promise was
   * made, which for the baseline is a common and realistic outcome.
   */
  planAllocation(context: PolicyContext, demand: BuyerDemand): AllocationProposal | null;

  /** Called when a disruption becomes observable. */
  respondToDisruption(context: PolicyContext, disruption: ObservedDisruption): RecoveryProposal;

  /**
   * Estimates available-to-promise kilograms for a batch.
   *
   * This is where the two policies differ most. The baseline trusts the
   * grower's headline number; Harvest discounts for uncertainty so that it
   * promises less and misses less.
   */
  estimateAvailableKg(context: PolicyContext, batch: ObservedCropBatch): number;

  /** Called when a commitment reaches its approval gate, if it has one. */
  approveCommitment(context: PolicyContext, commitment: Commitment): boolean;
}
