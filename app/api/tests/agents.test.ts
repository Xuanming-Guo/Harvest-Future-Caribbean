import { describe, expect, it } from "vitest";

import {
  buildCropObservationPrompt,
  buildDelayRecoveryPrompt,
  cropObservationPromptId,
  delayRecoveryPromptId,
} from "../src/agents/prompts.js";
import { createAgentTextAdapter, FixtureAgentTextAdapter } from "../src/agents/text-adapter.js";

const observationInput = {
  actorRole: "FARMER",
  cropBatchId: "11111111-1111-4111-8111-111111111111",
  cropType: "CUCUMBER",
  currentBatchStatus: "HARVEST_READY",
  observedAt: "2026-09-04T08:00:00Z",
  timezone: "America/St_Lucia",
  sourceType: "TEXT" as const,
  sourceText: "Approximately 20 kg of cucumbers are harvest ready, with some rain damage.",
};

const recoveryInput = {
  exceptionType: "DELAY" as const,
  severity: "HIGH",
  reportedAt: "2026-09-04T12:00:00Z",
  description: "Road closure near Castries.",
  missionId: "17000000-0000-4000-8000-000000000001",
  missionStatus: "IN_TRANSIT",
  routeSummary: "3 planned stops",
  orderQuantityKg: 20,
  previousDeadline: "2026-09-05T15:00:00Z",
  proposedDeadline: "2026-09-05T17:00:00Z",
};

describe("provider-neutral agent text tasks", () => {
  it("builds a bounded extraction prompt with explicit human and authority limits", () => {
    const prompt = buildCropObservationPrompt(observationInput);
    expect(prompt.promptId).toBe(cropObservationPromptId);
    expect(prompt.system).toContain("non-binding draft");
    expect(prompt.system).toContain("Do not invent");
    expect(prompt.system).toContain("Do not make forecasts, inventory, allocation");
    expect(prompt.context).toMatchObject({
      permittedCropBatchId: observationInput.cropBatchId,
      sourceText: observationInput.sourceText,
      timezone: "America/St_Lucia",
    });
    expect(JSON.stringify(prompt)).not.toContain("API_KEY");
  });

  it("extracts the hero observation deterministically without saving anything", async () => {
    const result = await new FixtureAgentTextAdapter().extractCropObservation(observationInput);
    expect(result).toMatchObject({
      suggestedCropStage: "HARVEST_READY",
      suggestedQuantityKg: 20,
      promptId: cropObservationPromptId,
      adapter: "fixture",
      warnings: [],
    });
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it("keeps missing fields null and warns instead of inventing them", async () => {
    const result = await new FixtureAgentTextAdapter().extractCropObservation({ ...observationInput, sourceText: "Some leaves were damaged by rain." });
    expect(result.suggestedCropStage).toBeNull();
    expect(result.suggestedQuantityKg).toBeNull();
    expect(result.warnings).toHaveLength(2);
  });

  it("builds and explains only the fixed delay recovery", async () => {
    const prompt = buildDelayRecoveryPrompt(recoveryInput);
    expect(prompt.promptId).toBe(delayRecoveryPromptId);
    expect(prompt.system).toContain("must not replace, alter, approve, or execute");
    expect(prompt.context.proposedDeadline).toBe("2026-09-05T17:00:00Z");
    const result = await new FixtureAgentTextAdapter().explainRecovery(recoveryInput);
    expect(result.summary).toContain("exactly two hours");
    expect(result.promptId).toBe(delayRecoveryPromptId);
  });

  it("uses fixture for a blank provider and rejects an unregistered provider", () => {
    expect(createAgentTextAdapter("").name).toBe("fixture");
    expect(() => createAgentTextAdapter("unknown-provider")).toThrow("Unsupported AGENT_LLM_PROVIDER");
  });
});
