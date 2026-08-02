"use client";

import { useQuery } from "@tanstack/react-query";
import { Database, FileCheck2, Radio, Tags } from "lucide-react";
import Link from "next/link";

import { useLiveEvents } from "@/components/live-events";
import { useSession } from "@/components/providers";
import { Badge, Card, ErrorState, LoadingState, Metric, PageHeader, SectionTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { compactId, formatDate, titleCase } from "@/lib/format";

const provenance = [
  ["OBSERVED", "A person or instrument directly reported it."],
  ["INFERRED", "Deterministic coordination logic derived it."],
  ["SYNTHETIC", "The local counterfactual scenario generated it."],
  ["STAKEHOLDER_CALIBRATED", "Stakeholder evidence calibrated an assumption."],
  ["MODEL_PREDICTED", "A versioned model produced it."],
] as const;

export default function DataPage() {
  const { ready } = useSession();
  const batches = useQuery({ queryKey: ["batches"], queryFn: api.cropBatches, enabled: ready });
  const { events, connected } = useLiveEvents();
  if (batches.error) return <ErrorState error={batches.error} />;
  if (!batches.data) return <LoadingState label="Loading evidence registry…" />;
  const counts = Object.fromEntries(provenance.map(([kind]) => [kind, events.filter((event) => event.provenance === kind).length]));
  return <>
    <PageHeader eyebrow="Evidence registry" title="Data provenance" description="Every operational signal states where it came from. Synthetic and predicted evidence is visible and never presented as deployed real-world impact." actions={<span className={`badge ${connected ? "badge-active" : "badge-open"}`}>{connected ? "Live" : "Reconnecting"}</span>} />
    <div className="grid metrics-grid">
      <Metric label="Streamed events" value={events.length} detail="Current retained view" icon={Radio}/>
      <Metric label="Crop records" value={batches.data.items.length} detail="Role-filtered Product API records" icon={Database} tone="green"/>
      <Metric label="Provenance classes" value={provenance.length} detail="Canonical contract vocabulary" icon={Tags} tone="purple"/>
      <Metric label="Hidden-truth fields" value="0" detail="Excluded by contract" icon={FileCheck2} tone="blue"/>
    </div>
    <div className="grid two-column" style={{marginTop:18}}>
      <Card><SectionTitle title="Provenance vocabulary" detail="Shared across web, mobile and simulation"/><div className="stack">{provenance.map(([kind,detail]) => <div className="split" key={kind}><div><Badge>{kind}</Badge><p className="muted small" style={{margin:"6px 0 0"}}>{detail}</p></div><strong>{counts[kind] ?? 0}</strong></div>)}</div></Card>
      <Card><SectionTitle title="Visible crop evidence" detail="Current safe projection"/><div className="stack">{batches.data.items.map((batch) => <div className="split" key={batch.cropBatchId}><div><strong className="small">{titleCase(batch.cropType)}</strong><p className="muted small" style={{margin:"4px 0 0"}}>{compactId(batch.cropBatchId)} · ATP {batch.availableToPromise.value} kg</p></div><Badge>{batch.provenance}</Badge></div>)}</div></Card>
    </div>
    <div style={{marginTop:18}}><Card><SectionTitle title="Immutable event evidence" detail={`${events.length} replayed or live events`}/><div className="table-scroll"><table className="data-table"><thead><tr><th>Event</th><th>Entity</th><th>Provenance</th><th>Observed</th><th>Trace</th></tr></thead><tbody>{events.map((event) => <tr key={event.eventId}><td><strong>{titleCase(event.eventType)}</strong><br/><span className="muted small">{compactId(event.eventId)}</span></td><td>{compactId(event.entityId)}</td><td><Badge>{event.provenance}</Badge></td><td>{formatDate(event.simulationTime ?? event.occurredAt)}</td><td><Link className="table-link" href={`/agents/traces/${event.traceId}`}>{compactId(event.traceId)}</Link></td></tr>)}</tbody></table></div></Card></div>
  </>;
}
