import { createHarvestClient, newIdempotencyKey, type ApiSchema } from "@harvest/shared";

export const productApiUrl =
  process.env.NEXT_PUBLIC_PRODUCT_API_URL ?? "http://localhost:3001";

const TOKEN_KEY = "harvest.access-token";
const ACTOR_KEY = "harvest.actor";

export interface SessionActor {
  actorId: string;
  authSubject: string;
  name: string;
  role: string;
  synthetic: boolean;
}

export class ApiProblem extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
  }
}

export const client = createHarvestClient({
  baseUrl: productApiUrl,
  getAccessToken: () =>
    typeof window === "undefined" ? null : window.localStorage.getItem(TOKEN_KEY),
});

export function currentActor(): SessionActor | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(ACTOR_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored) as SessionActor;
  } catch {
    return null;
  }
}

export function currentToken() {
  return typeof window === "undefined" ? null : window.localStorage.getItem(TOKEN_KEY);
}

export async function createDevelopmentSession(persona = "operations-demo") {
  const response = await fetch(`${productApiUrl}/dev/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ persona }),
  });
  if (!response.ok) throw await problemFromResponse(response);
  const session = (await response.json()) as { accessToken: string; actor: SessionActor };
  window.localStorage.setItem(TOKEN_KEY, session.accessToken);
  window.localStorage.setItem(ACTOR_KEY, JSON.stringify(session.actor));
  return session.actor;
}

export async function ensureDevelopmentSession() {
  return currentActor() ?? createDevelopmentSession();
}

export async function problemFromResponse(response: Response) {
  let body: { detail?: string; code?: string } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    // A non-JSON upstream error still becomes a useful client error.
  }
  return new ApiProblem(
    body.detail ?? `Product API returned ${response.status}.`,
    response.status,
    body.code ?? "API_ERROR",
  );
}

export function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (result.error !== undefined || result.data === undefined) {
    const detail = result.error as { detail?: string; code?: string } | undefined;
    throw new ApiProblem(
      detail?.detail ?? `Product API returned ${result.response.status}.`,
      result.response.status,
      detail?.code ?? "API_ERROR",
    );
  }
  return result.data;
}

export const api = {
  async cropBatches() {
    return unwrap(await client.GET("/v1/crop-batches"));
  },
  async prediction(predictionId: string) {
    return unwrap(await client.GET("/v1/yield-predictions/{predictionId}", { params: { path: { predictionId } } }));
  },
  async listings(cropType?: string) {
    return unwrap(await client.GET("/v1/listings", { params: { query: { cropType } } }));
  },
  async demands() {
    return unwrap(await client.GET("/v1/buyer-demands"));
  },
  async createDemand(body: ApiSchema<"BuyerDemandCreate">) {
    return unwrap(await client.POST("/v1/buyer-demands", { params: { header: { "Idempotency-Key": newIdempotencyKey("demand") } }, body }));
  },
  async orders() {
    return unwrap(await client.GET("/v1/orders"));
  },
  async order(orderId: string) {
    return unwrap(await client.GET("/v1/orders/{orderId}", { params: { path: { orderId } } }));
  },
  async createOrder(body: ApiSchema<"OrderCreate">) {
    return unwrap(await client.POST("/v1/orders", { params: { header: { "Idempotency-Key": newIdempotencyKey("order") } }, body }));
  },
  async approvals(status?: "PENDING" | "APPROVED" | "REJECTED") {
    return unwrap(await client.GET("/v1/approvals", { params: { query: { status } } }));
  },
  async decideApproval(approvalId: string, decision: "APPROVE" | "REJECT", reason?: string) {
    return unwrap(await client.POST("/v1/approvals/{approvalId}/decisions", { params: { path: { approvalId }, header: { "Idempotency-Key": newIdempotencyKey("approval") } }, body: { decision, reason } }));
  },
  async missions() {
    return unwrap(await client.GET("/v1/delivery-missions"));
  },
  async acceptMission(missionId: string, vehicleId: string) {
    return unwrap(await client.POST("/v1/delivery-missions/{missionId}/acceptance", { params: { path: { missionId }, header: { "Idempotency-Key": newIdempotencyKey("mission") } }, body: { decision: "ACCEPT", vehicleId } }));
  },
  async updateMission(missionId: string, updateType: "PICKED_UP" | "POSITION" | "DELAYED" | "ARRIVED" | "DELIVERED") {
    return unwrap(await client.POST("/v1/delivery-missions/{missionId}/updates", { params: { path: { missionId }, header: { "Idempotency-Key": newIdempotencyKey("delivery") } }, body: { updateType, recordedAt: new Date().toISOString() } }));
  },
  async exceptions() {
    return unwrap(await client.GET("/v1/exceptions"));
  },
  async createException(body: ApiSchema<"ExceptionCreate">) {
    return unwrap(await client.POST("/v1/exceptions", { params: { header: { "Idempotency-Key": newIdempotencyKey("exception") } }, body }));
  },
  async acceptDelivery(deliveryId: string, acceptedQuantity: number) {
    return unwrap(await client.POST("/v1/deliveries/{deliveryId}/acceptance", { params: { path: { deliveryId }, header: { "Idempotency-Key": newIdempotencyKey("receipt") } }, body: { outcome: "ACCEPTED", acceptedQuantity: { value: acceptedQuantity, unit: "kg" }, rejectedQuantity: { value: 0, unit: "kg" } } }));
  },
  async snapshot(simulationRunId?: string) {
    return unwrap(await client.GET("/v1/operations/snapshot", { params: { query: { simulationRunId } } }));
  },
  async trace(traceId: string) {
    return unwrap(await client.GET("/v1/agent-traces/{traceId}", { params: { path: { traceId } } }));
  },
  async simulationRun(runId: string) {
    return unwrap(await client.GET("/v1/simulation-runs/{runId}", { params: { path: { runId } } }));
  },
  async simulationWorld(runId: string) {
    return unwrap(await client.GET("/v1/simulation-runs/{runId}/world", { params: { path: { runId } } }));
  },
  async commandSimulation(runId: string, body: ApiSchema<"SimulationCommand">) {
    return unwrap(await client.POST("/v1/simulation-runs/{runId}/commands", { params: { path: { runId }, header: { "Idempotency-Key": newIdempotencyKey("simulation") } }, body }));
  },
  async createPair() {
    return unwrap(await client.POST("/v1/paired-runs", { params: { header: { "Idempotency-Key": newIdempotencyKey("benchmark") } }, body: { scenarioId: "saint-lucia-demo-v1", seed: 8675309 } }));
  },
  async pair(pairId: string) {
    return unwrap(await client.GET("/v1/paired-runs/{pairId}", { params: { path: { pairId } } }));
  },
};
