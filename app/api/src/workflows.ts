import { randomUUID } from "node:crypto";

import { Prisma, Provenance } from "@prisma/client";

import { prisma } from "./db.js";
import { recordEvent } from "./events.js";
import { httpError } from "./http.js";

const kilograms = (value: number) => ({ value, unit: "kg" });

export async function produceFixturePrediction(
  cropBatchId: string,
  actorId: string,
  traceId: string,
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
        availableToPromise: q10,
        provenance: Provenance.MODEL_PREDICTED,
      },
    });
    await recordEvent(tx, {
      eventType: "FORECAST_PRODUCED",
      actorId,
      entityId: cropBatchId,
      traceId,
      provenance: Provenance.MODEL_PREDICTED,
      payload: {
        predictionId,
        cropBatchId,
        q10MarketableYield: kilograms(q10),
        availableToPromise: kilograms(q10),
      },
    });
  });

  return { predictionId, requestId };
}

export async function proposeAllocation(orderId: string, actorId: string, traceId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw httpError(404, "ORDER_NOT_FOUND", "Order was not found.");

  const requestedIds = order.listingIds as string[];
  const listings = await prisma.listing.findMany({
    where: {
      cropType: order.cropType,
      status: "ACTIVE",
      ...(requestedIds.length ? { id: { in: requestedIds } } : {}),
    },
    orderBy: [{ unitPrice: "asc" }, { createdAt: "asc" }],
  });

  let remaining = order.requestedQuantity;
  const lines: Array<{ cropBatchId: string; listingId: string; quantity: number }> = [];
  for (const listing of listings) {
    if (remaining <= 0) break;
    const batch = await prisma.cropBatch.findUnique({ where: { id: listing.cropBatchId } });
    if (!batch) continue;
    const safe = Math.min(listing.quantity, batch.availableToPromise, remaining);
    if (safe > 0) {
      lines.push({ cropBatchId: listing.cropBatchId, listingId: listing.id, quantity: safe });
      remaining -= safe;
    }
  }

  if (remaining > 0.0001) {
    await prisma.order.update({ where: { id: orderId }, data: { atRisk: true } });
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
    await tx.agentTrace.update({ where: { id: traceId }, data: { status: "AWAITING_APPROVAL" } });
    await tx.traceStep.create({
      data: {
        traceId,
        recordedAt: new Date(),
        kind: "DECISION",
        summary: `Proposed ${lines.map((line) => `${line.quantity} kg`).join(" + ")} across ${lines.length} farms.`,
        confidence: 0.94,
      },
    });
    await recordEvent(tx, {
      eventType: "ALLOCATION_PROPOSED",
      actorId,
      entityId: allocationId,
      traceId,
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
  return prisma.$transaction(
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
      for (const line of lines) {
        const batch = await tx.cropBatch.findUnique({ where: { id: line.cropBatchId } });
        if (!batch || batch.availableToPromise < line.quantity) {
          throw httpError(409, "SUPPLY_CHANGED", "Available-to-promise supply changed before approval.");
        }
      }

      const decidedAt = new Date();
      await tx.approval.update({
        where: { id: approvalId },
        data: { status: "APPROVED", decidedBy: actorId, decidedAt, reason },
      });
      const remainingApprovals = await tx.approval.count({
        where: { subjectType: "ALLOCATION", subjectId: allocation.id, status: "PENDING" },
      });
      if (remainingApprovals > 0) {
        return tx.approval.findUniqueOrThrow({ where: { id: approvalId } });
      }
      await tx.allocation.update({ where: { id: allocation.id }, data: { status: "APPROVED" } });
      for (const line of lines) {
        await tx.reservation.create({ data: { allocationId: allocation.id, cropBatchId: line.cropBatchId, quantity: line.quantity, status: "ACTIVE" } });
        await tx.cropBatch.update({ where: { id: line.cropBatchId }, data: { availableToPromise: { decrement: line.quantity } } });
        await tx.listing.update({ where: { id: line.listingId }, data: { status: "RESERVED" } });
      }
      await tx.order.update({ where: { id: order.id }, data: { lifecycleStatus: "COMMITTED" } });

      const batchRows = await tx.cropBatch.findMany({ where: { id: { in: lines.map((line) => line.cropBatchId) } } });
      const farmRows = await tx.farm.findMany({ where: { id: { in: batchRows.map((batch) => batch.farmId) } } });
      const stops = [
        ...farmRows.map((farm, index) => ({ sequence: index + 1, kind: "PICKUP", location: { latitude: farm.latitude, longitude: farm.longitude } })),
        { sequence: farmRows.length + 1, kind: "DROPOFF", location: { latitude: order.latitude, longitude: order.longitude } },
      ];
      const missionId = randomUUID();
      await tx.deliveryMission.create({ data: { id: missionId, orderId: order.id, status: "AVAILABLE", quantity: order.requestedQuantity, deadline: order.neededBy, stops } });
      const trace = await tx.agentTrace.findFirst({ where: { subjectType: "ORDER", subjectId: order.id } });
      const traceId = trace?.id ?? randomUUID();
      if (trace) {
        await tx.agentTrace.update({ where: { id: trace.id }, data: { status: "COMPLETED" } });
        await tx.traceStep.create({ data: { traceId: trace.id, recordedAt: decidedAt, kind: "APPROVAL", summary: `Human approval recorded${reason ? `: ${reason}` : "."}` } });
        await tx.traceStep.create({ data: { traceId: trace.id, recordedAt: decidedAt, kind: "STATE_CHANGE", summary: "Reservations committed and a delivery mission created." } });
      }
      const allocationEvent = await recordEvent(tx, {
        eventType: "ALLOCATION_APPROVED",
        actorId,
        entityId: allocation.id,
        traceId,
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
        payload: { missionId, orderId: order.id, status: "AVAILABLE", stops: stops.map((stop) => stop.location) },
      });
      return tx.approval.findUniqueOrThrow({ where: { id: approvalId } });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
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
  const affected = exception.affectedEntityIds as string[];
  await tx.approval.update({ where: { id: approval.id }, data: { status: "APPROVED", decidedBy: actorId, decidedAt: new Date(), reason } });
  await tx.operationalException.update({ where: { id: exception.id }, data: { status: "RESOLVED" } });
  await tx.order.updateMany({ where: { id: { in: affected } }, data: { atRisk: false, activeExceptionIds: [] } });
  const trace = await tx.agentTrace.findFirst({ where: { subjectType: "EXCEPTION", subjectId: exception.id } });
  const traceId = trace?.id ?? randomUUID();
  await recordEvent(tx, {
    eventType: "RECOVERY_APPROVED",
    actorId,
    entityId: exception.id,
    traceId,
    provenance: Provenance.OBSERVED,
    payload: { exceptionId: exception.id, approvalId: approval.id, actionType: "REROUTE" },
  });
  return tx.approval.findUniqueOrThrow({ where: { id: approval.id } });
}

export async function rejectApproval(approvalId: string, actorId: string, reason?: string) {
  return prisma.$transaction(async (tx) => {
    const approval = await tx.approval.findUnique({ where: { id: approvalId } });
    if (!approval) throw httpError(404, "APPROVAL_NOT_FOUND", "Approval was not found.");
    if (approval.status !== "PENDING") throw httpError(409, "APPROVAL_ALREADY_DECIDED", "This approval already has a final decision.");
    if (approval.requestedFromActorId !== actorId) throw httpError(403, "APPROVAL_FORBIDDEN", "This decision belongs to another participant.");
    const updated = await tx.approval.update({ where: { id: approvalId }, data: { status: "REJECTED", decidedBy: actorId, decidedAt: new Date(), reason } });
    if (approval.subjectType === "ALLOCATION") {
      const allocation = await tx.allocation.update({ where: { id: approval.subjectId }, data: { status: "REJECTED" } });
      await tx.order.update({ where: { id: allocation.orderId }, data: { lifecycleStatus: "REJECTED" } });
      await tx.approval.updateMany({
        where: { subjectType: "ALLOCATION", subjectId: allocation.id, status: "PENDING" },
        data: { status: "CANCELLED", decidedAt: new Date(), reason: "Cancelled after another participant rejected the allocation." },
      });
    }
    return updated;
  });
}
