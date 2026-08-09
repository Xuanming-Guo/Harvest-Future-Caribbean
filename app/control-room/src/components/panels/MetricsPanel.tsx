"use client";

/**
 * Headline totals for the run so far.
 *
 * Whole kilograms only: the engine's totals accumulate fractional kilograms
 * from many small allocations, and showing that precision would suggest a
 * confidence the simulation does not have. Rounding here (rather than caching
 * a rounded value) is enough to stop jitter, because `frame.totals` only ever
 * grows as playback advances — the same instant always rounds the same way.
 */

import type { ControlRoomFrame } from "@harvest/simulation";

export interface MetricsPanelProps {
  frame: ControlRoomFrame;
  policy: "BASELINE" | "HARVEST";
}

function wholeKg(kg: number): string {
  return Math.round(kg).toLocaleString("en-US");
}

export default function MetricsPanel({ frame, policy }: MetricsPanelProps): React.JSX.Element {
  const { totals } = frame;

  return (
    <section className="panel">
      <header className="panel-header">
        <span className="panel-title">Run totals</span>
      </header>
      <div className="panel-body">
        <div className="metric-grid">
          <div className="metric">
            <div className="metric-label">Delivered</div>
            <div className="metric-value">
              {wholeKg(totals.acceptedKg)}
              <span className="metric-unit">kg</span>
            </div>
          </div>

          <div className="metric">
            <div className="metric-label">Substituted</div>
            <div className="metric-value">
              {wholeKg(totals.substitutedKg)}
              <span className="metric-unit">kg</span>
            </div>
          </div>

          <div className="metric">
            <div className="metric-label">Orders met</div>
            <div className="metric-value">{totals.demandsFullyMet.toLocaleString("en-US")}</div>
          </div>

          <div className="metric">
            <div className="metric-label">Orders missed</div>
            <div className="metric-value">{totals.demandsUnmet.toLocaleString("en-US")}</div>
          </div>

          <div className="metric">
            <div className="metric-label">Commitments approved</div>
            <div className="metric-value">{totals.commitmentsApproved.toLocaleString("en-US")}</div>
          </div>

          {/*
           * Grower check-ins are a Harvest-policy concept — the baseline never
           * asks for them — so showing the metric under baseline would imply a
           * behaviour that policy does not have.
           */}
          {policy === "HARVEST" && (
            <div className="metric">
              <div className="metric-label">Check-ins requested</div>
              <div className="metric-value">{totals.observationRequests.toLocaleString("en-US")}</div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
