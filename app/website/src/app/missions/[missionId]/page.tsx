"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Check, MapPin, PackageCheck, Truck } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useState } from "react";

import { useSession } from "@/components/providers";
import { Badge, Card, ErrorState, LoadingState, PageHeader, SectionTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate, titleCase } from "@/lib/format";

const demoVehicleId = "d0000000-0000-4000-8000-000000000001";

export default function MissionDetailPage() {
  const { missionId } = useParams<{ missionId: string }>();
  const { actor } = useSession();
  const queryClient = useQueryClient();
  const [delayNote, setDelayNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const mission = useQuery({ queryKey: ["mission", missionId], queryFn: () => api.mission(missionId) });
  const accept = useMutation({
    mutationFn: () => api.acceptMission(missionId, demoVehicleId),
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

  return (
    <>
      <Link className="back-link" href={back}><ArrowLeft size={16} />Back</Link>
      <PageHeader eyebrow="Delivery" title={`${mission.data.quantity.value} kg local delivery`} description={`Due ${formatDate(mission.data.deadline)}`} actions={<Badge>{mission.data.status}</Badge>} />
      <div className="grid two-column">
        <Card>
          <SectionTitle title="Route" detail={`${mission.data.stops.length} stops`} />
          <div className="stops-list">
            {mission.data.stops.map((stop) => <div key={stop.sequence}><span className="stop-number">{stop.sequence}</span><MapPin size={19} /><span><strong>{titleCase(stop.kind)}</strong><small>{stop.location.latitude.toFixed(4)}, {stop.location.longitude.toFixed(4)}</small></span></div>)}
          </div>
        </Card>
        <Card>
          <SectionTitle title="Job details" detail={titleCase(mission.data.status)} />
          <div className="info-list"><div><PackageCheck /><span><strong>{mission.data.quantity.value} kg</strong><small>Produce quantity</small></span></div><div><Truck /><span><strong>{mission.data.vehicleId ? "Vehicle assigned" : "No vehicle yet"}</strong><small>Transport status</small></span></div></div>
          {isTransporter && <div className="mission-actions">
            {mission.data.status === "AVAILABLE" && <button className="button" disabled={accept.isPending} onClick={() => accept.mutate()}><Check size={17} />Accept job</button>}
            {mission.data.status === "ASSIGNED" && <button className="button" disabled={update.isPending} onClick={() => update.mutate("PICKED_UP")}><PackageCheck size={17} />Confirm pickup</button>}
            {["PICKUP_IN_PROGRESS", "IN_TRANSIT"].includes(mission.data.status) && <button className="button" disabled={update.isPending} onClick={() => update.mutate("ARRIVED")}><MapPin size={17} />Arrived at stop</button>}
            {["PICKUP_IN_PROGRESS", "IN_TRANSIT"].includes(mission.data.status) && <button className="button button-secondary" disabled={update.isPending} onClick={() => update.mutate("DELIVERED")}><Check size={17} />Mark delivered</button>}
          </div>}
        </Card>
      </div>
      {isTransporter && mission.data.status !== "AVAILABLE" && mission.data.status !== "DELIVERED" && (
        <Card className="section-gap">
          <SectionTitle title="Report a delay or problem" detail="The coordinator will be notified" />
          <form className="form-inline" onSubmit={(event: FormEvent) => { event.preventDefault(); delay.mutate(); }}>
            <div className="field"><label htmlFor="delay">What happened?</label><input id="delay" required minLength={3} value={delayNote} onChange={(event) => setDelayNote(event.target.value)} placeholder="For example: road closure near Castries" /></div>
            <button className="button button-danger" disabled={delay.isPending}><AlertTriangle size={17} />Report problem</button>
          </form>
        </Card>
      )}
      {(message || accept.error || update.error || delay.error) && <p className={(accept.error || update.error || delay.error) ? "form-error" : "form-success"}>{message ?? accept.error?.message ?? update.error?.message ?? delay.error?.message}</p>}
    </>
  );
}
