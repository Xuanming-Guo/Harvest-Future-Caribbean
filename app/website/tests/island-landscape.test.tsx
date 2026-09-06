import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { IslandLandscape } from "@/components/island-landscape";
import { WORLD_ISLANDS } from "@/lib/caribbean-islands";

afterEach(cleanup);

describe("individual island landscapes", () => {
  it("changes the complete terrain asset with the island instead of masking one shared picture", () => {
    const { container, rerender } = render(<IslandLandscape islandId="saint-lucia" />);
    expect(container.querySelector("image")).toHaveAttribute("href", "/art/islands/saint-lucia-world-v3.webp");
    rerender(<IslandLandscape islandId="jamaica" />);
    expect(container.querySelector("image")).toHaveAttribute("href", "/art/islands/jamaica-world-v3.webp");
    expect(container.querySelector("clipPath")).toBeNull();
  });
  it("ships a distinct, traceable terrain render for every island", () => {
    const directory = path.resolve(process.cwd(), "public/art/islands");
    const manifest = JSON.parse(readFileSync(path.join(directory, "world-manifest.json"), "utf8"));
    const hashes = new Set<string>();
    for (const island of WORLD_ISLANDS) {
      const record = manifest.islands[island.id];
      expect(record, island.name).toBeDefined();
      expect(record.source.tiles.length, island.name).toBeGreaterThan(0);
      const asset = readFileSync(path.join(directory, path.basename(record.asset)));
      const hash = createHash("sha256").update(asset).digest("hex");
      expect(hash).toBe(record.sha256);
      expect(record.elevationRangeMeters[0]).toBeGreaterThanOrEqual(0);
      expect(record.elevationRangeMeters[1]).toBeLessThan(4000);
      hashes.add(hash);
    }
    expect(hashes.size).toBe(WORLD_ISLANDS.length);
  });
});
