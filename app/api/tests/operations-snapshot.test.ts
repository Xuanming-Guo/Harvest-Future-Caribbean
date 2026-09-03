import { describe, expect, it } from "vitest";

import { summarizeOrderOutcomes } from "../src/operations-snapshot.js";

describe("Product API order outcome summary", () => {
  const asOf = new Date("2026-09-22T06:00:00.000Z");

  it("classifies every order exactly once at the replay instant", () => {
    const outcomes = summarizeOrderOutcomes([
      { lifecycleStatus: "FULFILLED", neededBy: new Date("2026-09-20T06:00:00.000Z") },
      { lifecycleStatus: "PARTIALLY_FULFILLED", neededBy: new Date("2026-09-20T06:00:00.000Z") },
      { lifecycleStatus: "REJECTED", neededBy: new Date("2026-09-25T06:00:00.000Z") },
      { lifecycleStatus: "CANCELLED", neededBy: new Date("2026-09-25T06:00:00.000Z") },
      { lifecycleStatus: "REQUESTED", neededBy: new Date("2026-09-21T06:00:00.000Z") },
      { lifecycleStatus: "AWAITING_APPROVAL", neededBy: new Date("2026-09-23T06:00:00.000Z") },
    ], asOf);

    expect(outcomes).toMatchObject({
      total: 6,
      fulfilled: 1,
      partiallyFulfilled: 1,
      unfulfilled: 3,
      pending: 1,
    });
    expect(outcomes.fulfilled + outcomes.partiallyFulfilled + outcomes.unfulfilled + outcomes.pending).toBe(outcomes.total);
  });

  it("explains every missed order with exactly one cause", () => {
    const outcomes = summarizeOrderOutcomes([
      { lifecycleStatus: "FULFILLED", neededBy: new Date("2026-09-20T06:00:00.000Z"), outcomeCause: null },
      { lifecycleStatus: "PARTIALLY_FULFILLED", neededBy: new Date("2026-09-20T06:00:00.000Z"), outcomeCause: "DELIVERY_REJECTED" },
      { lifecycleStatus: "REJECTED", neededBy: new Date("2026-09-25T06:00:00.000Z"), outcomeCause: "APPROVAL_REJECTED" },
      { lifecycleStatus: "REQUESTED", neededBy: new Date("2026-09-21T06:00:00.000Z"), outcomeCause: "INSUFFICIENT_SUPPLY" },
      { lifecycleStatus: "REQUESTED", neededBy: new Date("2026-09-21T06:00:00.000Z"), outcomeCause: null },
      { lifecycleStatus: "COMMITTED", neededBy: new Date("2026-09-21T06:00:00.000Z"), outcomeCause: null },
      { lifecycleStatus: "AWAITING_APPROVAL", neededBy: new Date("2026-09-23T06:00:00.000Z"), outcomeCause: null },
    ], asOf);

    expect(outcomes.causes).toEqual({
      APPROVAL_REJECTED: 1,
      DELIVERY_REJECTED: 1,
      INSUFFICIENT_SUPPLY: 1,
      MISSION_LATE: 1,
      NO_READY_SUPPLY: 1,
    });
    const explained = Object.values(outcomes.causes ?? {}).reduce((sum, count) => sum + count, 0);
    expect(explained).toBe(outcomes.unfulfilled + outcomes.partiallyFulfilled);
  });

  it("moves an incomplete order from pending to unfulfilled at its deadline", () => {
    const before = summarizeOrderOutcomes([
      { lifecycleStatus: "REQUESTED", neededBy: asOf },
    ], new Date(asOf.getTime() - 1));
    const atDeadline = summarizeOrderOutcomes([
      { lifecycleStatus: "REQUESTED", neededBy: asOf },
    ], asOf);

    expect(before).toMatchObject({ pending: 1, unfulfilled: 0 });
    expect(atDeadline).toMatchObject({ pending: 0, unfulfilled: 1 });
  });
});
