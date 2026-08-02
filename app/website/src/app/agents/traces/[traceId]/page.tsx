"use client";

import { useQuery } from "@tanstack/react-query";
import { BrainCircuit, CheckCircle2, FileSearch, ShieldCheck } from "lucide-react";
import { useParams } from "next/navigation";

import { useSession } from "@/components/providers";
import { Badge, Card, ErrorState, LoadingState, Metric, PageHeader, SectionTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { compactId, formatDate, titleCase } from "@/lib/format";

export default function TracePage() {
  const { traceId } = useParams<{ traceId: string }>();
  const { ready } = useSession();
  const trace = useQuery({ queryKey: ["trace", traceId], queryFn: () => api.trace(traceId), enabled: ready });
  if (trace.error) return <ErrorState error={trace.error} />;
  if (!trace.data) return <LoadingState label="Loading safe decision trace…" />;
  const confidence = trace.data.steps.find((step) => step.confidence !== undefined)?.confidence;
  return <>
    <PageHeader eyebrow={`Trace ${compactId(traceId)}`} title="Decision trace" description="A concise audit of evidence, tools, recommendations, approvals and state changes. Private chain-of-thought is never recorded or displayed." actions={<Badge>{trace.data.status}</Badge>} />
    <div className="grid metrics-grid">
      <Metric label="Subject" value={titleCase(trace.data.subjectType)} detail={compactId(trace.data.subjectId)} icon={FileSearch}/>
      <Metric label="Steps" value={trace.data.steps.length} detail="Immutable audit entries" icon={BrainCircuit} tone="purple"/>
      <Metric label="Confidence" value={confidence === undefined ? "—" : `${Math.round(confidence*100)}%`} detail="For the recorded recommendation" icon={ShieldCheck} tone="amber"/>
      <Metric label="Human control" value={trace.data.steps.some((step) => step.kind === "APPROVAL") ? "Recorded" : "Pending"} detail="Commitments remain human-controlled" icon={CheckCircle2} tone="green"/>
    </div>
    <div className="grid two-column" style={{marginTop:18}}><Card><SectionTitle title="Safe summary" detail="No hidden reasoning"/><p style={{lineHeight:1.7}}>{trace.data.summary}</p><p className="form-message">Only decision-relevant evidence and outcomes are exposed. Internal reasoning tokens are neither stored nor returned.</p></Card><Card><SectionTitle title="Trace identity"/><div className="stack"><div className="split"><span className="muted small">Trace</span><code>{trace.data.traceId}</code></div><div className="split"><span className="muted small">Subject</span><code>{trace.data.subjectId}</code></div><div className="split"><span className="muted small">Status</span><Badge>{trace.data.status}</Badge></div></div></Card></div>
    <div style={{marginTop:18}}><Card><SectionTitle title="Evidence and decisions" detail="Chronological"/><div className="order-timeline">{trace.data.steps.map((step, index) => <div className="timeline-step" key={`${step.recordedAt}-${index}`}><span className="timeline-dot">{index+1}</span><div><Badge>{step.kind}</Badge><strong style={{marginTop:6}}>{step.summary}</strong><small>{formatDate(step.recordedAt)}{step.confidence !== undefined ? ` · ${Math.round(step.confidence*100)}% confidence` : ""}</small></div></div>)}</div></Card></div>
  </>;
}
