"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Leaf, Plus, ShoppingCart } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { Badge, Card, EmptyState, ErrorState, LoadingState, PageHeader, SectionTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";

const deliveryLocation = { latitude: 14.0101, longitude: -60.9875 };

export default function MarketplacePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [cropType, setCropType] = useState("CUCUMBER");
  const [quantity, setQuantity] = useState(12);
  const [neededBy, setNeededBy] = useState("2026-09-08T15:00");
  const [maxPrice, setMaxPrice] = useState(8);
  const [message, setMessage] = useState<string | null>(null);
  const listings = useQuery({ queryKey: ["listings", cropType], queryFn: () => api.listings(cropType) });

  const demand = useMutation({
    mutationFn: () => api.createDemand({
      cropType,
      quantity: { value: quantity, unit: "kg" },
      neededBy: new Date(neededBy).toISOString(),
      deliveryLocation,
      maxUnitPrice: { amount: maxPrice, currency: "XCD" },
    }),
    onSuccess: () => { setMessage("Demand saved. Harvest can now help find matching supply."); void queryClient.invalidateQueries({ queryKey: ["demands"] }); },
  });
  const order = useMutation({
    mutationFn: () => api.createOrder({
      cropType,
      requestedQuantity: { value: quantity, unit: "kg" },
      neededBy: new Date(neededBy).toISOString(),
      deliveryLocation,
      listingIds: selected,
    }),
    onSuccess: (created) => { void queryClient.invalidateQueries(); router.push(`/orders/${created.orderId}`); },
  });

  const selectedSupply = listings.data?.items.filter((item) => selected.includes(item.listingId)).reduce((sum, item) => sum + item.quantity.value, 0) ?? 0;
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  return (
    <>
      <PageHeader eyebrow="Local marketplace" title="Find produce you can rely on" description="Browse quantities that farmers can safely promise, then place an order or record future demand." />
      <div className="grid marketplace-layout">
        <div>
          <div className="filter-row"><label htmlFor="crop-filter">Crop</label><input id="crop-filter" value={cropType} onChange={(event) => setCropType(event.target.value.toUpperCase())} /></div>
          {listings.error ? <ErrorState error={listings.error} /> : !listings.data ? <LoadingState label="Loading local produce..." /> : !listings.data.items.length ? <EmptyState title="No produce listed yet" detail="Record your demand so coordinators and farmers can respond." /> : (
            <div className="listing-grid">
              {listings.data.items.map((listing) => (
                <button type="button" className={`listing-card card ${selected.includes(listing.listingId) ? "selected" : ""}`} key={listing.listingId} onClick={() => toggle(listing.listingId)}>
                  <span className="listing-check">{selected.includes(listing.listingId) && <Check size={15} />}</span>
                  <span className="listing-visual"><Leaf /></span>
                  <span className="listing-body">
                    <Badge>{listing.status}</Badge><strong>{listing.cropType}</strong>
                    <span className="listing-meta"><span><b>{listing.quantity.value} kg</b> available</span><span><b>EC${listing.unitPrice.amount.toFixed(2)}</b> per kg</span></span>
                    <small>{formatDate(listing.availableFrom, false)} to {formatDate(listing.availableUntil, false)}</small>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <Card className="sticky-card">
          <SectionTitle title="Your requirement" detail="Bay Gardens Hotel" />
          <form className="form-grid" onSubmit={(event: FormEvent) => { event.preventDefault(); order.mutate(); }}>
            <div className="field"><label>Crop</label><input value={cropType} onChange={(event) => setCropType(event.target.value.toUpperCase())} /></div>
            <div className="field"><label>Quantity (kg)</label><input type="number" min="0.1" step="0.1" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></div>
            <div className="field field-full"><label>Needed by</label><input type="datetime-local" value={neededBy} onChange={(event) => setNeededBy(event.target.value)} /></div>
            <div className="field"><label>Maximum EC$ / kg</label><input type="number" min="0" step="0.25" value={maxPrice} onChange={(event) => setMaxPrice(Number(event.target.value))} /></div>
            <div className="field"><label>Selected supply</label><input value={`${selectedSupply} kg`} disabled /></div>
            <div className="field-full order-summary"><span>Requested <strong>{quantity} kg</strong></span><span>Selected <strong>{selectedSupply} kg</strong></span></div>
            <button type="button" className="button button-secondary" disabled={demand.isPending} onClick={() => demand.mutate()}><Plus size={16} />{demand.isPending ? "Saving..." : "Save as demand"}</button>
            <button className="button" disabled={order.isPending || !selected.length}><ShoppingCart size={16} />{order.isPending ? "Placing order..." : "Place order"}</button>
          </form>
          {(message || demand.error || order.error) && <p className={(demand.error || order.error) ? "form-error" : "form-success"}>{message ?? demand.error?.message ?? order.error?.message}</p>}
        </Card>
      </div>
    </>
  );
}
