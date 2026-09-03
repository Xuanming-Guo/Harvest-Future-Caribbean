"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Check, CheckCircle2, ClipboardCheck, Sprout, Wallet, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { ApprovalList } from "@/components/approval-list";
import { OfflineHint, useOnlineStatus } from "@/components/offline";
import { Badge, Card, EmptyState, ErrorState, LoadingState, Metric, PageHeader, SectionTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate, titleCase } from "@/lib/format";

export default function CoordinatorHome() {
  const queryClient = useQueryClient();
  const online = useOnlineStatus();
  const [selectedExceptionId, setSelectedExceptionId] = useState<string>();
  const approvals = useQuery({ queryKey: ["approvals", "PENDING"], queryFn: () => api.approvals("PENDING"), refetchInterval: 5_000 });
  const exceptions = useQuery({ queryKey: ["exceptions"], queryFn: api.exceptions, refetchInterval: 5_000 });
  const batches = useQuery({ queryKey: ["crop-batches"], queryFn: api.cropBatches, refetchInterval: 15_000 });
  const verification = useQuery({ queryKey: ["verification-tasks", "OPEN"], queryFn: () => api.verificationTasks("OPEN"), refetchInterval: 5_000 });
  const orders = useQuery({ queryKey: ["orders"], queryFn: api.orders, refetchInterval: 15_000 });
  const exceptionDetail = useQuery({ queryKey: ["exception", selectedExceptionId], queryFn: () => api.exception(selectedExceptionId!), enabled: Boolean(selectedExceptionId), refetchInterval: 5_000 });
  const decideVerification = useMutation({
    mutationFn: ({ taskId, decision }: { taskId: string; decision: "VERIFY" | "REQUEST_CHANGES" }) => api.decideVerificationTask(taskId, decision),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["verification-tasks"] }),
  });
  if (approvals.error || exceptions.error || batches.error || verification.error) return <ErrorState error={approvals.error ?? exceptions.error ?? batches.error ?? verification.error} />;
  if (!approvals.data || !exceptions.data || !batches.data || !verification.data) return <LoadingState label="Loading coordination tasks..." />;
  const openExceptions = exceptions.data.items.filter((item) => item.status !== "RESOLVED");
  const overduePayments = (orders.data?.items ?? []).filter((item) => item.payment?.status === "OVERDUE").length;

  return (
    <>
      <div data-tour="coordinator-home"><PageHeader eyebrow="Coordination tasks" title="Help the network keep moving" description="Only the missing information, approval decisions and active exceptions that need human attention." /></div>
      <div className="metric-grid">
        <Metric label="Decisions waiting" value={approvals.data.items.length} detail="Assigned to you" icon={ClipboardCheck} />
        <Metric label="Verification queue" value={verification.data.items.length} detail="Crop updates to check" icon={Sprout} tone="amber" />
        <Metric label="Open exceptions" value={openExceptions.length} detail="Recovery needed" icon={AlertTriangle} tone="red" />
        <Metric label="Overdue payments" value={overduePayments} detail="Past agreed terms" icon={Wallet} tone={overduePayments ? "red" : "green"} />
      </div>
      <p className="payment-disclaimer">Harvest tracks payment terms and status. It does not move money, hold funds, or verify a transfer.</p>
      <div className="dashboard-grid">
        <div data-tour="coordinator-approvals"><ApprovalList /></div>
        <Card data-tour="coordinator-verification">
          <SectionTitle title="Verification queue" detail={`${verification.data.items.length} open`} />
          {!verification.data.items.length ? <EmptyState title="Crop updates are verified" detail="New farmer observations will appear here automatically." /> : <div className="task-list">{verification.data.items.map((task) => (
            <article className="task-row" key={task.taskId}><div><Badge tone="pending">Verification</Badge><h3>{task.summary}</h3><Link className="text-link" href={`/crops/${task.cropBatchId}`}>Review crop evidence <ArrowRight size={15} /></Link></div><div className="inline-actions"><button className="button button-danger" disabled={decideVerification.isPending} aria-disabled={!online || undefined} onClick={() => { if (online) decideVerification.mutate({ taskId: task.taskId, decision: "REQUEST_CHANGES" }); }}><X size={16} />Request changes</button><button className="button" disabled={decideVerification.isPending} aria-disabled={!online || undefined} onClick={() => { if (online) decideVerification.mutate({ taskId: task.taskId, decision: "VERIFY" }); }}><Check size={16} />Verify</button></div></article>
          ))}</div>}
          {!online && <OfflineHint>A verification decision changes what buyers can rely on, so it is never queued. Reconnect to decide.</OfflineHint>}
        </Card>
      </div>
      <Card className="section-gap" data-tour="coordinator-exceptions">
        <SectionTitle title="Active exceptions" detail={`${openExceptions.length} open`} />
        {!openExceptions.length ? <EmptyState title="No active exceptions" detail="Delivery and supply problems will appear here." /> : <div className="exception-list">{openExceptions.map((exception) => (
          <button type="button" className="exception-row" onClick={() => setSelectedExceptionId(exception.exceptionId)} key={exception.exceptionId}><span className="exception-icon"><AlertTriangle /></span><div><Badge tone={exception.severity.toLowerCase()}>{exception.severity}</Badge><h3>{titleCase(exception.exceptionType)}</h3><p>{exception.description}</p><small>Reported {formatDate(exception.reportedAt)}</small></div><Badge>{exception.status}</Badge></button>
        ))}</div>}
        {exceptionDetail.data?.recoveryProposal && <div className="notice section-gap"><strong>{titleCase(exceptionDetail.data.recoveryProposal.action)} proposal</strong><span>{exceptionDetail.data.recoveryProposal.summary}</span><small>{exceptionDetail.data.approvalSummary?.pending ?? 0} approval waiting</small></div>}
      </Card>
      <Card className="section-gap">
        <SectionTitle title="Farm verification" detail="Permitted farms" />
        <div className="verification-grid">{batches.data.items.map((batch, index) => <Link href={`/crops/${batch.cropBatchId}`} key={batch.cropBatchId} data-tour={index === 0 ? "coordinator-crop-link" : undefined}><CheckCircle2 /><span><strong>{titleCase(batch.cropType)}</strong><small>{batch.availableToPromise.value} kg safe to promise</small></span><ArrowRight size={16} /></Link>)}</div>
      </Card>
    </>
  );
}
