"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, BrainCircuit, CalendarDays, Gauge } from "lucide-react";
import { useState } from "react";

import { useSession } from "@/components/providers";
import { Badge, Card, ErrorState, LoadingState, Metric, PageHeader, SectionTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate, formatPercent } from "@/lib/format";

export default function ModelLabPage() {
  const { ready } = useSession();
  const [selectedId, setSelectedId] = useState("");
  const batches = useQuery({ queryKey: ["batches"], queryFn: api.cropBatches, enabled: ready });
  const selected = batches.data?.items.find((item) => item.cropBatchId === selectedId) ?? batches.data?.items[0];
  const predictionId = selected?.latestPredictionId;
  const prediction = useQuery({ queryKey: ["prediction", predictionId], queryFn: () => api.prediction(predictionId!), enabled: ready && Boolean(predictionId) });
  const error = batches.error ?? prediction.error;
  if (error) return <ErrorState error={error} />;
  if (!batches.data || (predictionId && !prediction.data)) return <LoadingState label="Loading validated crop evidence…" />;
  if (!selected || !prediction.data) return <ErrorState error={new Error("No validated prediction is available for a visible crop batch.")} />;
  const p = prediction.data;
  const features = p.featureSnapshot as Record<string, unknown>;
  return <>
    <PageHeader eyebrow="Validated model evidence" title="Model Lab" description="Inspect the conservative prediction that informs available-to-promise. Model output is evidence; the Product API applies deterministic safety and commitment rules." actions={<select aria-label="Crop batch" value={selected.cropBatchId} onChange={(event) => setSelectedId(event.target.value)}>{batches.data.items.map((batch) => <option key={batch.cropBatchId} value={batch.cropBatchId}>{batch.cropType} · {batch.cropBatchId.slice(0,8)}</option>)}</select>} />
    <div className="grid metrics-grid">
      <Metric label="Safe ATP" value={`${selected.availableToPromise.value} kg`} detail="Product API calculation" icon={Gauge}/>
      <Metric label="Confidence" value={formatPercent(p.confidence)} detail={p.modelVersion} icon={BrainCircuit} tone="purple"/>
      <Metric label="Readiness" value={formatPercent(p.readiness)} detail="Model-predicted" icon={Gauge} tone="amber"/>
      <Metric label="Harvest window" value={formatDate(p.harvestWindow.start, false)} detail={`to ${formatDate(p.harvestWindow.end, false)}`} icon={CalendarDays} tone="blue"/>
    </div>
    <div className="grid two-column" style={{marginTop:18}}>
      <Card><SectionTitle title="Marketable yield interval" detail="Kilograms"/><div className="quantile-chart">{[["q10",p.q10MarketableYield.value],["q50",p.q50MarketableYield.value],["q90",p.q90MarketableYield.value]].map(([label,value]) => <div className="quantile" key={label}><i style={{height:`${Math.max(34,Number(value)*4)}px`}}/><strong>{value} kg</strong><span>{String(label).toUpperCase()}</span></div>)}</div><p className="form-message">Harvest commits from q10 after reservations and safety buffers—not from the optimistic maximum.</p></Card>
      <Card><SectionTitle title="Warnings and provenance" detail={formatDate(p.generatedAt)}/><div className="stack"><div className="split"><span className="muted small">Prediction</span><Badge>{p.provenance}</Badge></div>{p.warnings.map((warning) => <div className="form-message" key={warning}><AlertTriangle size={13}/> {warning}</div>)}<div className="split"><span className="muted small">Model version</span><code>{p.modelVersion}</code></div><div className="split"><span className="muted small">Interval evaluated</span><span className="small">{p.evaluation ? (p.evaluation.intervalCovered ? "Actual fell inside interval" : "Actual outside interval") : "Awaiting accepted outcome"}</span></div></div></Card>
    </div>
    <div style={{marginTop:18}}><Card><SectionTitle title="Allow-listed feature snapshot" detail="No model artefacts or hidden simulation truth"/><div className="grid three-column">{Object.entries(features).map(([key,value]) => <div className="card" style={{boxShadow:"none"}} key={key}><span className="eyebrow">{key.replaceAll(/([A-Z])/g," $1")}</span><pre style={{whiteSpace:"pre-wrap",fontSize:10,marginBottom:0}}>{typeof value === "object" ? JSON.stringify(value,null,2) : String(value)}</pre></div>)}</div></Card></div>
  </>;
}
