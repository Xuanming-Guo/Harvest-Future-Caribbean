import { describe, expect, it } from "vitest";
import type { ControlRoomFrame } from "@harvest/simulation";

import {
  DEFAULT_SCENARIO,
  DEFAULT_SEED,
  compareRunOutcomes,
  describeEvent,
  isAlertEvent,
  isNotableEvent,
  type SavedRun,
} from "@/lib/run";

describe("saved-run control-room vocabulary", () => {
  it("uses the documented Caribbean scenario and a repeatable default seed", () => {
    expect(DEFAULT_SCENARIO).toBe("caribbean-islands-v1");
    expect(DEFAULT_SEED).toBe(8675309);
  });

  it("translates engine event types into plain English", () => {
    expect(describeEvent("BUYER_DEMAND")).toBe("Buyer placed an order");
    expect(describeEvent("MISSION_ARRIVE")).toBe("Delivery arrived");
  });

  it("degrades gracefully for a new event type", () => {
    expect(describeEvent("SOME_NEW_THING")).toBe("some new thing");
  });

  it("filters routine world ticks while keeping visible disruptions", () => {
    expect(isNotableEvent("WORLD_TICK")).toBe(false);
    expect(isNotableEvent("DISRUPTION_START")).toBe(true);
    expect(isAlertEvent("DISRUPTION_START")).toBe(true);
    expect(isAlertEvent("BUYER_DEMAND")).toBe(false);
  });
});

describe("derived-run outcome comparison", () => {
  const sourceRun = {
    runId: "10000000-0000-4000-8000-000000000001",
    metrics: { wasteQuantity: { value: 100, unit: "kg" } },
  } as SavedRun;
  const currentRun = {
    runId: "10000000-0000-4000-8000-000000000002",
    metrics: { wasteQuantity: { value: 125.5, unit: "kg" } },
  } as SavedRun;
  const snapshot = {
    deliveryAcceptedKg: 400,
    orderOutcomes: { total: 12, fulfilled: 1, partiallyFulfilled: 2, unfulfilled: 6, pending: 3 },
    approvedCommitmentCount: 5,
    completedMissionCount: 5,
  };
  const sourceFrame = { operationsSnapshot: snapshot, totals: { acceptedKg: 400, demandsFullyMet: 1, demandsUnmet: 6 } } as ControlRoomFrame;

  it("reports only changed final totals", () => {
    const currentFrame = {
      operationsSnapshot: { ...snapshot, deliveryAcceptedKg: 350, completedMissionCount: 4 },
      totals: { acceptedKg: 350, demandsFullyMet: 1, demandsUnmet: 6 },
    } as ControlRoomFrame;

    expect(compareRunOutcomes("HARVEST", sourceRun, sourceFrame, currentRun, currentFrame).changes).toEqual([
      "Delivered: 400 kg -> 350 kg",
      "Completed delivery missions: 5 -> 4",
      "Physical waste: 100 kg -> 125.5 kg",
    ]);
  });

  it("returns no changes when judge-visible totals are equal", () => {
    expect(compareRunOutcomes("HARVEST", sourceRun, sourceFrame, sourceRun, sourceFrame).changes).toEqual([]);
  });
});
