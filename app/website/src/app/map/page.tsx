"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Map as MapIcon, PackageCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

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
  const missions = useQuery({ queryKey: ["missions", "island-map"], queryFn: () => api.missions(), refetchInterval: 5_000 });
  const selected = missions.data?.items.find((mission) => mission.missionId === selectedMissionId) ?? missions.data?.items[0];
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
      <header className="island-world-hud">
        <div>
          <span><Sparkles size={14} />Harvest world</span>
          <h1>Your Saint Lucia map</h1>
          <p>{roleCopy[actor.role]}</p>
        </div>
        <div className="island-world-count"><MapIcon size={18} /><strong>{missions.data.items.length}</strong><span>{missions.data.items.length === 1 ? "route" : "routes"} visible to you</span></div>
      </header>

      {missions.data.items.length > 1 && (
        <div className="map-route-switcher" aria-label="Choose a route">
          {missions.data.items.map((mission) => (
            <button type="button" className={mission.missionId === selected?.missionId ? "is-selected" : ""} aria-pressed={mission.missionId === selected?.missionId} onClick={() => setSelectedMissionId(mission.missionId)} key={mission.missionId}>
              <PackageCheck size={16} />
              <span><strong>{mission.quantity.value} kg {titleCase(mission.cropType)}</strong><small>{mission.buyerName}</small></span>
              <Badge tone={mission.atRisk ? "high" : undefined}>{mission.status}</Badge>
            </button>
          ))}
        </div>
      )}

      {!selected ? (
        <EmptyIslandWorld />
      ) : (
        <DeliveryJourney
          key={selected.missionId}
          mission={selected}
          updates={updates.data?.items}
          controls={routeLink ? <Link className="button" href={routeLink}>Open {actor.role === "TRANSPORTER" ? "delivery" : "order"}<ArrowRight size={17} /></Link> : undefined}
        />
      )}
      {updates.error && <p className="form-error">The latest route updates are unavailable. The order-linked map is still shown.</p>}
    </div>
  );
}
