import { createHarvestClient, newIdempotencyKey, type ApiSchema } from "@harvest/shared";

export type DecisionReasonCode = ApiSchema<"DecisionReasonCode">;

/** Structured explanation the API requires with every rejection. */
export interface DecisionReason {
  reasonCode: DecisionReasonCode;
  nextAction: string;
}

export const productApiUrl =
  process.env.NEXT_PUBLIC_PRODUCT_API_URL ?? "http://localhost:3001";

const TOKEN_KEY = "harvest.access-token";
const ACTOR_KEY = "harvest.actor";
const DEVELOPMENT_PERSONA_FRAGMENT = "#harvest_demo_persona=";

const DEVELOPMENT_PERSONAS = [
  "farmer-ana",
  "buyer-hotel",
  "transporter-daniel",
  "coordinator-maya",
] as const;

export type DevelopmentPersona = (typeof DEVELOPMENT_PERSONAS)[number];

export type ProductRole = "FARMER" | "BUYER" | "TRANSPORTER" | "COORDINATOR";

export interface SessionActor {
  actorId: string;
  authSubject: string;
  name: string;
  role: ProductRole;
  synthetic: boolean;
  serviceZone?: string;
  deliveryLocation?: { latitude: number; longitude: number };
  simulationRunId?: string;
  simulationRunStatus?: string;
  readOnly?: boolean;
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

export function clearDevelopmentSession() {
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(ACTOR_KEY);
}

export function roleHome(role: ProductRole) {
  return {
    FARMER: "/farmer",
    BUYER: "/buyer",
    TRANSPORTER: "/transporter",
    COORDINATOR: "/coordinator",
  }[role];
}

export async function createDevelopmentSession(persona: string) {
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

export function developmentPersonaFromHash(hash: string): DevelopmentPersona | null {
  if (!hash.startsWith(DEVELOPMENT_PERSONA_FRAGMENT)) return null;
  try {
    const candidate = decodeURIComponent(hash.slice(DEVELOPMENT_PERSONA_FRAGMENT.length));
    return DEVELOPMENT_PERSONAS.find((persona) => persona === candidate) ?? null;
  } catch {
    return null;
  }
}

export async function consumeDevelopmentPersona(): Promise<SessionActor | null> {
  if (typeof window === "undefined" || !window.location.hash.startsWith(DEVELOPMENT_PERSONA_FRAGMENT)) return null;
  const persona = developmentPersonaFromHash(window.location.hash);
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  clearDevelopmentSession();
  if (process.env.NODE_ENV === "production" || !persona) return null;
  return createDevelopmentSession(persona);
}

export async function consumeSimulationSession(): Promise<SessionActor | null> {
  if (typeof window === "undefined" || !window.location.hash.startsWith("#harvest_access_token=")) return null;
  const token = decodeURIComponent(window.location.hash.slice("#harvest_access_token=".length));
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  if (!token) throw new ApiProblem("The simulation participant token is missing.", 401, "SIMULATION_TOKEN_MISSING");
  window.localStorage.setItem(TOKEN_KEY, token);
  const me = unwrap(await client.GET("/v1/me"));
  if (!["FARMER", "BUYER", "TRANSPORTER", "COORDINATOR"].includes(me.role)) {
    clearDevelopmentSession();
    throw new ApiProblem("This simulation identity cannot open a participant workspace.", 403, "PARTICIPANT_ROLE_REQUIRED");
  }
  const actor: SessionActor = {
    actorId: me.actorId,
    authSubject: me.authSubject,
    name: me.name,
    role: me.role as ProductRole,
    synthetic: me.synthetic,
    serviceZone: me.serviceZone,
    deliveryLocation: me.location,
    simulationRunId: me.simulationRunId,
    simulationRunStatus: me.simulationRunStatus,
    readOnly: me.readOnly,
  };
  window.localStorage.setItem(ACTOR_KEY, JSON.stringify(actor));
  return actor;
}

async function problemFromResponse(response: Response) {
  let body: { detail?: string; code?: string } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    // Preserve a useful message when an upstream service returns non-JSON.
  }
  return new ApiProblem(
    body.detail ?? `Product API returned ${response.status}.`,
    response.status,
    body.code ?? "API_ERROR",
  );
}

function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
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
  async worldMap() {
    return unwrap(await client.GET("/v1/world-map"));
  },
  async cropBatches() {
    return unwrap(await client.GET("/v1/crop-batches"));
  },
  async cropBatch(cropBatchId: string) {
    return unwrap(await client.GET("/v1/crop-batches/{cropBatchId}", { params: { path: { cropBatchId } } }));
  },
  async cropStandards(cropType: string) {
    return unwrap(await client.GET("/v1/crop-standards", { params: { query: { cropType, limit: 100 } } }));
  },
  async createObservationIntake(body: ApiSchema<"CropObservationIntakeCreate">) {
    return unwrap(await client.POST("/v1/crop-observation-intakes", {
      params: { header: { "Idempotency-Key": newIdempotencyKey("intake") } },
      body,
    }));
  },
  async submitObservation(body: ApiSchema<"CropObservationCreate">, idempotencyKey = newIdempotencyKey("observation")) {
    return unwrap(await client.POST("/v1/crop-observations", {
      params: { header: { "Idempotency-Key": idempotencyKey } },
      body,
    }));
  },
  async requestForecast(cropBatchId: string, reason: "NEW_OBSERVATION" | "MANUAL_REFRESH") {
    return unwrap(await client.POST("/v1/crop-batches/{cropBatchId}/forecast-requests", {
      params: { path: { cropBatchId }, header: { "Idempotency-Key": newIdempotencyKey("forecast") } },
      body: { reason },
    }));
  },
  async prediction(predictionId: string) {
    return unwrap(await client.GET("/v1/yield-predictions/{predictionId}", { params: { path: { predictionId } } }));
  },
  async listings(cropType?: string) {
    return unwrap(await client.GET("/v1/listings", { params: { query: { cropType } } }));
  },
  async listing(listingId: string) {
    return unwrap(await client.GET("/v1/listings/{listingId}", { params: { path: { listingId } } }));
  },
  async marketOpportunities(cropType?: string) {
    return unwrap(await client.GET("/v1/market-opportunities", { params: { query: { cropType } } }));
  },
  async createListing(body: ApiSchema<"ListingCreate">, idempotencyKey = newIdempotencyKey("listing")) {
    return unwrap(await client.POST("/v1/listings", {
      params: { header: { "Idempotency-Key": idempotencyKey } },
      body,
    }));
  },
  async demands() {
    return unwrap(await client.GET("/v1/buyer-demands"));
  },
  async createDemand(body: ApiSchema<"BuyerDemandCreate">) {
    return unwrap(await client.POST("/v1/buyer-demands", {
      params: { header: { "Idempotency-Key": newIdempotencyKey("demand") } },
      body,
    }));
  },
  async orders(cropBatchId?: string) {
    return unwrap(await client.GET("/v1/orders", { params: { query: { cropBatchId } } }));
  },
  async order(orderId: string) {
    return unwrap(await client.GET("/v1/orders/{orderId}", { params: { path: { orderId } } }));
  },
  /** Harvest records that the buyer paid outside Harvest. It never moves money. */
  async confirmPayment(orderId: string, reference?: string) {
    return unwrap(await client.POST("/v1/orders/{orderId}/payment-confirmations", {
      params: { path: { orderId }, header: { "Idempotency-Key": newIdempotencyKey("payment") } },
      body: reference ? { reference } : {},
    }));
  },
  async agentTrace(traceId: string) {
    return unwrap(await client.GET("/v1/agent-traces/{traceId}", { params: { path: { traceId } } }));
  },
  async createOrder(body: ApiSchema<"OrderCreate">) {
    return unwrap(await client.POST("/v1/orders", {
      params: { header: { "Idempotency-Key": newIdempotencyKey("order") } },
      body,
    }));
  },
  async approvals(status?: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED") {
    return unwrap(await client.GET("/v1/approvals", { params: { query: { status } } }));
  },
  async decideApproval(
    approvalId: string,
    decision: "APPROVE" | "REJECT",
    reason?: string,
    reasonCode?: DecisionReasonCode,
    nextAction?: string,
  ) {
    return unwrap(await client.POST("/v1/approvals/{approvalId}/decisions", {
      params: { path: { approvalId }, header: { "Idempotency-Key": newIdempotencyKey("approval") } },
      body: { decision, reason, reasonCode, nextAction },
    }));
  },
  async missions(status?: "AVAILABLE" | "ASSIGNED" | "PICKUP_IN_PROGRESS" | "IN_TRANSIT" | "DELIVERED" | "CANCELLED") {
    return unwrap(await client.GET("/v1/delivery-missions", { params: { query: { status } } }));
  },
  async mission(missionId: string) {
    return unwrap(await client.GET("/v1/delivery-missions/{missionId}", { params: { path: { missionId } } }));
  },
  async missionUpdates(missionId: string) {
    return unwrap(await client.GET("/v1/delivery-missions/{missionId}/updates", { params: { path: { missionId } } }));
  },
  async vehicles() {
    return unwrap(await client.GET("/v1/me/vehicles"));
  },
  async acceptMission(missionId: string, vehicleId: string) {
    return unwrap(await client.POST("/v1/delivery-missions/{missionId}/acceptance", {
      params: { path: { missionId }, header: { "Idempotency-Key": newIdempotencyKey("mission") } },
      body: { decision: "ACCEPT", vehicleId },
    }));
  },
  async updateMission(
    missionId: string,
    updateType: "PICKED_UP" | "POSITION" | "DELAYED" | "ARRIVED" | "DELIVERED",
    note?: string,
  ) {
    return unwrap(await client.POST("/v1/delivery-missions/{missionId}/updates", {
      params: { path: { missionId }, header: { "Idempotency-Key": newIdempotencyKey("delivery") } },
      body: { updateType, recordedAt: new Date().toISOString(), note },
    }));
  },
  async exceptions() {
    return unwrap(await client.GET("/v1/exceptions"));
  },
  async exception(exceptionId: string) {
    return unwrap(await client.GET("/v1/exceptions/{exceptionId}", { params: { path: { exceptionId } } }));
  },
  async verificationTasks(status?: "OPEN" | "VERIFIED" | "CHANGES_REQUESTED" | "UNVERIFIED") {
    return unwrap(await client.GET("/v1/verification-tasks", { params: { query: { status } } }));
  },
  async decideVerificationTask(taskId: string, decision: "VERIFY" | "REQUEST_CHANGES", note?: string) {
    return unwrap(await client.POST("/v1/verification-tasks/{taskId}/decisions", {
      params: { path: { taskId }, header: { "Idempotency-Key": newIdempotencyKey("verification") } },
      body: { decision, note },
    }));
  },
  async createException(body: ApiSchema<"ExceptionCreate">) {
    return unwrap(await client.POST("/v1/exceptions", {
      params: { header: { "Idempotency-Key": newIdempotencyKey("exception") } },
      body,
    }));
  },
  async acceptDelivery(
    deliveryId: string,
    acceptedQuantity: number,
    rejectedQuantity: number,
    outcome: "ACCEPTED" | "PARTIALLY_ACCEPTED" | "REJECTED",
    lineOutcomes: ApiSchema<"DeliveryLineOutcome">[],
    note?: string,
    reasonCode?: DecisionReasonCode,
    nextAction?: string,
  ) {
    return unwrap(await client.POST("/v1/deliveries/{deliveryId}/acceptance", {
      params: { path: { deliveryId }, header: { "Idempotency-Key": newIdempotencyKey("receipt") } },
      body: {
        outcome,
        acceptedQuantity: { value: acceptedQuantity, unit: "kg" },
        rejectedQuantity: { value: rejectedQuantity, unit: "kg" },
        lineOutcomes,
        note,
        reasonCode,
        nextAction,
      },
    }));
  },
};
