"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, PackageCheck, ShoppingBasket, Truck } from "lucide-react";
import Link from "next/link";

import { EventFeed, useLiveEvents } from "@/components/live-events";
import { useSession } from "@/components/providers";
import { Badge, Card, EmptyState, ErrorState, LoadingState, Metric, PageHeader, SectionTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { compactId, formatDate } from "@/lib/format";
import { DEMO_RUN_ID, DEMO_VEHICLE_ID } from "@/lib/scenario";

export default function OperationsPage() {
  const { ready, actor } = useSession();
  const queryClient = useQueryClient();
  const snapshot = useQuery({ queryKey: ["snapshot"], queryFn: () => api.snapshot(DEMO_RUN_ID), enabled: ready });
  const batches = useQuery({ queryKey: ["batches"], queryFn: api.cropBatches, enabled: ready });
  const demands = useQuery({ queryKey: ["demands"], queryFn: api.demands, enabled: ready });
  const orders = useQuery({ queryKey: ["orders"], queryFn: api.orders, enabled: ready });
  const missions = useQuery({ queryKey: ["missions"], queryFn: api.missions, enabled: ready });
  const approvals = useQuery({ queryKey: ["approvals"], queryFn: () => api.approvals(), enabled: ready });
  const exceptions = useQuery({ queryKey: ["exceptions"], queryFn: api.exceptions, enabled: ready });
  const { events, connected } = useLiveEvents(DEMO_RUN_ID);
  const decision = useMutation({ mutationFn: ({ id, value }: { id: string; value: "APPROVE" | "REJECT" }) => api.decideApproval(id, value, value === "APPROVE" ? "Reviewed in the Harvest operations centre." : "Rejected after human review."), onSuccess: () => void queryClient.invalidateQueries() });
  const missionAction = useMutation({ mutationFn: async ({ missionId, action, quantity }: { missionId: string; action: string; quantity: number }) => {
    if (action === "ACCEPT") return api.acceptMission(missionId, DEMO_VEHICLE_ID);
    if (action === "PICKED_UP" || action === "DELIVERED") return api.updateMission(missionId, action);
    return api.acceptDelivery(missionId, quantity);
  }, onSuccess: () => void queryClient.invalidateQueries() });

  const queries = [snapshot, batches, demands, orders, missions, approvals, exceptions];
  const error = queries.find((query) => query.error)?.error;

  return <>
    <PageHeader eyebrow="Live coordination" title="Operations centre" description="One shared view of safely orderable crops, buyer commitments, approvals, delivery work and exceptions." actions={<><span className={`badge ${connected ? "badge-active" : "badge-open"}`}>{connected ? "Live event stream" : "Reconnecting"}</span><Link href="/simulation" className="button">Open simulation</Link></>} />
    {error ? <ErrorState error={error} /> : !snapshot.data ? <LoadingState /> : <div className="stack">
      <div className="grid metrics-grid">
        <Metric label="Available crop batches" value={batches.data?.items.length ?? 0} detail={`${snapshot.data.activeListings} active listings`} icon={ShoppingBasket} />
        <Metric label="Open buyer demand" value={snapshot.data.openDemands} detail="Role-filtered demand" icon={PackageCheck} tone="amber" />
        <Metric label="Active deliveries" value={snapshot.data.activeMissionIds.length} detail={`${missions.data?.items.length ?? 0} visible missions`} icon={Truck} tone="blue" />
        <Metric label="Needs attention" value={(approvals.data?.items.filter((item) => item.status === "PENDING").length ?? 0) + snapshot.data.openExceptionIds.length} detail="Approvals and exceptions" icon={AlertTriangle} tone="red" />
      </div>

      <div className="grid two-column">
        <Card>
          <SectionTitle title="Crop supply and demand" detail="Safe quantities only" />
          <div className="table-scroll"><table className="data-table"><thead><tr><th>Crop</th><th>ATP</th><th>State</th><th>Provenance</th></tr></thead><tbody>{batches.data?.items.map((batch) => <tr key={batch.cropBatchId}><td><strong>{batch.cropType}</strong><br/><span className="muted small">{compactId(batch.cropBatchId)}</span></td><td>{batch.availableToPromise.value} {batch.availableToPromise.unit}</td><td><Badge>{batch.status}</Badge></td><td><Badge>{batch.provenance}</Badge></td></tr>)}</tbody></table></div>
          <SectionTitle title="Buyer demand" detail={`${demands.data?.items.length ?? 0} visible`} />
          <div className="table-scroll"><table className="data-table"><thead><tr><th>Crop</th><th>Quantity</th><th>Needed</th><th>Status</th></tr></thead><tbody>{demands.data?.items.map((demand) => <tr key={demand.demandId}><td>{demand.cropType}</td><td>{demand.quantity.value} kg</td><td>{formatDate(demand.neededBy)}</td><td><Badge>{demand.status}</Badge></td></tr>)}</tbody></table></div>
        </Card>
        <Card>
          <SectionTitle title="Live activity" detail={connected ? "SSE connected" : "Reconnecting"} />
          <EventFeed events={events} compact />
        </Card>
      </div>

      <div className="grid two-column">
        <Card>
          <SectionTitle title="Orders and delivery" detail="Current operational state" />
          <div className="table-scroll"><table className="data-table"><thead><tr><th>Order</th><th>Quantity</th><th>Lifecycle</th><th>Risk</th></tr></thead><tbody>{orders.data?.items.map((order) => <tr key={order.orderId}><td><Link className="table-link" href={`/orders/${order.orderId}`}>{compactId(order.orderId)}</Link></td><td>{order.requestedQuantity.value} kg</td><td><Badge>{order.lifecycleStatus}</Badge></td><td>{order.atRisk ? <Badge tone="high">At risk</Badge> : <span className="muted">Clear</span>}</td></tr>)}</tbody></table></div>
          {!orders.data?.items.length && <EmptyState title="No orders yet" detail="Create an order from the marketplace." />}
        </Card>
        <Card>
          <SectionTitle title="Human approvals" detail="No automatic commitments" />
          <div className="stack">{approvals.data?.items.map((approval) => <div className="split" key={approval.approvalId}><div><Badge>{approval.subjectType}</Badge><strong className="small" style={{display:"block", marginTop:6}}>{compactId(approval.subjectId)}</strong><span className="muted small">Requested {formatDate(approval.requestedAt)}</span></div>{approval.status === "PENDING" ? <div className="page-actions"><button className="button button-small" disabled={decision.isPending} onClick={() => decision.mutate({ id: approval.approvalId, value: "APPROVE" })}><CheckCircle2 size={13}/>Approve</button><button className="button button-secondary button-small" disabled={decision.isPending} onClick={() => decision.mutate({ id: approval.approvalId, value: "REJECT" })}>Reject</button></div> : <Badge>{approval.status}</Badge>}</div>)}</div>
          {!approvals.data?.items.length && <EmptyState title="No approvals" detail="Binding changes appear here for a person to decide." />}
          {decision.error && <p className="form-message error">{decision.error.message}</p>}
        </Card>
      </div>

      <Card>
        <SectionTitle title="Exceptions" detail="Evidence and recovery remain visible" />
        {exceptions.data?.items.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Type</th><th>Severity</th><th>Description</th><th>Status</th><th>Reported</th></tr></thead><tbody>{exceptions.data.items.map((item) => <tr key={item.exceptionId}><td><Badge tone="high">{item.exceptionType}</Badge></td><td><Badge>{item.severity}</Badge></td><td>{item.description}</td><td><Badge>{item.status}</Badge></td><td>{formatDate(item.reportedAt)}</td></tr>)}</tbody></table></div> : <EmptyState title="No open disruption" detail="Injected weather, road, crop or vehicle exceptions will appear here." />}
      </Card>

      <Card>
        <SectionTitle title="Delivery missions" detail="Use the persona selector to perform role-specific actions" />
        {missions.data?.items.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Mission</th><th>Order</th><th>Quantity</th><th>Status</th><th>Human action</th></tr></thead><tbody>{missions.data.items.map((mission) => <tr key={mission.missionId}><td>{compactId(mission.missionId)}</td><td><Link className="table-link" href={`/orders/${mission.orderId}`}>{compactId(mission.orderId)}</Link></td><td>{mission.quantity.value} kg</td><td><Badge>{mission.status}</Badge></td><td>{mission.status === "AVAILABLE" && actor?.role === "TRANSPORTER" ? <button className="button button-small" disabled={missionAction.isPending} onClick={() => missionAction.mutate({missionId:mission.missionId,action:"ACCEPT",quantity:mission.quantity.value})}>Accept mission</button> : mission.status === "ASSIGNED" && actor?.role === "TRANSPORTER" ? <button className="button button-small" disabled={missionAction.isPending} onClick={() => missionAction.mutate({missionId:mission.missionId,action:"PICKED_UP",quantity:mission.quantity.value})}>Confirm pickup</button> : (["PICKUP_IN_PROGRESS","IN_TRANSIT"].includes(mission.status) && actor?.role === "TRANSPORTER") ? <button className="button button-small" disabled={missionAction.isPending} onClick={() => missionAction.mutate({missionId:mission.missionId,action:"DELIVERED",quantity:mission.quantity.value})}>Confirm delivery</button> : mission.status === "DELIVERED" && actor?.role === "BUYER" ? <button className="button button-small" disabled={missionAction.isPending} onClick={() => missionAction.mutate({missionId:mission.missionId,action:"RECEIVE",quantity:mission.quantity.value})}>Accept produce</button> : <span className="muted small">Switch to {mission.status === "DELIVERED" ? "Hotel buyer" : "Transporter"}</span>}</td></tr>)}</tbody></table></div> : <EmptyState title="No delivery mission yet" detail="Approve an allocation to create the pickup route." />}
        {missionAction.error && <p className="form-message error">{missionAction.error.message}</p>}
      </Card>
    </div>}
  </>;
}
