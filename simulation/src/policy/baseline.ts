/**
 * The fragmented baseline: how this coordination happens today.
 *
 * The baseline is not a straw man, and it matters that it is not. If the
 * comparison in issue #11 is to mean anything, the baseline has to be a fair
 * model of current practice rather than a deliberately incompetent one.
 *
 * What it models:
 *
 *   - A buyer phones round and takes the first grower who says yes. There is no
 *     view across farms, so one order is filled from one farm.
 *   - The grower quotes a headline number from the last time they looked at the
 *     field. Nobody discounts it for uncertainty, because nobody is tracking
 *     uncertainty.
 *   - Nothing is recorded, so there is no approval step to clear.
 *   - When a road closes, nobody is coordinating, so the delivery simply fails.
 *     There is no reroute because there is no one holding the whole picture.
 *
 * Every one of these is a real behaviour, not an invented weakness. The
 * baseline loses on coordination, which is the thing being measured.
 */

import type {
  AllocationProposal,
  CoordinationPolicy,
  PolicyContext,
  RecoveryProposal,
} from './types.js';
import type { BuyerDemand, Commitment, ObservedCropBatch, ObservedDisruption } from '../world/types.js';
import { DAY_MS } from '../core/time.js';

/**
 * A rough per-hectare pick-lot figure a grower would quote from memory.
 *
 * SYNTHETIC, and deliberately above the mean the scenario draws actual lots
 * from (1,200 kg/ha). Growers quote good years, and that optimism is precisely
 * the behaviour the baseline is modelling.
 */
const REMEMBERED_YIELD_PER_HECTARE_KG = 1_500;

/**
 * The grower's quoted number, taken at face value.
 *
 * A module-level function rather than a `this` call from `planAllocation`:
 * `this` inside a contextually typed object literal is easy to break later by
 * destructuring the policy, and the failure would be a runtime `undefined`
 * rather than a type error.
 */
function quotedAvailableKg(batch: ObservedCropBatch): number {
  // Take the most recent observation at face value if one exists. No adjustment
  // for how stale it is or how variable the grower's reports have been, because
  // nobody is keeping that history.
  const latest = batch.observations.at(-1);
  if (latest) return latest.estimatedYieldKg;

  // Never observed: quote from area and a remembered per-hectare figure.
  return batch.areaHectares * REMEMBERED_YIELD_PER_HECTARE_KG;
}

export const baselinePolicy: CoordinationPolicy = {
  name: 'BASELINE',
  description:
    'Fragmented coordination: single-farm sourcing, undiscounted grower estimates, no approval step, ' +
    'and no recovery path when a delivery is disrupted.',

  // Nobody is watching the whole picture, so nothing brings a pickup forward
  // when a grower mentions the crop is ready, and nobody revisits an order that
  // could not be filled when it was first phoned round. The truck turns up when
  // the buyer said they needed it.
  capabilities: {
    collectOnReadiness: false,
    maxHoldMs: Number.POSITIVE_INFINITY,
    rematchOnNewSupply: false,
  },

  estimateAvailableKg(_context: PolicyContext, batch: ObservedCropBatch): number {
    return quotedAvailableKg(batch);
  },

  planAllocation(context: PolicyContext, demand: BuyerDemand): AllocationProposal | null {
    const buyer = context.buyers.get(demand.buyerId);
    if (!buyer) return null;
    // Only batches whose stated window covers the deadline are candidates. The
    // stated window is the grower's, and it is wrong more often than not.
    const candidates = [...context.observed.batches.values()]
      .filter((batch) => batch.crop === demand.crop)
      .filter((batch) => context.farms.get(batch.farmId)?.islandId === buyer.islandId)
      .filter((batch) => batch.expectedReadyFrom <= demand.neededBy)
      .filter((batch) => batch.lastReportedStage !== 'HARVESTED' && batch.lastReportedStage !== 'SPOILED')
      // Deterministic order: the buyer works down a contact list, and that list
      // does not reshuffle itself between runs.
      .sort((a, b) => a.batchId.localeCompare(b.batchId));

    if (candidates.length === 0) {
      context.record({
        kind: 'BASELINE_NO_SUPPLY',
        summary: `No grower on the contact list had ${demand.crop} for the requested date.`,
        evidence: { demandId: demand.demandId, crop: demand.crop, candidates: 0 },
      });
      return null;
    }

    // The defining limitation: one order, one farm. The first grower who can
    // plausibly cover it gets the whole order, and if none can, the largest
    // single grower takes it and everyone hopes.
    const wanted = demand.quantity.value;
    const covering = candidates.find((batch) => quotedAvailableKg(batch) >= wanted);
    const chosen = covering ?? candidates[0];
    if (!chosen) return null;

    const available = quotedAvailableKg(chosen);
    const promised = Math.min(wanted, available);

    context.record({
      kind: 'BASELINE_COMMIT',
      summary: `Promised ${promised.toFixed(0)} kg from a single farm on the grower's own estimate.`,
      evidence: {
        demandId: demand.demandId,
        batchId: chosen.batchId,
        requestedKg: wanted,
        promisedKg: Number(promised.toFixed(2)),
        singleFarm: true,
        discountApplied: false,
      },
    });

    return {
      demandId: demand.demandId,
      allocations: [{ batchId: chosen.batchId, farmId: chosen.farmId, quantityKg: promised }],
      // Nothing is written down, so there is nothing to approve.
      requiresApproval: false,
    };
  },

  respondToDisruption(context: PolicyContext, disruption: ObservedDisruption): RecoveryProposal {
    // Nobody holds the whole picture, so nobody acts. Affected deliveries fail
    // and the buyer finds out when the truck does not arrive.
    context.record({
      kind: 'BASELINE_NO_RECOVERY',
      summary: `A ${disruption.type.toLowerCase()} disruption was visible, but no coordinated recovery exists.`,
      evidence: { disruptionId: disruption.disruptionId, type: disruption.type, action: 'NONE' },
    });

    return {
      disruptionId: disruption.disruptionId,
      action: 'NONE',
      affectedMissionIds: [],
      summary: 'No coordinated recovery in the fragmented baseline.',
    };
  },

  approveCommitment(_context: PolicyContext, _commitment: Commitment): boolean {
    // No gate exists. Returning true keeps the engine's flow uniform across
    // policies rather than special-casing the baseline.
    return true;
  },
};

/** Exported for the Harvest policy, which reasons about the same staleness horizon. */
export const STALE_OBSERVATION_DAYS = 5;
export const STALE_OBSERVATION_MS = STALE_OBSERVATION_DAYS * DAY_MS;
