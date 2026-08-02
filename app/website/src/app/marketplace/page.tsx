"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Leaf, ShoppingCart } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useSession } from "@/components/providers";
import { Badge, Card, ErrorState, LoadingState, PageHeader, SectionTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";

export default function MarketplacePage() {
  const { actor, ready } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(20);
  const [neededBy, setNeededBy] = useState("2026-09-05T15:00");
  const [message, setMessage] = useState<string | null>(null);
  const listings = useQuery({ queryKey: ["listings", "CUCUMBER"], queryFn: () => api.listings("CUCUMBER"), enabled: ready });
  const createOrder = useMutation({
    mutationFn: async () => {
      const common = { cropType: "CUCUMBER", neededBy: new Date(neededBy).toISOString(), deliveryLocation: { latitude: 14.0101, longitude: -60.9875 } };
      await api.createDemand({ ...common, quantity: { value: quantity, unit: "kg" }, maxUnitPrice: { amount: 8, currency: "XCD" } });
      return api.createOrder({ ...common, requestedQuantity: { value: quantity, unit: "kg" }, listingIds: selected });
    },
    onSuccess: (order) => { setMessage("Demand recorded and safe matching started."); void queryClient.invalidateQueries(); setTimeout(() => router.push(`/orders/${order.orderId}`), 700); },
  });

  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const selectedSupply = listings.data?.items.filter((item) => selected.includes(item.listingId)).reduce((sum, item) => sum + item.quantity.value, 0) ?? 0;

  return <>
    <PageHeader eyebrow="Buyer marketplace" title="Dependable local supply" description="Browse conservative available-to-promise quantities, combine compatible farms, and send one traceable hotel order." />
    {listings.error ? <ErrorState error={listings.error} /> : !listings.data ? <LoadingState /> : <div className="grid two-column">
      <div className="listing-grid">{listings.data.items.map((listing) => <Card className="listing-card" key={listing.listingId}>
        <input className="listing-select" type="checkbox" checked={selected.includes(listing.listingId)} onChange={() => toggle(listing.listingId)} aria-label={`Select ${listing.quantity.value} kilograms from listing ${listing.listingId}`} />
        <div className="listing-visual"><Leaf /></div><div className="listing-body"><Badge>{listing.status}</Badge><h3>Saint Lucia cucumber</h3><p>Safe quantity backed by a validated crop prediction.</p><div className="listing-meta"><span><strong>{listing.quantity.value} kg</strong><br/>available</span><span><strong>EC${listing.unitPrice.amount.toFixed(2)}</strong><br/>per kg</span><span>From<br/><strong>{formatDate(listing.availableFrom, false)}</strong></span><span>Until<br/><strong>{formatDate(listing.availableUntil, false)}</strong></span></div></div>
      </Card>)}</div>
      <Card>
        <SectionTitle title="Build hotel order" detail="Multi-farm matching" />
        <div className="form-grid">
          <div className="field"><label>Crop</label><input value="Cucumber" disabled /></div>
          <div className="field"><label>Quantity (kg)</label><input type="number" min="1" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></div>
          <div className="field field-full"><label>Needed by</label><input type="datetime-local" value={neededBy} onChange={(event) => setNeededBy(event.target.value)} /></div>
          <div className="field"><label>Delivery</label><input value="Bay Gardens Hotel" disabled /></div>
          <div className="field"><label>Selected safe supply</label><input value={`${selectedSupply} kg`} disabled /></div>
        </div>
        <div className="card" style={{boxShadow:"none", marginTop:16, background:"var(--mint)"}}><div className="split"><span className="small">Requested</span><strong>{quantity} kg</strong></div><div className="split"><span className="small">Selected ATP</span><strong>{selectedSupply} kg</strong></div><div className="split"><span className="small">Coverage</span><Badge tone={selectedSupply >= quantity ? "active" : "pending"}>{selectedSupply >= quantity ? "Ready to match" : "Select more supply"}</Badge></div></div>
        {actor?.role !== "BUYER" && actor?.role !== "COORDINATOR" && actor?.role !== "ADMIN" && <p className="form-message error">Switch the development persona to Hotel buyer or Coordinator before placing an order.</p>}
        {createOrder.error && <p className="form-message error">{createOrder.error.message}</p>}
        {message && <p className="form-message"><Check size={13}/> {message}</p>}
        <button className="button" style={{width:"100%", marginTop:16}} disabled={selectedSupply < quantity || createOrder.isPending || !["BUYER","COORDINATOR","ADMIN"].includes(actor?.role ?? "")} onClick={() => createOrder.mutate()}><ShoppingCart size={16}/>{createOrder.isPending ? "Creating order…" : "Create traceable order"}</button>
      </Card>
    </div>}
  </>;
}
