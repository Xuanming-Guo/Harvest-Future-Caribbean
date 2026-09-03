import { describe, expect, it } from "vitest";

import { countOverduePayments, summarizeOrderOutcomes } from "../src/operations-snapshot.js";

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

  it("blames the run window, not operations, for a deadline after the horizon", () => {
    const horizonEndsAt = new Date("2026-09-22T06:00:00.000Z");
    const afterHorizon = { lifecycleStatus: "COMMITTED", neededBy: new Date("2026-09-25T06:00:00.000Z"), outcomeCause: null };

    // Mid-run the order is still live and could yet be delivered early.
    const midRun = summarizeOrderOutcomes([afterHorizon], new Date("2026-09-20T06:00:00.000Z"), horizonEndsAt);
    expect(midRun).toMatchObject({ pending: 1, unfulfilled: 0 });

    const atHorizon = summarizeOrderOutcomes([afterHorizon], horizonEndsAt, horizonEndsAt);
    expect(atHorizon).toMatchObject({ pending: 0, unfulfilled: 1 });
    expect(atHorizon.causes).toEqual({ HORIZON_TRUNCATED: 1 });

    // An order whose deadline fell inside the window keeps its real cause.
    const inWindow = summarizeOrderOutcomes([
      { lifecycleStatus: "REQUESTED", neededBy: new Date("2026-09-21T06:00:00.000Z"), outcomeCause: "INSUFFICIENT_SUPPLY" },
      afterHorizon,
    ], horizonEndsAt, horizonEndsAt);
    expect(inWindow.causes).toEqual({ HORIZON_TRUNCATED: 1, INSUFFICIENT_SUPPLY: 1 });

    // Without a horizon the classification is unchanged.
    expect(summarizeOrderOutcomes([afterHorizon], horizonEndsAt)).toMatchObject({ pending: 1, unfulfilled: 0 });
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

describe("overdue payment count (#74)", () => {
  const acceptedAt = new Date("2026-09-10T09:00:00.000Z");
  const delivered = { id: "order-1", lifecycleStatus: "FULFILLED", paymentTermsDays: 14, paymentAmount: 148.5, paidAt: null as Date | null };
  const accepted = new Map([["order-1", acceptedAt]]);

  it("counts an order only once its agreed term has fully expired", () => {
    // Inside the term, on the day it falls due, and the day after.
    expect(countOverduePayments([delivered], accepted, new Date("2026-09-23T09:00:00.000Z"))).toBe(0);
    expect(countOverduePayments([delivered], accepted, new Date("2026-09-24T09:00:00.000Z"))).toBe(0);
    expect(countOverduePayments([delivered], accepted, new Date("2026-09-25T09:00:00.000Z"))).toBe(1);
  });

  it("never counts an order that has no delivery acceptance, however old it is", () => {
    expect(countOverduePayments([delivered], new Map(), new Date("2027-01-01T00:00:00.000Z"))).toBe(0);
  });

  it("stops counting an order once payment is recorded, and ignores unpriced or cancelled orders", () => {
    const paid = { ...delivered, paidAt: new Date("2026-09-26T09:00:00.000Z") };
    const unpriced = { ...delivered, id: "order-2", paymentAmount: null };
    const cancelled = { ...delivered, id: "order-3", lifecycleStatus: "CANCELLED" };
    const asOf = new Date("2026-10-01T09:00:00.000Z");

    expect(countOverduePayments([paid], accepted, asOf)).toBe(0);
    expect(countOverduePayments([unpriced], new Map([["order-2", acceptedAt]]), asOf)).toBe(0);
    expect(countOverduePayments([cancelled], new Map([["order-3", acceptedAt]]), asOf)).toBe(0);
  });
});
