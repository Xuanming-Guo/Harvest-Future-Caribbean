"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarDays, Scale, Sprout } from "lucide-react";
import Link from "next/link";

import { ApprovalList } from "@/components/approval-list";
import { OrderList } from "@/components/order-list";
import { useSession } from "@/components/providers";
import { Badge, Card, ErrorState, LoadingState, Metric, PageHeader, SectionTitle } from "@/components/ui";
import { api } from "@/lib/api";

export default function FarmerHome() {
  const { actor } = useSession();
  const batches = useQuery({ queryKey: ["crop-batches"], queryFn: api.cropBatches });

  return (
    <>
      <PageHeader eyebrow="My farm" title={`Welcome, ${actor?.name.split(" ")[0] ?? "farmer"}`} description="Share a simple crop update, see what can safely be sold, and respond to order requests." />
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
                {batches.data.items.map((batch) => (
                  <Link href={`/crops/${batch.cropBatchId}`} className="crop-card" key={batch.cropBatchId}>
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
        </>
      )}
    </>
  );
}
