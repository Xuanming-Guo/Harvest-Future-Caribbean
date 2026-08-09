/**
 * The data layer.
 *
 * The point of these tests is less the logic — `buildTimeline` is a thin
 * wrapper — than the integration itself. `@harvest/simulation` is a
 * source-only workspace package consumed across a package boundary and
 * compiled by Next rather than published as JavaScript. If that resolution
 * breaks, everything downstream fails at once, and it fails in the browser
 * where nothing catches it. A test that merely imports and runs the engine
 * catches that class of breakage in CI instead.
 */

import { describe, expect, it } from "vitest";

import { DEFAULT_SEED, buildTimeline, describeEvent, isAlertEvent, isNotableEvent } from "@/lib/run";

describe("buildTimeline", () => {
  it("produces a scene and frames for the hero scenario", () => {
    const { timeline, result } = buildTimeline({ policy: "HARVEST", seed: DEFAULT_SEED });

    expect(result.status).toBe("COMPLETED");
    expect(timeline.frames.length).toBeGreaterThan(20);
    expect(timeline.scene.farms.length).toBeGreaterThan(0);
    expect(timeline.scene.buyers.length).toBeGreaterThan(0);
  });

  it("is reproducible for a seed, which is what makes the demo repeatable", () => {
    const first = buildTimeline({ policy: "HARVEST", seed: 4242 });
    const second = buildTimeline({ policy: "HARVEST", seed: 4242 });

    expect(second.result.digest).toBe(first.result.digest);
    expect(second.timeline.frames.length).toBe(first.timeline.frames.length);
  });

  it("gives the two policies the same world but different outcomes", () => {
    // The paired comparison the control room's policy toggle demonstrates.
    const baseline = buildTimeline({ policy: "BASELINE", seed: 777 });
    const harvest = buildTimeline({ policy: "HARVEST", seed: 777 });

    expect(harvest.timeline.scene.runId).toBe(baseline.timeline.scene.runId);
    expect(harvest.result.digest).not.toBe(baseline.result.digest);
  });

  it("never ships hidden simulation truth to the browser", () => {
    // The control room serialises this into a client bundle's memory, so a leak
    // here is a leak to anyone with developer tools open.
    const { timeline } = buildTimeline({ policy: "HARVEST", seed: 31 });
    const serialised = JSON.stringify(timeline);

    for (const forbidden of ["potentialYieldKg", "qualityFraction", "dailySpoilageRate", "severity"]) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it("carries the evidence label into the scene", () => {
    const { timeline } = buildTimeline({ policy: "HARVEST", seed: 8 });
    expect(timeline.scene.evidenceLabel).toMatch(/SYNTHETIC/);
  });

  it("changes the world when a disruption is injected", () => {
    const base = buildTimeline({ policy: "HARVEST", seed: 90 });
    const injected = buildTimeline({
      policy: "HARVEST",
      seed: 90,
      injectedDisruptions: [
        {
          type: "ROAD",
          offsetMs: 4 * 86_400_000,
          durationMs: 86_400_000,
          affectedEntityIds: [base.timeline.scene.roads[0]?.roadSegmentId ?? "road"],
          publicDescription: "Injected closure.",
        },
      ],
    });

    expect(injected.result.digest).not.toBe(base.result.digest);
  });

  it("reports an unknown scenario rather than rendering an empty world", () => {
    expect(() => buildTimeline({ scenarioId: "nope", policy: "HARVEST", seed: 1 })).toThrow(/Unknown scenario/);
  });
});

describe("event vocabulary", () => {
  it("translates engine event types into plain English", () => {
    expect(describeEvent("BUYER_DEMAND")).toBe("Buyer placed an order");
    expect(describeEvent("MISSION_ARRIVE")).toBe("Delivery arrived");
  });

  it("degrades gracefully for an event type it has never seen", () => {
    // A new engine event must not surface as a raw SCREAMING_SNAKE token.
    expect(describeEvent("SOME_NEW_THING")).toBe("some new thing");
  });

  it("filters the daily heartbeat out of the feed", () => {
    // WORLD_TICK fires every simulated day and says nothing on its own. Letting
    // it through buries the events that matter.
    expect(isNotableEvent("WORLD_TICK")).toBe(false);
    expect(isNotableEvent("DISRUPTION_START")).toBe(true);
  });

  it("marks problems as alerts", () => {
    expect(isAlertEvent("DISRUPTION_START")).toBe(true);
    expect(isAlertEvent("DEMAND_DEADLINE")).toBe(true);
    expect(isAlertEvent("BUYER_DEMAND")).toBe(false);
  });
});
