"use client";

import { useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { ArrowLeft, ArrowUpRight, Check, Compass, Globe2, MapPin, Route, Search, X } from "lucide-react";
import { useState } from "react";
import { OpenWorldMap } from "@/components/open-world-map";
import { useSession } from "@/components/providers";
import { Badge, ErrorState, LoadingState } from "@/components/ui";
import { api } from "@/lib/api";
import { WORLD_ISLANDS, workspaceIsland } from "@/lib/caribbean-islands";
import { titleCase } from "@/lib/format";

const CaribbeanMap = dynamic(() => import("@/components/caribbean-map").then(module => module.CaribbeanMap), { ssr: false, loading: () => <LoadingState label="Loading map…" /> });

export default function IslandMapPage() {
  const { actor } = useSession();
  const [islandId, setIslandId] = useState<string>();
  const [localView, setLocalView] = useState(true);
  const [islandsOpen, setIslandsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedMissionId, setSelectedMissionId] = useState<string>();
  const [routesOpen, setRoutesOpen] = useState(false);
  const [routeQuery, setRouteQuery] = useState("");
  const [placeOpen, setPlaceOpen] = useState(false);
  const world = useQuery({ queryKey: ["world-map"], queryFn: () => api.worldMap(), refetchInterval: 10_000 });
  const missions = useQuery({ queryKey: ["missions", "island-map"], queryFn: () => api.missions(), refetchInterval: 5_000 });
  if (world.error) return <ErrorState error={world.error} />;
  if (missions.error) return <ErrorState error={missions.error} />;
  if (!world.data || !missions.data || !actor) return <LoadingState label="Opening Harvest World…" />;
  const home = workspaceIsland(world.data.region);
  const selectedIsland = WORLD_ISLANDS.find(island => island.id === islandId);
  const localIsland = selectedIsland ?? home;
  const localWorld = localIsland && localIsland.id !== home?.id ? { ...world.data, region: localIsland.name, locations: [] } : world.data;
  const selectedMission = missions.data.items.find(mission => mission.missionId === selectedMissionId);
  const islands = WORLD_ISLANDS.filter(island => island.name.toLowerCase().includes(query.toLowerCase()));
  const routes = missions.data.items.filter(mission => `${mission.buyerName} ${mission.cropType} ${mission.status}`.toLowerCase().includes(routeQuery.toLowerCase()));
  const placeCount = world.data.locations.length;
  const selectedCount = selectedIsland?.id === home?.id ? placeCount : 0;
  function chooseIsland(id: string | undefined) { setIslandId(id); setIslandsOpen(false); }
  function backToRegion() { setLocalView(false); setPlaceOpen(false); setRoutesOpen(false); setSelectedMissionId(undefined); }

  return <div className="harvest-world">
    <header className="harvest-world-header">
      <div className="harvest-world-title"><span className="world-brand-icon"><Compass size={23} /></span><div><span className="eyebrow">Harvest World</span><h1>{localView ? localWorld.region : selectedIsland?.name ?? "The Caribbean"}</h1></div></div>
      <div className="harvest-world-actions">
        {localView ? <>
          <button type="button" className="button button-secondary" onClick={backToRegion}><ArrowLeft size={16} />Caribbean</button>
          {!placeOpen && localIsland?.id === home?.id && <button type="button" className="button button-secondary" aria-expanded={routesOpen} onClick={() => setRoutesOpen(value => !value)}><Route size={16} />Deliveries<span className="world-count">{missions.data.items.length}</span></button>}
        </> : <>
          <button type="button" className="button button-secondary world-islands-toggle" aria-expanded={islandsOpen} onClick={() => setIslandsOpen(value => !value)}><Globe2 size={16} />Islands</button>
          {home && placeCount > 0 && <button type="button" className="button" onClick={() => { setIslandId(home.id); setLocalView(true); }}><MapPin size={16} />My places<span className="world-count">{placeCount}</span></button>}
        </>}
      </div>
    </header>
    {localView ? <div className="world-local-view">
      <OpenWorldMap key={localWorld.region} world={localWorld} mission={localIsland?.id === home?.id ? selectedMission : undefined} role={actor.role} onClearRoute={() => setSelectedMissionId(undefined)} onSceneChange={setPlaceOpen} />
      {routesOpen && <section className="world-delivery-picker" role="dialog" aria-label="Deliveries" onKeyDown={event => { if (event.key === "Escape") setRoutesOpen(false); }}>
        <header><h2>Deliveries</h2><button type="button" className="icon-button" aria-label="Close deliveries" onClick={() => setRoutesOpen(false)}><X size={18} /></button></header>
        <label className="world-search"><Search size={16} /><input aria-label="Search deliveries" value={routeQuery} onChange={event => setRouteQuery(event.target.value)} placeholder="Search deliveries" /></label>
        <div className="world-delivery-list">{routes.map(mission => <button type="button" key={mission.missionId} aria-pressed={selectedMissionId === mission.missionId} onClick={() => { setSelectedMissionId(mission.missionId); setRoutesOpen(false); }}><span><strong>{mission.quantity.value} kg {titleCase(mission.cropType)}</strong><small>{mission.buyerName}</small></span>{selectedMissionId === mission.missionId ? <Check size={18} /> : <Badge>{mission.status}</Badge>}</button>)}{!routes.length && <p className="world-empty">No deliveries</p>}</div>
        {selectedMission && <button type="button" className="button button-quiet" onClick={() => { setSelectedMissionId(undefined); setRoutesOpen(false); }}>Hide route</button>}
      </section>}
    </div> : <div className="world-regional-layout">
      <aside className={`world-island-directory ${islandsOpen ? "is-open" : ""}`} aria-label="Caribbean islands">
        <header><h2>Islands & territories</h2><span>{WORLD_ISLANDS.length}</span></header>
        <label className="world-search"><Search size={16} /><input aria-label="Search islands" placeholder="Search islands" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <button type="button" className={`world-overview ${!islandId ? "is-selected" : ""}`} aria-pressed={!islandId} onClick={() => chooseIsland(undefined)}><Globe2 size={18} />Caribbean overview</button>
        <div className="world-island-list">{islands.map(island => <button type="button" key={island.id} aria-pressed={islandId === island.id} className={islandId === island.id ? "is-selected" : ""} onClick={() => chooseIsland(island.id)}><span>{island.name}</span>{island.id === home?.id && placeCount > 0 ? <span className="world-place-count">{placeCount}</span> : <ArrowUpRight size={14} />}</button>)}{!islands.length && <p className="world-empty">No matching islands</p>}</div>
      </aside>
      <div className="world-regional-map"><CaribbeanMap key={selectedIsland?.id ?? "overview"} selected={selectedIsland} homeId={home?.id} onSelect={chooseIsland} />
        {selectedIsland && <section className="world-island-card" aria-label={`${selectedIsland.name} overview`}><div><span className="eyebrow">{selectedIsland.code} · {selectedIsland.currency}</span><h2>{selectedIsland.name}</h2><span className="world-island-count">{selectedCount ? `${selectedCount} places` : "No places yet"}</span></div><button type="button" className="button" onClick={() => { setSelectedMissionId(undefined); setLocalView(true); }}>Explore island<ArrowUpRight size={17} /></button></section>}
      </div>
    </div>}
  </div>;
}
