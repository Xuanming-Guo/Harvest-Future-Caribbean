export const cropStages = [
  "GROWING",
  "FLOWERING",
  "FRUITING",
  "HARVEST_READY",
  "HARVESTED",
] as const;

export type CropStage = (typeof cropStages)[number];
export type ObservationSourceType = "TEXT" | "VOICE_TRANSCRIPT" | "COORDINATOR_NOTE";

export interface CropObservationPromptInput {
  actorRole: string;
  cropBatchId: string;
  cropType: string;
  currentBatchStatus: string;
  observedAt: string;
  timezone: string;
  sourceType: ObservationSourceType;
  sourceText: string;
}

export interface RecoveryExplanationPromptInput {
  exceptionType: "DELAY";
  severity: string;
  reportedAt: string;
  description: string;
  missionId: string;
  missionStatus: string;
  routeSummary: string;
  orderQuantityKg: number;
  previousDeadline: string;
  proposedDeadline: string;
}

export const cropObservationPromptId = "crop-observation-extraction-v1";
export const delayRecoveryPromptId = "delay-recovery-explanation-v1";

export function buildCropObservationPrompt(input: CropObservationPromptInput) {
  return {
    promptId: cropObservationPromptId,
    system: [
      "You extract agricultural field information for Harvest in Saint Lucia.",
      "Create a non-binding draft for explicit human review; never create operational truth.",
      "Do not invent quantities, dates, crop stages, damage, or observations not supported by the source.",
      "Preserve the supplied unit and convert to kilograms only when the conversion is unambiguous.",
      "Return only the strict structured output. Attach field confidence and warnings for uncertainty.",
      "Do not make forecasts, inventory, allocation, pricing, commitment, or approval decisions.",
    ].join(" "),
    context: {
      actorRole: input.actorRole,
      permittedCropBatchId: input.cropBatchId,
      cropType: input.cropType,
      currentBatchStatus: input.currentBatchStatus,
      observedAt: input.observedAt,
      timezone: input.timezone,
      sourceType: input.sourceType,
      sourceText: input.sourceText,
      allowedCropStages: cropStages,
    },
    outputSchema: {
      suggestedCropStage: "allowed crop stage or null",
      suggestedQuantityKg: "non-negative number or null",
      suggestedNotes: "concise source-grounded notes or null",
      fieldConfidence: { cropStage: "0..1", estimatedQuantity: "0..1", notes: "0..1" },
      confidence: "0..1",
      warnings: "string[]",
    },
  } as const;
}

export function buildDelayRecoveryPrompt(input: RecoveryExplanationPromptInput) {
  return {
    promptId: delayRecoveryPromptId,
    system: [
      "You explain a recovery action already calculated by deterministic Harvest code.",
      "You may explain but must not replace, alter, approve, or execute the action.",
      "Use only supplied evidence and clearly distinguish facts from uncertainty.",
      "Do not reveal private participant data, hidden simulation truth, or chain-of-thought.",
      "Return only the strict structured output.",
    ].join(" "),
    context: input,
    outputSchema: {
      summary: "concise participant-facing explanation",
      evidence: "string[]",
      risks: "string[]",
      requiresClarification: "boolean",
    },
  } as const;
}
