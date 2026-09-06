import type { MapBounds } from "./island-geography";
export type LabelAnchor = { id: string; text: string; x: number; y: number; land: MapBounds };
export type MapLabel = LabelAnchor & { box: MapBounds };
export function rectanglesOverlap(a: MapBounds, b: MapBounds, gap = 4) {
  return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
}
/** Lay out labels in screen pixels, independently of terrain scale and drawing order. */
export function placeMapLabels(anchors: LabelAnchor[], width: number, height: number): MapLabel[] {
  const placed: MapLabel[] = [];
  for (const anchor of anchors) {
    const w = Math.min(210, anchor.text.length * 6.9 + 16), h = 26;
    const { land, x, y } = anchor;
    const candidates = [
      ...(land.width > 60 && land.height > 25 ? [{ x: x - w / 2, y: y - h / 2 }] : []),
      { x: land.x + land.width + 9, y: y - h / 2 },
      { x: land.x - w - 9, y: y - h / 2 },
      { x: x - w / 2, y: land.y + land.height + 9 },
      { x: x - w / 2, y: land.y - h - 9 },
      ...[-1, 1].flatMap(side => [38, 76, 114].map(offset => ({ x: side > 0 ? land.x + land.width + 15 : land.x - w - 15, y: y + offset - h / 2 }))),
    ];
    const box = candidates.map(p => ({ ...p, width: w, height: h })).find(candidate => candidate.x >= 12 && candidate.y >= 12 && candidate.x + w <= width - 12 && candidate.y + h <= height - 62 && !placed.some(label => rectanglesOverlap(candidate, label.box)) && !anchors.some(other => other.id !== anchor.id && rectanglesOverlap(candidate, other.land, 3)));
    if (box) placed.push({ ...anchor, box });
  }
  return placed;
}
