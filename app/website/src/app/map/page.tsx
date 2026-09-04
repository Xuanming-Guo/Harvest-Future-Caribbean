"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Map as MapIcon, PackageCheck, Route, Search, Sparkles, X } from "lucide-react";
import { useId, useMemo, useState } from "react";

import { OpenWorldMap } from "@/components/open-world-map";
import { useSession } from "@/components/providers";
import { Badge, EmptyState, ErrorState, LoadingState } from "@/components/ui";
import { api } from "@/lib/api";
import { titleCase } from "@/lib/format";

const roleCopy = {
  FARMER: "Visit your fields, open hotel order boards, and choose which real buyer requests your crops can fill.",
  BUYER: "Explore available farms, then follow your order journeys back to your hotel.",
  TRANSPORTER: "Explore delivery places across the island and switch route layers on when you are ready to drive.",
  COORDINATOR: "Move around the island, inspect permitted crop progress, and watch approved deliveries.",
} as const;

export default function IslandMapPage() {
  const { actor } = useSession();
  const [selectedMissionId, setSelectedMissionId] = useState<string>();
  const [routePickerOpen, setRoutePickerOpen] = useState(false);
  const [routeQuery, setRouteQuery] = useState("");
  const [placeOpen, setPlaceOpen] = useState(false);
  const routePickerId = useId();
  const world = useQuery({ queryKey: ["world-map"], queryFn: () => api.worldMap(), refetchInterval: 10_000 });
  const missions = useQuery({ queryKey: ["missions", "island-map"], queryFn: () => api.missions(), refetchInterval: 5_000 });
  const selected = missions.data?.items.find((mission) => mission.missionId === selectedMissionId);
  const visibleRoutes = useMemo(() => {
    const query = routeQuery.trim().toLowerCase();
    if (!query) return missions.data?.items ?? [];
    return (missions.data?.items ?? []).filter((mission) => [mission.buyerName, mission.cropType, mission.status]
      .some((value) => value.toLowerCase().includes(query)));
  }, [missions.data?.items, routeQuery]);

  if (world.error) return <ErrorState error={world.error} />;
  if (missions.error) return <ErrorState error={missions.error} />;
  if (!world.data || !missions.data || !actor) return <LoadingState label="Opening the living island..." />;

  const farms = world.data.locations.filter((location) => location.kind === "FARM").length;
  const hotels = world.data.locations.filter((location) => location.kind === "HOTEL").length;

  return (
    <div className="island-world-page">
      <header className={`island-world-hud ${placeOpen ? "is-hidden" : ""}`} aria-hidden={placeOpen}>
        <div>
          <span><Sparkles size={14} />Harvest world</span>
          <h1>Saint Lucia, alive</h1>
          <p>{roleCopy[actor.role]}</p>
        </div>
        <div className="world-hud-actions">
          <div className="island-world-count"><MapIcon size={18} /><strong>{farms} + {hotels}</strong><span>farms and hotels</span></div>
          <button className="island-world-count is-action" type="button" aria-label={`${missions.data.items.length} visible delivery route${missions.data.items.length === 1 ? "" : "s"}. ${selected ? "Change route layer" : "Show a route layer"}`} aria-expanded={routePickerOpen} aria-controls={routePickerId} onClick={() => setRoutePickerOpen((open) => !open)}>
            <Route size={18} /><strong>{missions.data.items.length}</strong><span>{selected ? "Change route layer" : "Show a route layer"}</span>
          </button>
        </div>
      </header>

      {routePickerOpen && (
        <section className="map-route-drawer" id={routePickerId} role="dialog" aria-label="Choose an island route" onKeyDown={(event) => {
          if (event.key === "Escape") setRoutePickerOpen(false);
        }}>
          <div className="map-route-drawer-heading">
            <div><span>Route layers</span><strong>Choose a journey</strong></div>
            <button type="button" aria-label="Close route board" onClick={() => setRoutePickerOpen(false)}><X size={18} /></button>
          </div>
          <p className="route-layer-explainer">The world stays in place. Choosing a delivery draws its road and truck over the island.</p>
          <label className="map-route-search"><Search size={16} /><span className="sr-only">Search routes</span><input value={routeQuery} onChange={(event) => setRouteQuery(event.target.value)} placeholder="Search hotel, crop, or status" /></label>
          <div className="map-route-switcher" aria-label="Choose a route">
            {visibleRoutes.map((mission) => {
              const active = mission.missionId === selected?.missionId;
              return (
                <button type="button" className={active ? "is-selected" : ""} aria-pressed={active} onClick={() => {
                  setSelectedMissionId(mission.missionId);
                  setRoutePickerOpen(false);
                }} key={mission.missionId}>
                  <PackageCheck size={16} />
                  <span><strong>{mission.quantity.value} kg {titleCase(mission.cropType)}</strong><small>{mission.buyerName}</small></span>
                  {active ? <Check size={17} /> : <Badge tone={mission.atRisk ? "high" : undefined}>{mission.status}</Badge>}
                </button>
              );
            })}
            {!visibleRoutes.length && <EmptyState title="No routes match" detail="Try another hotel, crop, or status." />}
          </div>
          {selected && <button type="button" className="route-layer-clear" onClick={() => { setSelectedMissionId(undefined); setRoutePickerOpen(false); }}>Explore without a route</button>}
        </section>
      )}

      <OpenWorldMap
        world={world.data}
        mission={selected}
        role={actor.role}
        onClearRoute={() => setSelectedMissionId(undefined)}
        onSceneChange={setPlaceOpen}
      />
    </div>
  );
}
