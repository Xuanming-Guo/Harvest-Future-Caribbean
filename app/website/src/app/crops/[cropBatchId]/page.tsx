"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarDays, RefreshCw, Save, Sparkles, Store } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import { DeviceUpdateList, OfflineHint, useOnlineStatus, useOutbox } from "@/components/offline";
import { useSession } from "@/components/providers";
import { Badge, Card, ErrorState, LoadingState, PageHeader, SectionTitle } from "@/components/ui";
import { ApiProblem, api } from "@/lib/api";
import { dateInputOffset, formatDate, formatPercent, titleCase } from "@/lib/format";
import {
  clearCropDraft,
  enqueueOutboxItem,
  readCropDraft,
  removeOutboxItem,
  writeCropDraft,
  type ListingBody,
  type ObservationBody,
  type OutboxItem,
} from "@/lib/outbox";

/** A queued write is a success for the farmer, so both paths share one result. */
type SubmitResult = { queued: boolean };

export default function CropDetailPage() {
  const { cropBatchId } = useParams<{ cropBatchId: string }>();
  const { actor } = useSession();
  const online = useOnlineStatus();
  const queryClient = useQueryClient();
  const [stage, setStage] = useState("HARVEST_READY");
  const [quantity, setQuantity] = useState(20);
  const [notes, setNotes] = useState("");
  const [description, setDescription] = useState("");
  const [intakeId, setIntakeId] = useState<string | null>(null);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);
  const [listingQuantity, setListingQuantity] = useState(10);
  const [price, setPrice] = useState(7.5);
  const [availableFrom, setAvailableFrom] = useState(() => dateInputOffset(1));
  const [availableUntil, setAvailableUntil] = useState(() => dateInputOffset(6));
  const [message, setMessage] = useState<string | null>(null);

  const batch = useQuery({ queryKey: ["crop-batch", cropBatchId], queryFn: () => api.cropBatch(cropBatchId), refetchInterval: 15_000 });
  const prediction = useQuery({
    queryKey: ["prediction", batch.data?.latestPredictionId],
    queryFn: () => api.prediction(batch.data!.latestPredictionId!),
    enabled: Boolean(batch.data?.latestPredictionId),
    refetchInterval: 15_000,
  });
  const canEdit = actor?.role === "FARMER";
  const queued = useOutbox().filter((item) => item.cropBatchId === cropBatchId);

  // An unsent update belongs to the farmer, not to this page view: restore it on
  // arrival and keep it written down until it is queued or sent.
  useEffect(() => {
    if (!canEdit || !actor) return;
    const draft = readCropDraft(actor, cropBatchId);
    if (draft) {
      setStage(draft.stage);
      setQuantity(draft.quantity);
      setNotes(draft.notes);
      setDescription(draft.description);
    }
    setDraftRestored(true);
  }, [actor, canEdit, cropBatchId]);

  useEffect(() => {
    if (!draftRestored || !canEdit) return;
    writeCropDraft(actor, cropBatchId, { stage, quantity, notes, description });
  }, [actor, canEdit, cropBatchId, description, draftRestored, notes, quantity, stage]);

  function observationBody(): ObservationBody {
    return {
      cropBatchId,
      observedAt: new Date().toISOString(),
      cropStage: stage,
      estimatedQuantity: { value: quantity, unit: "kg" },
      notes: notes || undefined,
      provenance: "OBSERVED",
      intakeId: intakeId ?? undefined,
    };
  }

  function listingBody(): ListingBody {
    return {
      cropBatchId,
      quantity: { value: listingQuantity, unit: "kg" },
      unitPrice: { amount: price, currency: "XCD" },
      availableFrom,
      availableUntil,
    };
  }

  function queueWrite(kind: "observation" | "listing", body: ObservationBody | ListingBody): SubmitResult {
    const item = enqueueOutboxItem(actor, { kind, cropBatchId, body, baseObservationId: batch.data?.latestObservationId });
    if (!item) throw new Error("This update could not be saved on this device.");
    return { queued: true };
  }

  const observation = useMutation<SubmitResult>({
    // Runs while offline on purpose: TanStack pauses mutations by default until
    // the browser is back online, which would skip the on-device queue entirely.
    networkMode: "always",
    mutationFn: async () => {
      const body = observationBody();
      if (!online) return queueWrite("observation", body);
      try {
        await api.submitObservation(body);
        return { queued: false };
      } catch (error) {
        // A refused request is a real answer; a dropped one is a lost connection.
        if (error instanceof ApiProblem) throw error;
        return queueWrite("observation", body);
      }
    },
    onSuccess: (result) => {
      setMessage(result.queued
        ? "Saved on this device. Harvest sends this crop update on its own once you are back online."
        : "Crop update saved. Harvest created one refreshed forecast and a coordinator verification task.");
      setIntakeId(null);
      setDraftNotice(null);
      setNotes("");
      setDescription("");
      clearCropDraft(actor, cropBatchId);
      if (!result.queued) void queryClient.invalidateQueries({ queryKey: ["crop-batch", cropBatchId] });
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
  const listing = useMutation<SubmitResult>({
    // Runs while offline on purpose: TanStack pauses mutations by default until
    // the browser is back online, which would skip the on-device queue entirely.
    networkMode: "always",
    mutationFn: async () => {
      const body = listingBody();
      if (!online) return queueWrite("listing", body);
      try {
        await api.createListing(body);
        return { queued: false };
      } catch (error) {
        if (error instanceof ApiProblem) throw error;
        return queueWrite("listing", body);
      }
    },
    onSuccess: (result) => setMessage(result.queued
      ? "Saved on this device. Harvest publishes this offer once you are back online and the quantity is still safe to promise."
      : "Produce is now listed in the marketplace."),
  });

  /** Puts a conflicting queued write back in the form for the farmer to check. */
  function reviewQueued(item: OutboxItem) {
    if (item.kind === "observation") {
      const body = item.body as ObservationBody;
      setStage(body.cropStage);
      if (body.estimatedQuantity) setQuantity(body.estimatedQuantity.value);
      setNotes(body.notes ?? "");
      setMessage("This update is back in the form below. Check it against the current crop details, then save it again.");
    } else {
      const body = item.body as ListingBody;
      setListingQuantity(body.quantity.value);
      setPrice(body.unitPrice.amount);
      setAvailableFrom(body.availableFrom);
      setAvailableUntil(body.availableUntil);
      setMessage("This offer is back in the form below. Check the quantity against what is still safe to promise, then list it again.");
    }
    removeOutboxItem(actor, item.id);
  }

  if (batch.error) return <ErrorState error={batch.error} />;
  if (!batch.data) return <LoadingState label="Loading crop details..." />;

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
              {canEdit && (
                <>
                  <button
                    className="button button-secondary"
                    disabled={refresh.isPending}
                    aria-disabled={!online || undefined}
                    onClick={() => { if (online) refresh.mutate(); }}
                  >
                    <RefreshCw size={16} />Refresh forecast
                  </button>
                  {!online && <OfflineHint>A new forecast is calculated by Harvest, so it needs a connection.</OfflineHint>}
                </>
              )}
            </div>
          )}
        </Card></div>
        {canEdit ? (
          <div data-tour="crop-update"><Card>
            <SectionTitle title="Share a crop update" detail="Takes less than a minute" />
            <div className="form-grid agent-draft">
              <div className="field field-full"><label htmlFor="description">Describe your update</label><textarea id="description" rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="For example: About 20 kg of cucumbers are ready, but some have rain damage." /></div>
              <button
                type="button"
                className="button button-secondary field-full"
                disabled={intake.isPending || !description.trim()}
                aria-disabled={!online || undefined}
                onClick={() => { if (online) intake.mutate(); }}
              >
                <Sparkles size={16} />{intake.isPending ? "Preparing draft..." : "Prepare editable draft"}
              </button>
              {!online && <div className="field-full"><OfflineHint>Harvest fills this draft for you, so it needs a connection. You can still fill the form yourself.</OfflineHint></div>}
              <p className="field-full muted-copy">Harvest only fills the form below. Nothing is saved until you review it and select Save crop update.</p>
              {draftNotice && <div className="notice field-full"><strong>Human review required</strong>{draftNotice}</div>}
            </div>
            <form className="form-grid" onSubmit={(event: FormEvent) => { event.preventDefault(); observation.mutate(); }}>
              <div className="field"><label htmlFor="stage">Crop stage</label><select id="stage" value={stage} onChange={(event) => setStage(event.target.value)}><option>GROWING</option><option>FLOWERING</option><option>FRUITING</option><option>HARVEST_READY</option><option>HARVESTED</option></select></div>
              <div className="field"><label htmlFor="estimate">Estimated crop (kg)</label><input id="estimate" type="number" min="0" step="0.5" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></div>
              <div className="field field-full"><label htmlFor="notes">What have you noticed?</label><textarea id="notes" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="For example: heavy rain, pest damage, or good growth" /></div>
              {!online && <div className="field-full"><OfflineHint>No connection. This update is kept on your device and sent on its own when you are back online.</OfflineHint></div>}
              <button className="button field-full" disabled={observation.isPending}><Save size={16} />{observation.isPending ? "Saving..." : "Save crop update"}</button>
            </form>
          </Card></div>
        ) : (
          <Card><SectionTitle title="Information status" detail="Coordinator view" /><div className="info-list"><div><CalendarDays /><span><strong>Latest observation</strong><small>{batch.data.latestObservationId ? "Recorded" : "Missing"}</small></span></div><div><RefreshCw /><span><strong>Forecast</strong><small>{batch.data.latestPredictionId ? "Available" : "Missing"}</small></span></div></div></Card>
        )}
      </div>
      {canEdit && queued.length > 0 && (
        <div className="section-gap" data-tour="crop-device-updates"><Card>
          <SectionTitle title="Updates on this device" detail={`${queued.length} on this device`} />
          <DeviceUpdateList cropBatchId={cropBatchId} onReview={reviewQueued} />
        </Card></div>
      )}
      {canEdit && (
        <div className="section-gap" data-tour="crop-listing"><Card>
          <SectionTitle title="Offer produce to buyers" detail={`Up to ${batch.data.availableToPromise.value} kg safe to list`} />
          <form className="form-grid four-fields" onSubmit={(event: FormEvent) => { event.preventDefault(); listing.mutate(); }}>
            <div className="field"><label>Quantity (kg)</label><input type="number" min="0.1" max={batch.data.availableToPromise.value} step="0.1" value={listingQuantity} onChange={(event) => setListingQuantity(Number(event.target.value))} /></div>
            <div className="field"><label>Price per kg (EC$)</label><input type="number" min="0" step="0.25" value={price} onChange={(event) => setPrice(Number(event.target.value))} /></div>
            <div className="field"><label>Available from</label><input type="date" value={availableFrom} onChange={(event) => setAvailableFrom(event.target.value)} /></div>
            <div className="field"><label>Available until</label><input type="date" value={availableUntil} onChange={(event) => setAvailableUntil(event.target.value)} /></div>
            {!online && <div className="field-full"><OfflineHint>No connection. This offer is kept on your device, and Harvest checks the safe quantity again before publishing it.</OfflineHint></div>}
            <button className="button field-full" disabled={listing.isPending || listingQuantity > batch.data.availableToPromise.value}><Store size={16} />{listing.isPending ? "Publishing..." : "List in marketplace"}</button>
          </form>
        </Card></div>
      )}
      {(message || intake.error || observation.error || refresh.error || listing.error) && <p className={(intake.error || observation.error || refresh.error || listing.error) ? "form-error" : "form-success"}>{message ?? intake.error?.message ?? observation.error?.message ?? refresh.error?.message ?? listing.error?.message}</p>}
    </>
  );
}
