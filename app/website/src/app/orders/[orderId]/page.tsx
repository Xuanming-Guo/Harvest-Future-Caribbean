"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, PackageCheck, Truck } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useState } from "react";

import { ApprovalList } from "@/components/approval-list";
import { useSession } from "@/components/providers";
import { Badge, Card, ErrorState, LoadingState, PageHeader, SectionTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate, titleCase } from "@/lib/format";

const lifecycle = ["REQUESTED", "ALLOCATION_PROPOSED", "AWAITING_APPROVAL", "COMMITTED", "IN_DELIVERY", "FULFILLED"];

export default function OrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const { actor } = useSession();
  const queryClient = useQueryClient();
  const [accepted, setAccepted] = useState(0);
  const [rejected, setRejected] = useState(0);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const order = useQuery({ queryKey: ["order", orderId], queryFn: () => api.order(orderId) });
  const missions = useQuery({ queryKey: ["missions", orderId], queryFn: () => api.missions() });
  const mission = missions.data?.items.find((item) => item.orderId === orderId);
  const acceptance = useMutation({
    mutationFn: () => {
      if (!mission) throw new Error("No delivery is ready to accept.");
      const outcome = rejected === 0 ? "ACCEPTED" : accepted === 0 ? "REJECTED" : "PARTIALLY_ACCEPTED";
      return api.acceptDelivery(mission.missionId, accepted, rejected, outcome, note || undefined);
    },
    onSuccess: () => { setMessage("Delivery acceptance recorded. The order has been updated."); void queryClient.invalidateQueries(); },
  });

  if (order.error) return <ErrorState error={order.error} />;
  if (!order.data) return <LoadingState label="Loading order..." />;
  const currentIndex = lifecycle.indexOf(order.data.lifecycleStatus);

  return (
    <>
      <Link className="back-link" href="/orders"><ArrowLeft size={16} />Back to orders</Link>
      <PageHeader eyebrow="Order" title={`${order.data.requestedQuantity.value} kg ${titleCase(order.data.cropType)}`} description={`Needed by ${formatDate(order.data.neededBy)}`} actions={<Badge tone={order.data.atRisk ? "high" : undefined}>{order.data.lifecycleStatus}</Badge>} />
      <Card>
        <SectionTitle title="Order progress" detail={order.data.atRisk ? "Needs attention" : "On track"} />
        <div className="lifecycle">
          {lifecycle.map((status, index) => <div className={index <= currentIndex ? "complete" : ""} key={status}><span>{index < currentIndex ? <CheckCircle2 size={16} /> : index + 1}</span><small>{titleCase(status)}</small></div>)}
        </div>
      </Card>
      <div className="grid two-column section-gap">
        <Card>
          <SectionTitle title="Supply commitment" detail="Confirmed only after everyone approves" />
          {!order.data.allocation ? <p>Harvest is still finding safe supply for this order.</p> : (
            <div className="allocation-list">
              <div className="split"><span>Allocation status</span><Badge>{order.data.allocation.status}</Badge></div>
              {order.data.allocation.lines.map((line) => <div className="allocation-row" key={line.cropBatchId}><PackageCheck size={19} /><span><strong>{line.quantity.value} kg</strong><small>Local crop batch</small></span></div>)}
            </div>
          )}
        </Card>
        <Card>
          <SectionTitle title="Delivery" detail={mission ? titleCase(mission.status) : "Not scheduled"} />
          {!mission ? <p>A delivery job will be created when the supply commitment is approved.</p> : (
            <div className="delivery-summary"><Truck size={28} /><div><strong>{mission.quantity.value} kg</strong><span>Due {formatDate(mission.deadline)}</span></div><Link className="text-link" href={`/missions/${mission.missionId}`}>View delivery</Link></div>
          )}
        </Card>
      </div>
      {actor?.role !== "COORDINATOR" && <div className="section-gap"><ApprovalList /></div>}
      {actor?.role === "BUYER" && mission?.status === "DELIVERED" && (
        <Card className="section-gap">
          <SectionTitle title="Accept this delivery" detail="Record what arrived" />
          <form className="form-grid" onSubmit={(event: FormEvent) => { event.preventDefault(); acceptance.mutate(); }}>
            <div className="field"><label>Accepted quantity (kg)</label><input type="number" min="0" max={mission.quantity.value} step="0.1" value={accepted} onChange={(event) => setAccepted(Number(event.target.value))} /></div>
            <div className="field"><label>Rejected quantity (kg)</label><input type="number" min="0" max={mission.quantity.value} step="0.1" value={rejected} onChange={(event) => setRejected(Number(event.target.value))} /></div>
            <div className="field field-full"><label>Note (optional)</label><textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} /></div>
            <button className="button field-full" disabled={acceptance.isPending || accepted + rejected !== mission.quantity.value}><CheckCircle2 size={17} />Confirm delivery</button>
          </form>
          {(message || acceptance.error) && <p className={acceptance.error ? "form-error" : "form-success"}>{message ?? acceptance.error?.message}</p>}
        </Card>
      )}
    </>
  );
}
