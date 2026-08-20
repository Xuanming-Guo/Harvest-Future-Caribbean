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
import { completeStructured, readLlmConfiguration } from "./structured-client.js";

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

function asRecord(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("The configured LLM returned a non-object response.");
  return value as Record<string, unknown>;
}

function confidence(value: unknown, field: string) {
  if (typeof value !== "number" || value < 0 || value > 1) throw new Error(`${field} must be between 0 and 1.`);
  return value;
}

class OpenAiCompatibleTextAdapter implements AgentTextAdapter {
  readonly name: string;

  constructor() {
    this.name = readLlmConfiguration().adapter;
  }

  async extractCropObservation(input: CropObservationPromptInput): Promise<CropObservationDraftResult> {
    const prompt = buildCropObservationPrompt(input);
    const result = await completeStructured(prompt.system, { context: prompt.context, outputSchema: prompt.outputSchema }, (value) => {
      const row = asRecord(value);
      const stage = row.suggestedCropStage;
      if (stage !== null && !["GROWING", "FLOWERING", "FRUITING", "HARVEST_READY", "HARVESTED"].includes(String(stage))) throw new Error("suggestedCropStage is invalid.");
      if (row.suggestedQuantityKg !== null && (typeof row.suggestedQuantityKg !== "number" || row.suggestedQuantityKg < 0)) throw new Error("suggestedQuantityKg must be non-negative or null.");
      if (row.suggestedNotes !== null && typeof row.suggestedNotes !== "string") throw new Error("suggestedNotes must be a string or null.");
      const field = asRecord(row.fieldConfidence);
      if (!Array.isArray(row.warnings) || !row.warnings.every((item) => typeof item === "string")) throw new Error("warnings must be a string array.");
      return {
        suggestedCropStage: stage as CropStage | null,
        suggestedQuantityKg: row.suggestedQuantityKg as number | null,
        suggestedNotes: row.suggestedNotes as string | null,
        fieldConfidence: {
          cropStage: confidence(field.cropStage, "fieldConfidence.cropStage"),
          estimatedQuantity: confidence(field.estimatedQuantity, "fieldConfidence.estimatedQuantity"),
          notes: confidence(field.notes, "fieldConfidence.notes"),
        },
        confidence: confidence(row.confidence, "confidence"),
        warnings: row.warnings as string[],
      };
    });
    return { ...result.value, promptId: cropObservationPromptId, adapter: result.adapter };
  }

  async explainRecovery(input: RecoveryExplanationPromptInput): Promise<RecoveryExplanationResult> {
    const prompt = buildDelayRecoveryPrompt(input);
    const result = await completeStructured(prompt.system, { context: prompt.context, outputSchema: prompt.outputSchema }, (value) => {
      const row = asRecord(value);
      if (typeof row.summary !== "string" || row.summary.length > 500) throw new Error("summary must be a string of at most 500 characters.");
      if (!Array.isArray(row.evidence) || !row.evidence.every((item) => typeof item === "string")) throw new Error("evidence must be a string array.");
      if (!Array.isArray(row.risks) || !row.risks.every((item) => typeof item === "string")) throw new Error("risks must be a string array.");
      if (typeof row.requiresClarification !== "boolean") throw new Error("requiresClarification must be boolean.");
      return { summary: row.summary, evidence: row.evidence as string[], risks: row.risks as string[], requiresClarification: row.requiresClarification };
    });
    return { ...result.value, promptId: delayRecoveryPromptId, adapter: result.adapter };
  }
}

export function createAgentTextAdapter(provider = config.agentLlmProvider): AgentTextAdapter {
  if (provider.trim() && provider.trim() !== "openai-compatible") {
    throw new Error(`Unsupported AGENT_LLM_PROVIDER '${provider}'. Use 'openai-compatible' or leave all LLM variables blank.`);
  }
  const llm = readLlmConfiguration();
  if (llm.mode === "fixture") return new FixtureAgentTextAdapter();
  return new OpenAiCompatibleTextAdapter();
}
