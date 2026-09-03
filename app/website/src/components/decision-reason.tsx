"use client";

import type { DecisionReasonCode } from "@/lib/api";

export const decisionReasonCodes: DecisionReasonCode[] = [
  "QUANTITY_MISMATCH",
  "MATURITY_OR_QUALITY",
  "DAMAGE",
  "CLEANLINESS",
  "SIZE_OR_GRADE",
  "MISSING_INFORMATION",
  "OTHER",
];

/** Plain-language wording for each contract reason code. */
export const decisionReasonLabels: Record<DecisionReasonCode, string> = {
  QUANTITY_MISMATCH: "Wrong amount",
  MATURITY_OR_QUALITY: "Not ripe enough",
  DAMAGE: "Damaged",
  CLEANLINESS: "Not clean enough",
  SIZE_OR_GRADE: "Wrong size or grade",
  MISSING_INFORMATION: "Information missing",
  OTHER: "Something else",
};

export const decisionReasonLabel = (code?: string | null) =>
  (code && decisionReasonLabels[code as DecisionReasonCode]) || "Reason not recorded";

/**
 * Custom pill chooser for a rejection reason. Harvest never ships a native
 * select, so these are ordinary toggle buttons with large touch targets and
 * `aria-pressed` state.
 */
export function ReasonChooser({
  idPrefix,
  label,
  value,
  onChange,
  disabled = false,
}: {
  idPrefix: string;
  label: string;
  value: DecisionReasonCode | null;
  onChange: (value: DecisionReasonCode | null) => void;
  disabled?: boolean;
}) {
  return (
    <div className="field field-full reason-chooser" role="group" aria-labelledby={`${idPrefix}-reason-label`}>
      <span className="reason-chooser-label" id={`${idPrefix}-reason-label`}>{label}</span>
      <div className="reason-options">
        {decisionReasonCodes.map((code) => (
          <button
            aria-pressed={value === code}
            className="button button-quiet reason-option"
            disabled={disabled}
            key={code}
            onClick={() => onChange(value === code ? null : code)}
            type="button"
          >
            {decisionReasonLabels[code]}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Reason chooser plus the required "what happens next" instruction. */
export function DecisionReasonFields({
  idPrefix,
  reasonCode,
  nextAction,
  onReasonCode,
  onNextAction,
  disabled = false,
  reasonLabel = "What was wrong?",
  nextActionLabel = "What should the farmer do next?",
  placeholder = "For example: pick one day later so the fruit reaches full size",
}: {
  idPrefix: string;
  reasonCode: DecisionReasonCode | null;
  nextAction: string;
  onReasonCode: (value: DecisionReasonCode | null) => void;
  onNextAction: (value: string) => void;
  disabled?: boolean;
  reasonLabel?: string;
  nextActionLabel?: string;
  placeholder?: string;
}) {
  return (
    <>
      <ReasonChooser disabled={disabled} idPrefix={idPrefix} label={reasonLabel} onChange={onReasonCode} value={reasonCode} />
      <div className="field field-full">
        <label htmlFor={`${idPrefix}-next-action`}>{nextActionLabel}</label>
        <input
          disabled={disabled}
          id={`${idPrefix}-next-action`}
          maxLength={300}
          onChange={(event) => onNextAction(event.target.value)}
          placeholder={placeholder}
          value={nextAction}
        />
      </div>
    </>
  );
}

/** Farmer-facing explanation of the latest rejection affecting a crop batch. */
export function DecisionExplanation({
  decision,
  title = "What was wrong, and what to do next",
}: {
  decision: { source?: string; reasonCode?: string; nextAction?: string; note?: string; decidedAt?: string };
  title?: string;
}) {
  return (
    <div className="decision-explanation">
      <strong>{title}</strong>
      <p className="decision-reason-line">{decisionReasonLabel(decision.reasonCode)}</p>
      {decision.nextAction && <p className="decision-next-action">Next step: {decision.nextAction}</p>}
      {decision.note && <p className="decision-note">Their note: {decision.note}</p>}
    </div>
  );
}
