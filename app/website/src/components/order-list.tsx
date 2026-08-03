"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { Badge, Card, EmptyState, ErrorState, LoadingState, SectionTitle } from "./ui";

export function OrderList({ limit }: { limit?: number }) {
  const orders = useQuery({ queryKey: ["orders"], queryFn: api.orders });
  if (orders.error) return <ErrorState error={orders.error} />;
  if (!orders.data) return <LoadingState label="Loading orders..." />;
  const items = limit ? orders.data.items.slice(0, limit) : orders.data.items;
  if (!items.length) return <EmptyState title="No orders yet" detail="Orders you take part in will appear here." />;
  return (
    <Card>
      <SectionTitle title="Orders" detail={`${orders.data.items.length} total`} />
      <div className="order-list">
        {items.map((order) => (
          <Link href={`/orders/${order.orderId}`} className="order-row" key={order.orderId}>
            <div><strong>{order.cropType}</strong><small>Needed {formatDate(order.neededBy)}</small></div>
            <span>{order.requestedQuantity.value} kg</span>
            <Badge tone={order.atRisk ? "high" : undefined}>{order.lifecycleStatus}</Badge>
            <ArrowRight size={17} />
          </Link>
        ))}
      </div>
    </Card>
  );
}
