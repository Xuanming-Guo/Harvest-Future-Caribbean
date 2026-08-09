"use client";

/**
 * The control room's masthead: wordmark, policy toggle, seed control, and the
 * mandatory evidence badge.
 *
 * The evidence badge sits in the same visual unit as the title deliberately —
 * see globals.css's note on `.evidence-badge`. A screenshot cropped to "look
 * impressive" cannot separate the claim from its caveat if the caveat lives
 * right next to the claim.
 */

import type { ControlRoomScene } from "@harvest/simulation";

export interface MastheadProps {
  scene: ControlRoomScene;
  policy: "BASELINE" | "HARVEST";
  onPolicyChange: (p: "BASELINE" | "HARVEST") => void;
  seed: number;
  onSeedChange: (s: number) => void;
}

export default function Masthead({ scene, policy, onPolicyChange, seed, onSeedChange }: MastheadProps): React.JSX.Element {
  return (
    <div className="masthead">
      <span className="masthead-mark" aria-hidden="true">
        H
      </span>

      <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <span className="masthead-title">Harvest control room</span>
        <span className="masthead-sub">{scene.scenarioId}</span>
      </div>

      <div className="policy-toggle" role="group" aria-label="Simulation policy">
        <button
          type="button"
          aria-pressed={policy === "BASELINE"}
          onClick={() => onPolicyChange("BASELINE")}
        >
          Baseline
        </button>
        <button
          type="button"
          aria-pressed={policy === "HARVEST"}
          onClick={() => onPolicyChange("HARVEST")}
        >
          Harvest
        </button>
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-dim)", fontSize: 11 }}>
        Seed
        <input
          type="number"
          value={seed}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) onSeedChange(next);
          }}
          aria-label="Random seed for the scenario run"
          style={{
            width: 96,
            padding: "5px 8px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--line)",
            background: "var(--surface-raised)",
            color: "var(--text)",
            fontVariantNumeric: "tabular-nums",
          }}
        />
      </label>

      {/*
       * Mandatory, never dismissible: this run is entirely synthetic and must
       * never be read as measured real-world impact. `title` carries the fuller
       * provenance note for anyone who hovers.
       */}
      <span className="evidence-badge" title={scene.evidenceLabel} style={{ marginLeft: "auto" }}>
        Synthetic simulation
      </span>
    </div>
  );
}
