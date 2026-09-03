"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Clock3, PackageCheck, Truck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { DeliveryBoard, DeliveryJourney, VehiclePicker } from "@/components/delivery-world";
import { Card, EmptyState, ErrorState, LoadingState, Metric, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";

export default function TransporterHome() {
  const queryClient = useQueryClient();
  const [vehicleId, setVehicleId] = useState("");
  const [selectedMissionId, setSelectedMissionId] = useState<string>();
  const missions = useQuery({ queryKey: ["missions"], queryFn: () => api.missions(), refetchInterval: 5_000 });
  const vehicles = useQuery({ queryKey: ["vehicles"], queryFn: api.vehicles, refetchInterval: 5_000 });
  const selectedUpdates = useQuery({
    queryKey: ["mission-updates", selectedMissionId],
    queryFn: () => api.missionUpdates(selectedMissionId!),
    enabled: Boolean(selectedMissionId),
    refetchInterval: 5_000,
  });
  const accept = useMutation({
    mutationFn: (missionId: string) => {
      if (!vehicleId) throw new Error("Choose an available vehicle before accepting this route.");
      return api.acceptMission(missionId, vehicleId);
    },
    onSuccess: () => {
      setVehicleId("");
      void queryClient.invalidateQueries();
    },
  });

  useEffect(() => {
    if (!missions.data?.items.length || missions.data.items.some((mission) => mission.missionId === selectedMissionId)) return;
    const firstActive = missions.data.items.find((mission) => mission.status !== "AVAILABLE" && mission.status !== "CANCELLED");
    setSelectedMissionId((firstActive ?? missions.data.items[0])?.missionId);
  }, [missions.data, selectedMissionId]);

  if (missions.error) return <ErrorState error={missions.error} />;
  if (!missions.data) return <LoadingState label="Pinning today’s delivery tickets..." />;

  const available = missions.data.items.filter((mission) => mission.status === "AVAILABLE");
  const mine = missions.data.items.filter((mission) => mission.status !== "AVAILABLE" && mission.status !== "CANCELLED");
  const selected = missions.data.items.find((mission) => mission.missionId === selectedMissionId);
  const availableVehicles = vehicles.data?.items ?? [];

  return (
    <>
      <div className="delivery-page-header" data-tour="transporter-home">
        <PageHeader
          eyebrow="Saint Lucia deliveries"
          title="Choose a route. Move the harvest."
          description="Claim local delivery work, follow each farm stop and keep the hotel updated as the produce moves."
          actions={(
            <div data-tour="transporter-vehicle">
              <VehiclePicker vehicles={availableVehicles} value={vehicleId} onChange={setVehicleId} />
            </div>
          )}
        />
      </div>
      <div className="metric-grid">
        <Metric label="Ready to claim" value={available.length} detail="Local routes waiting" icon={PackageCheck} />
        <Metric label="My active routes" value={mine.filter((mission) => mission.status !== "DELIVERED").length} detail="Assigned to you" icon={Truck} tone="blue" />
        <Metric label="Delivered" value={mine.filter((mission) => mission.status === "DELIVERED").length} detail="Completed routes" icon={Clock3} tone="amber" />
      </div>
      {vehicles.error && <p className="form-error">Vehicle options could not be loaded. Try again before claiming a route.</p>}
      <div className="delivery-workspace-grid">
        <Card className="delivery-board-card" data-tour="transporter-available">
          <div className="delivery-board-banner"><h2>Delivery board</h2><span>Local jobs</span></div>
          <DeliveryBoard missions={missions.data.items} selectedMissionId={selectedMissionId} onSelect={setSelectedMissionId} />
        </Card>
        <div data-tour="transporter-jobs">
          {!selected ? (
            <Card><EmptyState title="Choose a delivery ticket" detail="Select a job to see its island route, cargo and timing." /></Card>
          ) : (
            <DeliveryJourney
              key={selected.missionId}
              mission={selected}
              updates={selectedUpdates.data?.items}
              vehicleLabel={availableVehicles.find((vehicle) => vehicle.vehicleId === (selected.vehicleId ?? vehicleId))?.label}
              controls={selected.status === "AVAILABLE" ? (
                <>
                  <div className="delivery-selected-summary">
                    <h3>Ready to claim this route?</h3>
                    <p>{vehicleId ? "Harvest will check the selected vehicle’s capacity." : "Choose a vehicle above before accepting."}</p>
                  </div>
                  <button className="button" disabled={accept.isPending || !vehicleId} onClick={() => accept.mutate(selected.missionId)}>
                    <Truck size={17} />Accept delivery
                  </button>
                </>
              ) : (
                <>
                  <div className="delivery-selected-summary">
                    <h3>{selected.status === "DELIVERED" ? "Route completed" : "Your route is active"}</h3>
                    <p>Open the full journey to confirm stops or report a problem.</p>
                  </div>
                  <Link className="button" href={"/missions/" + selected.missionId}>Open full route<ArrowRight size={17} /></Link>
                </>
              )}
            />
          )}
        </div>
      </div>
      {selectedUpdates.error && <p className="form-error">Route updates could not be loaded. The mission facts above are still available.</p>}
      {accept.error && <p className="form-error">{accept.error.message}</p>}
    </>
  );
}
