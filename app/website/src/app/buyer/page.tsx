"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, ClipboardList, ShoppingBasket, Truck } from "lucide-react";
import Link from "next/link";

import { ApprovalList } from "@/components/approval-list";
import { OrderList } from "@/components/order-list";
import { useSession } from "@/components/providers";
import { Metric, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";

export default function BuyerHome() {
  const { actor } = useSession();
  const orders = useQuery({ queryKey: ["orders"], queryFn: api.orders });
  const demands = useQuery({ queryKey: ["demands"], queryFn: api.demands });
  const missions = useQuery({ queryKey: ["missions"], queryFn: () => api.missions() });
  const orderItems = orders.data?.items ?? [];

  return (
    <>
      <PageHeader eyebrow="Buyer overview" title={`Welcome, ${actor?.name ?? "buyer"}`} description="Plan local demand, confirm safe supply and follow every delivery in one place." actions={<Link href="/marketplace" className="button"><ShoppingBasket size={17} />Find local produce</Link>} />
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
      <Link href="/orders" className="text-link section-gap">View all orders <ArrowRight size={16} /></Link>
    </>
  );
}
