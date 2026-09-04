"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, BadgeCheck, CheckCircle2, PackageCheck, Ship, Truck } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useState } from "react";

import { ApprovalList } from "@/components/approval-list";
import { DecisionReasonFields, ReasonChooser, decisionReasonLabel } from "@/components/decision-reason";
import { OfflineHint, useOnlineStatus } from "@/components/offline";
import { useSession } from "@/components/providers";
import { Badge, Card, ErrorState, LoadingState, PageHeader, SectionTitle } from "@/components/ui";
import { api, type DecisionReasonCode } from "@/lib/api";
import { formatDate, titleCase } from "@/lib/format";
import { formatMoney, PAYMENT_STATUS_LABELS } from "@/lib/payments";

const standardLifecycle = ["REQUESTED", "ALLOCATION_PROPOSED", "AWAITING_APPROVAL", "COMMITTED", "IN_DELIVERY", "FULFILLED"];

function lifecycleFor(status: string) {
  if (status === "REJECTED") return ["REQUESTED", "AWAITING_APPROVAL", "REJECTED"];
  if (status === "CANCELLED") return ["REQUESTED", "AWAITING_APPROVAL", "COMMITTED", "CANCELLED"];
  if (status === "PARTIALLY_FULFILLED") return ["REQUESTED", "AWAITING_APPROVAL", "COMMITTED", "IN_DELIVERY", "PARTIALLY_FULFILLED"];
  return standardLifecycle;
}


const LEG_LABEL: Record<string, string> = {
  PICKUP: "Farm to port",
  SEA: "Sea crossing",
  DELIVERY: "Port to you",
};

const CUSTOMS_LABEL: Record<string, string> = {
  PENDING: "Awaiting clearance",
  CLEARED: "Cleared",
  HELD: "Held at the border",
};

export default function OrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const { actor } = useSession();
  const online = useOnlineStatus();
  const queryClient = useQueryClient();
  const [lineValues, setLineValues] = useState<Record<string, { accepted: number; rejected: number }>>({});
  const [lineReasons, setLineReasons] = useState<Record<string, DecisionReasonCode | null>>({});
  const [note, setNote] = useState("");
  const [reference, setReference] = useState("");
  const [reasonCode, setReasonCode] = useState<DecisionReasonCode | null>(null);
  const [nextAction, setNextAction] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const order = useQuery({ queryKey: ["order", orderId], queryFn: () => api.order(orderId), refetchInterval: 5_000 });
  const standards = useQuery({
    queryKey: ["crop-standards", order.data?.cropType],
    queryFn: () => api.cropStandards(order.data!.cropType),
    enabled: Boolean(order.data?.cropStandardId),
    refetchInterval: 15_000,
  });
  const mission = order.data?.deliveryMission;
  const allocationLines = order.data?.allocation?.lines ?? [];
  const resolvedLines = allocationLines.map((line) => ({ cropBatchId: line.cropBatchId, quantity: line.quantity.value, ...(lineValues[line.cropBatchId] ?? { accepted: line.quantity.value, rejected: 0 }) }));
  const accepted = resolvedLines.reduce((sum, line) => sum + line.accepted, 0);
  const rejected = resolvedLines.reduce((sum, line) => sum + line.rejected, 0);
  // The Product API refuses a rejection without a reason and a next action, so
  // the form applies exactly the same rule before it sends anything.
  const trimmedNextAction = nextAction.trim();
  const reasonMissing = rejected > 0 && (!reasonCode || !trimmedNextAction);
  const acceptance = useMutation({
    mutationFn: () => {
      if (!mission) throw new Error("No delivery is ready to accept.");
      const outcome = rejected === 0 ? "ACCEPTED" : accepted === 0 ? "REJECTED" : "PARTIALLY_ACCEPTED";
      const lineOutcomes = resolvedLines.map((line) => ({
        cropBatchId: line.cropBatchId,
        acceptedQuantity: { value: line.accepted, unit: "kg" as const },
        rejectedQuantity: { value: line.rejected, unit: "kg" as const },
        // A per-line reason is optional; without one the shared reason applies.
        ...(line.rejected > 0 && lineReasons[line.cropBatchId] ? { reasonCode: lineReasons[line.cropBatchId] as DecisionReasonCode } : {}),
      }));
      return api.acceptDelivery(mission.missionId, accepted, rejected, outcome, lineOutcomes, note || undefined, rejected > 0 && reasonCode ? reasonCode : undefined, rejected > 0 ? trimmedNextAction : undefined);
    },
    onSuccess: () => { setMessage("Delivery acceptance recorded. The farmer can now see what was wrong and what to do next."); void queryClient.invalidateQueries(); },
  });
  const confirmPayment = useMutation({
    mutationFn: () => api.confirmPayment(orderId, reference || undefined),
    onSuccess: () => { setMessage("Payment recorded. Harvest tracks the payment; it does not move money."); void queryClient.invalidateQueries(); },
  });

  if (order.error) return <ErrorState error={order.error} />;
  if (!order.data) return <LoadingState label="Loading order..." />;
  const lifecycle = lifecycleFor(order.data.lifecycleStatus);
  const currentIndex = lifecycle.indexOf(order.data.lifecycleStatus);
  const appliedStandard = standards.data?.items.find((standard) => standard.standardId === order.data.cropStandardId);
  const requested = order.data.requestedQuantity.value;
  const committed = order.data.committedQuantity.value;
  // Only worth saying once something is actually committed and it is short.
  const partialCommitment = committed > 0 && committed + 0.0001 < requested;
  const committedSummary = `Committed ${committed} of ${requested} kg (${Math.round((committed / requested) * 100)}%)`;
  const payment = order.data.payment;
  // Both are additive: an order that never left its island has neither, and the
  // page is exactly what it was before issue #40.
  const interIsland = order.data.interIslandCommitment;
  const shipment = order.data.maritimeShipment;

  return (
    <>
      <Link className="back-link" href="/orders"><ArrowLeft size={16} />Back to orders</Link>
      <PageHeader eyebrow="Order" title={`${order.data.requestedQuantity.value} kg ${titleCase(order.data.cropType)}`} description={`Needed by ${formatDate(order.data.neededBy)}`} actions={<Badge tone={order.data.atRisk ? "high" : undefined}>{order.data.lifecycleStatus}</Badge>} />
      <Card>
        <SectionTitle title="Order progress" detail={order.data.atRisk ? "Needs attention" : "On track"} />
        {partialCommitment && (
          <div className="notice"><strong>{committedSummary}</strong><span>You accepted at least {Math.round(order.data.minimumAcceptableFraction * 100)}% of this order, so Harvest committed the supply it could confirm. Source the remaining {Number((requested - committed).toFixed(2))} kg elsewhere.</span></div>
        )}
        <div className="lifecycle">
          {lifecycle.map((status, index) => <div className={index <= currentIndex ? "complete" : ""} key={status}><span>{index < currentIndex ? <CheckCircle2 size={16} /> : index + 1}</span><small>{titleCase(status)}</small></div>)}
        </div>
      </Card>
      <div className="grid two-column section-gap">
        <Card>
          <SectionTitle title="Supply commitment" detail="Confirmed only after everyone approves" />
          {order.data.cropStandardId && <p className="crop-standard-applied">Standard applied: <strong>{appliedStandard ? `${appliedStandard.publisherName} v${appliedStandard.version}` : "Loading standard..."}</strong></p>}
          {!order.data.allocation ? <p>Harvest is still finding safe supply for this order.</p> : (
            <div className="allocation-list">
              <div className="split"><span>Allocation status</span><Badge>{order.data.allocation.status}</Badge></div>
              <div className="split"><span>Approvals</span><strong>{order.data.approvalSummary.approved} of {order.data.approvalSummary.required} approved</strong></div>
              {partialCommitment && <div className="split"><span>Coverage</span><strong>{committedSummary}</strong></div>}
              {order.data.allocation.lines.map((line) => <div className="allocation-row" key={line.cropBatchId}><PackageCheck size={19} /><span><strong>{line.quantity.value} kg</strong><small>Local crop batch</small></span></div>)}
            </div>
          )}
        </Card>
        <Card>
          <SectionTitle title="Delivery" detail={mission ? titleCase(mission.status) : "Not scheduled"} />
          {!mission ? <p>A delivery job will be created when the supply commitment is approved.</p> : (
            <div className="delivery-summary"><Truck size={28} /><div><strong>{mission.quantity.value} kg</strong><span>Due {formatDate(mission.deadline)}</span></div><Link className="text-link" href={`/missions/${mission.missionId}`}>View delivery</Link></div>
          )}
          {order.data.deliveryAcceptance && (
            <div className="notice section-gap">
              <strong>{titleCase(order.data.deliveryAcceptance.outcome)}</strong>
              <span>{order.data.deliveryAcceptance.acceptedQuantity.value} kg accepted · {order.data.deliveryAcceptance.rejectedQuantity.value} kg rejected</span>
              {order.data.deliveryAcceptance.rejectedQuantity.value > 0 && <span>Reason: {decisionReasonLabel(order.data.deliveryAcceptance.reasonCode)}</span>}
              {order.data.deliveryAcceptance.nextAction && <span>Next step for the farmer: {order.data.deliveryAcceptance.nextAction}</span>}
              <small>Recorded {formatDate(order.data.deliveryAcceptance.acceptedAt)}</small>
            </div>
          )}
        </Card>
      </div>
      {interIsland && (
        <Card className="section-gap">
          <SectionTitle
            title="Cross-island supply"
            detail={shipment ? titleCase(shipment.status) : titleCase(interIsland.status)}
          />
          <p className="payment-disclaimer">
            Ports, the sailing and the exchange rate are public references with their own sources and licences. The
            schedule, the capacity, the price, the customs check and the outcome are synthetic simulation values, not
            an operator&rsquo;s figures.
          </p>
          <div className="payment-card">
            <div className="split"><span>Route</span><strong>{titleCase(interIsland.originIslandId.replaceAll("-", " "))} to {titleCase(interIsland.destinationIslandId.replaceAll("-", " "))}</strong></div>
            <div className="split"><span>Operator</span><strong>{interIsland.route.operator}</strong></div>
            <div className="split">
              <span>Sailing time</span>
              <strong>
                {interIsland.route.seaLegHours} h
                {interIsland.route.journeyHoursSource === "PUBLIC_TIMETABLE" ? " (published)" : " (synthetic default)"}
              </strong>
            </div>
            <div className="split"><span>Approvals</span><strong>{interIsland.approvalSummary.approved} of {interIsland.approvalSummary.required} approved</strong></div>
            <div className="split">
              <span>Binding</span>
              <strong>{interIsland.boundAt ? `Yes, from ${formatDate(interIsland.boundAt)}` : "Not yet — nothing ships until every approval is granted"}</strong>
            </div>
            <div className="split">
              <span>Cost</span>
              <strong>
                {formatMoney(interIsland.cost.localAmount, interIsland.cost.localCurrency)}
                {interIsland.cost.localCurrency === interIsland.cost.comparisonCurrency
                  ? ""
                  : ` · ${formatMoney(interIsland.cost.comparisonAmount, interIsland.cost.comparisonCurrency)}`}
              </strong>
            </div>
            {interIsland.cost.localCurrency !== interIsland.cost.comparisonCurrency && (
              <div className="split"><span>Rate used</span><strong>{interIsland.cost.unitsPerComparisonCurrency} {interIsland.cost.localCurrency} per {interIsland.cost.comparisonCurrency}, as of {interIsland.cost.rateAsOf}</strong></div>
            )}
          </div>
          {shipment && (
            <>
              <SectionTitle title="Shipment legs" detail={`${shipment.loadedKg} kg of a ${shipment.capacityKg} kg sailing allowance`} />
              <div className="allocation-list">
                {shipment.legs.map((leg) => (
                  <div className="allocation-row" key={`${leg.kind}-${leg.startsAt}`}>
                    {leg.kind === "SEA" ? <Ship size={19} /> : <Truck size={19} />}
                    <span>
                      <strong>{LEG_LABEL[leg.kind] ?? titleCase(leg.kind)}: {leg.fromLabel} to {leg.toLabel}</strong>
                      <small>{formatDate(leg.startsAt)} to {formatDate(leg.endsAt)}</small>
                    </span>
                  </div>
                ))}
              </div>
              <div className="notice section-gap">
                <strong>Customs: {CUSTOMS_LABEL[shipment.customs.status] ?? titleCase(shipment.customs.status)}</strong>
                <span>
                  Reference {shipment.customs.documentationReference} · {shipment.customs.inspected ? "inspected" : "documents only"} ·
                  {" "}{shipment.customs.delayHours} h · {formatMoney(shipment.customs.feeXcd, "XCD")}
                </span>
                {shipment.customs.clearedAt && <span>Cleared {formatDate(shipment.customs.clearedAt)}</span>}
                <small>{shipment.customs.disclaimer}</small>
              </div>
              {(shipment.weatherDelayHours ?? 0) > 0 && (
                <div className="notice"><strong>Weather delayed the crossing by {shipment.weatherDelayHours} h</strong></div>
              )}
              {shipment.loadedKg === 0 && shipment.status !== "SCHEDULED" && (
                <div className="notice">
                  <strong>This sailing carried nothing</strong>
                  <span>No allocated crop was ready to load at the origin farm when the vehicle left, so the boat crossed empty. The booked freight and clearance were still charged.</span>
                </div>
              )}
              {shipment.failureReason && (
                <div className="notice"><strong>This consignment did not arrive</strong><span>{shipment.failureReason}</span></div>
              )}
            </>
          )}
        </Card>
      )}
      {payment && (
        <Card className="section-gap">
          <SectionTitle title="Payment" detail={`${order.data.paymentTermsDays}-day terms`} />
          <p className="payment-disclaimer">Harvest tracks payment; it does not move money. The amount is what the accepted produce is worth at the price the farmer published.</p>
          <div className="payment-card">
            <div className="split"><span>Status</span><Badge tone={payment.status.toLowerCase().replaceAll("_", "-")}>{PAYMENT_STATUS_LABELS[payment.status]}</Badge></div>
            <div className="split"><span>Amount</span><strong>{payment.amount ? formatMoney(payment.amount.amount, payment.amount.currency) : "-"}</strong></div>
            <div className="split"><span>Agreed terms</span><strong>{order.data.paymentTermsDays} days after delivery</strong></div>
            <div className="split"><span>Due</span><strong>{payment.dueAt ? formatDate(payment.dueAt, false) : "After the delivery is accepted"}</strong></div>
            {payment.daysOutstanding !== undefined && <div className="split"><span>Days since delivery</span><strong>{payment.daysOutstanding}</strong></div>}
            {payment.paidAt && <div className="split"><span>Recorded paid</span><strong>{formatDate(payment.paidAt)}</strong></div>}
            {payment.reference && <div className="split"><span>Reference</span><strong>{payment.reference}</strong></div>}
          </div>
          {actor?.role === "BUYER" && payment.status !== "PAID" && payment.dueAt && (
            <form className="form-grid section-gap" onSubmit={(event: FormEvent) => { event.preventDefault(); confirmPayment.mutate(); }}>
              <div className="field field-full"><label>Your payment reference (optional)</label><input value={reference} maxLength={120} onChange={(event) => setReference(event.target.value)} /></div>
              <button className="button field-full" disabled={confirmPayment.isPending}><BadgeCheck size={17} />Confirm payment</button>
            </form>
          )}
          {confirmPayment.error && <p className="form-error">{confirmPayment.error.message}</p>}
        </Card>
      )}
      {actor?.role !== "COORDINATOR" && <div className="section-gap"><ApprovalList /></div>}
      {actor?.role === "BUYER" && mission?.status === "DELIVERED" && !order.data.deliveryAcceptance && (
        <Card className="section-gap">
          <SectionTitle title="Accept this delivery" detail="Record what arrived" />
          <form className="form-grid" onSubmit={(event: FormEvent) => { event.preventDefault(); if (online) acceptance.mutate(); }}>
            {resolvedLines.map((line) => (
              <div className="field-full" key={line.cropBatchId}>
                <div className="order-summary">
                  <span><strong>{line.quantity} kg crop batch</strong><small>{line.cropBatchId.slice(0, 8)}</small></span>
                  <label>Accepted (kg)<input type="number" min="0" max={line.quantity} step="0.1" value={line.accepted} onChange={(event) => setLineValues((current) => ({ ...current, [line.cropBatchId]: { accepted: Number(event.target.value), rejected: current[line.cropBatchId]?.rejected ?? line.rejected } }))} /></label>
                  <label>Rejected (kg)<input type="number" min="0" max={line.quantity} step="0.1" value={line.rejected} onChange={(event) => setLineValues((current) => ({ ...current, [line.cropBatchId]: { accepted: current[line.cropBatchId]?.accepted ?? line.accepted, rejected: Number(event.target.value) } }))} /></label>
                </div>
                {line.rejected > 0 && (
                  <ReasonChooser
                    idPrefix={`line-${line.cropBatchId}`}
                    label="Reason for this crop batch (optional; the shared reason applies without one)"
                    onChange={(value) => setLineReasons((current) => ({ ...current, [line.cropBatchId]: value }))}
                    value={lineReasons[line.cropBatchId] ?? null}
                  />
                )}
              </div>
            ))}
            <div className="field"><label>Total accepted</label><input value={`${accepted} kg`} disabled /></div>
            <div className="field"><label>Total rejected</label><input value={`${rejected} kg`} disabled /></div>
            {rejected > 0 && (
              <DecisionReasonFields
                idPrefix="delivery"
                disabled={!online || acceptance.isPending}
                nextAction={nextAction}
                onNextAction={setNextAction}
                onReasonCode={setReasonCode}
                reasonCode={reasonCode}
                reasonLabel="What was wrong with the rejected produce?"
              />
            )}
            <div className="field field-full"><label htmlFor="acceptance-note">Note (optional)</label><textarea id="acceptance-note" rows={2} value={note} onChange={(event) => setNote(event.target.value)} /></div>
            {!online && <div className="field-full"><OfflineHint>Accepting a delivery settles what was received, so it is never queued. Reconnect to confirm.</OfflineHint></div>}
            {reasonMissing && <p className="form-error field-full">Choose a reason and say what the farmer should do next before recording a rejection.</p>}
            <button className="button field-full" aria-disabled={!online || undefined} disabled={acceptance.isPending || !online || reasonMissing || Math.abs(accepted + rejected - mission.quantity.value) > 0.0001 || resolvedLines.some((line) => Math.abs(line.accepted + line.rejected - line.quantity) > 0.0001)}><CheckCircle2 size={17} />Confirm delivery</button>
          </form>
          {(message || acceptance.error) && <p className={acceptance.error ? "form-error" : "form-success"}>{message ?? acceptance.error?.message}</p>}
        </Card>
      )}
    </>
  );
}
