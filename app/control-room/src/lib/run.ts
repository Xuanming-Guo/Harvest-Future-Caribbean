/** Saved-run Product API client for the separate simulation control room. */

import { createHarvestClient, newIdempotencyKey, type ApiSchema } from "@harvest/shared";
import type { ControlRoomFrame, InjectedDisruption, ReplayTimeline } from "@harvest/simulation";

export const DEFAULT_SCENARIO = "saint-lucia-demo-v1";
export const DEFAULT_SEED = 8675309;
export const PRODUCT_API_URL = process.env.NEXT_PUBLIC_PRODUCT_API_URL ?? "http://localhost:3001";
export const PARTICIPANT_WEBSITE_URL = process.env.NEXT_PUBLIC_WEBSITE_URL ?? "http://localhost:3000";

export type PolicyName = "BASELINE" | "HARVEST";
export type DecisionMode = "DETERMINISTIC" | "LLM_ASSISTED";
export type SavedRun = ApiSchema<"SimulationRun">;
export type SimulationScenario = ApiSchema<"SimulationScenario">;

export interface RunOutcomeComparison {
  sourceRunId: string;
  changes: string[];
}

let accessToken: string | null = null;

const client = createHarvestClient({ baseUrl: PRODUCT_API_URL, getAccessToken: () => accessToken });

function apiError(result: { error?: unknown; response: Response }) {
  const problem = result.error as { detail?: string; code?: string } | undefined;
  return new Error(problem?.detail ?? `${problem?.code ?? "Product API error"} (HTTP ${result.response.status}).`);
}

function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (result.error !== undefined || result.data === undefined) throw apiError(result);
  return result.data;
}

export async function ensureOperationsSession() {
  if (accessToken) return;
  const response = await fetch(`${PRODUCT_API_URL}/dev/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ persona: "operations-demo" }),
  });
  if (!response.ok) throw new Error(`Could not start the local operations session (HTTP ${response.status}).`);
  const session = await response.json() as { accessToken: string };
  accessToken = session.accessToken;
}

export async function listSavedRuns() {
  await ensureOperationsSession();
  const page = unwrap(await client.GET("/v1/simulation-runs", { params: { query: { limit: 50 } } }));
  return page.items;
}

export async function listScenarios() {
  await ensureOperationsSession();
  return unwrap(await client.GET("/v1/simulation-scenarios")).items;
}

export async function loadSavedRun(runId: string) {
  await ensureOperationsSession();
  return unwrap(await client.GET("/v1/simulation-runs/{runId}", { params: { path: { runId } } }));
}

export async function createSavedRun(input: {
  scenarioId: string;
  policy: PolicyName;
  seed: number;
  decisionMode: DecisionMode;
  disruptions?: InjectedDisruption[];
}) {
  await ensureOperationsSession();
  return unwrap(await client.POST("/v1/simulation-runs", {
    params: { header: { "Idempotency-Key": newIdempotencyKey("control-room-run") } },
    body: {
      scenarioId: input.scenarioId,
      policy: input.policy,
      seed: input.seed,
      decisionMode: input.decisionMode,
      scope: { mode: "SELECTED", islandIds: ["saint-lucia"] },
      disruptions: input.disruptions,
    },
  }));
}

export async function createDerivedRun(runId: string, disruptions: InjectedDisruption[]) {
  await ensureOperationsSession();
  return unwrap(await client.POST("/v1/simulation-runs", {
    params: { header: { "Idempotency-Key": newIdempotencyKey("control-room-derived") } },
    body: { derivedFromRunId: runId, disruptions },
  }));
}

export async function loadTimeline(runId: string): Promise<ReplayTimeline> {
  await ensureOperationsSession();
  const response = unwrap(await client.GET("/v1/simulation-runs/{runId}/timeline", { params: { path: { runId } } }));
  return { scene: response.scene, frames: response.frames } as unknown as ReplayTimeline;
}

export async function loadWorldFrame(runId: string, frameIndex: number): Promise<ControlRoomFrame> {
  await ensureOperationsSession();
  const response = unwrap(await client.GET("/v1/simulation-runs/{runId}/world", {
    params: { path: { runId }, query: { frameIndex } },
  }));
  return response.frame as unknown as ControlRoomFrame;
}

function displayNumber(value: number): string {
  return Number.isInteger(value)
    ? value.toLocaleString("en-US")
    : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function changedTotal(label: string, before: number, after: number, unit = ""): string | null {
  if (Math.abs(after - before) < 0.005) return null;
  const suffix = unit ? ` ${unit}` : "";
  return `${label}: ${displayNumber(before)}${suffix} -> ${displayNumber(after)}${suffix}`;
}

/** Compares only final, judge-visible totals; replay timing can still differ. */
export function compareRunOutcomes(
  policy: PolicyName,
  sourceRun: SavedRun,
  sourceFrame: ControlRoomFrame,
  currentRun: SavedRun,
  currentFrame: ControlRoomFrame,
): RunOutcomeComparison {
  const changes: Array<string | null> = [];
  if (policy === "HARVEST" && sourceFrame.operationsSnapshot && currentFrame.operationsSnapshot) {
    const before = sourceFrame.operationsSnapshot;
    const after = currentFrame.operationsSnapshot;
    changes.push(
      changedTotal("Delivered", before.deliveryAcceptedKg, after.deliveryAcceptedKg, "kg"),
      changedTotal("Fulfilled orders", before.orderOutcomes.fulfilled, after.orderOutcomes.fulfilled),
      changedTotal("Partially fulfilled orders", before.orderOutcomes.partiallyFulfilled, after.orderOutcomes.partiallyFulfilled),
      changedTotal("Unfulfilled orders", before.orderOutcomes.unfulfilled, after.orderOutcomes.unfulfilled),
      changedTotal("Pending orders", before.orderOutcomes.pending, after.orderOutcomes.pending),
      changedTotal("Approved commitments", before.approvedCommitmentCount, after.approvedCommitmentCount),
      changedTotal("Completed delivery missions", before.completedMissionCount, after.completedMissionCount),
    );
  } else {
    changes.push(
      changedTotal("Delivered", sourceFrame.totals.acceptedKg, currentFrame.totals.acceptedKg, "kg"),
      changedTotal("Fulfilled demands", sourceFrame.totals.demandsFullyMet, currentFrame.totals.demandsFullyMet),
      changedTotal("Unfulfilled demands", sourceFrame.totals.demandsUnmet, currentFrame.totals.demandsUnmet),
    );
  }

  const sourceWaste = sourceRun.metrics?.wasteQuantity.value;
  const currentWaste = currentRun.metrics?.wasteQuantity.value;
  if (sourceWaste !== undefined && currentWaste !== undefined) {
    changes.push(changedTotal("Physical waste", sourceWaste, currentWaste, "kg"));
  }

  return {
    sourceRunId: sourceRun.runId,
    changes: changes.filter((change): change is string => change !== null),
  };
}

export async function createParticipantSession(runId: string, productActorId: string) {
  await ensureOperationsSession();
  return unwrap(await client.POST("/v1/simulation-runs/{runId}/participant-sessions", {
    params: {
      path: { runId },
      header: { "Idempotency-Key": newIdempotencyKey("participant-replay") },
    },
    body: { productActorId },
  }));
}

/** Human wording for an engine or connected-agent event, used by the feed. */
const EVENT_LABELS: Record<string, string> = {
  WORLD_TICK: "Daily world update",
  FARMER_OBSERVATION: "Grower reported on a crop",
  BUYER_DEMAND: "Buyer placed an order",
  PLAN_ALLOCATION: "Supply matched to an order",
  APPROVAL_GATE: "Commitment reached approval",
  MISSION_DEPART: "Vehicle collected and departed",
  MISSION_ARRIVE: "Delivery arrived",
  DISRUPTION_START: "Disruption became visible",
  DISRUPTION_END: "Disruption cleared",
  DEMAND_DEADLINE: "Order deadline passed",
  RUN_SETTLED: "Run settled at the scenario horizon",
};

export function describeEvent(eventType: string): string {
  return EVENT_LABELS[eventType] ?? eventType.toLowerCase().replace(/_/g, " ");
}

export function isNotableEvent(eventType: string): boolean {
  return eventType !== "WORLD_TICK";
}

export function isAlertEvent(eventType: string): boolean {
  return eventType === "DISRUPTION_START" || eventType === "DEMAND_DEADLINE";
}
