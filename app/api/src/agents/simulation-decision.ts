import type { SimulationParticipant } from "@harvest/simulation";

import { completeStructured, readLlmConfiguration } from "./structured-client.js";

/**
 * Read-only tools, kept apart from the mutation allow-list below.
 *
 * `toolsByRole` gates tools that change operational state, and a model chooses
 * from it each simulated day. Reading the shared weather changes nothing, is
 * safe for every role that plans around it, and must not become something a
 * model can withhold: the whole point of issue #37 is that every participant
 * plans from the same forecast. So it is listed here and always permitted.
 *
 * The buyer is absent on purpose. A hotel orders against a deadline and a
 * price; the weather reaches it through the supply it is offered, not through
 * its own planning.
 */
export const readToolsByRole: Record<SimulationParticipant["role"], string[]> = {
  FARMER: ["read_weather"],
  BUYER: [],
  TRANSPORTER: ["read_weather"],
  COORDINATOR: ["read_weather"],
};

const toolsByRole: Record<SimulationParticipant["role"], string[]> = {
  FARMER: ["submit_crop_observation", "publish_listing", "decide_approval"],
  BUYER: ["create_buyer_demand", "place_order", "decide_approval", "record_delivery_acceptance", "confirm_payment"],
  TRANSPORTER: ["accept_delivery_mission", "report_mission_progress", "report_exception"],
  // The coordinator is the only role that proposes moving produce between
  // islands, and booking the sailing is a separate tool because it is a
  // separate decision that only becomes available once every approval lands.
  COORDINATOR: ["verify_observation", "decide_approval", "propose_inter_island_commitment", "book_maritime_shipment", "report_shipment_progress"],
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
