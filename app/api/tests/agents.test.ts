import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildCropObservationPrompt,
  buildDelayRecoveryPrompt,
  cropObservationPromptId,
  delayRecoveryPromptId,
} from "../src/agents/prompts.js";
import { createAgentTextAdapter, FixtureAgentTextAdapter } from "../src/agents/text-adapter.js";
import { SimulationDecisionProvider } from "../src/agents/simulation-decision.js";
import { config } from "../src/config.js";

const blankLlmConfiguration = {
  agentLlmProvider: "",
  agentLlmModel: "",
  agentLlmBaseUrl: "",
  agentLlmApiKey: "",
};

afterEach(() => {
  Object.assign(config, blankLlmConfiguration);
  vi.unstubAllGlobals();
});

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

  it("uses the labelled fixture for bounded LLM-assisted simulation decisions", async () => {
    const provider = new SimulationDecisionProvider("LLM_ASSISTED");
    const participant = {
      simulationActorId: "11111111-1111-4111-8111-111111111111",
      productActorId: "22222222-2222-4222-8222-222222222222",
      role: "BUYER" as const,
      displayName: "Synthetic buyer",
      islandId: "saint-lucia",
    };
    const decision = await provider.decide(participant, "2026-09-04T08:00:00Z", {
      activeSupply: [{ cropType: "CUCUMBER", quantityKg: 20 }],
      ownOrdersByStatus: {},
    });
    expect(provider.adapterName()).toBe("fixture");
    expect(decision.adapter).toBe("fixture");
    expect(decision.allowedTools).toContain("place_order");
    expect(decision.allowedTools).not.toContain("publish_listing");
  });

  it("calls a configured OpenAI-compatible provider with bounded structured context", async () => {
    Object.assign(config, {
      agentLlmProvider: "openai-compatible",
      agentLlmModel: "test-model",
      agentLlmBaseUrl: "https://llm.example/v1",
      agentLlmApiKey: "test-secret",
    });
    const providerCall = vi.fn(async (_url: string | URL | Request, _request?: RequestInit) => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ toolNames: ["place_order"], summary: "Place the observable cucumber order." }) } }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", providerCall);

    const provider = new SimulationDecisionProvider("LLM_ASSISTED");
    const decision = await provider.decide({
      simulationActorId: "11111111-1111-4111-8111-111111111111",
      productActorId: "22222222-2222-4222-8222-222222222222",
      role: "BUYER",
      displayName: "Synthetic buyer",
      islandId: "saint-lucia",
    }, "2026-09-04T08:00:00Z", { activeSupply: [{ cropType: "CUCUMBER", quantityKg: 20 }] });

    expect(provider.adapterName()).toBe("openai-compatible:test-model");
    expect(decision.allowedTools).toEqual(new Set(["place_order"]));
    expect(providerCall).toHaveBeenCalledTimes(1);
    const [url, request] = providerCall.mock.calls[0];
    expect(url).toBe("https://llm.example/v1/chat/completions");
    const body = JSON.parse(String(request?.body));
    expect(body).toMatchObject({ model: "test-model", temperature: 0, response_format: { type: "json_object" } });
    expect(JSON.stringify(body)).not.toContain("test-secret");
  });

  it("rejects partial LLM configuration instead of silently falling back", () => {
    Object.assign(config, { ...blankLlmConfiguration, agentLlmProvider: "openai-compatible" });
    expect(() => new SimulationDecisionProvider("LLM_ASSISTED").adapterName()).toThrow("LLM configuration is incomplete");
  });
});
