"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";

import { api } from "@/lib/api";
import { formatDate, titleCase } from "@/lib/format";
import { Badge, Card, EmptyState, ErrorState, LoadingState, SectionTitle } from "./ui";

export function ApprovalList({ compact = false }: { compact?: boolean }) {
  const queryClient = useQueryClient();
  const approvals = useQuery({ queryKey: ["approvals", "PENDING"], queryFn: () => api.approvals("PENDING") });
  const decision = useMutation({
    mutationFn: ({ id, value }: { id: string; value: "APPROVE" | "REJECT" }) => api.decideApproval(id, value),
    onSuccess: () => void queryClient.invalidateQueries(),
  });

  if (approvals.error) return <ErrorState error={approvals.error} />;
  if (!approvals.data) return <LoadingState label="Loading requests..." />;
  if (!approvals.data.items.length) {
    return <EmptyState title="Nothing waiting for you" detail="New supply or recovery requests will appear here." />;
  }

  return (
    <Card>
      <SectionTitle title="Needs your decision" detail={`${approvals.data.items.length} pending`} />
      <div className="task-list">
        {approvals.data.items.map((approval) => (
          <article className="task-row" key={approval.approvalId}>
            <div>
              <Badge tone="pending">Decision needed</Badge>
              <h3>{titleCase(approval.subjectType)}</h3>
              <p>{approval.subjectType === "ALLOCATION" ? "Confirm that you agree with this order allocation." : "Confirm the proposed recovery action."}</p>
              {!compact && <small>Requested {formatDate(approval.requestedAt)}</small>}
            </div>
            <div className="inline-actions">
              <button className="button button-danger" disabled={decision.isPending} onClick={() => decision.mutate({ id: approval.approvalId, value: "REJECT" })}><X size={16} />Decline</button>
              <button className="button" disabled={decision.isPending} onClick={() => decision.mutate({ id: approval.approvalId, value: "APPROVE" })}><Check size={16} />Approve</button>
            </div>
          </article>
        ))}
      </div>
      {decision.error && <p className="form-error">{decision.error.message}</p>}
    </Card>
  );
}
