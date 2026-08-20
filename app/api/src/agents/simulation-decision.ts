import type { SimulationParticipant } from "@harvest/simulation";

import { completeStructured, readLlmConfiguration } from "./structured-client.js";

const toolsByRole: Record<SimulationParticipant["role"], string[]> = {
  FARMER: ["submit_crop_observation", "publish_listing", "decide_approval"],
  BUYER: ["create_buyer_demand", "place_order", "decide_approval", "record_delivery_acceptance"],
  TRANSPORTER: ["accept_delivery_mission", "report_mission_progress", "report_exception"],
  COORDINATOR: ["verify_observation", "decide_approval"],
};

interface Decision {
  allowedTools: Set<string>;
  summary: string;
  adapter: string;
}

function validateDecision(role: SimulationParticipant["role"], value: unknown) {
  if (!value || typeof value !== "object") throw new Error("Simulation decision must be an object.");
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.toolNames) || !record.toolNames.every((item) => typeof item === "string")) {
    throw new Error("Simulation decision toolNames must be a string array.");
  }
  const permitted = new Set(toolsByRole[role]);
  if (record.toolNames.some((name) => !permitted.has(name as string))) {
    throw new Error("Simulation decision attempted a tool outside the participant role allow-list.");
  }
  if (typeof record.summary !== "string" || record.summary.length > 240) {
    throw new Error("Simulation decision summary must be a string of at most 240 characters.");
  }
  return { toolNames: record.toolNames as string[], summary: record.summary };
}

export class SimulationDecisionProvider {
  private readonly decisions = new Map<string, Promise<Decision>>();

  constructor(private readonly mode: "DETERMINISTIC" | "LLM_ASSISTED") {}

  adapterName() {
    if (this.mode === "DETERMINISTIC") return "deterministic";
    return readLlmConfiguration().adapter;
  }

  decide(participant: SimulationParticipant, at: string, observableContext: unknown) {
    const key = `${participant.productActorId}:${at.slice(0, 10)}`;
    const existing = this.decisions.get(key);
    if (existing) return existing;
    const decision = this.createDecision(participant, at, observableContext);
    this.decisions.set(key, decision);
    return decision;
  }

  private async createDecision(participant: SimulationParticipant, at: string, observableContext: unknown): Promise<Decision> {
    const possibleTools = toolsByRole[participant.role];
    if (this.mode === "DETERMINISTIC") {
      return { allowedTools: new Set(possibleTools), summary: "Deterministic role policy selected the safe daily tools.", adapter: "deterministic" };
    }
    const configuration = readLlmConfiguration();
    if (configuration.mode === "fixture") {
      return { allowedTools: new Set(possibleTools), summary: "Fixture role policy selected the predetermined safe daily tools.", adapter: "fixture" };
    }
    const completed = await completeStructured(
      [
        `You select bounded Harvest tools for one synthetic ${participant.role.toLowerCase()} in a Saint Lucia simulation.`,
        "Select only from the supplied role allow-list. Product API validation remains authoritative.",
        "Do not invent entities, quantities, observations, future disruptions, or hidden simulation truth.",
        "Return JSON only: {\"toolNames\": string[], \"summary\": string}.",
        "The summary must be a short decision explanation, never chain-of-thought.",
      ].join(" "),
      {
        simulationTime: at,
        participant: { role: participant.role, displayName: participant.displayName, islandId: participant.islandId },
        observableContext,
        possibleTools,
        instruction: "Choose only tools justified by the observable context for today's cycle. An empty list is valid. Product API validation is authoritative.",
      },
      (value) => validateDecision(participant.role, value),
    );
    return { allowedTools: new Set(completed.value.toolNames), summary: completed.value.summary, adapter: completed.adapter };
  }
}
