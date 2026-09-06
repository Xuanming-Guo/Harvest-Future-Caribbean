"use client";

import { ShoppingBasket } from "lucide-react";
import Link from "next/link";

import { OrderList } from "@/components/order-list";
import { useSession } from "@/components/providers";
import { PageHeader } from "@/components/ui";

export default function OrdersPage() {
  const { actor } = useSession();
  return (
    <div data-tour="orders-workspace">
      <PageHeader
        eyebrow="Shared commitments"
        title="Orders"
        actions={actor?.role === "BUYER" ? <Link href="/marketplace" className="button"><ShoppingBasket size={17} />Find produce</Link> : undefined}
      />
      <OrderList />
    </div>
  );
}
