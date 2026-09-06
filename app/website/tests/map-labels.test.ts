import { describe, expect, it } from "vitest";
import { placeMapLabels, rectanglesOverlap } from "@/lib/map-labels";
import { WORLD_ISLANDS } from "@/lib/caribbean-islands";
import { islandRings, localIslandRings, islandPlaceSlots, pointOnIsland, propertyWidthOnIsland, islandScenePoint, islandSceneSlots, islandTerrainFrame } from "@/lib/island-geography";

describe("island geography and readable labels", () => {
  it("has a distinct coastline for every navigable island", () => {
    for (const island of WORLD_ISLANDS) expect(islandRings(island.id).length).toBeGreaterThan(0);
    expect(new Set(WORLD_ISLANDS.map(island => JSON.stringify(islandRings(island.id)))).size).toBe(28);
  });
  it("fits wide islands within the visible mobile map", () => {
    for (const id of ["jamaica", "cuba", "saint-lucia"]) {
      const points = localIslandRings(id, 490, 750).flat();
      expect(Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x))).toBeLessThanOrEqual(490.001);
      expect(Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y))).toBeLessThanOrEqual(750.001);
    }
  });
  it("scales properties with the island extent instead of drawing giant buildings", () => {
    const lucia = propertyWidthOnIsland("saint-lucia", "FARM", 1000);
    const jamaica = propertyWidthOnIsland("jamaica", "FARM", 1000);
    expect(lucia).toBeGreaterThan(0);
    expect(lucia).toBeLessThan(2);
    expect(jamaica).toBeLessThan(lucia);
    expect(propertyWidthOnIsland("saint-lucia", "HOTEL", 1000)).toBeGreaterThan(lucia);
  });
  it("keeps workspace markers on land", () => {
    const rings = localIslandRings("saint-lucia");
    const points = islandPlaceSlots("saint-lucia", 18);
    expect(points).toHaveLength(18);
    for (const point of points) expect(pointOnIsland({ x: point.x * 1500, y: point.y * 1000 }, rings)).toBe(true);
  });
  it("keeps places registered to the angled artwork across responsive fits", () => {
    const full = islandSceneSlots("saint-lucia", 18);
    const mobile = islandSceneSlots("saint-lucia", 18, 490, 750);
    const frame = islandTerrainFrame("saint-lucia", 490, 750);
    const ratio = frame.width / 1500;
    for (let i = 0; i < full.length; i++) {
      expect(mobile[i]!.x * 1500).toBeCloseTo(frame.x + full[i]!.x * 1500 * ratio);
      expect(mobile[i]!.y * 1000).toBeCloseTo(frame.y + full[i]!.y * 1000 * ratio);
    }
    // The central mountain surface rises above the projected sea-level plane.
    const mountain = islandScenePoint("saint-lucia", { x: 750, y: 480 });
    expect(mountain.y).toBeLessThan(500);
    expect(mountain.x).toBe(750);
  });
  it("keeps clustered island labels clear of land, each other and map controls", () => {
    const anchors = Array.from({ length: 12 }, (_, i) => ({ id: String(i), text: `Island ${i}`, x: 350 + i % 2 * 15, y: 60 + i * 32, land: { x: 346 + i % 2 * 15, y: 55 + i * 32, width: 12, height: 14 } }));
    const labels = placeMapLabels(anchors, 800, 600);
    expect(labels.length).toBeGreaterThan(7);
    for (const label of labels) {
      expect(label.box.y + label.box.height).toBeLessThanOrEqual(538);
      for (const anchor of anchors) expect(rectanglesOverlap(label.box, anchor.land, 3)).toBe(false);
      for (const other of labels) if (label.id !== other.id) expect(rectanglesOverlap(label.box, other.box)).toBe(false);
    }
  });
});
