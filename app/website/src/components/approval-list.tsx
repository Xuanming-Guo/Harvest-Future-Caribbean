"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { useState } from "react";

import { api, type DecisionReasonCode } from "@/lib/api";
import { formatDate, titleCase } from "@/lib/format";
import { DecisionReasonFields } from "./decision-reason";
import { OfflineHint, useOnlineStatus } from "./offline";
import { Badge, Card, EmptyState, ErrorState, LoadingState, SectionTitle } from "./ui";

export function ApprovalList({ compact = false }: { compact?: boolean }) {
  const queryClient = useQueryClient();
  const online = useOnlineStatus();
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [reasonCode, setReasonCode] = useState<DecisionReasonCode | null>(null);
  const [nextAction, setNextAction] = useState("");
  const approvals = useQuery({ queryKey: ["approvals", "PENDING"], queryFn: () => api.approvals("PENDING"), refetchInterval: 5_000 });
  const decision = useMutation({
    mutationFn: ({ id, value }: { id: string; value: "APPROVE" | "REJECT" }) =>
      value === "APPROVE"
        ? api.decideApproval(id, value)
        : api.decideApproval(id, value, undefined, reasonCode ?? undefined, nextAction.trim()),
    onSuccess: () => {
      closeDecline();
      void queryClient.invalidateQueries();
    },
  });

  function closeDecline() {
    setDecliningId(null);
    setReasonCode(null);
    setNextAction("");
  }

  if (approvals.error) return <ErrorState error={approvals.error} />;
  if (!approvals.data) return <LoadingState label="Loading requests..." />;
  if (!approvals.data.items.length) {
    return <EmptyState title="Nothing waiting for you" detail="New supply or recovery requests will appear here." />;
  }

  // The Product API refuses a decline without a reason and a next action.
  const declineBlocked = !reasonCode || !nextAction.trim();

  return (
    <Card>
      <SectionTitle title="Needs your decision" detail={`${approvals.data.items.length} pending`} />
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
              <button className="button button-danger" disabled={decision.isPending} aria-disabled={!online || undefined} onClick={() => { if (!online) return; if (decliningId === approval.approvalId) closeDecline(); else setDecliningId(approval.approvalId); }}><X size={16} />Decline</button>
              <button className="button" disabled={decision.isPending} aria-disabled={!online || undefined} onClick={() => { if (online) decision.mutate({ id: approval.approvalId, value: "APPROVE" }); }}><Check size={16} />Approve</button>
            </div>
            {decliningId === approval.approvalId && (
              <div className="decline-panel form-grid">
                <p className="field-full muted-copy">Declining stops this commitment. Say what was wrong and what should happen next so the other participants can act on it.</p>
                <DecisionReasonFields
                  disabled={decision.isPending}
                  idPrefix={`decline-${approval.approvalId}`}
                  nextAction={nextAction}
                  nextActionLabel="What should happen next?"
                  onNextAction={setNextAction}
                  onReasonCode={setReasonCode}
                  placeholder="For example: list only the quantity you can pick this week"
                  reasonCode={reasonCode}
                  reasonLabel="Why are you declining?"
                />
                <div className="field-full inline-actions decline-actions">
                  <button className="button button-quiet" disabled={decision.isPending} onClick={closeDecline} type="button">Cancel</button>
                  <button className="button button-danger" disabled={decision.isPending || declineBlocked} onClick={() => decision.mutate({ id: approval.approvalId, value: "REJECT" })} type="button"><X size={16} />Confirm decline</button>
                </div>
                {declineBlocked && <p className="form-error field-full">Choose a reason and say what should happen next before declining.</p>}
              </div>
            )}
          </article>
        ))}
      </div>
      {!online && <OfflineHint>A commitment decision is never queued on a device. Reconnect to approve or decline.</OfflineHint>}
      {decision.error && <p className="form-error">{decision.error.message}</p>}
    </Card>
  );
}
