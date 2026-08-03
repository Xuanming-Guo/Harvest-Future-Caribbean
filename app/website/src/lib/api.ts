import { createHarvestClient, newIdempotencyKey, type ApiSchema } from "@harvest/shared";

export const productApiUrl =
  process.env.NEXT_PUBLIC_PRODUCT_API_URL ?? "http://localhost:3001";

const TOKEN_KEY = "harvest.access-token";
const ACTOR_KEY = "harvest.actor";

export type ProductRole = "FARMER" | "BUYER" | "TRANSPORTER" | "COORDINATOR";

export interface SessionActor {
  actorId: string;
  authSubject: string;
  name: string;
  role: ProductRole;
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
  async cropBatches() {
    return unwrap(await client.GET("/v1/crop-batches"));
  },
  async cropBatch(cropBatchId: string) {
    return unwrap(await client.GET("/v1/crop-batches/{cropBatchId}", { params: { path: { cropBatchId } } }));
  },
  async submitObservation(body: ApiSchema<"CropObservationCreate">) {
    return unwrap(await client.POST("/v1/crop-observations", {
      params: { header: { "Idempotency-Key": newIdempotencyKey("observation") } },
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
  async createListing(body: ApiSchema<"ListingCreate">) {
    return unwrap(await client.POST("/v1/listings", {
      params: { header: { "Idempotency-Key": newIdempotencyKey("listing") } },
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
  async orders() {
    return unwrap(await client.GET("/v1/orders"));
  },
  async order(orderId: string) {
    return unwrap(await client.GET("/v1/orders/{orderId}", { params: { path: { orderId } } }));
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
  async decideApproval(approvalId: string, decision: "APPROVE" | "REJECT", reason?: string) {
    return unwrap(await client.POST("/v1/approvals/{approvalId}/decisions", {
      params: { path: { approvalId }, header: { "Idempotency-Key": newIdempotencyKey("approval") } },
      body: { decision, reason },
    }));
  },
  async missions(status?: "AVAILABLE" | "ASSIGNED" | "PICKUP_IN_PROGRESS" | "IN_TRANSIT" | "DELIVERED" | "CANCELLED") {
    return unwrap(await client.GET("/v1/delivery-missions", { params: { query: { status } } }));
  },
  async mission(missionId: string) {
    return unwrap(await client.GET("/v1/delivery-missions/{missionId}", { params: { path: { missionId } } }));
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
    note?: string,
  ) {
    return unwrap(await client.POST("/v1/deliveries/{deliveryId}/acceptance", {
      params: { path: { deliveryId }, header: { "Idempotency-Key": newIdempotencyKey("receipt") } },
      body: {
        outcome,
        acceptedQuantity: { value: acceptedQuantity, unit: "kg" },
        rejectedQuantity: { value: rejectedQuantity, unit: "kg" },
        note,
      },
    }));
  },
};
