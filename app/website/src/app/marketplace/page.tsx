"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Leaf, Plus, ShoppingCart } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { OfflineHint, useOnlineStatus } from "@/components/offline";
import { Badge, Card, EmptyState, ErrorState, LoadingState, PageHeader, SectionTitle } from "@/components/ui";
import { useSession } from "@/components/providers";
import { api } from "@/lib/api";
import { dateTimeInputOffset, formatDate, formatPercent, titleCase } from "@/lib/format";

/** Buyer-facing acceptance thresholds; the contract allows 0.5 to 1. */
const ACCEPTANCE_OPTIONS = [0.8, 0.9, 1] as const;

export default function MarketplacePage() {
  const router = useRouter();
  const { actor } = useSession();
  const online = useOnlineStatus();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [cropType, setCropType] = useState("CUCUMBER");
  const [quantity, setQuantity] = useState(12);
  const [neededBy, setNeededBy] = useState(() => dateTimeInputOffset(4));
  const [maxPrice, setMaxPrice] = useState(8);
  const [minimumAcceptableFraction, setMinimumAcceptableFraction] = useState(0.8);
  const [message, setMessage] = useState<string | null>(null);
  const listings = useQuery({ queryKey: ["listings", cropType], queryFn: () => api.listings(cropType), refetchInterval: 15_000 });
  const focusedListingId = selected.at(-1);
  const listingDetail = useQuery({ queryKey: ["listing", focusedListingId], queryFn: () => api.listing(focusedListingId!), enabled: Boolean(focusedListingId), refetchInterval: 15_000 });

  const demand = useMutation({
    mutationFn: () => {
      if (!actor?.deliveryLocation) throw new Error("Your buyer delivery profile is missing a location.");
      return api.createDemand({
      cropType,
      quantity: { value: quantity, unit: "kg" },
      neededBy: new Date(neededBy).toISOString(),
      deliveryLocation: actor.deliveryLocation,
      maxUnitPrice: { amount: maxPrice, currency: "XCD" },
      });
    },
    onSuccess: () => { setMessage("Demand saved. Harvest can now help find matching supply."); void queryClient.invalidateQueries({ queryKey: ["demands"] }); },
  });
  const order = useMutation({
    mutationFn: () => {
      if (!actor?.deliveryLocation) throw new Error("Your buyer delivery profile is missing a location.");
      return api.createOrder({
      cropType,
      requestedQuantity: { value: quantity, unit: "kg" },
      neededBy: new Date(neededBy).toISOString(),
      deliveryLocation: actor.deliveryLocation,
      minimumAcceptableFraction,
      listingIds: selected,
      });
    },
    onSuccess: (created) => { void queryClient.invalidateQueries(); router.push(`/orders/${created.orderId}`); },
  });

  const selectedSupply = listings.data?.items.filter((item) => selected.includes(item.listingId)).reduce((sum, item) => sum + item.quantity.value, 0) ?? 0;
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  return (
    <>
      <PageHeader eyebrow="Local marketplace" title="Find produce you can rely on" description="Browse quantities that farmers can safely promise, then place an order or record future demand." />
      <div className="grid marketplace-layout">
        <div data-tour="marketplace-supply">
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
          {listingDetail.data && (
            <Card className="section-gap">
              <SectionTitle title={`${titleCase(listingDetail.data.cropType)} supply evidence`} detail={listingDetail.data.productionZone} />
              <div className="info-list">
                <div><Leaf /><span><strong>{titleCase(listingDetail.data.supplyEvidence.provenance)}</strong><small>Forecast provenance</small></span></div>
                <div><Check /><span><strong>{titleCase(listingDetail.data.supplyEvidence.verificationStatus)}</strong><small>Coordinator verification</small></span></div>
                {listingDetail.data.supplyEvidence.confidence !== undefined && <div><Check /><span><strong>{formatPercent(listingDetail.data.supplyEvidence.confidence)}</strong><small>Forecast confidence</small></span></div>}
              </div>
              {listingDetail.data.supplyEvidence.forecastGeneratedAt && <p>Updated {formatDate(listingDetail.data.supplyEvidence.forecastGeneratedAt)}</p>}
              {listingDetail.data.supplyEvidence.warnings?.length ? <div className="notice"><strong>Please check</strong>{listingDetail.data.supplyEvidence.warnings.join("; ")}</div> : null}
            </Card>
          )}
        </div>
        <Card className="sticky-card" data-tour="marketplace-requirement">
          <SectionTitle title="Your requirement" detail={`${actor?.name ?? "Buyer"} · ${actor?.serviceZone ?? "Delivery zone not set"}`} />
          <form className="form-grid" onSubmit={(event: FormEvent) => { event.preventDefault(); if (online) order.mutate(); }}>
            <div className="field"><label>Crop</label><input value={cropType} onChange={(event) => setCropType(event.target.value.toUpperCase())} /></div>
            <div className="field"><label>Quantity (kg)</label><input type="number" min="0.1" step="0.1" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></div>
            <div className="field field-full"><label>Needed by</label><input type="datetime-local" value={neededBy} onChange={(event) => setNeededBy(event.target.value)} /></div>
            <div className="field"><label>Maximum EC$ / kg</label><input type="number" min="0" step="0.25" value={maxPrice} onChange={(event) => setMaxPrice(Number(event.target.value))} /></div>
            <div className="field"><label>Selected supply</label><input value={`${selectedSupply} kg`} disabled /></div>
            <div className="field field-full">
              <span className="field-label" id="minimum-acceptable-label">Minimum I&apos;d accept</span>
              <div className="segmented" role="radiogroup" aria-labelledby="minimum-acceptable-label">
                {ACCEPTANCE_OPTIONS.map((option) => (
                  <button
                    type="button"
                    key={option}
                    role="radio"
                    aria-checked={minimumAcceptableFraction === option}
                    className={`button-quiet segmented-option ${minimumAcceptableFraction === option ? "selected" : ""}`}
                    onClick={() => setMinimumAcceptableFraction(option)}
                  >
                    <span className="badge">{Math.round(option * 100)}%</span>
                  </button>
                ))}
              </div>
              <small className="field-hint">Hotels often take part of an order and source the rest elsewhere.</small>
            </div>
            <div className="field-full order-summary"><span>Requested <strong>{quantity} kg</strong></span><span>Selected <strong>{selectedSupply} kg</strong></span></div>
            {!online && <div className="field-full"><OfflineHint>An order reserves supply from other farms, so it is never queued. Reconnect to send it.</OfflineHint></div>}
            <button type="button" className="button button-secondary" disabled={demand.isPending} aria-disabled={!online || undefined} onClick={() => { if (online) demand.mutate(); }}><Plus size={16} />{demand.isPending ? "Saving..." : "Save as demand"}</button>
            <button className="button" aria-disabled={!online || undefined} disabled={order.isPending || !selected.length || !actor?.deliveryLocation}><ShoppingCart size={16} />{order.isPending ? "Placing order..." : "Place order"}</button>
          </form>
          {(message || demand.error || order.error) && <p className={(demand.error || order.error) ? "form-error" : "form-success"}>{message ?? demand.error?.message ?? order.error?.message}</p>}
        </Card>
      </div>
    </>
  );
}
