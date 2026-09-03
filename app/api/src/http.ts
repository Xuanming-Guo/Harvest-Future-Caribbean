import { createHash } from "node:crypto";

import type { Prisma } from "@prisma/client";
import type { FastifyReply, FastifyRequest } from "fastify";

import { prisma } from "./db.js";

export interface HttpError extends Error {
  statusCode: number;
  code: string;
}

export function httpError(statusCode: number, code: string, message: string): HttpError {
  return Object.assign(new Error(message), { statusCode, code });
}

export function assertObjectBody(
  body: unknown,
  allowedKeys: string[],
  requiredKeys: string[] = [],
) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw httpError(400, "VALIDATION_FAILED", "A JSON object body is required.");
  }
  const value = body as Record<string, unknown>;
  const unknown = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (unknown.length) {
    throw httpError(400, "VALIDATION_FAILED", `Unknown field${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}.`);
  }
  const missing = requiredKeys.filter((key) => value[key] === undefined);
  if (missing.length) {
    throw httpError(400, "VALIDATION_FAILED", `Missing required field${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.`);
  }
  return value;
}

export function readQuantity(value: unknown, field = "quantity") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw httpError(400, "VALIDATION_FAILED", `${field} must be an object.`);
  }
  const quantity = value as Record<string, unknown>;
  if (quantity.unit !== "kg" || typeof quantity.value !== "number" || quantity.value < 0) {
    throw httpError(422, "INVALID_QUANTITY", `${field} must contain a non-negative numeric value and unit kg.`);
  }
  return quantity.value;
}

export const decisionReasonCodes = [
  "QUANTITY_MISMATCH",
  "MATURITY_OR_QUALITY",
  "DAMAGE",
  "CLEANLINESS",
  "SIZE_OR_GRADE",
  "MISSING_INFORMATION",
  "OTHER",
] as const;

export type DecisionReasonCode = (typeof decisionReasonCodes)[number];

export interface DecisionReason {
  reasonCode: DecisionReasonCode | null;
  nextAction: string | null;
}

export const decisionReasonKeys = ["reasonCode", "nextAction"] as const;

/**
 * Reads the optional structured explanation attached to a rejection. Both
 * fields stay optional here so historic records and accepted outcomes keep
 * working; `requireDecisionReason` enforces them where a rejection happened.
 */
export function readDecisionReason(value: Record<string, unknown>, field = ""): DecisionReason {
  const prefix = field ? `${field}.` : "";
  const rawCode = value.reasonCode;
  const rawAction = value.nextAction;
  if (rawCode !== undefined && (typeof rawCode !== "string" || !decisionReasonCodes.includes(rawCode as DecisionReasonCode))) {
    throw httpError(422, "INVALID_DECISION_REASON", `${prefix}reasonCode must be one of ${decisionReasonCodes.join(", ")}.`);
  }
  if (rawAction !== undefined && (typeof rawAction !== "string" || !rawAction.trim() || rawAction.trim().length > 300)) {
    throw httpError(422, "INVALID_DECISION_REASON", `${prefix}nextAction must be plain text of 1-300 characters.`);
  }
  return {
    reasonCode: rawCode === undefined ? null : (rawCode as DecisionReasonCode),
    nextAction: typeof rawAction === "string" ? rawAction.trim() : null,
  };
}

/** A rejection must say what was wrong and what the affected person does next. */
export function requireDecisionReason(reason: DecisionReason, detail: string) {
  if (!reason.reasonCode || !reason.nextAction) throw httpError(422, "DECISION_REASON_REQUIRED", detail);
  return reason;
}

export function readLocation(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw httpError(400, "VALIDATION_FAILED", "deliveryLocation must be an object.");
  }
  const location = value as Record<string, unknown>;
  if (
    typeof location.latitude !== "number" ||
    typeof location.longitude !== "number" ||
    location.latitude < -90 ||
    location.latitude > 90 ||
    location.longitude < -180 ||
    location.longitude > 180
  ) {
    throw httpError(422, "INVALID_LOCATION", "Latitude or longitude is outside its valid range.");
  }
  return { latitude: location.latitude, longitude: location.longitude };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function idempotent<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  statusCode: number,
  operation: () => Promise<T>,
) {
  if (!request.actor) throw httpError(401, "AUTHENTICATION_REQUIRED", "Authentication is required.");
  const key = request.headers["idempotency-key"];
  if (typeof key !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(key)) {
    throw httpError(400, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key must be 8-128 safe ASCII characters.");
  }
  const method = request.method.toUpperCase();
  const path = request.routeOptions.url ?? request.url.split("?")[0];
  const requestHash = createHash("sha256").update(stableJson(request.body ?? null)).digest("hex");
  const where = { actorId_method_path_key: { actorId: request.actor.id, method, path, key } };
  const existing = await prisma.idempotencyRecord.findUnique({ where });
  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw httpError(409, "IDEMPOTENCY_CONFLICT", "This idempotency key was already used with a different request body.");
    }
    return reply.code(existing.statusCode).send(existing.responseBody);
  }

  const response = await operation();
  await prisma.idempotencyRecord.create({
    data: {
      actorId: request.actor.id,
      method,
      path,
      key,
      requestHash,
      statusCode,
      responseBody: response as Prisma.InputJsonValue,
      simulationRunId: request.actor.simulationRunId,
    },
  });
  return reply.code(statusCode).send(response);
}

export function sendProblem(reply: FastifyReply, error: unknown) {
  const status = typeof error === "object" && error && "statusCode" in error
    ? Number((error as { statusCode: unknown }).statusCode)
    : 500;
  const code = typeof error === "object" && error && "code" in error
    ? String((error as { code: unknown }).code)
    : "INTERNAL_ERROR";
  const detail = error instanceof Error ? error.message : "An unexpected error occurred.";
  return reply.code(status).type("application/problem+json").send({
    type: `/problems/${code.toLowerCase().replaceAll("_", "-")}`,
    title: status >= 500 ? "Internal server error" : "Request could not be completed",
    status,
    code,
    detail,
  });
}
