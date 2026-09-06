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
import type { MaritimeRoute, ScopedMaritimeNetwork } from '../world/maritime.js';
import type {
  Buyer,
  BuyerDemand,
  Commitment,
  Farm,
  ObservableWeatherAccess,
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
  /**
   * Weather, as a participant may see it.
   *
   * Realised days that have already happened, and forecasts for the ones that
   * have not. A policy cannot reach realised weather for a future day through
   * this object — the accessor refuses it — so acting on a forecast is acting
   * on something that can be wrong, which is the point. A forecast informs a
   * decision; it never changes what the crop does.
   */
  readonly weather: ObservableWeatherAccess;
  /**
   * Ports, published links and exchange rates, already restricted to this run's
   * island scope.
   *
   * A policy cannot widen the scope through this object: everything outside it
   * was filtered out before the network was built, so a two-island run holds no
   * port belonging to a third island and there is nothing to reach for. An
   * empty `links` array is the ordinary answer for a one-island run, and for a
   * pair of islands the reviewed dataset records no published service between.
   */
  readonly maritime: ScopedMaritimeNetwork;
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
  /**
   * Set when part of this proposal is sourced from another island.
   *
   * Carried explicitly rather than inferred from the allocations' farms,
   * because the route was chosen against the scoped network at proposal time
   * and re-deriving it later would let a different network answer the same
   * question. `batchIds` names exactly which allocations travel by sea, so the
   * engine splits the commitment into a road mission and a sailing without
   * guessing.
   *
   * A proposal carrying this block requires the `INTER_ISLAND_COMMITMENT`
   * approval subject rather than the ordinary `ALLOCATION` one, and `AGENTS.md`
   * requires that gate before it binds anybody.
   */
  interIsland?: InterIslandProposal;
}

/** A cross-island fill: the route chosen, and the allocations that ride on it. */
export interface InterIslandFill {
  proposal: InterIslandProposal;
  allocations: Array<{ batchId: string; farmId: string; quantityKg: number }>;
}

export interface InterIslandProposal {
  originIslandId: string;
  destinationIslandId: string;
  route: MaritimeRoute;
  /** Allocations in this proposal that must cross by sea. */
  batchIds: string[];
  /** Why this island and this sailing won, as a readable line. */
  rationale: string;
}

/** How a policy responds to an observed disruption. */
export interface RecoveryProposal {
  disruptionId: string;
  action: 'REROUTE' | 'RESCHEDULE' | 'REALLOCATE' | 'CANCEL' | 'NONE';
  affectedMissionIds: string[];
  summary: string;
}

/**
 * Coordination levers the engine grants a policy.
 *
 * These are scheduling behaviours the engine performs, so they cannot live
 * inside a policy function, but they are coordination rather than physics: a
 * fragmented market where nobody holds the whole picture does not notice that a
 * crop was reported ready this morning, and does not revisit an order it
 * already failed to fill. Declaring them here keeps the engine from branching
 * on a policy's name, and keeps the difference between the two arms of the
 * benchmark visible in one place.
 */
export interface PolicyCapabilities {
  /**
   * Collect a batch once it has been reported ready, rather than scheduling the
   * pickup to arrive just before the delivery deadline.
   */
  readonly collectOnReadiness: boolean;
  /**
   * Longest a batch reported ready may be left in the field before collection
   * is brought forward. Only consulted when `collectOnReadiness` is set.
   */
  readonly maxHoldMs: number;
  /** Re-run matching for demand still waiting when new ready supply is reported. */
  readonly rematchOnNewSupply: boolean;
  /**
   * Read the shared weather forecast when scheduling a collection.
   *
   * Declared here for the same reason the two levers above are: it is a
   * coordination behaviour the engine performs, and a fragmented market has
   * nobody comparing a forecast against a field full of ready crop. Withholding
   * it from the baseline is a modelling choice, and it is stated rather than
   * hidden inside an `if (policy.name === ...)`.
   */
  readonly readsForecast: boolean;
  /**
   * Look for supply on other in-scope islands when the local island cannot
   * cover an order.
   *
   * Declared for the same reason as the levers above. A fragmented market has
   * nobody who can see a ready crop on the next island, let alone book it onto
   * a boat, so this belongs to the coordinated arm alone — and the reason it
   * does is written here rather than discovered inside a name check.
   */
  readonly coordinatesAcrossIslands: boolean;
}

export interface CoordinationPolicy {
  readonly name: 'BASELINE' | 'HARVEST';
  readonly description: string;
  readonly capabilities: PolicyCapabilities;

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

  /**
   * Chooses a source island and a published sailing for the part of an order
   * the buyer's own island cannot cover.
   *
   * Optional because it is a capability rather than an obligation: a policy
   * that declares `coordinatesAcrossIslands: false` does not implement it, and
   * the engine never asks. Separated from `planAllocation` so that the
   * connected Product API flow, where local matching belongs to the Product API
   * and not to this policy, can ask for the regional decision on its own.
   */
  planInterIslandFill?(
    context: PolicyContext,
    demand: BuyerDemand,
    destinationIslandId: string,
    shortfallKg: number,
  ): InterIslandFill | null;
}
