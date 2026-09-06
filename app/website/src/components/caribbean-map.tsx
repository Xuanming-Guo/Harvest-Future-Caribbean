"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { WORLD_ISLANDS, type WorldIsland } from "@/lib/caribbean-islands";
import { boundsOf, coastPath, islandRings, regionalTerrainFrame } from "@/lib/island-geography";
import { placeMapLabels } from "@/lib/map-labels";
import { MapControls } from "./map-controls";

const geography = WORLD_ISLANDS.map(island => { const rings = islandRings(island.id); return { island, path: coastPath(rings), bounds: boundsOf(rings), terrainFrame: regionalTerrainFrame(island.id), labelBounds: rings.map(ring => boundsOf([ring])).sort((a, b) => b.width * b.height - a.width * a.height)[0]! }; });
const shortNames: Record<string, string> = { "bonaire-sint-eustatius-saba": "Caribbean Netherlands", "saint-martin-french-part": "Saint Martin", "sint-maarten-dutch-part": "Sint Maarten", "saint-vincent-grenadines": "St Vincent & Grenadines", "antigua-barbuda": "Antigua & Barbuda", "united-states-virgin-islands": "US Virgin Islands", "british-virgin-islands": "British Virgin Islands" };

export function CaribbeanMap({ selected, homeId, onSelect }: { selected: WorldIsland | undefined; homeId?: string; onSelect: (id: string) => void }) {
  const uid = useId().replaceAll(":", "");
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 900, height: 650 });
  const [camera, setCamera] = useState({ x: 0, y: 0, zoom: 1 });
  const cameraRef = useRef(camera);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ x: number; y: number; distance: number; moved: boolean } | null>(null);
  const chosen = geography.find(item => item.island.id === selected?.id);
  const base = chosen?.bounds ?? { x: 0, y: 10, width: 1160, height: 800 };
  const fit = Math.max((base.width + (chosen ? base.width * .65 : 50)) / size.width, (base.height + (chosen ? base.height * .65 : 50)) / size.height);
  const scale = fit / camera.zoom;
  const center = { x: base.x + base.width / 2 + camera.x, y: base.y + base.height / 2 + camera.y };
  const view = { x: center.x - size.width * scale / 2, y: center.y - size.height * scale / 2, width: size.width * scale, height: size.height * scale };
  const viewRef = useRef({ view, scale, base, fit, size });
  cameraRef.current = camera;
  viewRef.current = { view, scale, base, fit, size };
  const zoomAt = (zoom: number, x = size.width / 2, y = size.height / 2) => {
    const current = cameraRef.current;
    const { fit, scale, size } = viewRef.current;
    const next = Math.max(1, Math.min(8, zoom));
    setCamera({ x: current.x + (x - size.width / 2) * (scale - fit / next), y: current.y + (y - size.height / 2) * (scale - fit / next), zoom: next });
  };
  const zoomRef = useRef(zoomAt); zoomRef.current = zoomAt;
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const measure = () => { const rect = svg.getBoundingClientRect(); if (rect.width && rect.height) setSize({ width: rect.width, height: rect.height }); };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(svg);
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
      zoomRef.current(cameraRef.current.zoom * Math.exp(-delta * .001), event.clientX - rect.left, event.clientY - rect.top);
    };
    svg.addEventListener("wheel", wheel, { passive: false });
    return () => { observer?.disconnect(); svg.removeEventListener("wheel", wheel); };
  }, []);
  const anchors = useMemo(() => geography.map(({ island, labelBounds: bounds }) => {
    const land = { x: (bounds.x - view.x) / scale, y: (bounds.y - view.y) / scale, width: bounds.width / scale, height: bounds.height / scale };
    return { id: island.id, text: shortNames[island.id] ?? island.name, x: land.x + land.width / 2, y: land.y + land.height / 2, land };
  }).filter(item => item.x > 0 && item.x < size.width && item.y > 0 && item.y < size.height).sort((a, b) => (a.id === (selected?.id ?? homeId) ? -1 : b.id === (selected?.id ?? homeId) ? 1 : b.land.width * b.land.height - a.land.width * a.land.height)), [view.x, view.y, scale, size.width, size.height, selected?.id, homeId]);
  const labels = placeMapLabels(anchors, size.width, size.height);
  function select(id: string) { if (!gesture.current?.moved) onSelect(id); }
  function touchState() {
    const points = [...pointers.current.values()];
    return { x: points.reduce((sum, p) => sum + p.x, 0) / points.length, y: points.reduce((sum, p) => sum + p.y, 0) / points.length, distance: points.length > 1 ? Math.hypot(points[0]!.x - points[1]!.x, points[0]!.y - points[1]!.y) : 0 };
  }
  return <div className="caribbean-map-surface illustrated-caribbean">
    <svg ref={svgRef} className="caribbean-illustration" viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`} data-zoom={camera.zoom.toFixed(2)} aria-label="Illustrated Caribbean islands" tabIndex={0}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        if (["+", "=", "-", "0"].includes(event.key)) { event.preventDefault(); if (event.key === "0") setCamera({ x: 0, y: 0, zoom: 1 }); else zoomAt(camera.zoom + (event.key === "-" ? -.2 : .2)); }
        const move = { ArrowLeft: [-35, 0], ArrowRight: [35, 0], ArrowUp: [0, -35], ArrowDown: [0, 35] }[event.key];
        if (move) { event.preventDefault(); setCamera(value => ({ ...value, x: value.x + move[0]! * scale, y: value.y + move[1]! * scale })); }
      }}
      onPointerDown={event => { pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY }); gesture.current = { ...touchState(), moved: false }; if (!(event.target as Element).closest('[role="button"], [data-island-label]')) event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => {
        if (!pointers.current.has(event.pointerId) || !gesture.current) return;
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const next = touchState(), previous = gesture.current;
        const dx = next.x - previous.x, dy = next.y - previous.y;
        if (Math.hypot(dx, dy) > 2 || next.distance) previous.moved = true;
        if (next.distance && previous.distance) { const rect = event.currentTarget.getBoundingClientRect(); zoomAt(cameraRef.current.zoom * next.distance / previous.distance, next.x - rect.left, next.y - rect.top); }
        else setCamera(value => ({ ...value, x: Math.max(-1200, Math.min(1200, value.x - dx * scale)), y: Math.max(-850, Math.min(850, value.y - dy * scale)) }));
        gesture.current = { ...next, moved: previous.moved };
      }}
      onPointerUp={event => { pointers.current.delete(event.pointerId); if (pointers.current.size) gesture.current = { ...touchState(), moved: true }; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={() => { pointers.current.clear(); gesture.current = null; }}>
      <defs>
        <linearGradient id={`${uid}-land`} x2=".3" y2="1"><stop stopColor="#c1d575" /><stop offset=".5" stopColor="#75a34c" /><stop offset="1" stopColor="#3e773d" /></linearGradient>
        <pattern id={`${uid}-waves`} width="65" height="55" patternUnits="userSpaceOnUse"><path d="M12 22q8 3 16 0" stroke="#c1f4e5" strokeWidth=".7" opacity=".22" fill="none" /></pattern>
      </defs>
      <rect x={view.x} y={view.y} width={view.width} height={view.height} fill="#239fab" />
      <rect x={view.x} y={view.y} width={view.width} height={view.height} fill={`url(#${uid}-waves)`} />
      {geography.map(({ island, path, bounds, terrainFrame }) => {
        const showArt = selected?.id === island.id || bounds.width / scale > 85;
        return <g key={island.id} role="button" tabIndex={0} aria-label={island.name} aria-pressed={selected?.id === island.id} className="geographic-island" onClick={() => select(island.id)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(island.id); } }}>
        <title>{island.name}</title>
        <path d={path} fill={showArt ? "transparent" : `url(#${uid}-land)`} stroke={showArt ? "none" : "#88d8c1"} strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        <path d={path} fill={showArt ? "transparent" : `url(#${uid}-land)`} stroke={showArt ? "none" : "#f4e2af"} strokeWidth="1.3" vectorEffect="non-scaling-stroke" />
        {showArt && <image href={`/art/islands/${island.id}-world-v3.webp`} {...terrainFrame} preserveAspectRatio="xMidYMid meet" pointerEvents="visiblePainted" /> }
      </g>; })}
      <g className="geographic-labels" transform={`translate(${view.x} ${view.y}) scale(${scale})`}>
        {labels.map(label => <g key={label.id} className="geographic-label" onClick={() => select(label.id)} data-island-label={label.id}>
          <path d={`M${label.x},${label.y}L${Math.max(label.box.x, Math.min(label.x, label.box.x + label.box.width))},${Math.max(label.box.y, Math.min(label.y, label.box.y + label.box.height))}`} stroke="#e3f3db" strokeWidth="1" opacity=".65" fill="none" />
          <rect x={label.box.x} y={label.box.y} width={label.box.width} height={label.box.height} rx="5" fill={label.id === homeId ? "#fff2c7" : "#f6f7e9"} fillOpacity=".97" />
          <text x={label.box.x + label.box.width / 2} y={label.box.y + 17} textAnchor="middle" fill="#244d43" fontSize="12" fontWeight="600">{label.text}</text>
        </g>)}
      </g>
    </svg>
    <MapControls zoom={camera.zoom} max={8} onZoom={zoom => zoomAt(zoom)} onReset={() => setCamera({ x: 0, y: 0, zoom: 1 })} resetLabel="Reset illustrated map" />
  </div>;
}
