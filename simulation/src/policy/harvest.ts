/**
 * The Harvest-enabled policy.
 *
 * Its advantage over the baseline is coordination, not clairvoyance. It reads
 * exactly the same observed world: the same grower reports, the same staleness,
 * the same visible disruptions. It has no access to hidden truth, so it cannot
 * know a real yield or a coming road closure.
 *
 * What it does differently:
 *
 *   - **Promises a conservative quantity, from a date it can keep.** A grower's
 *     estimate is treated as a central guess and discounted for how stale it is
 *     and how much that grower's reports have disagreed with each other. A crop
 *     still in the ground may be promised, because a buyer asking for produce
 *     next week is asking for exactly that, but only from the late end of the
 *     grower's own stated window and only when the journey still fits before
 *     the deadline. Promising less, and dating it, is what makes a promise
 *     worth something.
 *   - **Sources across farms.** One order may draw on several batches, so an
 *     order larger than any single grower's supply is still fillable.
 *   - **Routes commitments through an approval gate.** `docs/architecture.md`
 *     requires human approval before a commitment, and this models it.
 *   - **Recovers from disruptions.** Because something holds the whole picture,
 *     a closed road can be rerouted and a broken vehicle's load reassigned.
 *
 * The discount below is a deterministic rule, not a model. Issue #7 owns the
 * real quantile estimator; when it lands, `estimateAvailableKg` is where it
 * plugs in, and its output would still pass through the same validation.
 */

import type {
  AllocationProposal,
  CoordinationPolicy,
  PolicyContext,
  RecoveryProposal,
} from './types.js';
import type { Buyer, BuyerDemand, Commitment, ObservedCropBatch, ObservedDisruption } from '../world/types.js';
import type { SimulationInstant } from '../core/time.js';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '../core/time.js';
import { haversineKm, ROAD_WINDING_FACTOR } from '../scenario/saint-lucia-demo-v1.js';
import { STALE_OBSERVATION_MS } from './baseline.js';

/**
 * A stand-in for the q10 of a proper quantile model.
 *
 * A fresh, corroborated estimate is discounted to 85%; a stale or erratic one
 * far further. SYNTHETIC and rule-based; issue #7 replaces it.
 */
const BASE_CONFIDENCE_FACTOR = 0.85;

/** Floor on the discount, so a very stale report is heavily distrusted but not zeroed. */
const MINIMUM_CONFIDENCE_FACTOR = 0.35;

/** Never promise from a batch with no reports at all. */
const UNOBSERVED_AVAILABLE_KG = 0;

/**
 * Longest a batch reported ready is left in the field before collection.
 *
 * Cucumbers lose six to fourteen percent of themselves a day once ready, so a
 * pickup scheduled to arrive just before a delivery deadline three days out can
 * lose a third of the promise before the vehicle leaves. Half a day is the
 * slack a coordinator would allow for arranging a run; past that, go and get it.
 * SYNTHETIC and rule-based, like the discount above.
 */
export const MAX_READY_HOLD_DAYS = 0.5;
export const MAX_READY_HOLD_MS = MAX_READY_HOLD_DAYS * DAY_MS;

/**
 * Soonest a vehicle can be on the road after a commitment is cleared.
 *
 * The engine will not schedule a departure inside this hour, so a promise made
 * without allowing for it is a promise that arrives late. Mirrors the engine
 * rather than adding a margin of its own.
 */
const DISPATCH_LEAD_MS = HOUR_MS;

/**
 * When the produce on a batch becomes collectable, as the growers have
 * described it, or null when the batch cannot be promised at all.
 *
 * A batch reported READY is collectable now. A batch still growing or maturing
 * is dated from the *late* end of the grower's own stated window, which is the
 * conservative reading of a claim about the future and the one that keeps a
 * forward promise keepable. Nothing else can be promised: a planted field has
 * no crop in it yet, and a harvested or spoiled one has none left.
 *
 * `expectedReadyTo` is what the grower said at planting and is part of the
 * observed world. The hidden `readyAt` is not read here, and reading it is the
 * whole thing this benchmark exists to rule out.
 */
function collectableFrom(now: SimulationInstant, batch: ObservedCropBatch): SimulationInstant | null {
  switch (batch.lastReportedStage) {
    case 'READY':
      return now;
    case 'GROWING':
    case 'MATURING':
      return batch.expectedReadyTo;
    default:
      return null;
  }
}

/**
 * How long collecting from this farm and delivering to this buyer takes.
 *
 * Deliberately the same arithmetic the engine uses to schedule the mission it
 * will actually run — an hour before a vehicle can be got on the road, then
 * straight-line distance with the same winding factor, one pickup stop and a
 * drop at 25 minutes each — so a promise is not made on a journey time the
 * engine then disagrees with and cannot keep. The slowest vehicle in the fleet
 * is assumed, because a promise should not depend on the fastest one being
 * free.
 */
function collectionLeadMs(context: PolicyContext, batch: ObservedCropBatch, buyer: Buyer): number {
  const farm = context.farms.get(batch.farmId);
  if (!farm) return Number.POSITIVE_INFINITY;
  const cruiseSpeedKmh = Math.min(
    ...[...context.transporters.values()].map((transporter) => transporter.cruiseSpeedKmh),
  );
  if (!Number.isFinite(cruiseSpeedKmh) || cruiseSpeedKmh <= 0) return Number.POSITIVE_INFINITY;
  const distanceKm = haversineKm(farm.position, buyer.position) * ROAD_WINDING_FACTOR;
  return DISPATCH_LEAD_MS + (distanceKm / cruiseSpeedKmh) * HOUR_MS + 2 * 25 * MINUTE_MS;
}

/**
 * How much the grower's reports have disagreed, as a coefficient of variation.
 *
 * Returns 0 when there are fewer than two reports: with one data point there is
 * no evidence of instability, and inventing some would penalise a diligent
 * grower who happened to report once.
 */
function reportVariability(batch: ObservedCropBatch): number {
  const estimates = batch.observations.map((observation) => observation.estimatedYieldKg);
  if (estimates.length < 2) return 0;

  const mean = estimates.reduce((total, value) => total + value, 0) / estimates.length;
  if (mean <= 0) return 1;

  const variance = estimates.reduce((total, value) => total + (value - mean) ** 2, 0) / estimates.length;
  return Math.sqrt(variance) / mean;
}

export const harvestPolicy: CoordinationPolicy = {
  name: 'HARVEST',
  description:
    'Coordinated: uncertainty-discounted available-to-promise, multi-farm allocation, an explicit human ' +
    'approval gate, and deterministic recovery from observed disruptions.',

  // Something holds the whole picture here, so a reported-ready crop is
  // collected rather than left waiting for the delivery deadline, and an order
  // that could not be filled when it arrived is matched again when new supply
  // is reported.
  capabilities: {
    collectOnReadiness: true,
    maxHoldMs: MAX_READY_HOLD_MS,
    rematchOnNewSupply: true,
  },

  estimateAvailableKg(context: PolicyContext, batch: ObservedCropBatch): number {
    const latest = batch.observations.at(-1);

    // No report means no evidence. The baseline would quote from memory here;
    // promising against a field nobody has looked at is exactly the behaviour
    // that produces a missed delivery.
    if (!latest) return UNOBSERVED_AVAILABLE_KG;

    const ageMs = Math.max(0, context.now - latest.observedAt);
    // Confidence decays linearly to the staleness horizon and is floored there.
    const stalenessPenalty = Math.min(1, ageMs / STALE_OBSERVATION_MS) * 0.4;
    const variabilityPenalty = Math.min(0.3, reportVariability(batch));

    const factor = Math.max(MINIMUM_CONFIDENCE_FACTOR, BASE_CONFIDENCE_FACTOR - stalenessPenalty - variabilityPenalty);

    // Supply already picked is no longer promisable.
    const remaining = Math.max(0, latest.estimatedYieldKg - batch.confirmedHarvestedKg);
    return remaining * factor;
  },

  planAllocation(context: PolicyContext, demand: BuyerDemand): AllocationProposal | null {
    const wanted = demand.quantity.value;
    const buyer = context.buyers.get(demand.buyerId);
    if (!buyer) return null;

    const candidates = [...context.observed.batches.values()]
      .filter((batch) => batch.crop === demand.crop)
      .filter((batch) => context.farms.get(batch.farmId)?.islandId === buyer.islandId)
      // The defining difference from the baseline, and it is a difference of
      // dating rather than of optimism. The baseline promises against a stated
      // calendar window and then sends a vehicle whenever it likes. Harvest
      // will promise a crop that is still growing — a buyer asking for produce
      // next week wants exactly that — but only when the grower's own late
      // estimate of readiness, plus the journey it will take to collect and
      // deliver, still lands before the buyer needs it.
      //
      // It still refuses orders it could nominally fill — a crop whose stated
      // window closes after the buyer needs it is not supply, however much of
      // it there is. That is the trade: promises dated against the field
      // rather than against the calendar, and a keepable date is what makes a
      // promise worth having.
      .map((batch) => ({ batch, collectableFrom: collectableFrom(context.now, batch) }))
      .filter((candidate): candidate is { batch: ObservedCropBatch; collectableFrom: SimulationInstant } =>
        candidate.collectableFrom !== null)
      .filter((candidate) =>
        candidate.collectableFrom + collectionLeadMs(context, candidate.batch, buyer) <= demand.neededBy)
      .map(({ batch, collectableFrom: readyFrom }) => ({
        batch,
        forward: readyFrom > context.now,
        availableKg: harvestPolicy.estimateAvailableKg(context, batch),
      }))
      .filter((candidate) => candidate.availableKg > 0)
      // Draw on the best-evidenced supply first, then by id so ties are stable
      // across runs. An unstable tiebreak would make the benchmark irreproducible.
      .sort((a, b) => b.availableKg - a.availableKg || a.batch.batchId.localeCompare(b.batch.batchId));

    // Where the evidence is missing or old, go and ask for it rather than
    // promising on it. Two groups qualify, and the second is the one a policy
    // that only chases missing evidence never asks about:
    //
    //   - a plausible batch nobody has looked at recently enough to promise
    //     against at all, when the ready supply on hand does not cover the
    //     order. Its stated window has opened, so it might be ready even though
    //     the last report predates that;
    //   - a batch still carrying a READY report that has itself gone stale.
    //     That report is the very thing being promised against, and a five-day
    //     old sighting of a crop losing a tenth of itself a day is the least
    //     trustworthy evidence in the set, whether or not the order is covered.
    const promised0 = candidates.reduce((total, candidate) => total + candidate.availableKg, 0);
    const staleBy = (batch: ObservedCropBatch, horizonMs: number): boolean =>
      batch.lastObservedAt === null || context.now - batch.lastObservedAt > horizonMs;

    const worthChecking = [...context.observed.batches.values()]
      .filter((batch) => batch.crop === demand.crop)
      .filter((batch) => context.farms.get(batch.farmId)?.islandId === buyer.islandId)
      .filter((batch) => batch.lastReportedStage !== 'HARVESTED' && batch.lastReportedStage !== 'SPOILED')
      .filter((batch) => batch.expectedReadyFrom <= demand.neededBy)
      .filter((batch) =>
        batch.lastReportedStage === 'READY'
          ? staleBy(batch, STALE_OBSERVATION_MS)
          : promised0 < wanted && staleBy(batch, STALE_OBSERVATION_MS / 2),
      )
      .sort((a, b) => a.batchId.localeCompare(b.batchId));

    for (const batch of worthChecking) context.requestObservation(batch.batchId);

    if (worthChecking.length > 0) {
      context.record({
        kind: 'HARVEST_REQUEST_OBSERVATION',
        summary: `Asked ${worthChecking.length} grower(s) to check and report, rather than promising on stale evidence.`,
        evidence: {
          demandId: demand.demandId,
          batchesAsked: worthChecking.length,
          coveredKg: Number(promised0.toFixed(2)),
          requestedKg: wanted,
        },
      });
    }

    if (candidates.length === 0) {
      context.record({
        kind: 'HARVEST_NO_SAFE_SUPPLY',
        summary: 'No batch had evidence recent enough to promise against, so nothing was committed yet.',
        evidence: { demandId: demand.demandId, crop: demand.crop, candidates: 0 },
      });
      return null;
    }

    // Fill greedily across farms until the order is covered. Multi-farm
    // fulfilment is the normal case, not a fallback.
    const allocations: Array<{ batchId: string; farmId: string; quantityKg: number }> = [];
    let remaining = wanted;
    let forwardCount = 0;

    for (const candidate of candidates) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, candidate.availableKg);
      // Skip trivial slivers: a 200 g line on a delivery manifest is noise, and
      // it costs a pickup stop to collect.
      if (take < 1) continue;
      allocations.push({
        batchId: candidate.batch.batchId,
        farmId: candidate.batch.farmId,
        quantityKg: Number(take.toFixed(2)),
      });
      if (candidate.forward) forwardCount += 1;
      remaining -= take;
    }

    if (allocations.length === 0) return null;

    const promised = allocations.reduce((total, allocation) => total + allocation.quantityKg, 0);

    context.record({
      kind: 'HARVEST_PROPOSE_ALLOCATION',
      summary:
        `Proposed ${promised.toFixed(0)} kg of ${wanted.toFixed(0)} kg requested, drawn from ` +
        `${allocations.length} farm(s) on uncertainty-discounted estimates, ` +
        `${forwardCount} of them against a crop not yet reported ready.`,
      evidence: {
        demandId: demand.demandId,
        requestedKg: wanted,
        promisedKg: Number(promised.toFixed(2)),
        farmCount: allocations.length,
        forwardPromises: forwardCount,
        shortfallKg: Number(Math.max(0, wanted - promised).toFixed(2)),
        discountApplied: true,
      },
    });

    return {
      demandId: demand.demandId,
      allocations,
      // A commitment binds a farmer to deliver; architecture requires a human
      // to clear that.
      requiresApproval: true,
    };
  },

  approveCommitment(context: PolicyContext, commitment: Commitment): boolean {
    // The approver's job is to re-check the promise against current evidence,
    // not to rubber-stamp it. Between proposal and approval a report may have
    // gone stale or a batch may have been picked.
    const stillCovered = commitment.allocations.every((allocation) => {
      const batch = context.observed.batches.get(allocation.batchId);
      if (!batch) return false;
      return harvestPolicy.estimateAvailableKg(context, batch) >= allocation.quantityKg;
    });

    context.record({
      kind: stillCovered ? 'HARVEST_APPROVED' : 'HARVEST_APPROVAL_DECLINED',
      summary: stillCovered
        ? 'Approver confirmed every allocated quantity is still supported by current evidence.'
        : 'Approver declined: evidence no longer supports at least one allocated quantity.',
      evidence: { commitmentId: commitment.commitmentId, allocationCount: commitment.allocations.length },
    });

    return stillCovered;
  },

  respondToDisruption(context: PolicyContext, disruption: ObservedDisruption): RecoveryProposal {
    const affected = [...context.observed.missions.values()]
      .filter((mission) => mission.status === 'PLANNED' || mission.status === 'ACTIVE')
      .filter((mission) => {
        switch (disruption.type) {
          case 'ROAD':
            // Any mission not yet delivered is a reroute candidate; the engine
            // decides whether an alternative actually exists.
            return true;
          case 'VEHICLE':
            return disruption.affectedEntityIds.includes(mission.transporterId);
          case 'CROP':
          case 'WEATHER':
          case 'DEMAND':
            return true;
        }
      })
      .map((mission) => mission.missionId)
      .sort();

    const action: RecoveryProposal['action'] =
      disruption.type === 'ROAD'
        ? 'REROUTE'
        : disruption.type === 'VEHICLE'
          ? 'RESCHEDULE'
          : disruption.type === 'CROP'
            ? 'REALLOCATE'
            : 'RESCHEDULE';

    context.record({
      kind: 'HARVEST_RECOVERY_PROPOSED',
      summary: `Proposed ${action.toLowerCase()} for ${affected.length} mission(s) after a visible ${disruption.type.toLowerCase()} disruption.`,
      evidence: {
        disruptionId: disruption.disruptionId,
        type: disruption.type,
        action,
        missionCount: affected.length,
      },
    });

    return {
      disruptionId: disruption.disruptionId,
      action: affected.length > 0 ? action : 'NONE',
      affectedMissionIds: affected,
      summary: `Coordinated ${action.toLowerCase()} covering ${affected.length} mission(s).`,
    };
  },
};

/** How far ahead the Harvest policy is willing to plan a pickup. */
export const PLANNING_HORIZON_MS = 3 * DAY_MS;
