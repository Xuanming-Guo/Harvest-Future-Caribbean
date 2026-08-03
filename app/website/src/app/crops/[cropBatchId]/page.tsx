"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarDays, RefreshCw, Save, Store } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useState } from "react";

import { useSession } from "@/components/providers";
import { Badge, Card, ErrorState, LoadingState, PageHeader, SectionTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate, formatPercent } from "@/lib/format";

export default function CropDetailPage() {
  const { cropBatchId } = useParams<{ cropBatchId: string }>();
  const { actor } = useSession();
  const queryClient = useQueryClient();
  const [stage, setStage] = useState("HARVEST_READY");
  const [quantity, setQuantity] = useState(20);
  const [notes, setNotes] = useState("");
  const [listingQuantity, setListingQuantity] = useState(10);
  const [price, setPrice] = useState(7.5);
  const [availableFrom, setAvailableFrom] = useState("2026-09-05");
  const [availableUntil, setAvailableUntil] = useState("2026-09-10");
  const [message, setMessage] = useState<string | null>(null);

  const batch = useQuery({ queryKey: ["crop-batch", cropBatchId], queryFn: () => api.cropBatch(cropBatchId) });
  const prediction = useQuery({
    queryKey: ["prediction", batch.data?.latestPredictionId],
    queryFn: () => api.prediction(batch.data!.latestPredictionId!),
    enabled: Boolean(batch.data?.latestPredictionId),
  });
  const observation = useMutation({
    mutationFn: () => api.submitObservation({
      cropBatchId,
      observedAt: new Date().toISOString(),
      cropStage: stage,
      estimatedQuantity: { value: quantity, unit: "kg" },
      notes: notes || undefined,
      provenance: "OBSERVED",
    }),
    onSuccess: async () => {
      await api.requestForecast(cropBatchId, "NEW_OBSERVATION");
      setMessage("Crop update saved and the forecast is being refreshed.");
      void queryClient.invalidateQueries({ queryKey: ["crop-batch", cropBatchId] });
    },
  });
  const refresh = useMutation({
    mutationFn: () => api.requestForecast(cropBatchId, "MANUAL_REFRESH"),
    onSuccess: () => setMessage("Forecast refresh requested."),
  });
  const listing = useMutation({
    mutationFn: () => api.createListing({
      cropBatchId,
      quantity: { value: listingQuantity, unit: "kg" },
      unitPrice: { amount: price, currency: "XCD" },
      availableFrom,
      availableUntil,
    }),
    onSuccess: () => setMessage("Produce is now listed in the marketplace."),
  });

  if (batch.error) return <ErrorState error={batch.error} />;
  if (!batch.data) return <LoadingState label="Loading crop details..." />;
  const canEdit = actor?.role === "FARMER";

  return (
    <>
      <Link className="back-link" href={actor?.role === "COORDINATOR" ? "/coordinator" : "/farmer"}><ArrowLeft size={16} />Back to crops</Link>
      <PageHeader eyebrow="Crop batch" title={batch.data.cropType} description={`${batch.data.availableToPromise.value} kg can currently be promised without overcommitting.`} actions={<Badge>{batch.data.status}</Badge>} />
      <div className="grid two-column">
        <Card>
          <SectionTitle title="Harvest outlook" detail="Range, not a false promise" />
          {prediction.error ? <ErrorState error={prediction.error} /> : !batch.data.latestPredictionId ? (
            <p>No forecast exists yet. Save a crop update to create one.</p>
          ) : !prediction.data ? <LoadingState label="Loading forecast..." /> : (
            <div className="forecast-panel">
              <div className="forecast-range">
                <span><small>Low</small><strong>{prediction.data.q10MarketableYield.value} kg</strong></span>
                <span className="forecast-main"><small>Likely</small><strong>{prediction.data.q50MarketableYield.value} kg</strong></span>
                <span><small>High</small><strong>{prediction.data.q90MarketableYield.value} kg</strong></span>
              </div>
              <div className="split"><span>Expected harvest</span><strong>{formatDate(prediction.data.harvestWindow.start, false)} - {formatDate(prediction.data.harvestWindow.end, false)}</strong></div>
              <div className="split"><span>Confidence</span><strong>{formatPercent(prediction.data.confidence)}</strong></div>
              {prediction.data.warnings.length > 0 && <div className="notice"><strong>Please check</strong>{prediction.data.warnings.join("; ")}</div>}
              {canEdit && <button className="button button-secondary" disabled={refresh.isPending} onClick={() => refresh.mutate()}><RefreshCw size={16} />Refresh forecast</button>}
            </div>
          )}
        </Card>
        {canEdit ? (
          <Card>
            <SectionTitle title="Share a crop update" detail="Takes less than a minute" />
            <form className="form-grid" onSubmit={(event: FormEvent) => { event.preventDefault(); observation.mutate(); }}>
              <div className="field"><label htmlFor="stage">Crop stage</label><select id="stage" value={stage} onChange={(event) => setStage(event.target.value)}><option>GROWING</option><option>FLOWERING</option><option>FRUITING</option><option>HARVEST_READY</option><option>HARVESTED</option></select></div>
              <div className="field"><label htmlFor="estimate">Estimated crop (kg)</label><input id="estimate" type="number" min="0" step="0.5" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></div>
              <div className="field field-full"><label htmlFor="notes">What have you noticed?</label><textarea id="notes" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="For example: heavy rain, pest damage, or good growth" /></div>
              <button className="button field-full" disabled={observation.isPending}><Save size={16} />{observation.isPending ? "Saving..." : "Save crop update"}</button>
            </form>
          </Card>
        ) : (
          <Card><SectionTitle title="Information status" detail="Coordinator view" /><div className="info-list"><div><CalendarDays /><span><strong>Latest observation</strong><small>{batch.data.latestObservationId ? "Recorded" : "Missing"}</small></span></div><div><RefreshCw /><span><strong>Forecast</strong><small>{batch.data.latestPredictionId ? "Available" : "Missing"}</small></span></div></div></Card>
        )}
      </div>
      {canEdit && (
        <Card className="section-gap">
          <SectionTitle title="Offer produce to buyers" detail={`Up to ${batch.data.availableToPromise.value} kg safe to list`} />
          <form className="form-grid four-fields" onSubmit={(event: FormEvent) => { event.preventDefault(); listing.mutate(); }}>
            <div className="field"><label>Quantity (kg)</label><input type="number" min="0.1" max={batch.data.availableToPromise.value} step="0.1" value={listingQuantity} onChange={(event) => setListingQuantity(Number(event.target.value))} /></div>
            <div className="field"><label>Price per kg (EC$)</label><input type="number" min="0" step="0.25" value={price} onChange={(event) => setPrice(Number(event.target.value))} /></div>
            <div className="field"><label>Available from</label><input type="date" value={availableFrom} onChange={(event) => setAvailableFrom(event.target.value)} /></div>
            <div className="field"><label>Available until</label><input type="date" value={availableUntil} onChange={(event) => setAvailableUntil(event.target.value)} /></div>
            <button className="button field-full" disabled={listing.isPending || listingQuantity > batch.data.availableToPromise.value}><Store size={16} />{listing.isPending ? "Publishing..." : "List in marketplace"}</button>
          </form>
        </Card>
      )}
      {(message || observation.error || refresh.error || listing.error) && <p className={(observation.error || refresh.error || listing.error) ? "form-error" : "form-success"}>{message ?? observation.error?.message ?? refresh.error?.message ?? listing.error?.message}</p>}
    </>
  );
}
