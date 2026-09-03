import { randomUUID } from "node:crypto";

import { Prisma, Provenance } from "@prisma/client";

import { operationNow } from "./clock.js";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { recordEvent } from "./events.js";
import { httpError, type DecisionReason } from "./http.js";

const kilograms = (value: number) => ({ value, unit: "kg" });

/** Nullable reason columns written alongside a recorded human decision. */
const decisionReasonColumns = (decisionReason?: DecisionReason) => ({
  reasonCode: decisionReason?.reasonCode ?? null,
  nextAction: decisionReason?.nextAction ?? null,
});

/** Additive reason fields carried on an `APPROVAL_DECIDED` payload. */
const decisionReasonPayload = (decisionReason?: DecisionReason) => ({
  ...(decisionReason?.reasonCode ? { reasonCode: decisionReason.reasonCode } : {}),
  ...(decisionReason?.nextAction ? { nextAction: decisionReason.nextAction } : {}),
});

/** Plain-language order note explaining a declined commitment. */
function declineNote(reason: string | undefined, decisionReason?: DecisionReason) {
  const parts = [reason ?? "A participant declined the proposed commitment."];
  if (decisionReason?.nextAction) parts.push(`Next: ${decisionReason.nextAction}`);
  return parts.join(" ");
}

/** Crop-batch statuses whose produce may be promised and listed. */
export const READY_BATCH_STATUSES = new Set(["HARVEST_READY", "HARVESTED"]);
export const isReadyStatus = (status: string) => READY_BATCH_STATUSES.has(status);

/** Product crop-batch status implied by a reported observation stage. */
export function batchStatusForStage(cropStage: string): string {
  switch (cropStage.toUpperCase()) {
    case "HARVEST_READY": return "HARVEST_READY";
    case "HARVESTED": return "HARVESTED";
    case "PLANNED": return "PLANNED";
    default: return "GROWING";
  }
}

/**
 * Flip listings whose window has closed to `EXPIRED` so they stop looking
 * orderable. Matching already ignored them by date; the visible status did
 * not agree, which #53 called out. Idempotent: an already-expired listing is
 * never touched again.
 */
export async function expireListings(actorId: string, simulationRunId: string | null) {
  const now = operationNow();
  const stale = await prisma.listing.findMany({
    where: { status: "ACTIVE", availableUntil: { lt: now }, simulationRunId },
    orderBy: { id: "asc" },
  });
  if (stale.length === 0) return 0;
  await prisma.$transaction(async (tx) => {
    for (const listing of stale) {
      await tx.listing.update({ where: { id: listing.id }, data: { status: "EXPIRED" } });
      await recordEvent(tx, {
        eventType: "LISTING_EXPIRED",
        actorId,
        entityId: listing.id,
        traceId: randomUUID(),
        provenance: Provenance.INFERRED,
        simulationRunId,
        payload: { listingId: listing.id, cropBatchId: listing.cropBatchId, availableUntil: listing.availableUntil.toISOString().slice(0, 10) },
      });
    }
  });
  return stale.length;
}

/**
 * Give orders that were waiting for supply another matching pass once new
 * supply of their crop is published. Oldest deadline first, one pass per
 * trigger, no scheduler: the trigger is the listing publish itself.
 */
export async function rematchWaitingOrders(cropType: string, actorId: string, simulationRunId: string | null) {
  const waiting = await prisma.order.findMany({
    where: { lifecycleStatus: "REQUESTED", cropType, neededBy: { gt: operationNow() }, simulationRunId },
    orderBy: [{ neededBy: "asc" }, { id: "asc" }],
  });
  const proposed: string[] = [];
  for (const order of waiting) {
    const traceId = order.traceId ?? randomUUID();
    if (!order.traceId) {
      await prisma.agentTrace.create({ data: { id: traceId, subjectType: "ORDER", subjectId: order.id, workflowType: "ORDER_FULFILMENT", stage: "ORDER_REQUESTED", status: "RUNNING", summary: "Re-matching a waiting order after new supply was published.", simulationRunId } });
      await prisma.order.update({ where: { id: order.id }, data: { traceId } });
    }
    const result = await proposeAllocation(order.id, actorId, traceId);
    if (result) proposed.push(order.id);
  }
  return proposed;
}

type ModelPrediction = {
  predictionId: string;
  requestId: string;
  cropBatchId: string;
  modelVersion: string;
  q10: number;
  q50: number;
  q90: number;
  harvestStart: Date;
  harvestEnd: Date;
  readiness: number;
  confidence: number;
  warnings: string[];
  generatedAt: Date;
  featureSnapshot: Prisma.InputJsonValue;
};

function modelResponseError(message: string): never {
  throw httpError(502, "MODEL_RESPONSE_INVALID", message);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validNumber(value: unknown, minimum = 0): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum;
}

function parseHttpPrediction(value: unknown, requestId: string, cropBatchId: string, featureSnapshot: Prisma.InputJsonValue): ModelPrediction {
  if (!value || typeof value !== "object" || Array.isArray(value)) modelResponseError("The model returned a non-object response.");
  const body = value as Record<string, unknown>;
  const quantities = [body.q10MarketableYield, body.q50MarketableYield, body.q90MarketableYield];
  if (!isUuid(body.predictionId) || body.requestId !== requestId || body.cropBatchId !== cropBatchId || typeof body.modelVersion !== "string" || !body.modelVersion) {
    modelResponseError("The model response IDs or version do not match the request.");
  }
  if (!quantities.every((quantity) => quantity && typeof quantity === "object" && !Array.isArray(quantity) && (quantity as Record<string, unknown>).unit === "kg" && validNumber((quantity as Record<string, unknown>).value))) {
    modelResponseError("The model response must contain non-negative kg quantiles.");
  }
  const [q10, q50, q90] = quantities.map((quantity) => (quantity as { value: number }).value);
  if (q10 > q50 || q50 > q90) modelResponseError("The model response quantiles are out of order.");
  const window = body.harvestWindow;
  if (!window || typeof window !== "object" || Array.isArray(window)) modelResponseError("The model response harvest window is missing.");
  const start = new Date((window as Record<string, unknown>).start as string);
  const end = new Date((window as Record<string, unknown>).end as string);
  const generatedAt = new Date(body.generatedAt as string);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end || Number.isNaN(generatedAt.getTime())) modelResponseError("The model response includes invalid dates.");
  if (!validNumber(body.readiness) || body.readiness > 1 || !validNumber(body.confidence) || body.confidence > 1 || body.provenance !== "MODEL_PREDICTED" || !Array.isArray(body.warnings) || !body.warnings.every((warning) => typeof warning === "string" && warning.length > 0)) {
    modelResponseError("The model response includes invalid evidence fields.");
  }
  return { predictionId: body.predictionId, requestId, cropBatchId, modelVersion: body.modelVersion, q10, q50, q90, harvestStart: start, harvestEnd: end, readiness: body.readiness, confidence: body.confidence, warnings: body.warnings, generatedAt, featureSnapshot };
}

export interface WorkflowEventContext {
  correlationId?: string;
  causationId?: string | null;
}

type AllocationLineInput = { cropBatchId: string; listingId: string; quantity: number };
type GeoPoint = { latitude: number; longitude: number };

function haversineKm(a: GeoPoint, b: GeoPoint) {
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = toRadians(b.latitude - a.latitude);
  const longitudeDelta = toRadians(b.longitude - a.longitude);
  const firstLatitude = toRadians(a.latitude);
  const secondLatitude = toRadians(b.latitude);
  const h = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

async function buildDeliveryRoute(
  tx: Prisma.TransactionClient,
  lines: AllocationLineInput[],
  buyer: GeoPoint,
) {
  const batchRows = await tx.cropBatch.findMany({
    where: { id: { in: [...new Set(lines.map((line) => line.cropBatchId))] } },
  });
  const farms = await tx.farm.findMany({
    where: { id: { in: [...new Set(batchRows.map((batch) => batch.farmId))] } },
  });
  const farmById = new Map(farms.map((farm) => [farm.id, farm]));
  const batchById = new Map(batchRows.map((batch) => [batch.id, batch]));
  const pickupByFarm = new Map<string, { farmId: string; cropBatchIds: string[]; quantity: number; location: GeoPoint }>();
  for (const line of lines) {
    const batch = batchById.get(line.cropBatchId);
    const farm = batch ? farmById.get(batch.farmId) : undefined;
    if (!batch || !farm) throw httpError(409, "ROUTE_INPUT_MISSING", "A committed pickup farm could not be loaded.");
    const existing = pickupByFarm.get(farm.id) ?? {
      farmId: farm.id,
      cropBatchIds: [],
      quantity: 0,
      location: { latitude: farm.latitude, longitude: farm.longitude },
    };
    existing.quantity += line.quantity;
    if (!existing.cropBatchIds.includes(line.cropBatchId)) existing.cropBatchIds.push(line.cropBatchId);
    pickupByFarm.set(farm.id, existing);
  }

  // There is no transporter depot in the Product API yet. Build a deterministic
  // outward chain from the buyer, then reverse it so the mission moves back
  // toward its final drop-off.
  const remaining = [...pickupByFarm.values()];
  const outward: typeof remaining = [];
  let cursor = buyer;
  while (remaining.length) {
    remaining.sort((left, right) => {
      const distance = haversineKm(cursor, left.location) - haversineKm(cursor, right.location);
      return Math.abs(distance) > 0.000001 ? distance : left.farmId.localeCompare(right.farmId);
    });
    const next = remaining.shift()!;
    outward.push(next);
    cursor = next.location;
  }
  const pickups = outward.reverse();
  let distanceKm = 0;
  for (let index = 1; index < pickups.length; index += 1) {
    distanceKm += haversineKm(pickups[index - 1].location, pickups[index].location);
  }
  if (pickups.length) distanceKm += haversineKm(pickups[pickups.length - 1].location, buyer);
  const durationMinutes = Math.ceil(distanceKm / 30 * 60 + pickups.length * 15);
  const estimatedArrival = new Date(operationNow().getTime() + durationMinutes * 60_000);
  const stops = [
    ...pickups.map((pickup, index) => ({
      sequence: index + 1,
      kind: "PICKUP",
      farmId: pickup.farmId,
      cropBatchIds: pickup.cropBatchIds.sort(),
      quantity: kilograms(pickup.quantity),
      location: pickup.location,
    })),
    { sequence: pickups.length + 1, kind: "DROPOFF", quantity: kilograms(lines.reduce((sum, line) => sum + line.quantity, 0)), location: buyer },
  ];
  return { stops, distanceKm: Number(distanceKm.toFixed(2)), durationMinutes, estimatedArrival };
}

async function serializableTransaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
      if (!retryable || attempt === 3) throw error;
    }
  }
  throw new Error("Serializable transaction retry limit reached.");
}

export async function produceFixturePrediction(
  cropBatchId: string,
  actorId: string,
  traceId: string,
  eventContext: WorkflowEventContext = {},
) {
  const batch = await prisma.cropBatch.findUnique({ where: { id: cropBatchId } });
  if (!batch) throw httpError(404, "CROP_BATCH_NOT_FOUND", "Crop batch was not found.");
  const observation = await prisma.cropObservation.findFirst({
    where: { cropBatchId, simulationRunId: batch.simulationRunId },
    orderBy: { recordedAt: "desc" },
  });
  const requestId = randomUUID();
  const featureSnapshot = {
    observationCount: observation ? await prisma.cropObservation.count({ where: { cropBatchId, simulationRunId: batch.simulationRunId } }) : 0,
    ...(observation?.estimatedQuantity !== null && observation?.estimatedQuantity !== undefined ? { observationQuantityKg: observation.estimatedQuantity } : {}),
    cropStage: observation?.cropStage ?? "UNKNOWN",
    lastObservedAt: observation?.observedAt.toISOString() ?? null,
    // The Product API does not invent climate or satellite measurements. A
    // deployed feature pipeline may populate these contract allow-lists.
    weatherSummary: {},
    satelliteSummary: {},
  };
  let prediction: ModelPrediction;
  if (config.modelAdapter === "fixture") {
    const estimate = observation?.estimatedQuantity ?? 20;
    const damageBuffer = Math.max(2, Math.round(estimate * 0.3));
    const q10 = Math.max(0, estimate - damageBuffer);
    const q50 = Math.max(q10, estimate - Math.round(damageBuffer / 2));
    const q90 = Math.max(q50, estimate + Math.round(estimate * 0.1));
    const generatedAt = operationNow();
    const start = new Date(generatedAt);
    start.setUTCDate(start.getUTCDate() + 1);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 3);
    prediction = {
      predictionId: randomUUID(), requestId, cropBatchId, modelVersion: "fixture-yield-v0.1.0", q10, q50, q90,
      harvestStart: start, harvestEnd: end, readiness: 0.8, confidence: observation ? 0.76 : 0.55,
      warnings: observation ? ["Synthetic fixture prediction"] : ["No recent field observation"], generatedAt,
      featureSnapshot: { ...featureSnapshot, weatherSummary: { source: "fixture", rainfall7dMm: 74 }, satelliteSummary: { source: "fixture", ndvi: 0.71 } },
    };
  } else if (config.modelAdapter === "http") {
    let response: Response;
    try {
      response = await fetch(`${config.modelServiceUrl.replace(/\/$/, "")}/internal/v1/yield-predictions`, {
        method: "POST",
        headers: { authorization: `Bearer ${config.internalServiceToken}`, "content-type": "application/json", "idempotency-key": `forecast-${requestId}` },
        body: JSON.stringify({ requestId, cropBatchId, cropType: batch.cropType, farmId: batch.farmId, requestedAt: operationNow().toISOString(), ...(batch.simulationRunId ? { simulationRunId: batch.simulationRunId } : {}), provenance: observation?.provenance ?? "SYNTHETIC", features: featureSnapshot }),
      });
    } catch {
      throw httpError(503, "MODEL_UNAVAILABLE", "The configured yield-model service could not be reached.");
    }
    if (!response.ok) throw httpError(503, "MODEL_UNAVAILABLE", "The configured yield-model service rejected the prediction request.");
    prediction = parseHttpPrediction(await response.json(), requestId, cropBatchId, featureSnapshot);
  } else {
    throw httpError(500, "MODEL_ADAPTER_INVALID", "MODEL_ADAPTER must be fixture or http.");
  }

  await prisma.$transaction(async (tx) => {
    const committed = await tx.reservation.aggregate({
      where: { cropBatchId, status: "ACTIVE", simulationRunId: batch.simulationRunId },
      _sum: { quantity: true },
    });
    const committedQuantity = committed._sum.quantity ?? 0;
    // Forecast evidence stays visible, but nothing is orderable until the
    // farmer has reported the crop ready. Promising a growing crop was the
    // first cause of empty delivery trips in #53.
    const current = await tx.cropBatch.findUniqueOrThrow({ where: { id: cropBatchId }, select: { status: true } });
    const availableToPromise = isReadyStatus(current.status) ? Math.max(0, prediction.q10 - committedQuantity) : 0;
    await tx.yieldPrediction.create({
      data: {
        id: prediction.predictionId,
        requestId: prediction.requestId,
        cropBatchId,
        modelVersion: prediction.modelVersion,
        q10: prediction.q10,
        q50: prediction.q50,
        q90: prediction.q90,
        harvestStart: prediction.harvestStart,
        harvestEnd: prediction.harvestEnd,
        readiness: prediction.readiness,
        confidence: prediction.confidence,
        warnings: prediction.warnings,
        featureSnapshot: prediction.featureSnapshot,
        provenance: Provenance.MODEL_PREDICTED,
        generatedAt: prediction.generatedAt,
        simulationRunId: batch.simulationRunId,
      },
    });
    await tx.cropBatch.update({
      where: { id: cropBatchId },
      data: {
        latestPredictionId: prediction.predictionId,
        availableToPromise,
        provenance: Provenance.MODEL_PREDICTED,
      },
    });
    const forecastEvent = await recordEvent(tx, {
      eventType: "FORECAST_PRODUCED",
      actorId,
      entityId: cropBatchId,
      traceId,
      correlationId: eventContext.correlationId,
      causationId: eventContext.causationId,
      provenance: Provenance.MODEL_PREDICTED,
      simulationRunId: batch.simulationRunId,
      payload: {
        predictionId: prediction.predictionId,
        cropBatchId,
        q10MarketableYield: kilograms(prediction.q10),
        committedQuantity: kilograms(committedQuantity),
        availableToPromise: kilograms(availableToPromise),
      },
    });
    await tx.agentTrace.update({
      where: { id: traceId },
      data: { status: "COMPLETED", stage: "FORECAST_READY", summary: "Produced a conservative forecast and calculated available-to-promise after active commitments." },
    });
    await tx.traceStep.create({
      data: {
        traceId,
        recordedAt: prediction.generatedAt,
        kind: "TOOL_CALL",
        agentName: "Crop Intelligence Agent",
        toolName: config.modelAdapter === "http" ? "http-yield-model" : "fixture-yield-model",
        provenance: Provenance.MODEL_PREDICTED,
        summary: isReadyStatus(current.status)
          ? `Forecast q10 is ${prediction.q10} kg; ${committedQuantity} kg is committed, leaving ${availableToPromise} kg ATP.`
          : `Forecast q10 is ${prediction.q10} kg, but the crop is ${current.status.toLowerCase().replaceAll("_", " ")} so ATP stays at 0 kg until it is reported harvest ready.`,
        confidence: prediction.confidence,
        simulationRunId: batch.simulationRunId,
      },
    });
    return forecastEvent;
  });

  return { predictionId: prediction.predictionId, requestId: prediction.requestId };
}

export async function proposeAllocation(orderId: string, actorId: string, traceId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw httpError(404, "ORDER_NOT_FOUND", "Order was not found.");
  const orderEvent = await prisma.domainEvent.findFirst({
    where: { eventType: "ORDER_REQUESTED", entityId: orderId, traceId },
    orderBy: { occurredAt: "desc" },
  });

  await expireListings(actorId, order.simulationRunId);
  const requestedIds = order.listingIds as string[];
  const listings = await prisma.listing.findMany({
    where: {
      cropType: order.cropType,
      status: "ACTIVE",
      availableFrom: { lte: order.neededBy },
      availableUntil: { gte: operationNow() },
      simulationRunId: order.simulationRunId,
      ...(requestedIds.length ? { id: { in: requestedIds } } : {}),
    },
    orderBy: [{ unitPrice: "asc" }, { availableFrom: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  const batches = await prisma.cropBatch.findMany({
    where: { id: { in: [...new Set(listings.map((listing) => listing.cropBatchId))] }, simulationRunId: order.simulationRunId },
  });
  const remainingByBatch = new Map(batches.map((batch) => [batch.id, batch.availableToPromise]));
  // Supply already proposed to another order is held softly until that
  // approval resolves; otherwise re-matching several waiting orders against
  // one new listing would over-promise the same kilograms and every approval
  // but the first would be invalidated.
  const pendingProposals = await prisma.allocation.findMany({
    where: { status: "PROPOSED", orderId: { not: orderId }, simulationRunId: order.simulationRunId },
    select: { id: true },
  });
  if (pendingProposals.length > 0) {
    const softHeld = await prisma.allocationLine.groupBy({
      by: ["cropBatchId"],
      where: { allocationId: { in: pendingProposals.map((row) => row.id) }, cropBatchId: { in: [...remainingByBatch.keys()] } },
      _sum: { quantity: true },
    });
    for (const held of softHeld) {
      remainingByBatch.set(held.cropBatchId, Math.max(0, (remainingByBatch.get(held.cropBatchId) ?? 0) - (held._sum.quantity ?? 0)));
    }
  }

  let remaining = order.requestedQuantity;
  const lines: AllocationLineInput[] = [];
  for (const listing of listings) {
    if (remaining <= 0) break;
    const batchRemaining = remainingByBatch.get(listing.cropBatchId) ?? 0;
    const safe = Math.min(listing.quantity, batchRemaining, remaining);
    if (safe > 0) {
      lines.push({ cropBatchId: listing.cropBatchId, listingId: listing.id, quantity: safe });
      remaining -= safe;
      remainingByBatch.set(listing.cropBatchId, batchRemaining - safe);
    }
  }

  // Stakeholder evidence (#53): a hotel that ordered 6 kg and can be offered 5
  // would rather commit the 5 and source the last kilogram elsewhere than wait
  // for supply that may never arrive. The buyer states that threshold up front
  // on the order, so a partial proposal is still something they consented to.
  const covered = order.requestedQuantity - remaining;
  const coverageFraction = order.requestedQuantity > 0 ? covered / order.requestedQuantity : 0;
  const threshold = order.minimumAcceptableFraction * order.requestedQuantity;
  const isPartial = remaining > 0.0001;

  if (covered + 0.0001 < threshold) {
    const found = covered;
    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: {
          atRisk: false,
          lifecycleStatus: "REQUESTED",
          outcomeCause: found > 0.0001 ? "INSUFFICIENT_SUPPLY" : "NO_READY_SUPPLY",
          outcomeNote: `Found ${found} kg of ${order.requestedQuantity} kg of ready supply.`,
        },
      });
      await tx.agentTrace.update({
        where: { id: traceId },
        data: { status: "WAITING", stage: "AWAITING_SUPPLY", summary: "No complete safe allocation is currently available; the order remains open for supply." },
      });
      await tx.traceStep.create({
        data: {
          traceId,
          recordedAt: operationNow(),
          kind: "EVIDENCE",
          agentName: "Market Balance Agent",
          toolName: "read-safe-supply",
          provenance: Provenance.INFERRED,
          summary: `Found ${covered} kg of ${order.requestedQuantity} kg required, below the ${Math.round(order.minimumAcceptableFraction * 100)}% this buyer accepts. No partial commitment was proposed.`,
          simulationRunId: order.simulationRunId,
        },
      });
    });
    return null;
  }

  const allocationId = randomUUID();
  const coveragePercent = Math.round(coverageFraction * 100);
  const coverageSentence = `covers ${covered} of ${order.requestedQuantity} kg (${coveragePercent}%)`;
  const farmers = await prisma.listing.findMany({
    where: { id: { in: lines.map((line) => line.listingId) }, simulationRunId: order.simulationRunId },
    select: { farmerId: true },
  });
  const approverIds = [...new Set([order.buyerId, ...farmers.map((listing) => listing.farmerId)])];
  const approvalIds = approverIds.map(() => randomUUID());
  await prisma.$transaction(async (tx) => {
    await tx.allocation.create({ data: { id: allocationId, orderId, status: "PROPOSED", simulationRunId: order.simulationRunId } });
    await tx.allocationLine.createMany({ data: lines.map((line) => ({ allocationId, ...line, simulationRunId: order.simulationRunId })) });
    await tx.approval.createMany({
      data: approverIds.map((requestedFromActorId, index) => ({
        id: approvalIds[index],
        subjectType: "ALLOCATION",
        subjectId: allocationId,
        requestedFromActorId,
        status: "PENDING",
        requestedAt: operationNow(),
        simulationRunId: order.simulationRunId,
      })),
    });
    await tx.order.update({ where: { id: orderId }, data: { lifecycleStatus: "AWAITING_APPROVAL", outcomeCause: null, outcomeNote: null } });
    await tx.agentTrace.update({
      where: { id: traceId },
      data: {
        status: "AWAITING_APPROVAL",
        stage: "ALLOCATION_PROPOSED",
        summary: isPartial
          ? `Matched ${coveragePercent}% of the requested quantity, which this buyer accepts, and paused before commitment for human approval.`
          : "Matched complete safe supply and paused before commitment for human approval.",
      },
    });
    await tx.traceStep.create({
      data: {
        traceId,
        recordedAt: operationNow(),
        kind: "EVIDENCE",
        agentName: "Market Balance Agent",
        toolName: "read-safe-supply",
        provenance: Provenance.INFERRED,
        summary: isPartial
          ? `Confirmed ${coverageSentence} using current listing windows and per-batch ATP, at or above the ${Math.round(order.minimumAcceptableFraction * 100)}% this buyer accepts.`
          : `Confirmed complete coverage for ${order.requestedQuantity} kg using current listing windows and per-batch ATP.`,
        simulationRunId: order.simulationRunId,
      },
    });
    await tx.traceStep.create({
      data: {
        traceId,
        recordedAt: operationNow(),
        kind: "DECISION",
        agentName: "Matching Agent",
        toolName: "propose-allocation",
        provenance: Provenance.INFERRED,
        summary: `Proposed ${lines.map((line) => `${line.quantity} kg`).join(" + ")} across ${lines.length} farms.`,
        confidence: 0.94,
        simulationRunId: order.simulationRunId,
      },
    });
    await tx.traceStep.create({
      data: {
        traceId,
        recordedAt: operationNow(),
        kind: "APPROVAL",
        agentName: "Commitment Agent",
        toolName: "request-human-approval",
        provenance: Provenance.INFERRED,
        summary: `Requested approval from the buyer and ${approverIds.length - 1} participating farmer${approverIds.length === 2 ? "" : "s"} for a commitment that ${coverageSentence}; no stock is reserved yet.`,
        simulationRunId: order.simulationRunId,
      },
    });
    await recordEvent(tx, {
      eventType: "ALLOCATION_PROPOSED",
      actorId,
      entityId: allocationId,
      traceId,
      correlationId: orderEvent?.correlationId,
      causationId: orderEvent?.id,
      provenance: Provenance.INFERRED,
      simulationRunId: order.simulationRunId,
      payload: {
        allocationId,
        orderId,
        coverageFraction: Number(coverageFraction.toFixed(4)),
        lines: lines.map((line) => ({ cropBatchId: line.cropBatchId, quantity: kilograms(line.quantity) })),
      },
    });
  });
  return { allocationId, approvalIds };
}

export async function approveAllocation(
  approvalId: string,
  actorId: string,
  reason?: string,
  decisionReason?: DecisionReason,
) {
  return serializableTransaction(
    async (tx) => {
      const approval = await tx.approval.findUnique({ where: { id: approvalId } });
      if (!approval) throw httpError(404, "APPROVAL_NOT_FOUND", "Approval was not found.");
      if (approval.status !== "PENDING") throw httpError(409, "APPROVAL_ALREADY_DECIDED", "This approval already has a final decision.");
      if (approval.requestedFromActorId !== actorId) throw httpError(403, "APPROVAL_FORBIDDEN", "This decision belongs to another participant.");
      if (approval.subjectType !== "ALLOCATION") {
        return approveRecovery(tx, approval, actorId, reason, decisionReason);
      }

      const allocation = await tx.allocation.findUnique({ where: { id: approval.subjectId } });
      if (!allocation) throw httpError(409, "SUBJECT_NOT_FOUND", "The allocation no longer exists.");
      const order = await tx.order.findUnique({ where: { id: allocation.orderId } });
      if (!order || order.lifecycleStatus !== "AWAITING_APPROVAL") {
        throw httpError(409, "STALE_APPROVAL", "The order is no longer awaiting this approval.");
      }
      const lines = await tx.allocationLine.findMany({ where: { allocationId: allocation.id } });
      const decidedAt = operationNow();
      const updatedApproval = await tx.approval.update({
        where: { id: approvalId },
        data: { status: "APPROVED", decidedBy: actorId, decidedAt, reason, ...decisionReasonColumns(decisionReason) },
      });
      const trace = await tx.agentTrace.findFirst({ where: { subjectType: "ORDER", subjectId: order.id } });
      const traceId = order.traceId ?? trace?.id ?? randomUUID();
      const proposedEvent = await tx.domainEvent.findFirst({
        where: { eventType: "ALLOCATION_PROPOSED", entityId: allocation.id },
        orderBy: { occurredAt: "desc" },
      });
      const approvalEvent = await recordEvent(tx, {
        eventType: "APPROVAL_DECIDED",
        actorId,
        entityId: approval.id,
        traceId,
        correlationId: proposedEvent?.correlationId,
        causationId: proposedEvent?.id,
        provenance: Provenance.OBSERVED,
        simulationRunId: order.simulationRunId,
        payload: { approvalId: approval.id, subjectType: "ALLOCATION", subjectId: allocation.id, decision: "APPROVE" },
      });
      if (trace) {
        await tx.traceStep.create({
          data: {
            traceId,
            recordedAt: decidedAt,
            kind: "APPROVAL",
            agentName: "Commitment Agent",
            toolName: "record-human-decision",
            provenance: Provenance.OBSERVED,
            summary: `Human approval recorded${reason ? `: ${reason}` : "."}`,
            simulationRunId: order.simulationRunId,
          },
        });
      }
      const remainingApprovals = await tx.approval.count({
        where: { subjectType: "ALLOCATION", subjectId: allocation.id, status: "PENDING" },
      });
      if (remainingApprovals > 0) {
        return updatedApproval;
      }

      const requiredByBatch = new Map<string, number>();
      const requiredByListing = new Map<string, number>();
      for (const line of lines) {
        requiredByBatch.set(line.cropBatchId, (requiredByBatch.get(line.cropBatchId) ?? 0) + line.quantity);
        requiredByListing.set(line.listingId, (requiredByListing.get(line.listingId) ?? 0) + line.quantity);
      }
      const batches = await tx.cropBatch.findMany({ where: { id: { in: [...requiredByBatch.keys()] } } });
      const listings = await tx.listing.findMany({ where: { id: { in: [...requiredByListing.keys()] } } });
      const batchById = new Map(batches.map((batch) => [batch.id, batch]));
      const listingById = new Map(listings.map((listing) => [listing.id, listing]));
      const invalidSupply = [...requiredByBatch].some(([id, required]) => (batchById.get(id)?.availableToPromise ?? -1) + 0.0001 < required) ||
        [...requiredByListing].some(([id, required]) => {
          const listing = listingById.get(id);
          return !listing || listing.status !== "ACTIVE" || listing.quantity + 0.0001 < required;
        });
      if (invalidSupply) {
        await tx.allocation.update({ where: { id: allocation.id }, data: { status: "STALE" } });
        await tx.order.update({ where: { id: order.id }, data: { lifecycleStatus: "REQUESTED", atRisk: false, outcomeCause: "SUPPLY_CHANGED", outcomeNote: "Safe supply changed before every participant approved." } });
        await tx.approval.updateMany({
          where: { subjectType: "ALLOCATION", subjectId: allocation.id, status: "PENDING" },
          data: { status: "CANCELLED", decidedAt, reason: "Cancelled because safe supply changed before commitment." },
        });
        if (trace) {
          await tx.agentTrace.update({ where: { id: traceId }, data: { status: "WAITING", stage: "AWAITING_SUPPLY", summary: "Supply changed before final commitment; the proposal was invalidated without reserving stock." } });
          await tx.traceStep.create({
            data: { traceId, recordedAt: decidedAt, kind: "DECISION", agentName: "Commitment Agent", toolName: "revalidate-safe-supply", provenance: Provenance.INFERRED, summary: "Invalidated the allocation because aggregate ATP or listing supply changed; no partial reservation was created.", simulationRunId: order.simulationRunId },
          });
        }
        await recordEvent(tx, {
          eventType: "ALLOCATION_INVALIDATED",
          actorId,
          entityId: allocation.id,
          traceId,
          correlationId: approvalEvent.correlationId,
          causationId: approvalEvent.id,
          provenance: Provenance.INFERRED,
          simulationRunId: order.simulationRunId,
          payload: { allocationId: allocation.id, orderId: order.id, reason: "SUPPLY_CHANGED", status: "STALE" },
        });
        return updatedApproval;
      }

      await tx.allocation.update({ where: { id: allocation.id }, data: { status: "APPROVED" } });
      for (const [cropBatchId, quantity] of requiredByBatch) {
        await tx.reservation.create({ data: { allocationId: allocation.id, cropBatchId, quantity, status: "ACTIVE", simulationRunId: order.simulationRunId } });
        await tx.cropBatch.update({ where: { id: cropBatchId }, data: { availableToPromise: { decrement: quantity } } });
      }
      for (const [listingId, quantity] of requiredByListing) {
        const listing = listingById.get(listingId)!;
        const remainingQuantity = Math.max(0, listing.quantity - quantity);
        await tx.listing.update({ where: { id: listingId }, data: { quantity: remainingQuantity, status: remainingQuantity > 0.0001 ? "ACTIVE" : "SOLD_OUT" } });
      }
      // Commit exactly what was approved. On a safe partial commitment that is
      // less than the request, and the mission, its acceptance arithmetic and
      // the released reservation all have to agree with it rather than with the
      // quantity the buyer originally asked for.
      const committedQuantity = lines.reduce((sum, line) => sum + line.quantity, 0);
      await tx.order.update({ where: { id: order.id }, data: { lifecycleStatus: "COMMITTED", committedQuantity } });

      const route = await buildDeliveryRoute(tx, lines, { latitude: order.latitude, longitude: order.longitude });
      const missionId = randomUUID();
      await tx.deliveryMission.create({
        data: {
          id: missionId,
          orderId: order.id,
          status: "AVAILABLE",
          quantity: committedQuantity,
          deadline: order.neededBy,
          stops: route.stops,
          estimatedDistanceKm: route.distanceKm,
          estimatedDurationMinutes: route.durationMinutes,
          estimatedArrival: route.estimatedArrival,
          simulationRunId: order.simulationRunId,
        },
      });
      if (trace) {
        await tx.agentTrace.update({ where: { id: trace.id }, data: { status: "RUNNING", stage: "DELIVERY_AVAILABLE", summary: "All participants approved; safe supply was reserved and a delivery mission is available." } });
        await tx.traceStep.create({ data: { traceId, recordedAt: decidedAt, kind: "STATE_CHANGE", agentName: "Commitment Agent", toolName: "commit-reservations", provenance: Provenance.INFERRED, summary: `Aggregate supply was revalidated and reservations were committed atomically for ${committedQuantity} of ${order.requestedQuantity} kg.`, simulationRunId: order.simulationRunId } });
        await tx.traceStep.create({ data: { traceId, recordedAt: decidedAt, kind: "DECISION", agentName: "Logistics Agent", toolName: "build-pickup-route", provenance: Provenance.INFERRED, summary: `Created a ${route.stops.length}-stop mission covering ${route.distanceKm} km with an estimated ${route.durationMinutes}-minute duration.`, simulationRunId: order.simulationRunId } });
      }
      const allocationEvent = await recordEvent(tx, {
        eventType: "ALLOCATION_APPROVED",
        actorId,
        entityId: allocation.id,
        traceId,
        correlationId: approvalEvent.correlationId,
        causationId: approvalEvent.id,
        provenance: Provenance.OBSERVED,
        simulationRunId: order.simulationRunId,
        payload: { allocationId: allocation.id, orderId: order.id, coverageFraction: Number((order.requestedQuantity > 0 ? committedQuantity / order.requestedQuantity : 0).toFixed(4)), lines: lines.map((line) => ({ cropBatchId: line.cropBatchId, quantity: kilograms(line.quantity) })) },
      });
      await recordEvent(tx, {
        eventType: "DELIVERY_MISSION_CREATED",
        actorId,
        entityId: missionId,
        traceId,
        causationId: allocationEvent.id,
        correlationId: allocationEvent.correlationId,
        provenance: Provenance.INFERRED,
        simulationRunId: order.simulationRunId,
        payload: { missionId, orderId: order.id, status: "AVAILABLE", stops: route.stops, estimatedDistanceKm: route.distanceKm, estimatedDurationMinutes: route.durationMinutes, estimatedArrival: route.estimatedArrival.toISOString() },
      });
      return updatedApproval;
    },
  );
}

async function approveRecovery(
  tx: Prisma.TransactionClient,
  approval: { id: string; subjectType: string; subjectId: string; simulationRunId: string | null },
  actorId: string,
  reason?: string,
  decisionReason?: DecisionReason,
) {
  if (approval.subjectType !== "RECOVERY") {
    throw httpError(422, "UNSUPPORTED_APPROVAL_SUBJECT", "Only allocation and recovery approvals are implemented in this workflow.");
  }
  const exception = await tx.operationalException.findUnique({ where: { id: approval.subjectId } });
  if (!exception || exception.status === "RESOLVED") throw httpError(409, "STALE_APPROVAL", "The exception is no longer pending recovery.");
  if (exception.recoveryAction !== "RESCHEDULE" || !exception.recoveryChanges) throw httpError(409, "RECOVERY_NOT_ACTIONABLE", "This exception has no actionable recovery proposal.");
  const changes = exception.recoveryChanges as { missionId?: unknown; proposedDeadline?: unknown };
  if (typeof changes.missionId !== "string" || typeof changes.proposedDeadline !== "string") throw httpError(409, "RECOVERY_INVALID", "The stored recovery proposal is incomplete.");
  const proposedDeadline = new Date(changes.proposedDeadline);
  if (Number.isNaN(proposedDeadline.valueOf())) throw httpError(409, "RECOVERY_INVALID", "The stored recovery deadline is invalid.");
  const mission = await tx.deliveryMission.findUnique({ where: { id: changes.missionId } });
  if (!mission || ["DELIVERED", "CANCELLED"].includes(mission.status)) throw httpError(409, "STALE_APPROVAL", "The delivery mission can no longer be rescheduled.");
  const decidedAt = operationNow();
  await tx.approval.update({ where: { id: approval.id }, data: { status: "APPROVED", decidedBy: actorId, decidedAt, reason, ...decisionReasonColumns(decisionReason) } });
  await tx.deliveryMission.update({ where: { id: mission.id }, data: { deadline: proposedDeadline } });
  await tx.operationalException.update({ where: { id: exception.id }, data: { status: "RESOLVED" } });
  const order = await tx.order.findUnique({ where: { id: mission.orderId } });
  if (order) {
    const remainingExceptions = (order.activeExceptionIds as string[]).filter((id) => id !== exception.id);
    await tx.order.update({ where: { id: order.id }, data: { atRisk: remainingExceptions.length > 0, activeExceptionIds: remainingExceptions } });
  }
  const trace = await tx.agentTrace.findFirst({ where: { subjectType: "EXCEPTION", subjectId: exception.id } });
  const traceId = exception.traceId ?? trace?.id ?? randomUUID();
  const proposedEvent = await tx.domainEvent.findFirst({ where: { eventType: "RECOVERY_PROPOSED", entityId: exception.id }, orderBy: { occurredAt: "desc" } });
  const approvalEvent = await recordEvent(tx, {
    eventType: "APPROVAL_DECIDED",
    actorId,
    entityId: approval.id,
    traceId,
    correlationId: proposedEvent?.correlationId,
    causationId: proposedEvent?.id,
    provenance: Provenance.OBSERVED,
    simulationRunId: approval.simulationRunId,
    payload: { approvalId: approval.id, subjectType: "RECOVERY", subjectId: exception.id, decision: "APPROVE" },
  });
  await recordEvent(tx, {
    eventType: "RECOVERY_APPROVED",
    actorId,
    entityId: exception.id,
    traceId,
    correlationId: approvalEvent.correlationId,
    causationId: approvalEvent.id,
    provenance: Provenance.OBSERVED,
    simulationRunId: approval.simulationRunId,
    payload: { exceptionId: exception.id, approvalId: approval.id, actionType: "RESCHEDULE", missionId: mission.id, deadline: proposedDeadline.toISOString() },
  });
  if (trace) {
    await tx.agentTrace.update({ where: { id: traceId }, data: { status: "COMPLETED", stage: "RECOVERY_APPLIED", summary: "A human coordinator approved the deterministic two-hour recovery proposal." } });
    await tx.traceStep.create({
      data: { traceId, recordedAt: decidedAt, kind: "APPROVAL", agentName: "Exception Agent", toolName: "apply-approved-recovery", provenance: Provenance.OBSERVED, summary: `Human approval applied the stored deadline change to ${proposedDeadline.toISOString()}.`, simulationRunId: approval.simulationRunId },
    });
  }
  return tx.approval.findUniqueOrThrow({ where: { id: approval.id } });
}

export async function rejectApproval(approvalId: string, actorId: string, reason?: string, decisionReason?: DecisionReason) {
  return prisma.$transaction(async (tx) => {
    const approval = await tx.approval.findUnique({ where: { id: approvalId } });
    if (!approval) throw httpError(404, "APPROVAL_NOT_FOUND", "Approval was not found.");
    if (approval.status !== "PENDING") throw httpError(409, "APPROVAL_ALREADY_DECIDED", "This approval already has a final decision.");
    if (approval.requestedFromActorId !== actorId) throw httpError(403, "APPROVAL_FORBIDDEN", "This decision belongs to another participant.");
    const decidedAt = operationNow();
    const updated = await tx.approval.update({ where: { id: approvalId }, data: { status: "REJECTED", decidedBy: actorId, decidedAt, reason, ...decisionReasonColumns(decisionReason) } });
    if (approval.subjectType === "ALLOCATION") {
      const allocation = await tx.allocation.update({ where: { id: approval.subjectId }, data: { status: "REJECTED" } });
      const order = await tx.order.update({ where: { id: allocation.orderId }, data: { lifecycleStatus: "REJECTED", outcomeCause: "APPROVAL_REJECTED", outcomeNote: declineNote(reason, decisionReason) } });
      await tx.approval.updateMany({
        where: { subjectType: "ALLOCATION", subjectId: allocation.id, status: "PENDING" },
        data: { status: "CANCELLED", decidedAt, reason: "Cancelled after another participant rejected the allocation." },
      });
      const trace = await tx.agentTrace.findFirst({ where: { subjectType: "ORDER", subjectId: allocation.orderId } });
      const traceId = order.traceId ?? trace?.id ?? randomUUID();
      const proposedEvent = await tx.domainEvent.findFirst({ where: { eventType: "ALLOCATION_PROPOSED", entityId: allocation.id }, orderBy: { occurredAt: "desc" } });
      await recordEvent(tx, { eventType: "APPROVAL_DECIDED", actorId, entityId: approvalId, traceId, correlationId: proposedEvent?.correlationId, causationId: proposedEvent?.id, provenance: Provenance.OBSERVED, simulationRunId: approval.simulationRunId, payload: { approvalId, subjectType: "ALLOCATION", subjectId: allocation.id, decision: "REJECT", ...decisionReasonPayload(decisionReason) } });
      if (trace) {
        await tx.agentTrace.update({ where: { id: traceId }, data: { status: "COMPLETED", stage: "ALLOCATION_REJECTED", summary: "A participant rejected the proposed commitment; no stock was reserved." } });
        await tx.traceStep.create({ data: { traceId, recordedAt: decidedAt, kind: "APPROVAL", agentName: "Commitment Agent", toolName: "record-human-decision", provenance: Provenance.OBSERVED, summary: `Human rejected the allocation${reason ? `: ${reason}` : "."}`, simulationRunId: approval.simulationRunId } });
      }
    } else if (approval.subjectType === "RECOVERY") {
      const exception = await tx.operationalException.update({ where: { id: approval.subjectId }, data: { status: "OPEN" } });
      const trace = await tx.agentTrace.findFirst({ where: { subjectType: "EXCEPTION", subjectId: exception.id } });
      const traceId = exception.traceId ?? trace?.id ?? randomUUID();
      const proposedEvent = await tx.domainEvent.findFirst({ where: { eventType: "RECOVERY_PROPOSED", entityId: exception.id }, orderBy: { occurredAt: "desc" } });
      await recordEvent(tx, { eventType: "APPROVAL_DECIDED", actorId, entityId: approvalId, traceId, correlationId: proposedEvent?.correlationId, causationId: proposedEvent?.id, provenance: Provenance.OBSERVED, simulationRunId: approval.simulationRunId, payload: { approvalId, subjectType: "RECOVERY", subjectId: exception.id, decision: "REJECT", ...decisionReasonPayload(decisionReason) } });
      if (trace) {
        await tx.agentTrace.update({ where: { id: traceId }, data: { status: "WAITING", stage: "MANUAL_RECOVERY", summary: "The automatic recovery proposal was rejected and the exception remains open." } });
        await tx.traceStep.create({ data: { traceId, recordedAt: decidedAt, kind: "APPROVAL", agentName: "Exception Agent", toolName: "record-human-decision", provenance: Provenance.OBSERVED, summary: `Human rejected the recovery proposal${reason ? `: ${reason}` : "."}`, simulationRunId: approval.simulationRunId } });
      }
    }
    return updated;
  });
}
