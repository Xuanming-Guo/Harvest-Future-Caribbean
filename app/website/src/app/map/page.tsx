"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, Map as MapIcon, PackageCheck, Search, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";

import { DeliveryJourney, EmptyIslandWorld } from "@/components/delivery-world";
import { useSession } from "@/components/providers";
import { Badge, ErrorState, LoadingState } from "@/components/ui";
import { api } from "@/lib/api";
import { titleCase } from "@/lib/format";

const roleCopy = {
  FARMER: "See where your committed crops join the journey. Open a farm marker to visit its field.",
  BUYER: "Follow each order from its farms to your hotel, with only the crops committed to you.",
  TRANSPORTER: "Explore available and assigned routes, then open a delivery when you are ready to drive.",
  COORDINATOR: "Watch the island’s approved deliveries and inspect the crops attached to each route.",
} as const;

export default function IslandMapPage() {
  const { actor } = useSession();
  const [selectedMissionId, setSelectedMissionId] = useState<string>();
  const [routePickerOpen, setRoutePickerOpen] = useState(false);
  const [routeQuery, setRouteQuery] = useState("");
  const [worldMode, setWorldMode] = useState<"MAP" | "FARM">("MAP");
  const routePickerId = useId();
  const missions = useQuery({ queryKey: ["missions", "island-map"], queryFn: () => api.missions(), refetchInterval: 5_000 });
  const selected = missions.data?.items.find((mission) => mission.missionId === selectedMissionId) ?? missions.data?.items[0];
  const visibleRoutes = useMemo(() => {
    const query = routeQuery.trim().toLowerCase();
    if (!query) return missions.data?.items ?? [];
    return (missions.data?.items ?? []).filter((mission) => [mission.buyerName, mission.cropType, mission.status]
      .some((value) => value.toLowerCase().includes(query)));
  }, [missions.data?.items, routeQuery]);
  const updates = useQuery({
    queryKey: ["mission-updates", selected?.missionId],
    queryFn: () => api.missionUpdates(selected!.missionId),
    enabled: Boolean(selected),
    refetchInterval: 5_000,
  });

  useEffect(() => {
    if (selectedMissionId || !missions.data?.items.length) return;
    const active = missions.data.items.find((mission) => !["AVAILABLE", "DELIVERED", "CANCELLED"].includes(mission.status));
    setSelectedMissionId((active ?? missions.data.items[0])?.missionId);
  }, [missions.data, selectedMissionId]);

  if (missions.error) return <ErrorState error={missions.error} />;
  if (!missions.data || !actor) return <LoadingState label="Opening the island world..." />;

  const routeLink = selected
    ? actor.role === "TRANSPORTER" ? `/missions/${selected.missionId}` : `/orders/${selected.orderId}`
    : undefined;

  return (
    <div className="island-world-page">
      <header className={`island-world-hud ${worldMode === "FARM" ? "is-hidden" : ""}`} aria-hidden={worldMode === "FARM"}>
        <div>
          <span><Sparkles size={14} />Harvest world</span>
          <h1>Your Saint Lucia map</h1>
          <p>{roleCopy[actor.role]}</p>
        </div>
        {missions.data.items.length > 1 ? (
          <button className="island-world-count is-action" type="button" aria-expanded={routePickerOpen} aria-controls={routePickerId} onClick={() => setRoutePickerOpen((open) => !open)}>
            <MapIcon size={18} /><strong>{missions.data.items.length}</strong><span>Browse visible routes</span>
          </button>
        ) : (
          <div className="island-world-count"><MapIcon size={18} /><strong>{missions.data.items.length}</strong><span>route visible to you</span></div>
        )}
      </header>

      {missions.data.items.length > 1 && routePickerOpen && (
        <section className="map-route-drawer" id={routePickerId} role="dialog" aria-label="Choose an island route" onKeyDown={(event) => {
          if (event.key === "Escape") setRoutePickerOpen(false);
        }}>
          <div className="map-route-drawer-heading">
            <div><span>Route board</span><strong>Choose a journey</strong></div>
            <button type="button" aria-label="Close route board" onClick={() => setRoutePickerOpen(false)}><X size={18} /></button>
          </div>
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
            {!visibleRoutes.length && <p>No routes match that search.</p>}
          </div>
        </section>
      )}

      {!selected ? (
        <EmptyIslandWorld />
      ) : (
        <DeliveryJourney
          key={selected.missionId}
          immersive
          mission={selected}
          onWorldModeChange={(mode) => {
            setWorldMode(mode);
            if (mode === "FARM") setRoutePickerOpen(false);
          }}
          updates={updates.data?.items}
          controls={routeLink ? <Link className="button" href={routeLink}>Open {actor.role === "TRANSPORTER" ? "delivery" : "order"}<ArrowRight size={17} /></Link> : undefined}
        />
      )}
      {updates.error && <p className="form-error">The latest route updates are unavailable. The order-linked map is still shown.</p>}
    </div>
  );
}
