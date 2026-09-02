"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";

import { api } from "@/lib/api";
import { formatDate, titleCase } from "@/lib/format";
import { OfflineHint, useOnlineStatus } from "./offline";
import { Badge, Card, EmptyState, ErrorState, LoadingState, SectionTitle } from "./ui";

/** `embedded` drops the card shell when the caller already provides one. */
export function ApprovalList({ compact = false, embedded = false }: { compact?: boolean; embedded?: boolean }) {
  const queryClient = useQueryClient();
  const online = useOnlineStatus();
  const approvals = useQuery({ queryKey: ["approvals", "PENDING"], queryFn: () => api.approvals("PENDING"), refetchInterval: 5_000 });
  const decision = useMutation({
    mutationFn: ({ id, value }: { id: string; value: "APPROVE" | "REJECT" }) => api.decideApproval(id, value),
    onSuccess: () => void queryClient.invalidateQueries(),
  });

  if (approvals.error) return <ErrorState error={approvals.error} />;
  if (!approvals.data) return <LoadingState label="Loading requests..." />;
  if (!approvals.data.items.length) {
    return <EmptyState title="Nothing waiting for you" detail="New supply or recovery requests will appear here." />;
  }

  const body = (
    <>
      <div className="task-list">
        {approvals.data.items.map((approval) => (
          <article className="task-row approval-row" key={approval.approvalId}>
            <div>
              <Badge tone="pending">Decision needed</Badge>
              <h3>{approval.context?.title ?? titleCase(approval.subjectType)}</h3>
              <p>{approval.context?.quantity ? `Confirm ${approval.context.quantity.value} kg${approval.context.cropType ? ` of ${titleCase(approval.context.cropType)}` : ""}${approval.context.neededBy ? ` for delivery by ${formatDate(approval.context.neededBy)}` : ""}.` : approval.context?.summary ?? (approval.subjectType === "ALLOCATION" ? "Confirm that you agree with this order allocation." : "Confirm the proposed recovery action.")}</p>
              {!compact && <small>Requested {formatDate(approval.requestedAt)}</small>}
            </div>
            <div className="inline-actions">
              <button className="button button-danger" disabled={decision.isPending} aria-disabled={!online || undefined} onClick={() => { if (online) decision.mutate({ id: approval.approvalId, value: "REJECT" }); }}><X size={16} />Decline</button>
              <button className="button" disabled={decision.isPending} aria-disabled={!online || undefined} onClick={() => { if (online) decision.mutate({ id: approval.approvalId, value: "APPROVE" }); }}><Check size={16} />Approve</button>
            </div>
          </article>
        ))}
      </div>
      {!online && <OfflineHint>A commitment decision is never queued on a device. Reconnect to approve or decline.</OfflineHint>}
      {decision.error && <p className="form-error">{decision.error.message}</p>}
    </>
  );

  if (embedded) return body;
  return (
    <Card>
      <SectionTitle title="Needs your decision" detail={`${approvals.data.items.length} pending`} />
      {body}
    </Card>
  );
}
