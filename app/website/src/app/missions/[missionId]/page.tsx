"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Check, MapPin, PackageCheck } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { type FormEvent, useState } from "react";

import { DeliveryJourney, VehiclePicker } from "@/components/delivery-world";
import { useSession } from "@/components/providers";
import { Badge, Card, ErrorState, LoadingState, PageHeader, SectionTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate, titleCase } from "@/lib/format";

export default function MissionDetailPage() {
  const { missionId } = useParams<{ missionId: string }>();
  const { actor } = useSession();
  const queryClient = useQueryClient();
  const [delayNote, setDelayNote] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const mission = useQuery({ queryKey: ["mission", missionId], queryFn: () => api.mission(missionId), refetchInterval: 5_000 });
  const updates = useQuery({ queryKey: ["mission-updates", missionId], queryFn: () => api.missionUpdates(missionId), refetchInterval: 5_000 });
  const vehicles = useQuery({ queryKey: ["vehicles"], queryFn: api.vehicles, enabled: actor?.role === "TRANSPORTER", refetchInterval: 5_000 });
  const accept = useMutation({
    mutationFn: () => {
      if (!vehicleId) throw new Error("Choose an available vehicle first.");
      return api.acceptMission(missionId, vehicleId);
    },
    onSuccess: () => {
      setMessage("Delivery route claimed. Crop readiness is now available at each pickup farm.");
      void queryClient.invalidateQueries();
    },
  });
  const update = useMutation({
    mutationFn: (updateType: "PICKED_UP" | "ARRIVED" | "DELIVERED") => api.updateMission(missionId, updateType),
    onSuccess: () => {
      setMessage("Delivery progress updated.");
      void queryClient.invalidateQueries();
    },
  });
  const delay = useMutation({
    mutationFn: async () => {
      await api.updateMission(missionId, "DELAYED", delayNote);
      return api.createException({ exceptionType: "DELAY", severity: "HIGH", affectedEntityIds: [missionId], description: delayNote, provenance: "OBSERVED" });
    },
    onSuccess: () => {
      setMessage("Delay reported to the coordinator and hotel.");
      setDelayNote("");
      void queryClient.invalidateQueries();
    },
  });

  if (mission.error) return <ErrorState error={mission.error} />;
  if (!mission.data) return <LoadingState label="Drawing the delivery route..." />;

  const isTransporter = actor?.role === "TRANSPORTER";
  const back = isTransporter ? "/transporter" : actor?.role === "BUYER" ? "/buyer" : "/orders";
  const currentStop = mission.data.currentStopSequence > 0 ? mission.data.stops[mission.data.currentStopSequence - 1] : undefined;
  const currentPickupConfirmed = currentStop?.kind === "PICKUP" && updates.data?.items.some((item) => item.updateType === "PICKED_UP" && item.stopSequence === currentStop.sequence);
  const mayArrive = ["ASSIGNED", "PICKUP_IN_PROGRESS", "IN_TRANSIT"].includes(mission.data.status) &&
    mission.data.currentStopSequence < mission.data.stops.length &&
    (currentStop?.kind !== "PICKUP" || currentPickupConfirmed);
  const mayConfirmPickup = mission.data.status === "PICKUP_IN_PROGRESS" && currentStop?.kind === "PICKUP" && !currentPickupConfirmed;
  const mayDeliver = mission.data.status === "IN_TRANSIT" &&
    mission.data.currentStopSequence === mission.data.stops.length &&
    currentStop?.kind === "DROPOFF";
  const mutationError = accept.error ?? update.error ?? delay.error;

  const controls = isTransporter ? (
    <>
      {mission.data.status === "AVAILABLE" && (
        <>
          <VehiclePicker vehicles={vehicles.data?.items ?? []} value={vehicleId} onChange={setVehicleId} />
          <div className="mission-action-row">
            <button className="button" disabled={accept.isPending || !vehicleId} onClick={() => accept.mutate()}><Check size={17} />Accept delivery</button>
          </div>
        </>
      )}
      {(mayArrive || mayConfirmPickup || mayDeliver) && (
        <div className="mission-action-row">
          {mayArrive && <button className="button" disabled={update.isPending} onClick={() => update.mutate("ARRIVED")}><MapPin size={17} />Arrived at next stop</button>}
          {mayConfirmPickup && <button className="button" disabled={update.isPending} onClick={() => update.mutate("PICKED_UP")}><PackageCheck size={17} />Confirm pickup</button>}
          {mayDeliver && <button className="button button-secondary" disabled={update.isPending} onClick={() => update.mutate("DELIVERED")}><Check size={17} />Mark delivered</button>}
        </div>
      )}
      {mission.data.status === "DELIVERED" && <p className="form-success">Every stop is complete. The hotel can now record the delivery outcome.</p>}
      {mission.data.status === "CANCELLED" && <p className="form-error">This route was cancelled. No further updates can be recorded.</p>}
    </>
  ) : undefined;

  return (
    <>
      <Link className="back-link" href={back}><ArrowLeft size={16} />Back</Link>
      <PageHeader
        eyebrow="Delivery journey"
        title={mission.data.quantity.value + " kg " + titleCase(mission.data.cropType) + " to " + mission.data.buyerName}
        description={"Due " + formatDate(mission.data.deadline) + " · " + mission.data.routeRegion}
        actions={<Badge tone={mission.data.atRisk ? "high" : undefined}>{mission.data.atRisk ? "At risk" : mission.data.status}</Badge>}
      />
      <div className="mission-detail-grid">
        <DeliveryJourney
          mission={mission.data}
          updates={updates.data?.items}
          controls={controls}
          detailsInitiallyOpen={isTransporter}
          vehicleLabel={vehicles.data?.items.find((vehicle) => vehicle.vehicleId === (mission.data.vehicleId ?? vehicleId))?.label}
        />
        <Card>
          <SectionTitle title="Delivery timeline" detail={(updates.data?.items.length ?? 0) + " updates"} />
          {!updates.data?.items.length ? (
            <p>No progress updates have been recorded yet.</p>
          ) : (
            <div className="task-list">
              {updates.data.items.map((item) => (
                <article className="task-row" key={item.updateId}>
                  <div><Badge>{item.updateType}</Badge><h3>{titleCase(item.updateType)}</h3><p>{item.note ?? (item.stopSequence ? "Route stop " + item.stopSequence : "Mission progress recorded")}</p><small>{formatDate(item.recordedAt)}</small></div>
                </article>
              ))}
            </div>
          )}
        </Card>
      </div>
      {updates.error && <p className="form-error">The delivery timeline could not be loaded. Mission details are still available.</p>}
      {vehicles.error && <p className="form-error">Vehicle options could not be loaded. Try again before accepting this route.</p>}
      {isTransporter && !["AVAILABLE", "DELIVERED", "CANCELLED"].includes(mission.data.status) && (
        <Card className="section-gap">
          <SectionTitle title="Report a delay or problem" detail="The coordinator and hotel will be notified" />
          <form className="form-inline" onSubmit={(event: FormEvent) => { event.preventDefault(); delay.mutate(); }}>
            <div className="field"><label htmlFor="delay">What happened?</label><input id="delay" required minLength={3} value={delayNote} onChange={(event) => setDelayNote(event.target.value)} placeholder="For example: road closure near Castries" /></div>
            <button className="button button-danger" disabled={delay.isPending}><AlertTriangle size={17} />Report problem</button>
          </form>
        </Card>
      )}
      {(message || mutationError) && <p className={mutationError ? "form-error" : "form-success"}>{message ?? mutationError?.message}</p>}
    </>
  );
}
