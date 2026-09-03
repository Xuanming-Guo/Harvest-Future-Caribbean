"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, ClipboardList, ShoppingBasket, Truck } from "lucide-react";
import Link from "next/link";

import { ApprovalList } from "@/components/approval-list";
import { OrderList } from "@/components/order-list";
import { useSession } from "@/components/providers";
import { Badge, Card, EmptyState, Metric, PageHeader, SectionTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate, titleCase } from "@/lib/format";

export default function BuyerHome() {
  const { actor } = useSession();
  const orders = useQuery({ queryKey: ["orders"], queryFn: () => api.orders(), refetchInterval: 5_000 });
  const demands = useQuery({ queryKey: ["demands"], queryFn: api.demands, refetchInterval: 15_000 });
  const missions = useQuery({ queryKey: ["missions"], queryFn: () => api.missions(), refetchInterval: 5_000 });
  const orderItems = orders.data?.items ?? [];

  return (
    <>
      <div data-tour="buyer-home"><PageHeader eyebrow="Buyer overview" title={`Welcome, ${actor?.name ?? "buyer"}`} description="Plan local demand, confirm safe supply and follow every delivery in one place." actions={<Link href="/marketplace" className="button" data-tour="buyer-marketplace-link"><ShoppingBasket size={17} />Find local produce</Link>} /></div>
      <div className="metric-grid">
        <Metric label="Open demand" value={demands.data?.items.filter((item) => item.status !== "SATISFIED" && item.status !== "CANCELLED").length ?? "-"} detail="Needs being sourced" icon={ClipboardList} />
        <Metric label="Active orders" value={orderItems.filter((item) => !["FULFILLED", "REJECTED", "CANCELLED"].includes(item.lifecycleStatus)).length} detail="In progress" icon={ShoppingBasket} tone="blue" />
        <Metric label="In delivery" value={missions.data?.items.filter((item) => ["ASSIGNED", "PICKUP_IN_PROGRESS", "IN_TRANSIT"].includes(item.status)).length ?? "-"} detail="On the road" icon={Truck} tone="amber" />
        <Metric label="At risk" value={orderItems.filter((item) => item.atRisk).length} detail="Needs attention" icon={AlertTriangle} tone="red" />
      </div>
      <div className="dashboard-grid">
        <OrderList limit={5} />
        <ApprovalList compact />
      </div>
      <Card className="section-gap">
        <SectionTitle title="Demand history" detail={`${demands.data?.items.length ?? 0} requests`} />
        {!demands.data?.items.length ? <EmptyState title="No demand recorded" detail="Save a requirement from the marketplace to start sourcing." /> : (
          <div className="order-list">{demands.data.items.map((item) => (
            <div className="order-row" key={item.demandId}><div><strong>{titleCase(item.cropType)}</strong><small>Needed {formatDate(item.neededBy)}</small></div><span>{item.quantity.value} kg</span><Badge>{item.status}</Badge></div>
          ))}</div>
        )}
      </Card>
      <Link href="/orders" className="text-link section-gap">View all orders <ArrowRight size={16} /></Link>
    </>
  );
}
