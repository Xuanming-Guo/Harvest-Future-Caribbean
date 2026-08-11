import { randomUUID } from "node:crypto";

import { Prisma, Provenance } from "@prisma/client";

import { prisma } from "./db.js";
import { recordEvent } from "./events.js";
import { httpError } from "./http.js";

const kilograms = (value: number) => ({ value, unit: "kg" });

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
  const estimatedArrival = new Date(Date.now() + durationMinutes * 60_000);
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
    where: { cropBatchId },
    orderBy: { recordedAt: "desc" },
  });
  const estimate = observation?.estimatedQuantity ?? 20;
  const damageBuffer = Math.max(2, Math.round(estimate * 0.3));
  const q10 = Math.max(0, estimate - damageBuffer);
  const q50 = Math.max(q10, estimate - Math.round(damageBuffer / 2));
  const q90 = Math.max(q50, estimate + Math.round(estimate * 0.1));
  const predictionId = randomUUID();
  const requestId = randomUUID();
  const generatedAt = new Date();
  const start = new Date(generatedAt);
  start.setUTCDate(start.getUTCDate() + 1);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 3);

  await prisma.$transaction(async (tx) => {
    const committed = await tx.reservation.aggregate({
      where: { cropBatchId, status: "ACTIVE" },
      _sum: { quantity: true },
    });
    const committedQuantity = committed._sum.quantity ?? 0;
    const availableToPromise = Math.max(0, q10 - committedQuantity);
    await tx.yieldPrediction.create({
      data: {
        id: predictionId,
        requestId,
        cropBatchId,
        modelVersion: "fixture-yield-v0.1.0",
        q10,
        q50,
        q90,
        harvestStart: start,
        harvestEnd: end,
        readiness: 0.8,
        confidence: observation ? 0.76 : 0.55,
        warnings: observation ? ["Synthetic fixture prediction"] : ["No recent field observation"],
        featureSnapshot: {
          observationCount: observation ? 1 : 0,
          cropStage: observation?.cropStage ?? "UNKNOWN",
          lastObservedAt: observation?.observedAt.toISOString() ?? null,
          weatherSummary: { source: "fixture", rainfall7dMm: 74 },
          satelliteSummary: { source: "fixture", ndvi: 0.71 },
        },
        provenance: Provenance.MODEL_PREDICTED,
        generatedAt,
      },
    });
    await tx.cropBatch.update({
      where: { id: cropBatchId },
      data: {
        latestPredictionId: predictionId,
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
      payload: {
        predictionId,
        cropBatchId,
        q10MarketableYield: kilograms(q10),
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
        recordedAt: generatedAt,
        kind: "TOOL_CALL",
        agentName: "Crop Intelligence Agent",
        toolName: "fixture-yield-model",
        provenance: Provenance.MODEL_PREDICTED,
        summary: `Forecast q10 is ${q10} kg; ${committedQuantity} kg is committed, leaving ${availableToPromise} kg ATP.`,
        confidence: observation ? 0.76 : 0.55,
      },
    });
    return forecastEvent;
  });

  return { predictionId, requestId };
}

export async function proposeAllocation(orderId: string, actorId: string, traceId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw httpError(404, "ORDER_NOT_FOUND", "Order was not found.");
  const orderEvent = await prisma.domainEvent.findFirst({
    where: { eventType: "ORDER_REQUESTED", entityId: orderId, traceId },
    orderBy: { occurredAt: "desc" },
  });

  const requestedIds = order.listingIds as string[];
  const listings = await prisma.listing.findMany({
    where: {
      cropType: order.cropType,
      status: "ACTIVE",
      availableFrom: { lte: order.neededBy },
      availableUntil: { gte: new Date() },
      ...(requestedIds.length ? { id: { in: requestedIds } } : {}),
    },
    orderBy: [{ unitPrice: "asc" }, { availableFrom: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  const batches = await prisma.cropBatch.findMany({
    where: { id: { in: [...new Set(listings.map((listing) => listing.cropBatchId))] } },
  });
  const remainingByBatch = new Map(batches.map((batch) => [batch.id, batch.availableToPromise]));

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

  if (remaining > 0.0001) {
    await prisma.$transaction(async (tx) => {
      await tx.order.update({ where: { id: orderId }, data: { atRisk: false, lifecycleStatus: "REQUESTED" } });
      await tx.agentTrace.update({
        where: { id: traceId },
        data: { status: "WAITING", stage: "AWAITING_SUPPLY", summary: "No complete safe allocation is currently available; the order remains open for supply." },
      });
      await tx.traceStep.create({
        data: {
          traceId,
          recordedAt: new Date(),
          kind: "EVIDENCE",
          agentName: "Market Balance Agent",
          toolName: "read-safe-supply",
          provenance: Provenance.INFERRED,
          summary: `Found ${order.requestedQuantity - remaining} kg of ${order.requestedQuantity} kg required. No partial commitment was proposed.`,
        },
      });
    });
    return null;
  }

  const allocationId = randomUUID();
  const farmers = await prisma.listing.findMany({
    where: { id: { in: lines.map((line) => line.listingId) } },
    select: { farmerId: true },
  });
  const approverIds = [...new Set([order.buyerId, ...farmers.map((listing) => listing.farmerId)])];
  const approvalIds = approverIds.map(() => randomUUID());
  await prisma.$transaction(async (tx) => {
    await tx.allocation.create({ data: { id: allocationId, orderId, status: "PROPOSED" } });
    await tx.allocationLine.createMany({ data: lines.map((line) => ({ allocationId, ...line })) });
    await tx.approval.createMany({
      data: approverIds.map((requestedFromActorId, index) => ({
        id: approvalIds[index],
        subjectType: "ALLOCATION",
        subjectId: allocationId,
        requestedFromActorId,
        status: "PENDING",
        requestedAt: new Date(),
      })),
    });
    await tx.order.update({ where: { id: orderId }, data: { lifecycleStatus: "AWAITING_APPROVAL" } });
    await tx.agentTrace.update({
      where: { id: traceId },
      data: { status: "AWAITING_APPROVAL", stage: "ALLOCATION_PROPOSED", summary: "Matched complete safe supply and paused before commitment for human approval." },
    });
    await tx.traceStep.create({
      data: {
        traceId,
        recordedAt: new Date(),
        kind: "EVIDENCE",
        agentName: "Market Balance Agent",
        toolName: "read-safe-supply",
        provenance: Provenance.INFERRED,
        summary: `Confirmed complete coverage for ${order.requestedQuantity} kg using current listing windows and per-batch ATP.`,
      },
    });
    await tx.traceStep.create({
      data: {
        traceId,
        recordedAt: new Date(),
        kind: "DECISION",
        agentName: "Matching Agent",
        toolName: "propose-allocation",
        provenance: Provenance.INFERRED,
        summary: `Proposed ${lines.map((line) => `${line.quantity} kg`).join(" + ")} across ${lines.length} farms.`,
        confidence: 0.94,
      },
    });
    await tx.traceStep.create({
      data: {
        traceId,
        recordedAt: new Date(),
        kind: "APPROVAL",
        agentName: "Commitment Agent",
        toolName: "request-human-approval",
        provenance: Provenance.INFERRED,
        summary: `Requested approval from the buyer and ${approverIds.length - 1} participating farmer${approverIds.length === 2 ? "" : "s"}; no stock is reserved yet.`,
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
      payload: {
        allocationId,
        orderId,
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
) {
  return serializableTransaction(
    async (tx) => {
      const approval = await tx.approval.findUnique({ where: { id: approvalId } });
      if (!approval) throw httpError(404, "APPROVAL_NOT_FOUND", "Approval was not found.");
      if (approval.status !== "PENDING") throw httpError(409, "APPROVAL_ALREADY_DECIDED", "This approval already has a final decision.");
      if (approval.requestedFromActorId !== actorId) throw httpError(403, "APPROVAL_FORBIDDEN", "This decision belongs to another participant.");
      if (approval.subjectType !== "ALLOCATION") {
        return approveRecovery(tx, approval, actorId, reason);
      }

      const allocation = await tx.allocation.findUnique({ where: { id: approval.subjectId } });
      if (!allocation) throw httpError(409, "SUBJECT_NOT_FOUND", "The allocation no longer exists.");
      const order = await tx.order.findUnique({ where: { id: allocation.orderId } });
      if (!order || order.lifecycleStatus !== "AWAITING_APPROVAL") {
        throw httpError(409, "STALE_APPROVAL", "The order is no longer awaiting this approval.");
      }
      const lines = await tx.allocationLine.findMany({ where: { allocationId: allocation.id } });
      const decidedAt = new Date();
      const updatedApproval = await tx.approval.update({
        where: { id: approvalId },
        data: { status: "APPROVED", decidedBy: actorId, decidedAt, reason },
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
        await tx.order.update({ where: { id: order.id }, data: { lifecycleStatus: "REQUESTED", atRisk: false } });
        await tx.approval.updateMany({
          where: { subjectType: "ALLOCATION", subjectId: allocation.id, status: "PENDING" },
          data: { status: "CANCELLED", decidedAt, reason: "Cancelled because safe supply changed before commitment." },
        });
        if (trace) {
          await tx.agentTrace.update({ where: { id: traceId }, data: { status: "WAITING", stage: "AWAITING_SUPPLY", summary: "Supply changed before final commitment; the proposal was invalidated without reserving stock." } });
          await tx.traceStep.create({
            data: { traceId, recordedAt: decidedAt, kind: "DECISION", agentName: "Commitment Agent", toolName: "revalidate-safe-supply", provenance: Provenance.INFERRED, summary: "Invalidated the allocation because aggregate ATP or listing supply changed; no partial reservation was created." },
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
          payload: { allocationId: allocation.id, orderId: order.id, reason: "SUPPLY_CHANGED", status: "STALE" },
        });
        return updatedApproval;
      }

      await tx.allocation.update({ where: { id: allocation.id }, data: { status: "APPROVED" } });
      for (const [cropBatchId, quantity] of requiredByBatch) {
        await tx.reservation.create({ data: { allocationId: allocation.id, cropBatchId, quantity, status: "ACTIVE" } });
        await tx.cropBatch.update({ where: { id: cropBatchId }, data: { availableToPromise: { decrement: quantity } } });
      }
      for (const [listingId, quantity] of requiredByListing) {
        const listing = listingById.get(listingId)!;
        const remainingQuantity = Math.max(0, listing.quantity - quantity);
        await tx.listing.update({ where: { id: listingId }, data: { quantity: remainingQuantity, status: remainingQuantity > 0.0001 ? "ACTIVE" : "SOLD_OUT" } });
      }
      await tx.order.update({ where: { id: order.id }, data: { lifecycleStatus: "COMMITTED" } });

      const route = await buildDeliveryRoute(tx, lines, { latitude: order.latitude, longitude: order.longitude });
      const missionId = randomUUID();
      await tx.deliveryMission.create({
        data: {
          id: missionId,
          orderId: order.id,
          status: "AVAILABLE",
          quantity: order.requestedQuantity,
          deadline: order.neededBy,
          stops: route.stops,
          estimatedDistanceKm: route.distanceKm,
          estimatedDurationMinutes: route.durationMinutes,
          estimatedArrival: route.estimatedArrival,
        },
      });
      if (trace) {
        await tx.agentTrace.update({ where: { id: trace.id }, data: { status: "RUNNING", stage: "DELIVERY_AVAILABLE", summary: "All participants approved; safe supply was reserved and a delivery mission is available." } });
        await tx.traceStep.create({ data: { traceId, recordedAt: decidedAt, kind: "STATE_CHANGE", agentName: "Commitment Agent", toolName: "commit-reservations", provenance: Provenance.INFERRED, summary: "Aggregate supply was revalidated and reservations were committed atomically." } });
        await tx.traceStep.create({ data: { traceId, recordedAt: decidedAt, kind: "DECISION", agentName: "Logistics Agent", toolName: "build-pickup-route", provenance: Provenance.INFERRED, summary: `Created a ${route.stops.length}-stop mission covering ${route.distanceKm} km with an estimated ${route.durationMinutes}-minute duration.` } });
      }
      const allocationEvent = await recordEvent(tx, {
        eventType: "ALLOCATION_APPROVED",
        actorId,
        entityId: allocation.id,
        traceId,
        correlationId: approvalEvent.correlationId,
        causationId: approvalEvent.id,
        provenance: Provenance.OBSERVED,
        payload: { allocationId: allocation.id, orderId: order.id, lines: lines.map((line) => ({ cropBatchId: line.cropBatchId, quantity: kilograms(line.quantity) })) },
      });
      await recordEvent(tx, {
        eventType: "DELIVERY_MISSION_CREATED",
        actorId,
        entityId: missionId,
        traceId,
        causationId: allocationEvent.id,
        correlationId: allocationEvent.correlationId,
        provenance: Provenance.INFERRED,
        payload: { missionId, orderId: order.id, status: "AVAILABLE", stops: route.stops, estimatedDistanceKm: route.distanceKm, estimatedDurationMinutes: route.durationMinutes, estimatedArrival: route.estimatedArrival.toISOString() },
      });
      return updatedApproval;
    },
  );
}

async function approveRecovery(
  tx: Prisma.TransactionClient,
  approval: { id: string; subjectType: string; subjectId: string },
  actorId: string,
  reason?: string,
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
  const decidedAt = new Date();
  await tx.approval.update({ where: { id: approval.id }, data: { status: "APPROVED", decidedBy: actorId, decidedAt, reason } });
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
    payload: { exceptionId: exception.id, approvalId: approval.id, actionType: "RESCHEDULE", missionId: mission.id, deadline: proposedDeadline.toISOString() },
  });
  if (trace) {
    await tx.agentTrace.update({ where: { id: traceId }, data: { status: "COMPLETED", stage: "RECOVERY_APPLIED", summary: "A human coordinator approved the deterministic two-hour recovery proposal." } });
    await tx.traceStep.create({
      data: { traceId, recordedAt: decidedAt, kind: "APPROVAL", agentName: "Exception Agent", toolName: "apply-approved-recovery", provenance: Provenance.OBSERVED, summary: `Human approval applied the stored deadline change to ${proposedDeadline.toISOString()}.` },
    });
  }
  return tx.approval.findUniqueOrThrow({ where: { id: approval.id } });
}

export async function rejectApproval(approvalId: string, actorId: string, reason?: string) {
  return prisma.$transaction(async (tx) => {
    const approval = await tx.approval.findUnique({ where: { id: approvalId } });
    if (!approval) throw httpError(404, "APPROVAL_NOT_FOUND", "Approval was not found.");
    if (approval.status !== "PENDING") throw httpError(409, "APPROVAL_ALREADY_DECIDED", "This approval already has a final decision.");
    if (approval.requestedFromActorId !== actorId) throw httpError(403, "APPROVAL_FORBIDDEN", "This decision belongs to another participant.");
    const decidedAt = new Date();
    const updated = await tx.approval.update({ where: { id: approvalId }, data: { status: "REJECTED", decidedBy: actorId, decidedAt, reason } });
    if (approval.subjectType === "ALLOCATION") {
      const allocation = await tx.allocation.update({ where: { id: approval.subjectId }, data: { status: "REJECTED" } });
      const order = await tx.order.update({ where: { id: allocation.orderId }, data: { lifecycleStatus: "REJECTED" } });
      await tx.approval.updateMany({
        where: { subjectType: "ALLOCATION", subjectId: allocation.id, status: "PENDING" },
        data: { status: "CANCELLED", decidedAt, reason: "Cancelled after another participant rejected the allocation." },
      });
      const trace = await tx.agentTrace.findFirst({ where: { subjectType: "ORDER", subjectId: allocation.orderId } });
      const traceId = order.traceId ?? trace?.id ?? randomUUID();
      const proposedEvent = await tx.domainEvent.findFirst({ where: { eventType: "ALLOCATION_PROPOSED", entityId: allocation.id }, orderBy: { occurredAt: "desc" } });
      await recordEvent(tx, { eventType: "APPROVAL_DECIDED", actorId, entityId: approvalId, traceId, correlationId: proposedEvent?.correlationId, causationId: proposedEvent?.id, provenance: Provenance.OBSERVED, payload: { approvalId, subjectType: "ALLOCATION", subjectId: allocation.id, decision: "REJECT" } });
      if (trace) {
        await tx.agentTrace.update({ where: { id: traceId }, data: { status: "COMPLETED", stage: "ALLOCATION_REJECTED", summary: "A participant rejected the proposed commitment; no stock was reserved." } });
        await tx.traceStep.create({ data: { traceId, recordedAt: decidedAt, kind: "APPROVAL", agentName: "Commitment Agent", toolName: "record-human-decision", provenance: Provenance.OBSERVED, summary: `Human rejected the allocation${reason ? `: ${reason}` : "."}` } });
      }
    } else if (approval.subjectType === "RECOVERY") {
      const exception = await tx.operationalException.update({ where: { id: approval.subjectId }, data: { status: "OPEN" } });
      const trace = await tx.agentTrace.findFirst({ where: { subjectType: "EXCEPTION", subjectId: exception.id } });
      const traceId = exception.traceId ?? trace?.id ?? randomUUID();
      const proposedEvent = await tx.domainEvent.findFirst({ where: { eventType: "RECOVERY_PROPOSED", entityId: exception.id }, orderBy: { occurredAt: "desc" } });
      await recordEvent(tx, { eventType: "APPROVAL_DECIDED", actorId, entityId: approvalId, traceId, correlationId: proposedEvent?.correlationId, causationId: proposedEvent?.id, provenance: Provenance.OBSERVED, payload: { approvalId, subjectType: "RECOVERY", subjectId: exception.id, decision: "REJECT" } });
      if (trace) {
        await tx.agentTrace.update({ where: { id: traceId }, data: { status: "WAITING", stage: "MANUAL_RECOVERY", summary: "The automatic recovery proposal was rejected and the exception remains open." } });
        await tx.traceStep.create({ data: { traceId, recordedAt: decidedAt, kind: "APPROVAL", agentName: "Exception Agent", toolName: "record-human-decision", provenance: Provenance.OBSERVED, summary: `Human rejected the recovery proposal${reason ? `: ${reason}` : "."}` } });
      }
    }
    return updated;
  });
}
