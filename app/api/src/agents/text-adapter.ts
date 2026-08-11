import { config } from "../config.js";
import {
  buildCropObservationPrompt,
  buildDelayRecoveryPrompt,
  cropObservationPromptId,
  delayRecoveryPromptId,
  type CropObservationPromptInput,
  type CropStage,
  type RecoveryExplanationPromptInput,
} from "./prompts.js";

export interface CropObservationDraftResult {
  suggestedCropStage: CropStage | null;
  suggestedQuantityKg: number | null;
  suggestedNotes: string | null;
  fieldConfidence: { cropStage: number; estimatedQuantity: number; notes: number };
  confidence: number;
  warnings: string[];
  promptId: typeof cropObservationPromptId;
  adapter: string;
}

export interface RecoveryExplanationResult {
  summary: string;
  evidence: string[];
  risks: string[];
  requiresClarification: boolean;
  promptId: typeof delayRecoveryPromptId;
  adapter: string;
}

export interface AgentTextAdapter {
  readonly name: string;
  extractCropObservation(input: CropObservationPromptInput): Promise<CropObservationDraftResult>;
  explainRecovery(input: RecoveryExplanationPromptInput): Promise<RecoveryExplanationResult>;
}

function extractedStage(sourceText: string): CropStage | null {
  const text = sourceText.toLowerCase();
  if (/harvest[ -]?ready|ready (?:to|for) harvest/.test(text)) return "HARVEST_READY";
  if (/\bharvested\b/.test(text)) return "HARVESTED";
  if (/\bfruiting\b|fruit (?:is|are|has|have)/.test(text)) return "FRUITING";
  if (/\bflowering\b|flowers? (?:are|have)/.test(text)) return "FLOWERING";
  if (/\bgrowing\b|new growth/.test(text)) return "GROWING";
  return null;
}

function extractedKilograms(sourceText: string) {
  const match = sourceText.match(/\b(?:approximately|about|around|roughly|nearly)?\s*(\d+(?:\.\d+)?)\s*(?:kg|kgs|kilograms?|kilos?)\b/i);
  return match ? Number(match[1]) : null;
}

export class FixtureAgentTextAdapter implements AgentTextAdapter {
  readonly name = "fixture";

  async extractCropObservation(input: CropObservationPromptInput): Promise<CropObservationDraftResult> {
    buildCropObservationPrompt(input);
    const suggestedCropStage = extractedStage(input.sourceText);
    const suggestedQuantityKg = extractedKilograms(input.sourceText);
    const warnings: string[] = [];
    if (!suggestedCropStage) warnings.push("Crop stage was not stated clearly; review the existing stage.");
    if (suggestedQuantityKg === null) warnings.push("No unambiguous kilogram quantity was found.");
    const fieldConfidence = {
      cropStage: suggestedCropStage ? 0.9 : 0.25,
      estimatedQuantity: suggestedQuantityKg === null ? 0.2 : 0.94,
      notes: 0.88,
    };
    return {
      suggestedCropStage,
      suggestedQuantityKg,
      suggestedNotes: input.sourceText.trim() || null,
      fieldConfidence,
      confidence: (fieldConfidence.cropStage + fieldConfidence.estimatedQuantity + fieldConfidence.notes) / 3,
      warnings,
      promptId: cropObservationPromptId,
      adapter: this.name,
    };
  }

  async explainRecovery(input: RecoveryExplanationPromptInput): Promise<RecoveryExplanationResult> {
    buildDelayRecoveryPrompt(input);
    return {
      summary: `Extend mission ${input.missionId.slice(0, 8)} by exactly two hours while a coordinator reviews the reported delay.`,
      evidence: [
        `${input.exceptionType} was reported with ${input.severity.toLowerCase()} severity.`,
        `The existing deadline is ${input.previousDeadline}; the proposed deadline is ${input.proposedDeadline}.`,
      ],
      risks: ["Delivery remains at risk until a coordinator approves or rejects the proposal."],
      requiresClarification: !input.description.trim(),
      promptId: delayRecoveryPromptId,
      adapter: this.name,
    };
  }
}

export function createAgentTextAdapter(provider = config.agentLlmProvider): AgentTextAdapter {
  if (!provider.trim()) return new FixtureAgentTextAdapter();
  throw new Error(
    `Unsupported AGENT_LLM_PROVIDER '${provider}'. Leave it blank for the fixture or add and register a provider adapter as documented in docs/agent_workflows.md.`,
  );
}
