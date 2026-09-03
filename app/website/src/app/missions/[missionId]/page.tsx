"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Check, MapPin, PackageCheck, Truck } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useState } from "react";

import { OfflineHint, useOnlineStatus } from "@/components/offline";
import { useSession } from "@/components/providers";
import { Badge, Card, ErrorState, LoadingState, PageHeader, SectionTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate, titleCase } from "@/lib/format";

export default function MissionDetailPage() {
  const { missionId } = useParams<{ missionId: string }>();
  const { actor } = useSession();
  const online = useOnlineStatus();
  const queryClient = useQueryClient();
  const [delayNote, setDelayNote] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const mission = useQuery({ queryKey: ["mission", missionId], queryFn: () => api.mission(missionId), refetchInterval: 5_000 });
  const updates = useQuery({ queryKey: ["mission-updates", missionId], queryFn: () => api.missionUpdates(missionId), refetchInterval: 5_000 });
  const vehicles = useQuery({ queryKey: ["vehicles"], queryFn: api.vehicles, enabled: actor?.role === "TRANSPORTER", refetchInterval: 5_000 });
  const accept = useMutation({
    mutationFn: () => {
      if (!vehicleId) throw new Error("Select an available vehicle first.");
      return api.acceptMission(missionId, vehicleId);
    },
    onSuccess: () => { setMessage("Delivery job accepted."); void queryClient.invalidateQueries(); },
  });
  const update = useMutation({
    mutationFn: (updateType: "PICKED_UP" | "ARRIVED" | "DELIVERED") => api.updateMission(missionId, updateType),
    onSuccess: () => { setMessage("Delivery progress updated."); void queryClient.invalidateQueries(); },
  });
  const delay = useMutation({
    mutationFn: async () => {
      await api.updateMission(missionId, "DELAYED", delayNote);
      return api.createException({ exceptionType: "DELAY", severity: "HIGH", affectedEntityIds: [missionId], description: delayNote, provenance: "OBSERVED" });
    },
    onSuccess: () => { setMessage("Delay reported to the coordinator."); setDelayNote(""); void queryClient.invalidateQueries(); },
  });

  if (mission.error) return <ErrorState error={mission.error} />;
  if (!mission.data) return <LoadingState label="Loading delivery details..." />;
  const isTransporter = actor?.role === "TRANSPORTER";
  const back = isTransporter ? "/transporter" : actor?.role === "BUYER" ? "/buyer" : "/orders";
  const currentStop = mission.data.currentStopSequence > 0 ? mission.data.stops[mission.data.currentStopSequence - 1] : undefined;
  const currentPickupConfirmed = currentStop?.kind === "PICKUP" && updates.data?.items.some((item) => item.updateType === "PICKED_UP" && item.stopSequence === currentStop.sequence);
  const mayArrive = ["ASSIGNED", "PICKUP_IN_PROGRESS", "IN_TRANSIT"].includes(mission.data.status) && mission.data.currentStopSequence < mission.data.stops.length && (currentStop?.kind !== "PICKUP" || currentPickupConfirmed);
  const mayConfirmPickup = mission.data.status === "PICKUP_IN_PROGRESS" && currentStop?.kind === "PICKUP" && !currentPickupConfirmed;
  const mayDeliver = mission.data.status === "IN_TRANSIT" && mission.data.currentStopSequence === mission.data.stops.length && currentStop?.kind === "DROPOFF";

  return (
    <>
      <Link className="back-link" href={back}><ArrowLeft size={16} />Back</Link>
      <PageHeader eyebrow="Delivery" title={`${mission.data.quantity.value} kg local delivery`} description={`Due ${formatDate(mission.data.deadline)}`} actions={<Badge>{mission.data.status}</Badge>} />
      <div className="grid two-column" data-tour="mission-detail">
        <Card>
          <SectionTitle title="Route" detail={`${mission.data.stops.length} stops`} />
          <div className="stops-list">
            {mission.data.stops.map((stop) => <div key={stop.sequence}><span className="stop-number">{stop.sequence}</span><MapPin size={19} /><span><strong>{titleCase(stop.kind)}</strong><small>{stop.location.latitude.toFixed(4)}, {stop.location.longitude.toFixed(4)}</small></span></div>)}
          </div>
        </Card>
        <Card>
          <SectionTitle title="Job details" detail={titleCase(mission.data.status)} />
          <div className="info-list"><div><PackageCheck /><span><strong>{mission.data.quantity.value} kg</strong><small>Produce quantity</small></span></div><div><Truck /><span><strong>{mission.data.vehicleId ? "Vehicle assigned" : "No vehicle yet"}</strong><small>Transport status</small></span></div></div>
          {isTransporter && <div className="mission-actions" data-tour="mission-progress">
            {mission.data.status === "AVAILABLE" && <><div className="field"><label htmlFor="mission-vehicle">Vehicle</label><select id="mission-vehicle" value={vehicleId} onChange={(event) => setVehicleId(event.target.value)}><option value="">Select a vehicle</option>{vehicles.data?.items.map((vehicle) => <option value={vehicle.vehicleId} disabled={vehicle.status !== "AVAILABLE"} key={vehicle.vehicleId}>{vehicle.label} · {vehicle.status}</option>)}</select></div><button className="button" disabled={accept.isPending || !vehicleId} aria-disabled={!online || undefined} onClick={() => { if (online) accept.mutate(); }}><Check size={17} />Accept job</button></>}
            {mayArrive && <button className="button" disabled={update.isPending} aria-disabled={!online || undefined} onClick={() => { if (online) update.mutate("ARRIVED"); }}><MapPin size={17} />Arrived at next stop</button>}
            {mayConfirmPickup && <button className="button" disabled={update.isPending} aria-disabled={!online || undefined} onClick={() => { if (online) update.mutate("PICKED_UP"); }}><PackageCheck size={17} />Confirm pickup</button>}
            {mayDeliver && <button className="button button-secondary" disabled={update.isPending} aria-disabled={!online || undefined} onClick={() => { if (online) update.mutate("DELIVERED"); }}><Check size={17} />Mark delivered</button>}
            {!online && <OfflineHint>Delivery progress is only recorded live, so it is never queued. Reconnect to report it.</OfflineHint>}
          </div>}
        </Card>
      </div>
      <Card className="section-gap">
        <SectionTitle title="Delivery timeline" detail={`${updates.data?.items.length ?? 0} updates`} />
        {!updates.data?.items.length ? <p>No progress updates have been recorded yet.</p> : <div className="task-list">{updates.data.items.map((item) => <article className="task-row" key={item.updateId}><div><Badge>{item.updateType}</Badge><h3>{titleCase(item.updateType)}</h3><p>{item.note ?? (item.stopSequence ? `Route stop ${item.stopSequence}` : "Mission progress recorded")}</p><small>{formatDate(item.recordedAt)}</small></div></article>)}</div>}
      </Card>
      {isTransporter && mission.data.status !== "AVAILABLE" && mission.data.status !== "DELIVERED" && (
        <Card className="section-gap">
          <SectionTitle title="Report a delay or problem" detail="The coordinator will be notified" />
          <form className="form-inline" onSubmit={(event: FormEvent) => { event.preventDefault(); if (online) delay.mutate(); }}>
            <div className="field"><label htmlFor="delay">What happened?</label><input id="delay" required minLength={3} value={delayNote} onChange={(event) => setDelayNote(event.target.value)} placeholder="For example: road closure near Castries" /></div>
            <button className="button button-danger" data-tour="mission-report-problem" disabled={delay.isPending} aria-disabled={!online || undefined}><AlertTriangle size={17} />Report problem</button>
          </form>
          {!online && <OfflineHint>A coordinator has to see this straight away, so it is never queued. Reconnect to report it.</OfflineHint>}
        </Card>
      )}
      {(message || accept.error || update.error || delay.error) && <p className={(accept.error || update.error || delay.error) ? "form-error" : "form-success"}>{message ?? accept.error?.message ?? update.error?.message ?? delay.error?.message}</p>}
    </>
  );
}
