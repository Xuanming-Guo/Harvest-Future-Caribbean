import type { ApiSchema } from "@harvest/shared";
import { describe, expect, it } from "vitest";

import {
  WORKSPACE_SECTIONS,
  recommendedActions,
  selectRecommendedAction,
  type RecommendedActionInput,
} from "@/lib/recommended-action";

type CropBatch = ApiSchema<"CropBatch">;
type Listing = ApiSchema<"Listing">;
type MarketOpportunity = ApiSchema<"MarketOpportunity">;
type Approval = ApiSchema<"Approval">;
type DeliveryMission = ApiSchema<"DeliveryMission">;

/** 11:00 in Saint Lucia, which keeps one offset all year. */
const NOW = new Date("2026-09-03T15:00:00.000Z");

const batch = (over: Partial<CropBatch> & { cropBatchId: string }): CropBatch => ({
  farmId: "farm-1",
  cropType: "CUCUMBER",
  status: "GROWING",
  availableToPromise: { value: 0, unit: "kg" },
  provenance: "OBSERVED",
  ...over,
});

const listing = (over: Partial<Listing> & { listingId: string; cropBatchId: string }): Listing => ({
  farmerId: "farmer-ana",
  cropType: "CUCUMBER",
  quantity: { value: 20, unit: "kg" },
  unitPrice: { amount: 7.5, currency: "XCD" },
  availableFrom: "2026-09-04",
  availableUntil: "2026-09-10",
  status: "ACTIVE",
  createdAt: "2026-09-01T10:00:00.000Z",
  ...over,
});

const opportunity = (over: Partial<MarketOpportunity> & { opportunityId: string }): MarketOpportunity => ({
  cropType: "CUCUMBER",
  quantity: { value: 30, unit: "kg" },
  neededBy: "2026-09-08T12:00:00.000Z",
  deliveryZone: "Gros Islet",
  createdAt: "2026-09-01T10:00:00.000Z",
  ...over,
});

const approval = (over: Partial<Approval> & { approvalId: string }): Approval => ({
  subjectType: "ALLOCATION",
  subjectId: "allocation-1",
  requestedFromActorId: "farmer-ana",
  status: "PENDING",
  requestedAt: "2026-09-02T09:00:00.000Z",
  ...over,
});

const mission = (over: Partial<DeliveryMission> & { missionId: string }): DeliveryMission => ({
  orderId: "order-1",
  status: "ASSIGNED",
  quantity: { value: 25, unit: "kg" },
  deadline: "2026-09-03T20:00:00.000Z",
  stops: [],
  currentStopSequence: 0,
  ...over,
});

const input = (over: Partial<RecommendedActionInput> = {}): RecommendedActionInput => ({
  batches: [],
  listings: [],
  opportunities: [],
  approvals: [],
  missions: [],
  queued: [],
  now: NOW,
  ...over,
});

/** Every priority present at once, so each test can remove exactly one rung. */
const everything = (): RecommendedActionInput =>
  input({
    batches: [
      batch({ cropBatchId: "ready-batch", cropType: "CUCUMBER", status: "HARVEST_READY", availableToPromise: { value: 14, unit: "kg" }, latestObservationId: "observation-1" }),
      batch({ cropBatchId: "newest-growing", cropType: "TOMATO", status: "GROWING", latestObservationId: "observation-2" }),
      batch({ cropBatchId: "oldest-growing", cropType: "SWEET_POTATO", status: "GROWING", latestObservationId: "observation-3" }),
    ],
    listings: [listing({ listingId: "listing-1", cropBatchId: "ready-batch", cropType: "CUCUMBER" })],
    opportunities: [opportunity({ opportunityId: "opportunity-1", cropType: "CUCUMBER" })],
    approvals: [approval({ approvalId: "approval-1", context: { title: "Supply commitment", summary: "Confirm the allocation", orderId: "order-9", cropType: "CUCUMBER", quantity: { value: 12, unit: "kg" }, neededBy: "2026-09-09T12:00:00.000Z" } })],
    missions: [mission({ missionId: "mission-1" })],
    queued: [{ id: "queued-1", cropBatchId: "newest-growing", status: "attention" }],
  });

describe("recommended action", () => {
  it("offers dated forecast supply without calling it harvest ready", () => {
    const action = selectRecommendedAction(input({ batches: [batch({ cropBatchId: "future", status: "GROWING", availableToPromise: { value: 20, unit: "kg" }, promisableFrom: "2026-09-08" })] }));
    expect(action?.headline).toContain("can be promised from");
    expect(action?.headline).toContain("8 Sept 2026");
    expect(action?.href).toBe("/crops/future#offer-produce");
  });

  it("does not recommend a buyer need after its deadline", () => {
    const actions = recommendedActions(input({ ...everything(), opportunities: [opportunity({ opportunityId: "expired", neededBy: "2026-09-02T12:00:00Z" })] }));
    expect(actions.some((action) => action.kind === "RESPOND_TO_BUYER")).toBe(false);
  });

  it("puts ready produce nobody can buy yet at the top", () => {
    const action = selectRecommendedAction(input({
      ...everything(),
      listings: [],
    }));
    expect(action?.kind).toBe("REPORT_PRODUCE_READY");
    expect(action?.headline).toBe("14 kg of cucumber is ready to sell");
    expect(action?.actionLabel).toBe("Offer it to buyers");
    expect(action?.href).toBe("/crops/ready-batch#offer-produce");
    expect(action?.sectionId).toBe(WORKSPACE_SECTIONS.ready);
  });

  it("does not ask for an offer that already exists, and moves to the waiting buyer", () => {
    const action = selectRecommendedAction(everything());
    expect(action?.kind).toBe("RESPOND_TO_BUYER");
    expect(action?.headline).toBe("A buyer needs 30 kg of cucumber");
    expect(action?.actionLabel).toBe("Respond to a buyer");
    expect(action?.href).toBe("/crops/ready-batch");
    expect(action?.sectionId).toBe(WORKSPACE_SECTIONS.demand);
  });

  it("asks for the commitment decision when no buyer matches an offer", () => {
    const action = selectRecommendedAction(input({ ...everything(), opportunities: [] }));
    expect(action?.kind).toBe("APPROVE_DELIVERY_PLAN");
    expect(action?.headline).toBe("A buyer wants 12 kg of cucumber from your farm");
    expect(action?.actionLabel).toBe("Approve a delivery plan");
    expect(action?.href).toBe("/orders/order-9");
    expect(action?.sectionId).toBe(WORKSPACE_SECTIONS.respond);
  });

  it("falls back to the orders page when an approval carries no order", () => {
    const action = selectRecommendedAction(input({
      ...everything(),
      opportunities: [],
      approvals: [approval({ approvalId: "approval-2" })],
    }));
    expect(action?.headline).toBe("A delivery plan is waiting for your decision");
    expect(action?.href).toBe("/orders");
  });

  it("raises a collection happening today once nothing needs a decision", () => {
    const action = selectRecommendedAction(input({ ...everything(), opportunities: [], approvals: [] }));
    expect(action?.kind).toBe("TRACK_COLLECTION");
    expect(action?.headline).toBe("25 kg is collected from your farm today");
    expect(action?.actionLabel).toBe("Track collection");
    expect(action?.href).toBe("/missions/mission-1");
    expect(action?.sectionId).toBe(WORKSPACE_SECTIONS.collection);
  });

  it("ignores a collection on another day or already delivered", () => {
    const action = selectRecommendedAction(input({
      ...everything(),
      opportunities: [],
      approvals: [],
      missions: [
        mission({ missionId: "mission-tomorrow", deadline: "2026-09-04T20:00:00.000Z" }),
        mission({ missionId: "mission-done", status: "DELIVERED" }),
      ],
    }));
    expect(action?.kind).toBe("REVIEW_QUEUED_UPDATE");
  });

  it("asks for a stuck device update before routine work", () => {
    const action = selectRecommendedAction(input({ ...everything(), opportunities: [], approvals: [], missions: [] }));
    expect(action?.kind).toBe("REVIEW_QUEUED_UPDATE");
    expect(action?.headline).toBe("One update on this phone was not sent");
    expect(action?.actionLabel).toBe("Review and resend");
    expect(action?.href).toBe("/crops/newest-growing");
    expect(action?.sectionId).toBe(WORKSPACE_SECTIONS.growing);
  });

  it("otherwise asks for an update on the crop left longest without one", () => {
    const action = selectRecommendedAction(input({
      ...everything(),
      opportunities: [],
      approvals: [],
      missions: [],
      queued: [{ id: "queued-2", cropBatchId: "newest-growing", status: "waiting" }],
    }));
    expect(action?.kind).toBe("UPDATE_WHAT_IS_GROWING");
    expect(action?.headline).toBe("Tell Harvest how the sweet potato is doing");
    expect(action?.actionLabel).toBe("Update what is growing");
    expect(action?.href).toBe("/crops/oldest-growing");
    expect(action?.sectionId).toBe(WORKSPACE_SECTIONS.growing);
  });

  it("prefers a crop that has never been reported at all", () => {
    const action = selectRecommendedAction(input({
      batches: [
        batch({ cropBatchId: "reported", status: "GROWING", latestObservationId: "observation-1" }),
        batch({ cropBatchId: "never-reported", cropType: "OKRA", status: "GROWING" }),
        batch({ cropBatchId: "also-reported", status: "GROWING", latestObservationId: "observation-2" }),
      ],
    }));
    expect(action?.href).toBe("/crops/never-reported");
    expect(action?.support).toContain("never been reported");
  });

  it("keeps all six priorities in one fixed order", () => {
    expect(recommendedActions(input({ ...everything(), listings: [] })).map((action) => action.kind)).toEqual([
      "REPORT_PRODUCE_READY",
      "APPROVE_DELIVERY_PLAN",
      "TRACK_COLLECTION",
      "REVIEW_QUEUED_UPDATE",
      "UPDATE_WHAT_IS_GROWING",
    ]);
    expect(recommendedActions(everything()).map((action) => action.kind)).toEqual([
      "RESPOND_TO_BUYER",
      "APPROVE_DELIVERY_PLAN",
      "TRACK_COLLECTION",
      "REVIEW_QUEUED_UPDATE",
      "UPDATE_WHAT_IS_GROWING",
    ]);
  });

  it("moves to the next action rather than hiding work when one is set aside", () => {
    const state = everything();
    const first = selectRecommendedAction(state);
    const second = selectRecommendedAction(state, [first!.key]);
    expect(first?.key).toBe("RESPOND_TO_BUYER:opportunity-1");
    expect(second?.kind).toBe("APPROVE_DELIVERY_PLAN");
    expect(selectRecommendedAction(state, recommendedActions(state).map((action) => action.key))).toBeNull();
  });

  it("recommends nothing when a farm has no crops and no work", () => {
    expect(selectRecommendedAction(input())).toBeNull();
  });
});
