import type { ApiSchema } from "@harvest/shared";

import { cropName, formatDate, formatKg } from "@/lib/format";

type CropBatch = ApiSchema<"CropBatch">;
type Listing = ApiSchema<"Listing">;
type MarketOpportunity = ApiSchema<"MarketOpportunity">;
type Approval = ApiSchema<"Approval">;
type DeliveryMission = ApiSchema<"DeliveryMission">;

/** Only the queued-write fields the recommendation needs. */
export interface QueuedUpdate {
  id: string;
  cropBatchId: string;
  status: string;
}

export type RecommendedActionKind =
  | "REPORT_PRODUCE_READY"
  | "RESPOND_TO_BUYER"
  | "APPROVE_DELIVERY_PLAN"
  | "TRACK_COLLECTION"
  | "REVIEW_QUEUED_UPDATE"
  | "UPDATE_WHAT_IS_GROWING";

export interface RecommendedAction {
  /** Stable per subject, so "Not now" skips this one and not its whole kind. */
  key: string;
  kind: RecommendedActionKind;
  headline: string;
  support: string;
  actionLabel: string;
  href: string;
  /** The workspace section this action lives in, so it can open itself. */
  sectionId: string;
}

export interface RecommendedActionInput {
  batches: CropBatch[];
  listings: Listing[];
  opportunities: MarketOpportunity[];
  approvals: Approval[];
  missions: DeliveryMission[];
  queued: QueuedUpdate[];
  now: Date;
}

export const WORKSPACE_SECTIONS = {
  growing: "update-what-is-growing",
  ready: "report-produce-ready",
  demand: "view-buyer-demand",
  respond: "respond-to-an-opportunity",
  collection: "track-collection",
  history: "view-previous-deliveries",
} as const;

const OFFERED_LISTING_STATUSES = new Set(["ACTIVE", "RESERVED"]);
const OPEN_MISSION_STATUSES = new Set(["AVAILABLE", "ASSIGNED", "PICKUP_IN_PROGRESS", "IN_TRANSIT"]);

/** Saint Lucia keeps one offset all year, so a calendar day needs no DST care. */
const dayKey = (value: string | Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/St_Lucia" }).format(new Date(value));

/**
 * Every action Harvest could recommend to this farmer, most useful first.
 *
 * The order is fixed and deterministic: produce that nobody can buy yet, then a
 * buyer already asking for a crop this farmer offers, then a commitment waiting
 * on a human decision, then a collection happening today, then an update this
 * device failed to send, and finally the crop that has gone longest without an
 * update.
 */
export function recommendedActions(input: RecommendedActionInput): RecommendedAction[] {
  const actions: RecommendedAction[] = [];
  const offeredBatchIds = new Set(
    input.listings.filter((listing) => OFFERED_LISTING_STATUSES.has(listing.status)).map((listing) => listing.cropBatchId),
  );

  // 1. Harvested produce that is safe to sell but has never been offered.
  const unoffered = input.batches
    .filter((batch) => batch.status === "HARVEST_READY" && batch.availableToPromise.value > 0 && !offeredBatchIds.has(batch.cropBatchId))
    .sort((left, right) => right.availableToPromise.value - left.availableToPromise.value)[0];
  if (unoffered) {
    actions.push({
      key: `REPORT_PRODUCE_READY:${unoffered.cropBatchId}`,
      kind: "REPORT_PRODUCE_READY",
      headline: `${formatKg(unoffered.availableToPromise.value)} of ${cropName(unoffered.cropType)} is ready to sell`,
      support: "No buyer can see it until you offer it. Harvest keeps the offer inside the amount that is safe to promise, so you never sell more than you have.",
      actionLabel: "Offer it to buyers",
      href: `/crops/${unoffered.cropBatchId}#offer-produce`,
      sectionId: WORKSPACE_SECTIONS.ready,
    });
  }

  // 2. A buyer asking for a crop this farmer already has on offer.
  const offeredCropTypes = new Map(
    input.listings
      .filter((listing) => OFFERED_LISTING_STATUSES.has(listing.status))
      .map((listing) => [listing.cropType.toUpperCase(), listing.cropBatchId] as const),
  );
  const opportunity = [...input.opportunities]
    .filter((item) => offeredCropTypes.has(item.cropType.toUpperCase()))
    .sort((left, right) => left.neededBy.localeCompare(right.neededBy))[0];
  if (opportunity) {
    actions.push({
      key: `RESPOND_TO_BUYER:${opportunity.opportunityId}`,
      kind: "RESPOND_TO_BUYER",
      headline: `A buyer needs ${formatKg(opportunity.quantity.value)} of ${cropName(opportunity.cropType)}`,
      support: `Wanted by ${formatDate(opportunity.neededBy, false)} in ${opportunity.deliveryZone}. Check that your offer still matches what you can pick.`,
      actionLabel: "Respond to a buyer",
      href: `/crops/${offeredCropTypes.get(opportunity.cropType.toUpperCase())}`,
      sectionId: WORKSPACE_SECTIONS.demand,
    });
  }

  // 3. A commitment that cannot move until a person decides.
  const approval = [...input.approvals]
    .filter((item) => item.status === "PENDING")
    .sort((left, right) => left.requestedAt.localeCompare(right.requestedAt))[0];
  if (approval) {
    const quantity = approval.context?.quantity;
    const crop = approval.context?.cropType;
    actions.push({
      key: `APPROVE_DELIVERY_PLAN:${approval.approvalId}`,
      kind: "APPROVE_DELIVERY_PLAN",
      headline: quantity && crop
        ? `A buyer wants ${formatKg(quantity.value)} of ${cropName(crop)} from your farm`
        : "A delivery plan is waiting for your decision",
      support: approval.context?.neededBy
        ? `Nothing is promised until you agree. Delivery would be by ${formatDate(approval.context.neededBy, false)}.`
        : "Nothing is promised until you agree to it. Read the plan, then approve or decline.",
      actionLabel: "Approve a delivery plan",
      href: approval.context?.orderId ? `/orders/${approval.context.orderId}` : "/orders",
      sectionId: WORKSPACE_SECTIONS.respond,
    });
  }

  // 4. Someone is coming to collect today.
  const today = dayKey(input.now);
  const mission = [...input.missions]
    .filter((item) => OPEN_MISSION_STATUSES.has(item.status) && dayKey(item.deadline) === today)
    .sort((left, right) => left.deadline.localeCompare(right.deadline))[0];
  if (mission) {
    actions.push({
      key: `TRACK_COLLECTION:${mission.missionId}`,
      kind: "TRACK_COLLECTION",
      headline: `${formatKg(mission.quantity.value)} is collected from your farm today`,
      support: "Have the produce ready. The job page shows the driver's stops and tells you when they are on the way.",
      actionLabel: "Track collection",
      href: `/missions/${mission.missionId}`,
      sectionId: WORKSPACE_SECTIONS.collection,
    });
  }

  // 5. Something this device wrote down could not be sent as written.
  const stuck = input.queued.find((item) => item.status === "attention");
  if (stuck) {
    actions.push({
      key: `REVIEW_QUEUED_UPDATE:${stuck.id}`,
      kind: "REVIEW_QUEUED_UPDATE",
      headline: "One update on this phone was not sent",
      support: "The crop changed after you wrote it, so Harvest stopped and kept your words. Check it against the crop, then send it again.",
      actionLabel: "Review and resend",
      href: `/crops/${stuck.cropBatchId}`,
      sectionId: WORKSPACE_SECTIONS.growing,
    });
  }

  // 6. Nothing is pending, so keep the oldest crop record honest. The API
  // returns crop batches most recently updated first, so the last one listed is
  // the one that has gone longest without a change.
  const growing = input.batches.filter((batch) => batch.status === "PLANNED" || batch.status === "GROWING");
  const open = growing.length ? growing : input.batches.filter((batch) => batch.status !== "CLOSED");
  const stale = open.filter((batch) => !batch.latestObservationId).at(-1) ?? open.at(-1);
  if (stale) {
    actions.push({
      key: `UPDATE_WHAT_IS_GROWING:${stale.cropBatchId}`,
      kind: "UPDATE_WHAT_IS_GROWING",
      headline: `Tell Harvest how the ${cropName(stale.cropType)} is doing`,
      support: stale.latestObservationId
        ? "This crop has waited longest for an update. A short note keeps your harvest range and your safe-to-sell amount close to the field."
        : "This crop has never been reported. A short note gives it a harvest range and an amount you can safely sell.",
      actionLabel: "Update what is growing",
      href: `/crops/${stale.cropBatchId}`,
      sectionId: WORKSPACE_SECTIONS.growing,
    });
  }

  return actions;
}

/** The one action to put at the top of the workspace, or null when none apply. */
export function selectRecommendedAction(
  input: RecommendedActionInput,
  dismissed: readonly string[] = [],
): RecommendedAction | null {
  return recommendedActions(input).find((action) => !dismissed.includes(action.key)) ?? null;
}
