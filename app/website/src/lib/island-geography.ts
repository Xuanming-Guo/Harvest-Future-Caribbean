import coastlines from "./island-coastlines.json";
import artRegistration from "./island-art-registration.json";

export type MapPoint = { x: number; y: number };
export type MapBounds = { x: number; y: number; width: number; height: number };
const coast = coastlines as Record<string, number[][][]>;
export const projectCoast = ([longitude, latitude]: number[]): MapPoint => ({ x: (longitude! + 85) * 42, y: (28 - latitude!) * 44.2 });
export function islandRings(id: string): MapPoint[][] { return (coast[id] ?? []).map(ring => ring.map(projectCoast)); }
export function boundsOf(rings: MapPoint[][]): MapBounds {
  const points = rings.flat();
  const xs = points.map(point => point.x), ys = points.map(point => point.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
export function coastPath(rings: MapPoint[][]): string {
  return rings.map(ring => ring.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join("") + "Z").join("");
}
export function localIslandRings(id: string, fitWidth = 1150, fitHeight = 750): MapPoint[][] {
  const rings = islandRings(id);
  if (!rings.length) return [];
  const bounds = boundsOf(rings);
  const scale = Math.min(fitWidth / bounds.width, fitHeight / bounds.height);
  return rings.map(ring => ring.map(point => ({ x: 750 + (point.x - bounds.x - bounds.width / 2) * scale, y: 480 + (point.y - bounds.y - bounds.height / 2) * scale })));
}
export function pointOnIsland(point: MapPoint, rings: MapPoint[][]): boolean {
  return rings.some(ring => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i]!, b = ring[j]!;
      if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  });
}
/** Stable display positions inside the coastline. The API supplies zones, not farm coordinates. */
export function islandPlaceSlots(id: string, count: number, fitWidth = 1150, fitHeight = 750): MapPoint[] {
  const rings = localIslandRings(id, fitWidth, fitHeight);
  if (!rings.length || !count) return [];
  const candidates: MapPoint[] = [];
  for (let y = 160; y < 810; y += 28) for (let x = 220; x < 1280; x += 28) {
    if ([{ x, y }, { x: x - 35, y }, { x: x + 35, y }, { x, y: y - 35 }, { x, y: y + 35 }].every(p => pointOnIsland(p, rings))) candidates.push({ x, y });
  }
  if (!candidates.length) return [];
  const chosen = [candidates.reduce((best, p) => Math.hypot(p.x - 750, p.y - 480) < Math.hypot(best.x - 750, best.y - 480) ? p : best)];
  while (chosen.length < count && chosen.length < candidates.length) {
    const available = candidates.filter(p => !chosen.includes(p));
    chosen.push(available.reduce((best, p) => {
      const distance = (q: MapPoint) => Math.min(...chosen.map(c => Math.hypot(q.x - c.x, (q.y - c.y) * 1.4)));
      return distance(p) > distance(best) ? p : best;
    }));
  }
  return chosen.map(p => ({ x: p.x / 1500, y: p.y / 1000 }));
}

/** The authored terrain canvas uses the same geographic registration as places. */
export function islandTerrainFrame(id: string, fitWidth = 1150, fitHeight = 750): MapBounds {
  const bounds = boundsOf(islandRings(id));
  const originalScale = Math.min(1150 / bounds.width, 750 / bounds.height);
  const displayScale = Math.min(fitWidth / bounds.width, fitHeight / bounds.height);
  const ratio = displayScale / originalScale;
  return { x: 750 * (1 - ratio), y: 500 * (1 - ratio), width: 1500 * ratio, height: 1000 * ratio };
}

/** Position a complete island illustration within the regional geographic view. */
export function regionalTerrainFrame(id: string): MapBounds {
  const bounds = boundsOf(islandRings(id));
  const scale = Math.min(1150 / bounds.width, 750 / bounds.height);
  return { x: bounds.x + bounds.width / 2 - 750 / scale, y: bounds.y + bounds.height / 2 - 500 / scale, width: 1500 / scale, height: 1000 / scale };
}

/** Visual footprint defaults; no measured property dimensions are returned by the API. */
export function propertyWidthOnIsland(id: string, kind: "FARM" | "HOTEL", surfaceWidth: number, fitWidth = 1150, fitHeight = 750): number {
  const bounds = boundsOf(islandRings(id));
  const scale = Math.min(fitWidth / bounds.width, fitHeight / bounds.height);
  const latitude = 28 - (bounds.y + bounds.height / 2) / 44.2;
  const pixelsPerMeter = 42 * scale * surfaceWidth / 1500 / (111320 * Math.cos(latitude * Math.PI / 180));
  return (kind === "FARM" ? 60 : 90) * pixelsPerMeter;
}


type ReliefRegistration = { width: number; height: number; values: number[] };
const registeredRelief = artRegistration as Record<string, ReliefRegistration>;

/** Project an authored ground position through the same camera as the island art. */
export function islandScenePoint(id: string, point: MapPoint, fitWidth = 1150, fitHeight = 750): MapPoint {
  const grid = registeredRelief[id];
  let height = 0;
  if (grid) {
    const x = Math.max(0, Math.min(grid.width - 1, point.x / 1500 * grid.width));
    const y = Math.max(0, Math.min(grid.height - 1, point.y / 1000 * grid.height));
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = Math.min(grid.width - 1, x0 + 1), y1 = Math.min(grid.height - 1, y0 + 1);
    const at = (column: number, row: number) => grid.values[row * grid.width + column] ?? 0;
    const upper = at(x0, y0) * (1 - (x - x0)) + at(x1, y0) * (x - x0);
    const lower = at(x0, y1) * (1 - (x - x0)) + at(x1, y1) * (x - x0);
    height = upper * (1 - (y - y0)) + lower * (y - y0);
  }
  const frame = islandTerrainFrame(id, fitWidth, fitHeight);
  const ratio = frame.width / 1500;
  return {
    x: 750 + (point.x - 750) * ratio,
    y: 500 + ((point.y - 480) * Math.SQRT1_2 - height * 100 * Math.SQRT1_2) * ratio,
  };
}

/** Responsive fitting keeps both the same place positions and terrain registration. */
export function islandSceneSlots(id: string, count: number, fitWidth = 1150, fitHeight = 750): MapPoint[] {
  return islandPlaceSlots(id, count).map(point => {
    const projected = islandScenePoint(id, { x: point.x * 1500, y: point.y * 1000 }, fitWidth, fitHeight);
    return { x: projected.x / 1500, y: projected.y / 1000 };
  });
}
