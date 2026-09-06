"use client";
import { useState } from "react";
import type { ControlRoomScene, ControlRoomFrame } from "@harvest/simulation";
import type { SimulationScenario } from "@/lib/run";
import type { MapRoute, MapStop } from "@/lib/map-route";
import SelectControl from "./SelectControl";

export default function MapExplorer({ islands, scene, frame, activeIsland, onIsland, routeMode, onRouteMode, fromId, toId, onFrom, onTo, stops, route }: {
  islands: SimulationScenario["islands"]; scene: ControlRoomScene; frame: ControlRoomFrame;
  activeIsland: string | null; onIsland: (id: string | null) => void;
  routeMode: boolean; onRouteMode: (enabled: boolean) => void;
  fromId: string; toId: string; onFrom: (id: string) => void; onTo: (id: string) => void;
  stops: MapStop[]; route: MapRoute | null;
}) {
  const [query, setQuery] = useState("");
  const scope = new Set([...scene.farms, ...scene.buyers].map((item) => item.islandId));
  const current = islands.find((island) => island.islandId === activeIsland);
  const filtered = islands.filter((island) => island.name.toLowerCase().includes(query.toLowerCase()));
  const affected = route?.roadIds.filter((id) => frame.degradedRoadSegmentIds.includes(id)).length ?? 0;
  const options = stops.filter((stop) => !activeIsland || stop.islandId === activeIsland || [fromId, toId].includes(stop.id));
  return <section className="panel map-explorer" aria-label="Caribbean explorer">
    <header className="explorer-heading"><span className="eyebrow">THE HARVEST NETWORK</span><h2>Explore Caribbean</h2></header>
    <div className="explorer-tabs" role="group" aria-label="Map tools">
      <button type="button" aria-pressed={!routeMode} onClick={() => onRouteMode(false)}>Islands</button>
      <button type="button" aria-pressed={routeMode} onClick={() => onRouteMode(true)}>A → B route</button>
    </div>
    {!routeMode ? <>
      <input className="island-search" aria-label="Search islands" placeholder="Search 28 islands & territories…" value={query} onChange={(event) => setQuery(event.target.value)} />
      <button type="button" className={`island-overview ${activeIsland === null ? "is-active" : ""}`} onClick={() => onIsland(null)}><span>◎ Caribbean overview</span><small>{scope.size} {scope.size === 1 ? "island" : "islands"} in this run</small></button>
      <div className="island-directory">
        {filtered.map((island) => <button type="button" key={island.islandId} className={activeIsland === island.islandId ? "is-active" : ""} aria-pressed={activeIsland === island.islandId} onClick={() => onIsland(island.islandId)}>
          <span><strong>{island.name}</strong><small>{scope.has(island.islandId) ? `${scene.farms.filter((farm) => farm.islandId === island.islandId).length} farms · saved activity` : "Outside this run"}</small></span><span aria-hidden="true">↗</span>
        </button>)}
        {!filtered.length && <p className="panel-help">No matching islands</p>}
      </div>
    </> : <div className="route-planner">
      <label><span className="route-pin">A</span> Start<SelectControl aria-label="Route start" value={fromId} onValueChange={onFrom}><option value="">Choose a starting point</option>{options.map((stop) => <option key={stop.id} value={stop.id}>{stop.name}</option>)}</SelectControl></label>
      <button type="button" className="route-swap" disabled={!fromId || !toId} aria-label="Swap route endpoints" onClick={() => { onFrom(toId); onTo(fromId); }}>⇅ Swap</button>
      <label><span className="route-pin destination">B</span> Destination<SelectControl aria-label="Route destination" value={toId} onValueChange={onTo}><option value="">Choose a destination</option>{options.map((stop) => <option key={stop.id} value={stop.id}>{stop.name}</option>)}</SelectControl></label>
      <div className="route-result" role="status">
        {!fromId || !toId ? <strong>{fromId ? "Select destination" : "Select start"}</strong> : route ? <><strong>{route.distanceKm.toFixed(1)} km</strong><p>Route · {route.roadIds.length} {route.roadIds.length === 1 ? "segment" : "segments"}</p>{affected > 0 && <p className="route-warning">{affected} disrupted segments</p>}</> : <strong>No route available</strong>}
      </div>
      <button type="button" className="subtle-button" onClick={() => { onFrom(""); onTo(""); }}>Clear route</button>
    </div>}
    {current && <footer className="island-context"><strong>{current.name}</strong><span>{current.currency} · {current.timeZone.replaceAll("_", " ")}</span>{!scope.has(current.islandId) && <p>No activity in this run</p>}</footer>}
  </section>;
}
