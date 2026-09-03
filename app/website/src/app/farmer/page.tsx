"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Archive,
  ArrowRight,
  ClipboardCheck,
  Handshake,
  History,
  Map,
  MapPin,
  PackageCheck,
  RefreshCw,
  Sprout,
  Store,
  Truck,
  Wallet,
  Wheat,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { ApprovalList } from "@/components/approval-list";
import { DecisionExplanation, decisionReasonLabel } from "@/components/decision-reason";
import { DeviceUpdateList, useOutbox } from "@/components/offline";
import { OrderList } from "@/components/order-list";
import { useSession } from "@/components/providers";
import { FarmWeather } from "@/components/weather";
import { Badge, Card, Disclosure, EmptyState, ErrorState, LoadingState, MoreDetail, PageHeader, SectionTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { compactId, formatDate, formatKg, plural, titleCase } from "@/lib/format";
import { PAYMENT_STATUS_LABELS, formatMoney, summarizeMoneyOwed } from "@/lib/payments";
import {
  WORKSPACE_SECTIONS,
  selectRecommendedAction,
  type RecommendedAction,
  type RecommendedActionKind,
} from "@/lib/recommended-action";

/** The single sentence this workspace has to earn, quoted from issue #54. */
const FARMER_VALUE = "Know what buyers need, show what you can supply, coordinate collection and keep a clear delivery history.";

const OPEN_MISSION_STATUSES = ["AVAILABLE", "ASSIGNED", "PICKUP_IN_PROGRESS", "IN_TRANSIT"];
const FINISHED_ORDER_STATUSES = ["FULFILLED", "PARTIALLY_FULFILLED", "REJECTED", "CANCELLED"];

const ACTION_ICONS: Record<RecommendedActionKind, LucideIcon> = {
  REPORT_PRODUCE_READY: Wheat,
  RESPOND_TO_BUYER: Handshake,
  APPROVE_DELIVERY_PLAN: ClipboardCheck,
  TRACK_COLLECTION: Truck,
  REVIEW_QUEUED_UPDATE: RefreshCw,
  UPDATE_WHAT_IS_GROWING: Sprout,
};

const CROP_ICONS: Record<string, LucideIcon> = {
  HARVEST_READY: Wheat,
  HARVESTED: PackageCheck,
  CLOSED: Archive,
};

export default function FarmerHome() {
  const { actor } = useSession();
  const batches = useQuery({ queryKey: ["crop-batches"], queryFn: api.cropBatches, refetchInterval: 15_000 });
  const listings = useQuery({ queryKey: ["listings"], queryFn: () => api.listings(), refetchInterval: 15_000 });
  const opportunities = useQuery({ queryKey: ["market-opportunities"], queryFn: () => api.marketOpportunities(), refetchInterval: 15_000 });
  const missions = useQuery({ queryKey: ["missions"], queryFn: () => api.missions(), refetchInterval: 5_000 });
  const orders = useQuery({ queryKey: ["orders"], queryFn: () => api.orders(), refetchInterval: 5_000 });
  const approvals = useQuery({ queryKey: ["approvals", "PENDING"], queryFn: () => api.approvals("PENDING"), refetchInterval: 5_000 });
  const deviceUpdates = useOutbox();
  const [dismissed, setDismissed] = useState<string[]>([]);

  if (batches.error) return <ErrorState error={batches.error} />;
  if (!batches.data) return <LoadingState />;

  const cropBatches = batches.data.items;
  const offeredBatchIds = new Set(
    (listings.data?.items ?? []).filter((listing) => listing.status === "ACTIVE" || listing.status === "RESERVED").map((listing) => listing.cropBatchId),
  );
  const openBatches = cropBatches.filter((batch) => batch.status !== "CLOSED");
  const readyBatches = cropBatches.filter((batch) => batch.status === "HARVEST_READY");
  const stillToOffer = readyBatches.filter((batch) => !offeredBatchIds.has(batch.cropBatchId)).length;
  const buyerNeeds = opportunities.data?.items ?? [];
  const pendingApprovals = approvals.data?.items ?? [];
  const collections = (missions.data?.items ?? []).filter((mission) => OPEN_MISSION_STATUSES.includes(mission.status));
  const allOrders = orders.data?.items ?? [];
  const liveOrders = allOrders.filter((order) => !FINISHED_ORDER_STATUSES.includes(order.lifecycleStatus));
  const finishedOrders = allOrders.filter((order) => FINISHED_ORDER_STATUSES.includes(order.lifecycleStatus));
  const safeToSell = cropBatches.reduce((sum, batch) => sum + batch.availableToPromise.value, 0);
  const acceptedKg = finishedOrders.reduce((sum, order) => sum + order.acceptedQuantity.value, 0);
  const owed = summarizeMoneyOwed(allOrders);
  const needsAction = cropBatches.filter((batch) => batch.latestDecision);
  const requestedKg = finishedOrders.reduce((sum, order) => sum + order.requestedQuantity.value, 0);

  const recommendation = selectRecommendedAction(
    {
      batches: cropBatches,
      listings: listings.data?.items ?? [],
      opportunities: buyerNeeds,
      approvals: pendingApprovals,
      missions: missions.data?.items ?? [],
      queued: deviceUpdates,
      now: new Date(),
    },
    dismissed,
  );

  return (
    <>
      <div data-tour="farmer-home">
        <PageHeader
          eyebrow="My farm"
          title={`Welcome, ${actor?.name.split(" ")[0] ?? "farmer"}`}
          description="Do the one thing at the top, then work down the list only if you need to."
          actions={<Badge>Synthetic demo data</Badge>}
        />
        <p className="workspace-intro">{FARMER_VALUE}</p>
        <RecommendedNow
          action={recommendation}
          onDismiss={(key) => setDismissed((keys) => [...keys, key])}
          ledger={[
            ["Crops on your farm", String(openBatches.length)],
            ["Safe to sell now", formatKg(safeToSell)],
            ["Ready to harvest", String(readyBatches.length)],
            ["Accepted by buyers", formatKg(acceptedKg)],
          ]}
        />
      </div>

      <Card className="section-gap owed-card">
        <SectionTitle
          title="Money owed to you"
          detail={owed.count === 0
            ? "Nothing outstanding"
            : `${plural(owed.count, "delivered order")} · longest wait ${plural(owed.oldestDaysOutstanding, "day")}${owed.overdueCount ? ` · ${owed.overdueCount} overdue` : ""}`}
        />
        <div className="owed-summary">
          <span className="owed-mark" aria-hidden="true"><Wallet size={22} /></span>
          <b className={owed.overdueCount ? "owed-amount owed-amount-late" : "owed-amount"}>{formatMoney(owed.amount, owed.currency)}</b>
          <p>Harvest tracks payment; it does not move money. This is what buyers have agreed to pay you for produce they already accepted.</p>
        </div>
      </Card>

      <div className="section-gap">
        <FarmWeather />
      </div>

      {needsAction.length > 0 && (
        <Card className="section-gap decision-card">
          <SectionTitle title="What was wrong, and what to do next" detail={`${plural(needsAction.length, "crop batch", "crop batches")} needing your attention`} />
          <div className="decision-list">
            {needsAction.map((batch) => (
              <Link className="decision-row" href={`/crops/${batch.cropBatchId}`} key={batch.cropBatchId}>
                <div>
                  <Badge tone="high">{decisionReasonLabel(batch.latestDecision?.reasonCode)}</Badge>
                  <h3>{titleCase(batch.cropType)}</h3>
                  <p>{batch.latestDecision?.source === "DELIVERY" ? "A buyer did not accept part of this crop at delivery." : "A coordinator asked for changes to this crop update."}</p>
                  {batch.latestDecision && <DecisionExplanation decision={batch.latestDecision} title={`Recorded ${formatDate(batch.latestDecision.decidedAt)}`} />}
                </div>
                <ArrowRight size={18} aria-hidden="true" />
              </Link>
            ))}
          </div>
        </Card>
      )}

      {deviceUpdates.length > 0 && (
        <Card className="section-gap">
          <SectionTitle title="Updates on this device" detail="Sent automatically when you reconnect" />
          <DeviceUpdateList />
        </Card>
      )}

      <div className="workspace-sections">
        <Disclosure
          id={WORKSPACE_SECTIONS.growing}
          icon={Sprout}
          primary
          defaultOpen
          title="Update what is growing"
          summary={openBatches.length ? `${plural(openBatches.length, "crop")} · ${formatKg(safeToSell)} safe to sell` : "No crops recorded yet"}
        >
          <p className="section-lede">Tell Harvest what you see in the field. Each update keeps your harvest range and the amount you can safely sell close to the truth.</p>
          {!cropBatches.length ? (
            <EmptyState title="No crops recorded yet" detail="Your crop batches appear here once your first one is created." />
          ) : (
            <>
              <div className="crop-grid">
                {cropBatches.map((batch, index) => {
                  const Icon = CROP_ICONS[batch.status] ?? Sprout;
                  return (
                    <Link href={`/crops/${batch.cropBatchId}`} className="crop-card" key={batch.cropBatchId} data-tour={index === 0 ? "farmer-crop-link" : undefined}>
                      <span className={`crop-symbol${batch.status === "HARVEST_READY" ? " crop-symbol-ready" : ""}`}><Icon aria-hidden="true" /></span>
                      <div>
                        <Badge tone={batch.status === "HARVEST_READY" ? "ready" : undefined}>{batch.status === "HARVEST_READY" ? "Ready" : titleCase(batch.status)}</Badge>
                        <h3>{titleCase(batch.cropType)}</h3>
                        <p>{formatKg(batch.availableToPromise.value)} can be sold safely</p>
                      </div>
                      <ArrowRight size={18} aria-hidden="true" />
                    </Link>
                  );
                })}
              </div>
              <MoreDetail id="crop-provenance" label="More detail: where numbers come from">
                {cropBatches.map((batch) => (
                  <div key={batch.cropBatchId}>
                    <span>{titleCase(batch.cropType)} · {compactId(batch.cropBatchId)}</span>
                    <b>{titleCase(batch.provenance)} · {titleCase(batch.verificationStatus ?? "UNVERIFIED")}</b>
                  </div>
                ))}
              </MoreDetail>
            </>
          )}
          <Link href="/farmer/farm" className="text-link section-gap"><Map size={16} aria-hidden="true" />See your farm map</Link>
        </Disclosure>

        <Disclosure
          id={WORKSPACE_SECTIONS.ready}
          icon={Wheat}
          primary
          defaultOpen
          title="Report produce ready"
          summary={!readyBatches.length ? "Nothing is ready to offer yet" : stillToOffer ? `${plural(stillToOffer, "crop")} still to offer` : "Everything ready is already offered"}
        >
          <p className="section-lede">Once a crop is picked and ready, offer it so buyers can see it. Harvest never lets you offer more than is safe to promise.</p>
          {!readyBatches.length ? (
            <EmptyState title="No crop is ready yet" detail="Mark a crop as harvest ready in its update form and it appears here to offer." />
          ) : (
            readyBatches.map((batch) => {
              const offered = offeredBatchIds.has(batch.cropBatchId);
              return (
                <article className="task-action" key={batch.cropBatchId}>
                  <span className="crop-symbol crop-symbol-ready"><Wheat aria-hidden="true" /></span>
                  <div>
                    <Badge tone={offered ? "active" : "ready"}>{offered ? "Offered" : "Ready"}</Badge>
                    <h3>{titleCase(batch.cropType)}</h3>
                    <p>{offered ? `Buyers can already see this crop. ${formatKg(batch.availableToPromise.value)} is still safe to promise.` : `${formatKg(batch.availableToPromise.value)} is safe to promise today.`}</p>
                  </div>
                  <Link className={`button${offered ? " button-secondary" : ""}`} href={`/crops/${batch.cropBatchId}#offer-produce`}>
                    <Store size={17} aria-hidden="true" />{offered ? "Change the offer" : "Offer it to buyers"}
                  </Link>
                </article>
              );
            })
          )}
        </Disclosure>

        <Disclosure
          id={WORKSPACE_SECTIONS.demand}
          icon={Store}
          defaultOpen={recommendation?.sectionId === WORKSPACE_SECTIONS.demand}
          title="View buyer demand"
          summary={buyerNeeds.length ? `${plural(buyerNeeds.length, "buyer")} ${buyerNeeds.length === 1 ? "wants" : "want"} crops you grow` : "No open demand for your crops"}
        >
          <p className="section-lede">Open needs from buyers near you, matched to the crops you grow. Buyer names and exact addresses stay private until an order is agreed.</p>
          {!buyerNeeds.length ? (
            <EmptyState title="No matching demand yet" detail="Open buyer needs for your crops will appear here." />
          ) : (
            <>
              <div className="task-list">
                {buyerNeeds.map((need) => (
                  <article className="task-row" key={need.opportunityId}>
                    <div>
                      <Badge tone="pending">Buyer need</Badge>
                      <h3>{titleCase(need.cropType)}</h3>
                      <p>{formatKg(need.quantity.value)} wanted by {formatDate(need.neededBy, false)}</p>
                      <small><MapPin size={13} aria-hidden="true" /> {need.deliveryZone}</small>
                    </div>
                  </article>
                ))}
              </div>
              <MoreDetail id="demand-detail" label="More detail: prices and references">
                {buyerNeeds.map((need) => (
                  <div key={need.opportunityId}>
                    <span>{titleCase(need.cropType)} · {compactId(need.opportunityId)}</span>
                    <b>{need.maxUnitPrice ? `Up to ${need.maxUnitPrice.currency} ${need.maxUnitPrice.amount} per kg` : "No price limit given"}</b>
                  </div>
                ))}
              </MoreDetail>
            </>
          )}
        </Disclosure>

        <Disclosure
          id={WORKSPACE_SECTIONS.respond}
          icon={Handshake}
          defaultOpen={recommendation?.sectionId === WORKSPACE_SECTIONS.respond}
          title="Respond to an opportunity"
          summary={pendingApprovals.length ? `${plural(pendingApprovals.length, "decision")} waiting for you` : `${plural(liveOrders.length, "request")} in progress`}
        >
          <p className="section-lede">A buyer has asked for produce from your farm. Nothing is promised on your behalf until you agree to it.</p>
          <ApprovalList compact embedded />
          <h3 className="panel-heading">Requests in progress</h3>
          <OrderList
            embedded
            limit={4}
            filter={(order) => !FINISHED_ORDER_STATUSES.includes(order.lifecycleStatus)}
            emptyTitle="No requests in progress"
            emptyDetail="Orders that include produce from your farm will appear here."
          />
          <Link href="/orders" className="text-link section-gap">See every order <ArrowRight size={16} aria-hidden="true" /></Link>
        </Disclosure>

        <Disclosure
          id={WORKSPACE_SECTIONS.collection}
          icon={Truck}
          defaultOpen={recommendation?.sectionId === WORKSPACE_SECTIONS.collection}
          title="Track collection"
          summary={collections.length ? `${plural(collections.length, "collection")} planned` : "No collection planned"}
        >
          <p className="section-lede">A driver comes to your farm, collects the produce and takes it to the buyer. Open a collection to see the stops and when the driver is on the way.</p>
          {!collections.length ? (
            <EmptyState title="No pickups scheduled" detail="Approved commitments create a collection here." />
          ) : (
            <>
              <div className="mission-list">
                {collections.map((mission) => (
                  <Link href={`/missions/${mission.missionId}`} className="mission-card" key={mission.missionId}>
                    <div>
                      <Badge>{mission.status}</Badge>
                      <h3>{formatKg(mission.quantity.value)} collection</h3>
                      <p><Truck size={15} aria-hidden="true" />Due {formatDate(mission.deadline)}</p>
                    </div>
                    <ArrowRight size={18} aria-hidden="true" />
                  </Link>
                ))}
              </div>
              <MoreDetail id="collection-detail" label="More detail: stops and distance">
                {collections.map((mission) => (
                  <div key={mission.missionId}>
                    <span>{compactId(mission.missionId)}</span>
                    <b>{mission.stops.length} stops{mission.estimatedDistanceKm ? ` · ${mission.estimatedDistanceKm} km` : ""}{mission.estimatedArrival ? ` · arrives ${formatDate(mission.estimatedArrival)}` : ""}</b>
                  </div>
                ))}
              </MoreDetail>
            </>
          )}
        </Disclosure>

        <Disclosure
          id={WORKSPACE_SECTIONS.history}
          icon={History}
          defaultOpen={recommendation?.sectionId === WORKSPACE_SECTIONS.history}
          title="View previous deliveries"
          summary={finishedOrders.length ? `${plural(finishedOrders.length, "delivery", "deliveries")} · ${formatKg(acceptedKg)} accepted` : "No finished deliveries yet"}
        >
          <p className="section-lede">What buyers actually took, kept in one place. This record is what makes your farm easy to buy from again.</p>
          {!finishedOrders.length ? (
            <EmptyState title="No finished deliveries yet" detail="Once an order is delivered and checked by the buyer, it is recorded here." />
          ) : (
            <>
              <p className="history-summary">Buyers accepted {formatKg(acceptedKg)} of the {formatKg(requestedKg)} asked for, across {plural(finishedOrders.length, "finished order")}.</p>
              <div className="history-list">
                {finishedOrders.map((order) => {
                  const shortfall = Math.max(0, order.requestedQuantity.value - order.acceptedQuantity.value);
                  return (
                    <div className="history-row" key={order.orderId}>
                      <div>
                        <strong>{titleCase(order.cropType)}</strong>
                        <small>Finished {formatDate(order.updatedAt, false)}</small>
                      </div>
                      <div className={`history-kg${shortfall > 0 ? " history-kg-short" : ""}`}>
                        <b>{formatKg(order.acceptedQuantity.value)}</b>
                        <span>{shortfall > 0 ? `accepted · ${formatKg(shortfall)} short` : "accepted"}</span>
                      </div>
                      <div className="history-badges">
                        {order.payment && <Badge tone={order.payment.status.toLowerCase().replaceAll("_", "-")}>{PAYMENT_STATUS_LABELS[order.payment.status]}</Badge>}
                        <Badge tone={order.lifecycleStatus === "FULFILLED" ? "fulfilled" : undefined}>{order.lifecycleStatus}</Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
              <MoreDetail id="history-detail" label="More detail: order references">
                {finishedOrders.map((order) => (
                  <div key={order.orderId}>
                    <span>{titleCase(order.cropType)} · {compactId(order.orderId)}</span>
                    <b>Asked for {formatKg(order.requestedQuantity.value)} by {formatDate(order.neededBy, false)}</b>
                  </div>
                ))}
              </MoreDetail>
            </>
          )}
        </Disclosure>
      </div>
    </>
  );
}

/**
 * One recommended action, chosen deterministically from data the farmer already
 * has. "Not now" never hides work: it moves to the next thing down the list.
 */
function RecommendedNow({
  action,
  onDismiss,
  ledger,
}: {
  action: RecommendedAction | null;
  onDismiss: (key: string) => void;
  ledger: [string, string][];
}) {
  const Icon = action ? ACTION_ICONS[action.kind] : Sprout;
  return (
    <section className="recommended" aria-labelledby="recommended-headline">
      <span className="recommended-mark"><Icon size={26} aria-hidden="true" /></span>
      <p className="eyebrow">Recommended now</p>
      <h2 className="recommended-headline" id="recommended-headline">
        {action ? action.headline : "Nothing is waiting for you"}
      </h2>
      <p className="recommended-support">
        {action ? action.support : "Your crops are up to date and no buyer is waiting on you. The next thing to do will appear here."}
      </p>
      {action && (
        <div className="recommended-actions">
          <Link className="button button-hero" href={action.href}>
            {action.actionLabel}<ArrowRight size={19} aria-hidden="true" />
          </Link>
          <button type="button" className="recommended-dismiss" onClick={() => onDismiss(action.key)}>Not now</button>
        </div>
      )}
      <dl className="recommended-ledger">
        {ledger.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
