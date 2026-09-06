"use client";
import { useId } from "react";
import { islandTerrainFrame } from "@/lib/island-geography";

export function IslandLandscape({ islandId, fitWidth, fitHeight }: { islandId: string; fitWidth?: number; fitHeight?: number }) {
  const uid = useId().replaceAll(":", "");
  const frame = islandTerrainFrame(islandId, fitWidth, fitHeight);
  return <svg className="island-landscape" viewBox="0 0 1500 1000" aria-hidden="true" data-island-terrain={islandId}>
    <defs>
      <pattern id={`${uid}-waves`} width="90" height="70" patternUnits="userSpaceOnUse"><path d="M12 28q12 5 24 0" fill="none" stroke="#b6f5df" strokeWidth="1.4" opacity=".16" /></pattern>
    </defs>
    <rect width="1500" height="1000" fill="#239fab" />
    <rect width="1500" height="1000" fill={`url(#${uid}-waves)`} />
    <image href={`/art/islands/${islandId}-world-v3.webp`} {...frame} preserveAspectRatio="xMidYMid meet" />
  </svg>;
}
