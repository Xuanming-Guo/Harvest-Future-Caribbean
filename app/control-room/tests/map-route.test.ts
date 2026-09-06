import { describe, expect, it } from "vitest";
import { shortestMapRoute, type MapStop } from "../src/lib/map-route";
const point = (n: number) => ({ latitude: 14, longitude: -61 + n / 100 });
const stop = (n: number): MapStop => ({ id: String(n), name: String(n), islandId: "saint-lucia", kind: "Farm", position: point(n) });
const road = (id: string, a: number, b: number, distanceKm: number) => ({ roadSegmentId: id, islandId: "saint-lucia", name: id, from: point(a), to: point(b), distanceKm });
const scene = { roads: [road("direct", 0, 2, 12), road("first", 0, 1, 3), road("second", 1, 2, 4)] };
describe("recorded-network route explorer", () => {
  it("takes the shortest connected path rather than the direct line", () => {
    expect(shortestMapRoute(scene, stop(0), stop(2))).toEqual({ distanceKm: 7, points: [point(0), point(1), point(2)], roadIds: ["first", "second"] });
  });
  it("supports reverse road travel and equal endpoints", () => {
    expect(shortestMapRoute(scene, stop(2), stop(0))?.roadIds).toEqual(["second", "first"]);
    expect(shortestMapRoute(scene, stop(0), stop(0))?.distanceKm).toBe(0);
  });
  it("does not invent access roads or island crossings", () => {
    expect(shortestMapRoute(scene, stop(0), stop(8))).toBeNull();
    expect(shortestMapRoute(scene, stop(0), { ...stop(2), islandId: "barbados" })).toBeNull();
    expect(shortestMapRoute({ roads: [...scene.roads, road("separate", 7, 8, 1)] }, stop(0), stop(8))).toBeNull();
  });
  it("is deterministic under input permutations and rejects invalid weights", () => {
    expect(shortestMapRoute({ roads: [...scene.roads].reverse() }, stop(0), stop(2))).toEqual(shortestMapRoute(scene, stop(0), stop(2)));
    expect(shortestMapRoute({ roads: [road("invalid", 0, 2, -1)] }, stop(0), stop(2))).toBeNull();
  });
});
