"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardCheck, Sprout } from "lucide-react";
import Link from "next/link";

import { ApprovalList } from "@/components/approval-list";
import { Badge, Card, EmptyState, ErrorState, LoadingState, Metric, PageHeader, SectionTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate, titleCase } from "@/lib/format";

export default function CoordinatorHome() {
  const approvals = useQuery({ queryKey: ["approvals", "PENDING"], queryFn: () => api.approvals("PENDING") });
  const exceptions = useQuery({ queryKey: ["exceptions"], queryFn: api.exceptions });
  const batches = useQuery({ queryKey: ["crop-batches"], queryFn: api.cropBatches });
  if (approvals.error || exceptions.error || batches.error) return <ErrorState error={approvals.error ?? exceptions.error ?? batches.error} />;
  if (!approvals.data || !exceptions.data || !batches.data) return <LoadingState label="Loading coordination tasks..." />;
  const missing = batches.data.items.filter((batch) => !batch.latestObservationId || !batch.latestPredictionId);
  const openExceptions = exceptions.data.items.filter((item) => item.status !== "RESOLVED");

  return (
    <>
      <PageHeader eyebrow="Coordination tasks" title="Help the network keep moving" description="Only the missing information, approval decisions and active exceptions that need human attention." />
      <div className="metric-grid">
        <Metric label="Decisions waiting" value={approvals.data.items.length} detail="Assigned to you" icon={ClipboardCheck} />
        <Metric label="Missing information" value={missing.length} detail="Crop records to verify" icon={Sprout} tone="amber" />
        <Metric label="Open exceptions" value={openExceptions.length} detail="Recovery needed" icon={AlertTriangle} tone="red" />
      </div>
      <div className="dashboard-grid">
        <ApprovalList />
        <Card>
          <SectionTitle title="Missing crop information" detail={`${missing.length} records`} />
          {!missing.length ? <EmptyState title="Crop information is complete" detail="No farmer follow-up is needed right now." /> : <div className="task-list">{missing.map((batch) => (
            <Link href={`/crops/${batch.cropBatchId}`} className="task-row" key={batch.cropBatchId}><div><Badge tone="pending">Follow up</Badge><h3>{titleCase(batch.cropType)}</h3><p>{!batch.latestObservationId ? "Latest farmer observation is missing." : "Forecast needs to be generated."}</p></div><ArrowRight size={18} /></Link>
          ))}</div>}
        </Card>
      </div>
      <Card className="section-gap">
        <SectionTitle title="Active exceptions" detail={`${openExceptions.length} open`} />
        {!openExceptions.length ? <EmptyState title="No active exceptions" detail="Delivery and supply problems will appear here." /> : <div className="exception-list">{openExceptions.map((exception) => (
          <article className="exception-row" key={exception.exceptionId}><span className="exception-icon"><AlertTriangle /></span><div><Badge tone={exception.severity.toLowerCase()}>{exception.severity}</Badge><h3>{titleCase(exception.exceptionType)}</h3><p>{exception.description}</p><small>Reported {formatDate(exception.reportedAt)}</small></div><Badge>{exception.status}</Badge></article>
        ))}</div>}
      </Card>
      <Card className="section-gap">
        <SectionTitle title="Farm verification" detail="Permitted farms" />
        <div className="verification-grid">{batches.data.items.map((batch) => <Link href={`/crops/${batch.cropBatchId}`} key={batch.cropBatchId}><CheckCircle2 /><span><strong>{titleCase(batch.cropType)}</strong><small>{batch.availableToPromise.value} kg safe to promise</small></span><ArrowRight size={16} /></Link>)}</div>
      </Card>
    </>
  );
}
