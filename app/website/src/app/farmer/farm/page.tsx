"use client";

import { useQuery } from "@tanstack/react-query";
import { Sprout } from "lucide-react";
import Link from "next/link";

import { FarmMap } from "@/components/farm-map";
import { Badge, Card, EmptyState, ErrorState, LoadingState, PageHeader, SectionTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { titleCase } from "@/lib/format";

export default function FarmMapPage() {
  const batches = useQuery({ queryKey: ["crop-batches"], queryFn: api.cropBatches, refetchInterval: 15_000 });
  const opportunities = useQuery({ queryKey: ["market-opportunities"], queryFn: () => api.marketOpportunities(), refetchInterval: 15_000 });
  const missions = useQuery({ queryKey: ["missions"], queryFn: () => api.missions(), refetchInterval: 5_000 });

  return (
    <>
      <PageHeader
        eyebrow="My farm"
        title="What's growing"
        description="Every crop batch laid out as a plot on your farm, sized by what is safe to sell right now."
        actions={<Badge>Synthetic demo data</Badge>}
      />
      {batches.error ? <ErrorState error={batches.error} /> : !batches.data ? <LoadingState /> : (
        <>
          <Card>
            <SectionTitle title="Farm map" detail={`${batches.data.items.length} plots`} />
            <FarmMap batches={batches.data.items} opportunities={opportunities.data?.items} missions={missions.data?.items} />
            <div className="farm-legend">
              <Badge>Planned</Badge>
              <Badge>Growing</Badge>
              <Badge>Harvest Ready</Badge>
              <Badge>Harvested</Badge>
              <Badge>Closed</Badge>
              <Badge tone="pending">Buyer demand</Badge>
              <Badge tone="active">Active delivery</Badge>
            </div>
          </Card>
          <div className="farm-list section-gap">
            {!batches.data.items.length ? (
              <EmptyState title="No crop batches yet" detail="Report your first crop to see it appear on the map." />
            ) : (
              <div className="crop-grid">
                {batches.data.items.map((batch) => (
                  <Link href={`/crops/${batch.cropBatchId}`} className="crop-card" key={batch.cropBatchId}>
                    <span className="crop-symbol"><Sprout /></span>
                    <div><Badge>{batch.status}</Badge><h3>{titleCase(batch.cropType)}</h3><p>{batch.availableToPromise.value} kg currently safe to promise</p></div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
