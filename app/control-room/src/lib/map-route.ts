import type { ControlRoomScene, GeoPoint } from "@harvest/simulation";

export interface MapStop { id: string; name: string; islandId: string; position: GeoPoint; kind: string }
export interface MapRoute { distanceKm: number; points: GeoPoint[]; roadIds: string[] }
const key = (point: GeoPoint) => `${point.latitude.toFixed(6)},${point.longitude.toFixed(6)}`;

export function mapStops(scene: ControlRoomScene): MapStop[] {
  return [
    ...scene.farms.map((item) => ({ id: item.farmId, name: item.name, islandId: item.islandId, position: item.position, kind: "Farm" })),
    ...scene.buyers.map((item) => ({ id: item.buyerId, name: item.name, islandId: item.islandId, position: item.position, kind: "Buyer" })),
    ...scene.transporters.map((item) => ({ id: item.transporterId, name: item.name, islandId: item.islandId, position: item.homePosition, kind: "Depot" })),
    ...scene.referencePlaces.map((item) => ({ id: item.referencePlaceId, name: item.name, islandId: item.islandId, position: item.position, kind: "Public place" })),
  ].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** Shortest distance on the saved undirected road graph. Never invent access
 * links, road geometry, travel times or cross-water connections. */
export function shortestMapRoute(scene: Pick<ControlRoomScene, "roads">, from: MapStop, to: MapStop): MapRoute | null {
  if (from.islandId !== to.islandId) return null;
  const graph = new Map<string, Array<{ to: string; km: number; roadId: string }>>();
  const points = new Map<string, GeoPoint>();
  for (const road of [...scene.roads].sort((a, b) => a.roadSegmentId.localeCompare(b.roadSegmentId))) {
    if (road.islandId !== from.islandId || !Number.isFinite(road.distanceKm) || road.distanceKm < 0) continue;
    const a = key(road.from), b = key(road.to);
    points.set(a, road.from); points.set(b, road.to);
    graph.set(a, [...(graph.get(a) ?? []), { to: b, km: road.distanceKm, roadId: road.roadSegmentId }]);
    graph.set(b, [...(graph.get(b) ?? []), { to: a, km: road.distanceKm, roadId: road.roadSegmentId }]);
  }
  const start = key(from.position), end = key(to.position);
  if (!graph.has(start) || !graph.has(end)) return null;
  const distances = new Map<string, number>([[start, 0]]);
  const previous = new Map<string, { from: string; roadId: string }>();
  const remaining = new Set(graph.keys());
  while (remaining.size) {
    const current = [...remaining].sort((a, b) => (distances.get(a) ?? Infinity) - (distances.get(b) ?? Infinity) || a.localeCompare(b))[0]!;
    const distance = distances.get(current);
    if (distance === undefined) break;
    remaining.delete(current);
    if (current === end) {
      const path = [points.get(end)!], roadIds: string[] = [];
      let cursor = end;
      while (cursor !== start) {
        const step = previous.get(cursor)!;
        roadIds.unshift(step.roadId); path.unshift(points.get(step.from)!); cursor = step.from;
      }
      return { distanceKm: distance, points: path, roadIds };
    }
    for (const edge of graph.get(current) ?? []) {
      if (!remaining.has(edge.to)) continue;
      const next = distance + edge.km;
      if (next < (distances.get(edge.to) ?? Infinity)) {
        distances.set(edge.to, next); previous.set(edge.to, { from: current, roadId: edge.roadId });
      }
    }
  }
  return null;
}
