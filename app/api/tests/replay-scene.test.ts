import { describe, expect, it } from "vitest";

import { normalizeReplayScene } from "../src/simulation-routes.js";

describe("saved replay scene compatibility", () => {
  it("normalizes pre-0.8.0 scenes with no reference arrays", () => {
    const scene = normalizeReplayScene({ runId: "old-run", farms: [], buyers: [], transporters: [], roads: [] });
    expect(scene.referencePlaces).toEqual([]);
    expect(scene.referenceDataSources).toEqual([]);
  });

  it("preserves current reference arrays", () => {
    const scene = normalizeReplayScene({
      referencePlaces: [{ referencePlaceId: "osm-node-1" }],
      referenceDataSources: [{ sourceId: "openstreetmap-v1" }],
    });
    expect(scene.referencePlaces).toHaveLength(1);
    expect(scene.referenceDataSources).toHaveLength(1);
  });
});
