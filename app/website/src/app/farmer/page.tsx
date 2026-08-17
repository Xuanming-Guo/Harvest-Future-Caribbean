"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarDays, MapPin, Scale, Sprout, Truck } from "lucide-react";
import Link from "next/link";

import { ApprovalList } from "@/components/approval-list";
import { OrderList } from "@/components/order-list";
import { useSession } from "@/components/providers";
import { Badge, Card, EmptyState, ErrorState, LoadingState, Metric, PageHeader, SectionTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate, titleCase } from "@/lib/format";

export default function FarmerHome() {
  const { actor } = useSession();
  const batches = useQuery({ queryKey: ["crop-batches"], queryFn: api.cropBatches, refetchInterval: 15_000 });
  const opportunities = useQuery({ queryKey: ["market-opportunities"], queryFn: () => api.marketOpportunities(), refetchInterval: 15_000 });
  const missions = useQuery({ queryKey: ["missions"], queryFn: () => api.missions(), refetchInterval: 5_000 });

  return (
    <>
      <div data-tour="farmer-home"><PageHeader eyebrow="My farm" title={`Welcome, ${actor?.name.split(" ")[0] ?? "farmer"}`} description="Share a simple crop update, see what can safely be sold, and respond to order requests." /></div>
      {batches.error ? <ErrorState error={batches.error} /> : !batches.data ? <LoadingState /> : (
        <>
          <div className="metric-grid">
            <Metric label="Crop batches" value={batches.data.items.length} detail="Visible to you" icon={Sprout} />
            <Metric label="Safe to promise" value={`${batches.data.items.reduce((sum, batch) => sum + batch.availableToPromise.value, 0)} kg`} detail="Across your crops" icon={Scale} tone="blue" />
            <Metric label="Harvest ready" value={batches.data.items.filter((batch) => batch.status === "HARVEST_READY").length} detail="Ready for market" icon={CalendarDays} tone="amber" />
          </div>
          <div className="dashboard-grid">
            <Card>
              <SectionTitle title="My crops" detail="Update at any time" />
              <div className="crop-grid">
                {batches.data.items.map((batch, index) => (
                  <Link href={`/crops/${batch.cropBatchId}`} className="crop-card" key={batch.cropBatchId} data-tour={index === 0 ? "farmer-crop-link" : undefined}>
                    <span className="crop-symbol"><Sprout /></span>
                    <div><Badge>{batch.status}</Badge><h3>{batch.cropType}</h3><p>{batch.availableToPromise.value} kg currently safe to promise</p></div>
                    <ArrowRight size={18} />
                  </Link>
                ))}
              </div>
            </Card>
            <ApprovalList compact />
          </div>
          <div className="section-gap"><OrderList limit={4} /></div>
          <div className="dashboard-grid section-gap">
            <Card>
              <SectionTitle title="Buyer opportunities" detail="Privacy-safe demand" />
              {!opportunities.data?.items.length ? <EmptyState title="No matching demand yet" detail="Open buyer needs for your crops will appear here." /> : (
                <div className="task-list">{opportunities.data.items.slice(0, 4).map((item) => (
                  <article className="task-row" key={item.opportunityId}><div><Badge tone="pending">Buyer need</Badge><h3>{titleCase(item.cropType)}</h3><p>{item.quantity.value} kg needed by {formatDate(item.neededBy)}</p><small><MapPin size={13} /> {item.deliveryZone}</small></div></article>
                ))}</div>
              )}
            </Card>
            <Card>
              <SectionTitle title="Upcoming deliveries" detail="Committed orders" />
              {!missions.data?.items.length ? <EmptyState title="No pickups scheduled" detail="Approved commitments will create delivery missions here." /> : (
                <div className="mission-list">{missions.data.items.filter((item) => item.status !== "DELIVERED" && item.status !== "CANCELLED").slice(0, 4).map((item) => (
                  <Link href={`/missions/${item.missionId}`} className="mission-card" key={item.missionId}><div><Badge>{item.status}</Badge><h3>{item.quantity.value} kg pickup</h3><p><Truck size={15} />Due {formatDate(item.deadline)}</p></div><ArrowRight size={18} /></Link>
                ))}</div>
              )}
            </Card>
          </div>
        </>
      )}
    </>
  );
}
