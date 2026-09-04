"use client";

import { useId } from "react";

import type { EstimationMode } from "@/lib/run";

interface EstimationModeControlProps {
  value: EstimationMode;
  onChange: (mode: EstimationMode) => void;
  /** Baseline participants never call the Product API, so the choice is inert. */
  disabled?: boolean;
}

const OPTIONS: Array<{ mode: EstimationMode; label: string; hint: string }> = [
  {
    mode: "LEARNED_MODEL",
    label: "Harvest estimation model",
    hint: "Calls the quantile harvest-estimation service. The run fails if that service is unavailable; it never silently falls back.",
  },
  {
    mode: "DETERMINISTIC_FALLBACK",
    label: "Deterministic fallback",
    hint: "Rule-based fixture estimates, labelled as such on every forecast. Not learned-model output.",
  },
];

/**
 * A two-option segmented control rather than a native select: the front-end
 * design contract keeps browser chrome out of the product interface, and the
 * choice reads better as two visible alternatives than as a collapsed menu.
 *
 * Radio semantics carry the grouping for assistive technology, and roving
 * arrow-key movement comes free with a native radio group.
 */
export default function EstimationModeControl({ value, onChange, disabled = false }: EstimationModeControlProps): React.JSX.Element {
  const groupName = useId();
  return (
    <div className="segmented-field">
      <span className="custom-menu-label" id={`${groupName}-label`}>Harvest estimation</span>
      <div className="segmented" role="radiogroup" aria-labelledby={`${groupName}-label`} data-disabled={disabled || undefined}>
        {OPTIONS.map((option) => {
          const selected = value === option.mode;
          return (
            <label
              key={option.mode}
              className={selected ? "segmented-option is-selected" : "segmented-option"}
              title={disabled ? "Baseline runs never request a harvest estimate, so this choice is recorded but unused." : option.hint}
            >
              <input
                type="radio"
                name={groupName}
                value={option.mode}
                checked={selected}
                disabled={disabled}
                onChange={() => onChange(option.mode)}
              />
              <span>{option.label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
