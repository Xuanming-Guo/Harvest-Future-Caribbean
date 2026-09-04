"use client";

import type { ControlRoomFrame } from "@harvest/simulation";
import type React from "react";

export interface MetricsPanelProps {
  frame: ControlRoomFrame;
  policy: "BASELINE" | "HARVEST";
}

function wholeKg(kg: number): string {
  return Math.round(kg).toLocaleString("en-US");
}

const CAUSE_LABELS: Record<string, string> = {
  NO_READY_SUPPLY: "No ready supply",
  INSUFFICIENT_SUPPLY: "Not enough safe supply",
  SUPPLY_CHANGED: "Supply changed before commitment",
  APPROVAL_REJECTED: "A participant declined",
  APPROVAL_TIMEOUT: "Approval not completed in time",
  MISSION_LATE: "Delivery missed the deadline",
  DELIVERY_REJECTED: "Produce rejected at delivery",
  CANCELLED: "Cancelled",
  HORIZON_TRUNCATED: "Deadline after the run ended",
};

/**
 * Negative outcomes are listed, not hidden: every unfulfilled or partially
 * fulfilled order contributes exactly one cause, so the counts here sum to
 * those two cards above.
 */
function MissedOrderCauses({ causes }: { causes: Record<string, number> | undefined }) {
  const entries = Object.entries(causes ?? {}).sort(([, a], [, b]) => b - a);
  if (entries.length === 0) return null;
  return (
    <div className="metrics-causes">
      <div className="metric-label">Why orders were missed</div>
      <ul className="metrics-cause-list">
        {entries.map(([cause, count]) => (
          <li key={cause}>
            <span>{CAUSE_LABELS[cause] ?? cause}</span>
            <span className="metrics-cause-count">{count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Metric({ label, value, unit }: { label: string; value: number; unit?: string }) {
  const formatted = unit === "kg" ? wholeKg(value) : value.toLocaleString("en-US");
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className="metric-value">
        {formatted}
        {unit && <span className="metric-unit">{unit}</span>}
      </div>
    </div>
  );
}

export default function MetricsPanel({ frame, policy }: MetricsPanelProps): React.JSX.Element {
  if (policy === "HARVEST") {
    const snapshot = frame.operationsSnapshot;
    return (
      <section className="panel">
        <header className="panel-header">
          <span className="panel-title">Harvest product outcomes</span>
        </header>
        <div className="panel-body">
          <p className="metrics-source">From run-scoped Product API records at this replay instant.</p>
          {snapshot ? (
            <>
              <div className="metric-grid">
                <Metric label="Delivered" value={snapshot.deliveryAcceptedKg} unit="kg" />
                <Metric label="Total orders" value={snapshot.orderOutcomes.total} />
                <Metric label="Fulfilled" value={snapshot.orderOutcomes.fulfilled} />
                <Metric label="Partially fulfilled" value={snapshot.orderOutcomes.partiallyFulfilled} />
                <Metric label="Unfulfilled" value={snapshot.orderOutcomes.unfulfilled} />
                <Metric label="Pending" value={snapshot.orderOutcomes.pending} />
                <Metric label="Approved commitments" value={snapshot.approvedCommitmentCount} />
                <Metric label="Completed delivery missions" value={snapshot.completedMissionCount} />
                <Metric label="Overdue payments" value={snapshot.paymentOverdueCount ?? 0} />
              </div>
              <p className="metrics-source">Harvest tracks payment terms and status; it does not move money.</p>
              <MissedOrderCauses causes={snapshot.orderOutcomes.causes} />
            </>
          ) : (
            <p className="metrics-unavailable">No Product API snapshot is available for this older saved frame.</p>
          )}
        </div>
      </section>
    );
  }

  const partial = frame.demands.filter((demand) => demand.status === "PARTIALLY_FULFILLED").length;
  const pending = frame.demands.filter((demand) => demand.status === "PENDING" || demand.status === "COMMITTED").length;
  return (
    <section className="panel">
      <header className="panel-header">
        <span className="panel-title">Fragmented baseline outcomes</span>
      </header>
      <div className="panel-body">
        <p className="metrics-source">From the physical simulation engine; baseline actors do not use Harvest.</p>
        <div className="metric-grid">
          <Metric label="Delivered" value={frame.totals.acceptedKg} unit="kg" />
          <Metric label="Substituted" value={frame.totals.substitutedKg} unit="kg" />
          <Metric label="Fulfilled" value={frame.totals.demandsFullyMet} />
          <Metric label="Partially fulfilled" value={partial} />
          <Metric label="Unfulfilled" value={frame.totals.demandsUnmet} />
          <Metric label="Pending" value={pending} />
        </div>
      </div>
    </section>
  );
}
