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
 *   - **Promises a conservative quantity.** A grower's estimate is treated as a
 *     central guess and discounted for how stale it is and how much that
 *     grower's reports have disagreed with each other. Promising less is what
 *     makes a promise worth something.
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
import type { BuyerDemand, Commitment, ObservedCropBatch, ObservedDisruption } from '../world/types.js';
import { DAY_MS } from '../core/time.js';
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

    const candidates = [...context.observed.batches.values()]
      .filter((batch) => batch.crop === demand.crop)
      // The defining difference from the baseline. The baseline promises
      // against the grower's stated calendar window, which is a guess made at
      // planting. Harvest promises only against a batch someone has actually
      // reported as ready, so it is committing to produce that exists rather
      // than produce that is scheduled to exist.
      //
      // This costs it some orders it might have filled. That is the trade:
      // fewer promises, and the ones it makes are keepable.
      .filter((batch) => batch.lastReportedStage === 'READY')
      .filter((batch) => batch.expectedReadyFrom <= demand.neededBy)
      .map((batch) => ({ batch, availableKg: harvestPolicy.estimateAvailableKg(context, batch) }))
      .filter((candidate) => candidate.availableKg > 0)
      // Draw on the best-evidenced supply first, then by id so ties are stable
      // across runs. An unstable tiebreak would make the benchmark irreproducible.
      .sort((a, b) => b.availableKg - a.availableKg || a.batch.batchId.localeCompare(b.batch.batchId));

    // Where the evidence is missing, go and ask for it rather than simply
    // declining. Any batch whose stated window has opened is a plausible
    // source that nobody has looked at recently enough to promise against.
    const promised0 = candidates.reduce((total, candidate) => total + candidate.availableKg, 0);
    if (promised0 < wanted) {
      const worthChecking = [...context.observed.batches.values()]
        .filter((batch) => batch.crop === demand.crop)
        .filter((batch) => batch.lastReportedStage !== 'READY')
        .filter((batch) => batch.lastReportedStage !== 'HARVESTED' && batch.lastReportedStage !== 'SPOILED')
        // Its stated window has opened, so it might be ready even though the
        // last report predates that.
        .filter((batch) => batch.expectedReadyFrom <= demand.neededBy)
        .filter((batch) => batch.lastObservedAt === null || context.now - batch.lastObservedAt > STALE_OBSERVATION_MS / 2)
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
      remaining -= take;
    }

    if (allocations.length === 0) return null;

    const promised = allocations.reduce((total, allocation) => total + allocation.quantityKg, 0);

    context.record({
      kind: 'HARVEST_PROPOSE_ALLOCATION',
      summary:
        `Proposed ${promised.toFixed(0)} kg of ${wanted.toFixed(0)} kg requested, drawn from ` +
        `${allocations.length} farm(s) on uncertainty-discounted estimates.`,
      evidence: {
        demandId: demand.demandId,
        requestedKg: wanted,
        promisedKg: Number(promised.toFixed(2)),
        farmCount: allocations.length,
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
