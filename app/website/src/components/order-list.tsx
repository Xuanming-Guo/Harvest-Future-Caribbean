"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { api } from "@/lib/api";
import { formatDate, titleCase } from "@/lib/format";
import { PAYMENT_STATUS_LABELS } from "@/lib/payments";
import { Badge, Card, EmptyState, ErrorState, LoadingState, SectionTitle } from "./ui";

/**
 * `embedded` drops the card shell for callers that already provide one, such as
 * a workspace section whose heading names the list.
 */
export function OrderList({
  limit,
  embedded = false,
  filter,
  emptyTitle = "No orders yet",
  emptyDetail = "Orders you take part in will appear here.",
}: {
  limit?: number;
  embedded?: boolean;
  filter?: (order: { lifecycleStatus: string }) => boolean;
  emptyTitle?: string;
  emptyDetail?: string;
}) {
  const orders = useQuery({ queryKey: ["orders"], queryFn: () => api.orders(), refetchInterval: 5_000 });
  if (orders.error) return <ErrorState error={orders.error} />;
  if (!orders.data) return <LoadingState label="Loading orders..." />;
  const matching = filter ? orders.data.items.filter(filter) : orders.data.items;
  const items = limit ? matching.slice(0, limit) : matching;
  if (!items.length) return <EmptyState title={emptyTitle} detail={emptyDetail} />;
  const list = (
    <div className="order-list">
      {items.map((order) => (
        <Link href={`/orders/${order.orderId}`} className="order-row" key={order.orderId}>
          <div><strong>{titleCase(order.cropType)}</strong><small>Needed {formatDate(order.neededBy)}</small></div>
          <span>{order.requestedQuantity.value} kg</span>
          <span className="order-payment-cell">{order.payment && <Badge tone={order.payment.status.toLowerCase().replaceAll("_", "-")}>{PAYMENT_STATUS_LABELS[order.payment.status]}</Badge>}</span>
          <Badge tone={order.atRisk ? "high" : undefined}>{order.lifecycleStatus}</Badge>
          <ArrowRight size={17} />
        </Link>
      ))}
    </div>
  );
  if (embedded) return list;
  return (
    <Card>
      <SectionTitle title="Orders" detail={`${matching.length} total`} />
      {list}
    </Card>
  );
}
