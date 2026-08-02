"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Circle, Clock3, PackageCheck, Truck } from "lucide-react";
import { useParams } from "next/navigation";

import { EventFeed, useLiveEvents } from "@/components/live-events";
import { useSession } from "@/components/providers";
import { Badge, Card, ErrorState, LoadingState, Metric, PageHeader, SectionTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { compactId, formatDate, titleCase } from "@/lib/format";

const lifecycle = ["REQUESTED", "AWAITING_APPROVAL", "COMMITTED", "IN_DELIVERY", "FULFILLED"];

export default function OrderPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const { ready } = useSession();
  const order = useQuery({ queryKey: ["order", orderId], queryFn: () => api.order(orderId), enabled: ready });
  const missions = useQuery({ queryKey: ["missions"], queryFn: api.missions, enabled: ready });
  const { events } = useLiveEvents();
  if (order.error) return <ErrorState error={order.error} />;
  if (!order.data) return <LoadingState />;
  const activeIndex = lifecycle.indexOf(order.data.lifecycleStatus === "PARTIALLY_FULFILLED" || order.data.lifecycleStatus === "REJECTED" ? "FULFILLED" : order.data.lifecycleStatus);
  const mission = missions.data?.items.find((item) => item.orderId === orderId);
  const orderEvents = events.filter((event) => event.entityId === orderId || (event.payload as unknown as Record<string, unknown>).orderId === orderId);

  return <>
    <PageHeader eyebrow={`Order ${compactId(orderId)}`} title={`${order.data.requestedQuantity.value} kg ${titleCase(order.data.cropType)}`} description="A single operational record connects the buyer request, farm allocation, human decisions, delivery and accepted outcome." actions={<Badge>{order.data.lifecycleStatus}</Badge>} />
    <div className="grid metrics-grid">
      <Metric label="Requested" value={`${order.data.requestedQuantity.value} kg`} detail={`Due ${formatDate(order.data.neededBy)}`} icon={PackageCheck} />
      <Metric label="Accepted" value={`${order.data.acceptedQuantity.value} kg`} detail="Buyer-confirmed outcome" icon={Check} tone="green" />
      <Metric label="Risk overlay" value={order.data.atRisk ? "At risk" : "Clear"} detail={`${order.data.activeExceptionIds?.length ?? 0} active exceptions`} icon={Circle} tone={order.data.atRisk ? "red" : "green"} />
      <Metric label="Delivery" value={mission ? titleCase(mission.status) : "Pending"} detail={mission ? compactId(mission.missionId) : "Created after approval"} icon={Truck} tone="blue" />
    </div>
    <div className="grid two-column" style={{marginTop:18}}>
      <Card><SectionTitle title="Commitment lifecycle" detail="Binding steps require a person"/><div className="order-timeline">{lifecycle.map((step, index) => <div className={`timeline-step ${index > activeIndex ? "pending" : ""}`} key={step}><span className="timeline-dot">{index < activeIndex ? <Check size={11}/> : index + 1}</span><div><strong>{titleCase(step)}</strong><small>{index === 1 ? "Allocation waits for explicit approval." : index === 4 ? "Final state follows buyer acceptance." : "Recorded in Product API state and event history."}</small></div></div>)}</div></Card>
      <Card><SectionTitle title="Order activity" detail={`${orderEvents.length} streamed events`}/><EventFeed events={orderEvents} compact/></Card>
    </div>
    {mission && <div style={{marginTop:18}}><Card><SectionTitle title="Delivery mission" detail={compactId(mission.missionId)}/><div className="grid three-column"><div><span className="muted small">Status</span><p><Badge>{mission.status}</Badge></p></div><div><span className="muted small">Quantity</span><p><strong>{mission.quantity.value} kg</strong></p></div><div><span className="muted small">Deadline</span><p><Clock3 size={13}/> {formatDate(mission.deadline)}</p></div></div></Card></div>}
  </>;
}
