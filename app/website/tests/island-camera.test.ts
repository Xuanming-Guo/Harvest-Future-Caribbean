import { describe, expect, it } from "vitest";
import { clampIslandCamera } from "@/lib/island-camera";

describe("painted island camera bounds", () => {
  const viewports = [
    { width: 979, height: 676, surfaceWidth: 1017, surfaceHeight: 678 },
    { width: 360, height: 760, surfaceWidth: 1143, surfaceHeight: 762 },
    { width: 1400, height: 500, surfaceWidth: 1402, surfaceHeight: 934.67 },
  ];
  for (const viewport of viewports) {
    it(`keeps the artwork covering a ${viewport.width} by ${viewport.height} viewport through pan and zoom`, () => {
      for (const zoom of [.5, 1, 1.4, 2, 3, 5]) {
        for (const x of [-10000, 0, 10000]) for (const y of [-10000, 0, 10000]) {
          const view = clampIslandCamera({ x, y, zoom }, viewport);
          const left = (viewport.width - viewport.surfaceWidth * view.zoom) / 2 + view.x;
          const top = (viewport.height - viewport.surfaceHeight * view.zoom) / 2 + view.y;
          expect(left).toBeLessThanOrEqual(0);
          expect(top).toBeLessThanOrEqual(0);
          expect(left + viewport.surfaceWidth * view.zoom).toBeGreaterThanOrEqual(viewport.width);
          expect(top + viewport.surfaceHeight * view.zoom).toBeGreaterThanOrEqual(viewport.height);
          expect(view.zoom).toBeGreaterThanOrEqual(1);
          expect(view.zoom).toBeLessThanOrEqual(3);
        }
      }
    });
  }
  it("reclamps a zoomed and panned view when zooming out or resizing", () => {
    const view = clampIslandCamera({ x: 600, y: 500, zoom: 1 }, viewports[0]!);
    expect(Math.abs(view.x)).toBeLessThan(20);
    expect(view.y).toBe(0);
  });
});
