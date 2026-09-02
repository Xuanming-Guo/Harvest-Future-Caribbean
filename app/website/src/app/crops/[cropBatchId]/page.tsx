"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarDays, RefreshCw, Save, Sparkles, Store } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useState } from "react";

import { useSession } from "@/components/providers";
import { CropStandardCard } from "@/components/crop-standard-card";
import { Badge, Card, ErrorState, LoadingState, PageHeader, SectionTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { dateInputOffset, formatDate, formatPercent, titleCase } from "@/lib/format";

export default function CropDetailPage() {
  const { cropBatchId } = useParams<{ cropBatchId: string }>();
  const { actor } = useSession();
  const queryClient = useQueryClient();
  const [stage, setStage] = useState("HARVEST_READY");
  const [quantity, setQuantity] = useState(20);
  const [notes, setNotes] = useState("");
  const [description, setDescription] = useState("");
  const [intakeId, setIntakeId] = useState<string | null>(null);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const [listingQuantity, setListingQuantity] = useState(10);
  const [price, setPrice] = useState(7.5);
  const [availableFrom, setAvailableFrom] = useState(() => dateInputOffset(1));
  const [availableUntil, setAvailableUntil] = useState(() => dateInputOffset(6));
  const [message, setMessage] = useState<string | null>(null);

  const batch = useQuery({ queryKey: ["crop-batch", cropBatchId], queryFn: () => api.cropBatch(cropBatchId), refetchInterval: 15_000 });
  const standards = useQuery({
    queryKey: ["crop-standards", batch.data?.cropType],
    queryFn: () => api.cropStandards(batch.data!.cropType),
    enabled: Boolean(batch.data?.cropType),
    refetchInterval: 15_000,
  });
  const prediction = useQuery({
    queryKey: ["prediction", batch.data?.latestPredictionId],
    queryFn: () => api.prediction(batch.data!.latestPredictionId!),
    enabled: Boolean(batch.data?.latestPredictionId),
    refetchInterval: 15_000,
  });
  const observation = useMutation({
    mutationFn: () => api.submitObservation({
      cropBatchId,
      observedAt: new Date().toISOString(),
      cropStage: stage,
      estimatedQuantity: { value: quantity, unit: "kg" },
      notes: notes || undefined,
      provenance: "OBSERVED",
      intakeId: intakeId ?? undefined,
    }),
    onSuccess: () => {
      setMessage("Crop update saved. Harvest created one refreshed forecast and a coordinator verification task.");
      setIntakeId(null);
      setDraftNotice(null);
      void queryClient.invalidateQueries({ queryKey: ["crop-batch", cropBatchId] });
    },
  });
  const intake = useMutation({
    mutationFn: () => api.createObservationIntake({
      cropBatchId,
      observedAt: new Date().toISOString(),
      sourceType: "TEXT",
      sourceText: description,
      provenance: "OBSERVED",
    }),
    onSuccess: (result) => {
      if (result.draft.suggestedCropStage) setStage(result.draft.suggestedCropStage);
      if (result.draft.suggestedEstimatedQuantity) setQuantity(result.draft.suggestedEstimatedQuantity.value);
      if (result.draft.suggestedNotes) setNotes(result.draft.suggestedNotes);
      setIntakeId(result.intakeId);
      const confidence = Math.round(result.draft.confidence * 100);
      setDraftNotice(`Draft prepared with ${confidence}% extraction confidence.${result.draft.warnings.length ? ` Review: ${result.draft.warnings.join(" ")}` : " Review every field before saving."}`);
      setMessage(null);
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
  const standard = standards.data?.items.find((item) => item.status === "PUBLISHED");

  return (
    <>
      <Link className="back-link" href={actor?.role === "COORDINATOR" ? "/coordinator" : "/farmer"}><ArrowLeft size={16} />Back to crops</Link>
      <PageHeader eyebrow="Crop batch" title={batch.data.cropType} description={`${batch.data.availableToPromise.value} kg can currently be promised without overcommitting.`} actions={<Badge>{batch.data.status}</Badge>} />
      <div className="grid two-column">
        <div data-tour="crop-outlook"><Card>
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
              <div className="split"><span>Evidence</span><strong>{titleCase(prediction.data.provenance)}</strong></div>
              <div className="split"><span>Forecast updated</span><strong>{formatDate(prediction.data.generatedAt)}</strong></div>
              <div className="split"><span>Verification</span><Badge>{batch.data.verificationStatus ?? "UNVERIFIED"}</Badge></div>
              {prediction.data.warnings.length > 0 && <div className="notice"><strong>Please check</strong>{prediction.data.warnings.join("; ")}</div>}
              {canEdit && <button className="button button-secondary" disabled={refresh.isPending} onClick={() => refresh.mutate()}><RefreshCw size={16} />Refresh forecast</button>}
            </div>
          )}
        </Card></div>
        {canEdit ? (
          <div data-tour="crop-update"><Card>
            <SectionTitle title="Share a crop update" detail="Takes less than a minute" />
            <div className="form-grid agent-draft">
              <div className="field field-full"><label htmlFor="description">Describe your update</label><textarea id="description" rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="For example: About 20 kg of cucumbers are ready, but some have rain damage." /></div>
              <button type="button" className="button button-secondary field-full" disabled={intake.isPending || !description.trim()} onClick={() => intake.mutate()}><Sparkles size={16} />{intake.isPending ? "Preparing draft..." : "Prepare editable draft"}</button>
              <p className="field-full muted-copy">Harvest only fills the form below. Nothing is saved until you review it and select Save crop update.</p>
              {draftNotice && <div className="notice field-full"><strong>Human review required</strong>{draftNotice}</div>}
            </div>
            <form className="form-grid" onSubmit={(event: FormEvent) => { event.preventDefault(); observation.mutate(); }}>
              <div className="field"><label htmlFor="stage">Crop stage</label><select id="stage" value={stage} onChange={(event) => setStage(event.target.value)}><option>GROWING</option><option>FLOWERING</option><option>FRUITING</option><option>HARVEST_READY</option><option>HARVESTED</option></select></div>
              <div className="field"><label htmlFor="estimate">Estimated crop (kg)</label><input id="estimate" type="number" min="0" step="0.5" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></div>
              <div className="field field-full"><label htmlFor="notes">What have you noticed?</label><textarea id="notes" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="For example: heavy rain, pest damage, or good growth" /></div>
              <button className="button field-full" disabled={observation.isPending}><Save size={16} />{observation.isPending ? "Saving..." : "Save crop update"}</button>
            </form>
          </Card></div>
        ) : (
          <Card><SectionTitle title="Information status" detail="Coordinator view" /><div className="info-list"><div><CalendarDays /><span><strong>Latest observation</strong><small>{batch.data.latestObservationId ? "Recorded" : "Missing"}</small></span></div><div><RefreshCw /><span><strong>Forecast</strong><small>{batch.data.latestPredictionId ? "Available" : "Missing"}</small></span></div></div></Card>
        )}
      </div>
      {canEdit && (
        <>
          <div className="section-gap">
            {standards.error ? <ErrorState error={standards.error} /> : !standards.data ? <LoadingState label="Loading buyer expectations..." /> : standard ? <CropStandardCard standard={standard} /> : (
              <Card><SectionTitle title="What buyers expect" detail={batch.data.cropType} /><p>No published buyer standard is available for this crop yet.</p></Card>
            )}
          </div>
          <div className="section-gap" data-tour="crop-listing"><Card>
            <SectionTitle title="Offer produce to buyers" detail={`Up to ${batch.data.availableToPromise.value} kg safe to list`} />
            <form className="form-grid four-fields" onSubmit={(event: FormEvent) => { event.preventDefault(); listing.mutate(); }}>
              <div className="field"><label>Quantity (kg)</label><input type="number" min="0.1" max={batch.data.availableToPromise.value} step="0.1" value={listingQuantity} onChange={(event) => setListingQuantity(Number(event.target.value))} /></div>
              <div className="field"><label>Price per kg (EC$)</label><input type="number" min="0" step="0.25" value={price} onChange={(event) => setPrice(Number(event.target.value))} /></div>
              <div className="field"><label>Available from</label><input type="date" value={availableFrom} onChange={(event) => setAvailableFrom(event.target.value)} /></div>
              <div className="field"><label>Available until</label><input type="date" value={availableUntil} onChange={(event) => setAvailableUntil(event.target.value)} /></div>
              <button className="button field-full" disabled={listing.isPending || listingQuantity > batch.data.availableToPromise.value}><Store size={16} />{listing.isPending ? "Publishing..." : "List in marketplace"}</button>
            </form>
          </Card></div>
        </>
      )}
      {(message || intake.error || observation.error || refresh.error || listing.error) && <p className={(intake.error || observation.error || refresh.error || listing.error) ? "form-error" : "form-success"}>{message ?? intake.error?.message ?? observation.error?.message ?? refresh.error?.message ?? listing.error?.message}</p>}
    </>
  );
}
