import { randomUUID } from "node:crypto";

import cors from "@fastify/cors";
import { Prisma, Provenance } from "@prisma/client";
import Fastify from "fastify";

import { canAccessBatch, canAccessOrder, visibleBatchIds, visibleExceptionRows, visibleFarmIds, visibleOrderIds } from "./access.js";
import { registerAuthentication, requireRole, signDevelopmentToken, type AuthActor } from "./auth.js";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { recordEvent } from "./events.js";
import { assertObjectBody, httpError, idempotent, readLocation, readQuantity, sendProblem } from "./http.js";
import {
  approvalDto,
  cropBatchDto,
  deliveryAcceptanceDto,
  deliveryUpdateDto,
  demandDto,
  exceptionDetailDto,
  exceptionDto,
  listingDto,
  missionDto,
  orderDto,
  pageInfo,
  predictionDto,
  quantity,
  vehicleDto,
  verificationTaskDto,
} from "./serializers.js";
import { approveAllocation, produceFixturePrediction, proposeAllocation, rejectApproval } from "./workflows.js";

type JsonObject = Record<string, unknown>;
type GeoPoint = { latitude: number; longitude: number };
type DeliveryStop = { sequence: number; kind: "PICKUP" | "DROPOFF"; location: GeoPoint };

const productRoles = ["FARMER", "BUYER", "TRANSPORTER", "COORDINATOR", "OPERATIONS", "ADMIN"] as const;
const queryLimit = (value: unknown) => Math.min(100, Math.max(1, Number(value ?? 20) || 20));

const asString = (value: unknown, field: string) => {
  if (typeof value !== "string" || !value.trim()) throw httpError(400, "VALIDATION_FAILED", `${field} must be a non-empty string.`);
  return value.trim();
};

const asDate = (value: unknown, field: string) => {
  const parsed = new Date(asString(value, field));
  if (Number.isNaN(parsed.valueOf())) throw httpError(400, "VALIDATION_FAILED", `${field} must be an ISO-8601 date or date-time.`);
  return parsed;
};

async function verificationStatuses(batchIds: string[]) {
  const tasks = await prisma.verificationTask.findMany({
    where: { cropBatchId: { in: batchIds } },
    orderBy: { createdAt: "desc" },
  });
  const statuses = new Map<string, string>();
  for (const task of tasks) if (!statuses.has(task.cropBatchId)) statuses.set(task.cropBatchId, task.status);
  return statuses;
}

async function canSeeMission(actor: AuthActor, mission: { orderId: string; status: string; transporterId: string | null }) {
  return actor.role === "ADMIN" || actor.role === "OPERATIONS" ||
    (actor.role === "TRANSPORTER" ? mission.status === "AVAILABLE" || mission.transporterId === actor.id : await canAccessOrder(actor, mission.orderId));
}

function summarizeApprovals(rows: Array<{ id: string; status: string; requestedFromActorId: string }>, actorId: string) {
  const mine = rows.find((row) => row.requestedFromActorId === actorId);
  return {
    required: rows.length,
    approved: rows.filter((row) => row.status === "APPROVED").length,
    pending: rows.filter((row) => row.status === "PENDING").length,
    rejected: rows.filter((row) => row.status === "REJECTED").length,
    ...(mine ? { myApprovalId: mine.id, myApprovalStatus: mine.status } : {}),
  };
}

async function approvalContext(row: { subjectType: string; subjectId: string; requestedFromActorId: string }) {
  if (row.subjectType === "RECOVERY") {
    const exception = await prisma.operationalException.findUnique({ where: { id: row.subjectId } });
    if (!exception) return undefined;
    return {
      title: `${exception.exceptionType.toLowerCase()} recovery`,
      summary: exception.recoverySummary ?? "Review the reported exception and decide whether recovery may proceed.",
      exceptionId: exception.id,
      ...(exception.recoveryAction ? { recoveryAction: exception.recoveryAction } : {}),
    };
  }
  if (row.subjectType !== "ALLOCATION") return undefined;
  const allocation = await prisma.allocation.findUnique({ where: { id: row.subjectId } });
  if (!allocation) return undefined;
  const order = await prisma.order.findUnique({ where: { id: allocation.orderId } });
  if (!order) return undefined;
  const lines = await prisma.allocationLine.findMany({ where: { allocationId: allocation.id } });
  const requestedActor = await prisma.actor.findUnique({ where: { id: row.requestedFromActorId } });
  let amount = order.requestedQuantity;
  if (requestedActor?.role === "FARMER") {
    const farmIds = (await prisma.farm.findMany({ where: { farmerId: requestedActor.id }, select: { id: true } })).map((farm) => farm.id);
    const batchIds = (await prisma.cropBatch.findMany({ where: { farmId: { in: farmIds } }, select: { id: true } })).map((batch) => batch.id);
    amount = lines.filter((line) => batchIds.includes(line.cropBatchId)).reduce((sum, line) => sum + line.quantity, 0);
  }
  return {
    title: `${order.cropType.toLowerCase()} supply commitment`,
    summary: `Confirm ${amount} kg for delivery by ${order.neededBy.toISOString()}.`,
    orderId: order.id,
    cropType: order.cropType,
    quantity: quantity(amount),
    neededBy: order.neededBy.toISOString(),
  };
}

export async function buildServer() {
  const server = Fastify({ logger: true, bodyLimit: 1_000_000 });
  await server.register(cors, {
    origin: config.websiteOrigin,
    allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key"],
    exposedHeaders: ["Content-Type"],
  });
  await registerAuthentication(server);
  server.setErrorHandler((error, _request, reply) => sendProblem(reply, error));

  server.get("/health", async () => ({ status: "ok", service: "harvest-product-api", contractVersion: "0.3.0", adapters: { model: config.modelAdapter } }));

  server.post("/dev/session", async (request, reply) => {
    if (!config.enableDevAuth) throw httpError(404, "NOT_FOUND", "Development authentication is disabled.");
    const body = assertObjectBody(request.body, ["persona"], ["persona"]);
    const actor = await prisma.actor.findUnique({ where: { authSubject: asString(body.persona, "persona") } });
    if (!actor || !["FARMER", "BUYER", "TRANSPORTER", "COORDINATOR"].includes(actor.role)) throw httpError(404, "PERSONA_NOT_FOUND", "The requested development persona was not seeded.");
    return reply.send({
      accessToken: await signDevelopmentToken(actor),
      actor: {
        actorId: actor.id,
        authSubject: actor.authSubject,
        name: actor.name,
        role: actor.role,
        synthetic: actor.isSynthetic,
        ...(actor.serviceZone ? { serviceZone: actor.serviceZone } : {}),
        ...(actor.defaultLatitude !== null && actor.defaultLongitude !== null
          ? { deliveryLocation: { latitude: actor.defaultLatitude, longitude: actor.defaultLongitude } }
          : {}),
      },
    });
  });

  server.get("/v1/crop-batches", async (request) => {
    const actor = requireRole(request, ["FARMER", "COORDINATOR", "OPERATIONS", "ADMIN"]);
    const query = request.query as JsonObject;
    const rows = await prisma.cropBatch.findMany({
      where: { id: { in: await visibleBatchIds(actor) }, ...(typeof query.cropType === "string" ? { cropType: query.cropType } : {}), ...(typeof query.status === "string" ? { status: query.status } : {}) },
      orderBy: { updatedAt: "desc" },
      take: queryLimit(query.limit),
    });
    const statuses = await verificationStatuses(rows.map((row) => row.id));
    return { items: rows.map((row) => cropBatchDto(row, statuses.get(row.id))), pageInfo };
  });

  server.get("/v1/crop-batches/:cropBatchId", async (request) => {
    const actor = requireRole(request, ["FARMER", "COORDINATOR", "OPERATIONS", "ADMIN"]);
    const { cropBatchId } = request.params as { cropBatchId: string };
    if (!(await canAccessBatch(actor, cropBatchId))) throw httpError(404, "CROP_BATCH_NOT_FOUND", "Crop batch was not found.");
    const row = await prisma.cropBatch.findUnique({ where: { id: cropBatchId } });
    if (!row) throw httpError(404, "CROP_BATCH_NOT_FOUND", "Crop batch was not found.");
    const statuses = await verificationStatuses([row.id]);
    return cropBatchDto(row, statuses.get(row.id));
  });

  server.post("/v1/crop-observations", async (request, reply) => idempotent(request, reply, 201, async () => {
    const actor = requireRole(request, ["FARMER", "COORDINATOR", "ADMIN"]);
    const body = assertObjectBody(request.body, ["cropBatchId", "observedAt", "cropStage", "notes", "estimatedQuantity", "provenance"], ["cropBatchId", "observedAt", "cropStage", "provenance"]);
    const cropBatchId = asString(body.cropBatchId, "cropBatchId");
    if (!(await canAccessBatch(actor, cropBatchId))) throw httpError(404, "CROP_BATCH_NOT_FOUND", "Crop batch was not found.");
    const provenance = asString(body.provenance, "provenance") as Provenance;
    if (!Object.values(Provenance).includes(provenance) || provenance === Provenance.MODEL_PREDICTED) throw httpError(422, "INVALID_PROVENANCE", "Crop observations require an observable input provenance.");
    const observationId = randomUUID();
    const traceId = randomUUID();
    const observedAt = asDate(body.observedAt, "observedAt");
    const recordedAt = new Date();
    const estimatedQuantity = body.estimatedQuantity === undefined ? null : readQuantity(body.estimatedQuantity, "estimatedQuantity");
    await prisma.$transaction(async (tx) => {
      await tx.agentTrace.create({ data: { id: traceId, subjectType: "CROP_BATCH", subjectId: cropBatchId, status: "RUNNING", summary: "Validated a crop observation and requested an updated conservative forecast." } });
      await tx.traceStep.create({ data: { traceId, recordedAt, kind: "INPUT", summary: `Recorded ${asString(body.cropStage, "cropStage")} observation${estimatedQuantity !== null ? ` with ${estimatedQuantity} kg estimate` : ""}.` } });
      await tx.cropObservation.create({ data: { id: observationId, cropBatchId, actorId: actor.id, observedAt, recordedAt, cropStage: asString(body.cropStage, "cropStage"), notes: typeof body.notes === "string" ? body.notes : null, estimatedQuantity, provenance, traceId } });
      await tx.cropBatch.update({ where: { id: cropBatchId }, data: { latestObservationId: observationId, provenance } });
      const observationEvent = await recordEvent(tx, { eventType: "CROP_OBSERVATION_SUBMITTED", actorId: actor.id, entityId: cropBatchId, traceId, provenance, payload: { observationId, cropBatchId, observedAt: observedAt.toISOString(), cropStage: body.cropStage as string } });
      const batch = await tx.cropBatch.findUniqueOrThrow({ where: { id: cropBatchId } });
      const taskId = randomUUID();
      await tx.verificationTask.create({
        data: {
          id: taskId,
          farmId: batch.farmId,
          cropBatchId,
          subjectType: "CROP_OBSERVATION",
          subjectId: observationId,
          taskType: "VERIFY_OBSERVATION",
          status: "OPEN",
          summary: `Verify the ${asString(body.cropStage, "cropStage").toLowerCase()} crop update.`,
        },
      });
      await recordEvent(tx, {
        eventType: "VERIFICATION_TASK_CREATED",
        actorId: actor.id,
        entityId: taskId,
        traceId,
        correlationId: observationEvent.correlationId,
        causationId: observationEvent.id,
        provenance,
        payload: { taskId, cropBatchId, observationId, status: "OPEN" },
      });
    });
    await produceFixturePrediction(cropBatchId, actor.id, traceId);
    return { observationId, cropBatchId, observedAt: observedAt.toISOString(), recordedAt: recordedAt.toISOString(), cropStage: body.cropStage, ...(typeof body.notes === "string" ? { notes: body.notes } : {}), ...(estimatedQuantity !== null ? { estimatedQuantity: quantity(estimatedQuantity) } : {}), provenance, traceId };
  }));

  server.post("/v1/crop-batches/:cropBatchId/forecast-requests", async (request, reply) => idempotent(request, reply, 202, async () => {
    const actor = requireRole(request, ["FARMER", "COORDINATOR", "ADMIN"]);
    const { cropBatchId } = request.params as { cropBatchId: string };
    if (!(await canAccessBatch(actor, cropBatchId))) throw httpError(404, "CROP_BATCH_NOT_FOUND", "Crop batch was not found.");
    const body = assertObjectBody(request.body, ["reason"], ["reason"]);
    asString(body.reason, "reason");
    const trace = await prisma.agentTrace.findFirst({ where: { subjectType: "CROP_BATCH", subjectId: cropBatchId } });
    const traceId = trace?.id ?? randomUUID();
    if (!trace) await prisma.agentTrace.create({ data: { id: traceId, subjectType: "CROP_BATCH", subjectId: cropBatchId, status: "RUNNING", summary: "Requested a refreshed crop forecast." } });
    const result = await produceFixturePrediction(cropBatchId, actor.id, traceId);
    return { forecastRequestId: result.requestId, cropBatchId, status: "COMPLETED", requestedAt: new Date().toISOString() };
  }));

  server.get("/v1/yield-predictions/:predictionId", async (request) => {
    const actor = requireRole(request, ["FARMER", "COORDINATOR", "OPERATIONS", "ADMIN"]);
    const { predictionId } = request.params as { predictionId: string };
    const row = await prisma.yieldPrediction.findUnique({ where: { id: predictionId } });
    if (!row || !(await canAccessBatch(actor, row.cropBatchId))) throw httpError(404, "PREDICTION_NOT_FOUND", "Yield prediction was not found.");
    return predictionDto(row);
  });

  server.get("/v1/listings", async (request) => {
    const actor = requireRole(request, [...productRoles]);
    const query = request.query as JsonObject;
    const farmIds = await visibleFarmIds(actor);
    const farmerIds = farmIds.length ? (await prisma.farm.findMany({ where: { id: { in: farmIds } }, select: { farmerId: true } })).map((row) => row.farmerId) : [];
    const rows = await prisma.listing.findMany({
      where: { ...(typeof query.cropType === "string" ? { cropType: query.cropType } : {}), ...(actor.role === "FARMER" || actor.role === "COORDINATOR" ? { farmerId: { in: farmerIds } } : { status: "ACTIVE" }) },
      orderBy: { createdAt: "desc" },
      take: queryLimit(query.limit),
    });
    return { items: rows.map(listingDto), pageInfo };
  });

  server.get("/v1/listings/:listingId", async (request) => {
    const actor = requireRole(request, ["FARMER", "BUYER", "COORDINATOR", "OPERATIONS", "ADMIN"]);
    const { listingId } = request.params as { listingId: string };
    const listing = await prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing) throw httpError(404, "LISTING_NOT_FOUND", "Listing was not found.");
    const visible = actor.role === "ADMIN" || actor.role === "OPERATIONS" ||
      (actor.role === "BUYER" ? listing.status === "ACTIVE" :
        actor.role === "FARMER" ? listing.farmerId === actor.id : await canAccessBatch(actor, listing.cropBatchId));
    if (!visible) throw httpError(404, "LISTING_NOT_FOUND", "Listing was not found.");
    const batch = await prisma.cropBatch.findUniqueOrThrow({ where: { id: listing.cropBatchId } });
    const farm = await prisma.farm.findUniqueOrThrow({ where: { id: batch.farmId } });
    const prediction = batch.latestPredictionId
      ? await prisma.yieldPrediction.findUnique({ where: { id: batch.latestPredictionId } })
      : null;
    const status = (await verificationStatuses([batch.id])).get(batch.id) ?? "UNVERIFIED";
    return {
      ...listingDto(listing),
      productionZone: farm.productionZone,
      supplyEvidence: {
        provenance: prediction?.provenance ?? batch.provenance,
        verificationStatus: status,
        ...(prediction ? {
          confidence: prediction.confidence,
          forecastGeneratedAt: prediction.generatedAt.toISOString(),
          harvestWindow: { start: prediction.harvestStart.toISOString().slice(0, 10), end: prediction.harvestEnd.toISOString().slice(0, 10) },
          warnings: prediction.warnings,
        } : {}),
      },
    };
  });

  server.get("/v1/market-opportunities", async (request) => {
    const actor = requireRole(request, ["FARMER", "COORDINATOR", "ADMIN"]);
    const query = request.query as JsonObject;
    const batchIds = actor.role === "ADMIN"
      ? (await prisma.cropBatch.findMany({ select: { id: true } })).map((row) => row.id)
      : await visibleBatchIds(actor);
    const cropTypes = [...new Set((await prisma.cropBatch.findMany({ where: { id: { in: batchIds } }, select: { cropType: true } })).map((row) => row.cropType))];
    const requestedCrop = typeof query.cropType === "string" ? query.cropType.toUpperCase() : undefined;
    const eligibleCropTypes = requestedCrop ? (cropTypes.includes(requestedCrop) ? [requestedCrop] : []) : cropTypes;
    const rows = await prisma.buyerDemand.findMany({
      where: {
        status: { in: ["OPEN", "MATCHING"] },
        cropType: { in: eligibleCropTypes },
      },
      orderBy: { neededBy: "asc" },
      take: queryLimit(query.limit),
    });
    const buyers = await prisma.actor.findMany({ where: { id: { in: rows.map((row) => row.buyerId) } }, select: { id: true, serviceZone: true } });
    const zones = new Map(buyers.map((buyer) => [buyer.id, buyer.serviceZone ?? "Saint Lucia"]));
    return {
      items: rows.map((row) => ({
        opportunityId: row.id,
        cropType: row.cropType,
        quantity: quantity(row.quantity),
        neededBy: row.neededBy.toISOString(),
        deliveryZone: zones.get(row.buyerId) ?? "Saint Lucia",
        ...(row.maxUnitPrice !== null ? { maxUnitPrice: { amount: row.maxUnitPrice, currency: row.currency ?? "XCD" } } : {}),
        createdAt: row.createdAt.toISOString(),
      })),
      pageInfo,
    };
  });

  server.post("/v1/listings", async (request, reply) => idempotent(request, reply, 201, async () => {
    const actor = requireRole(request, ["FARMER", "COORDINATOR", "ADMIN"]);
    const body = assertObjectBody(request.body, ["cropBatchId", "quantity", "unitPrice", "availableFrom", "availableUntil"], ["cropBatchId", "quantity", "unitPrice", "availableFrom", "availableUntil"]);
    const cropBatchId = asString(body.cropBatchId, "cropBatchId");
    if (!(await canAccessBatch(actor, cropBatchId))) throw httpError(404, "CROP_BATCH_NOT_FOUND", "Crop batch was not found.");
    const batch = await prisma.cropBatch.findUniqueOrThrow({ where: { id: cropBatchId } });
    const amount = readQuantity(body.quantity);
    if (amount > batch.availableToPromise) throw httpError(422, "ATP_EXCEEDED", "Listing quantity exceeds available-to-promise supply.");
    const money = body.unitPrice as JsonObject;
    if (!money || typeof money.amount !== "number" || typeof money.currency !== "string") throw httpError(400, "VALIDATION_FAILED", "unitPrice requires amount and currency.");
    const unitPrice = money.amount;
    const currency = money.currency;
    const farm = await prisma.farm.findUniqueOrThrow({ where: { id: batch.farmId } });
    const listingId = randomUUID();
    const traceId = randomUUID();
    const row = await prisma.$transaction(async (tx) => {
      const listing = await tx.listing.create({ data: { id: listingId, cropBatchId, farmerId: farm.farmerId, cropType: batch.cropType, quantity: amount, unitPrice, currency, availableFrom: asDate(body.availableFrom, "availableFrom"), availableUntil: asDate(body.availableUntil, "availableUntil"), status: "ACTIVE" } });
      await tx.agentTrace.create({ data: { id: traceId, subjectType: "CROP_BATCH", subjectId: cropBatchId, status: "COMPLETED", summary: "Published supply without exceeding available-to-promise." } });
      await recordEvent(tx, { eventType: "LISTING_PUBLISHED", actorId: actor.id, entityId: listingId, traceId, provenance: batch.provenance, payload: { listingId, cropBatchId, quantity: quantity(amount), availableFrom: listing.availableFrom.toISOString().slice(0, 10) } });
      return listing;
    });
    return listingDto(row);
  }));

  server.get("/v1/buyer-demands", async (request) => {
    const actor = requireRole(request, ["BUYER", "ADMIN"]);
    const query = request.query as JsonObject;
    const rows = await prisma.buyerDemand.findMany({ where: { ...(actor.role === "BUYER" ? { buyerId: actor.id } : {}), ...(typeof query.status === "string" ? { status: query.status } : {}), ...(typeof query.cropType === "string" ? { cropType: query.cropType } : {}) }, orderBy: { createdAt: "desc" }, take: queryLimit(query.limit) });
    return { items: rows.map(demandDto), pageInfo };
  });

  server.post("/v1/buyer-demands", async (request, reply) => idempotent(request, reply, 201, async () => {
    const actor = requireRole(request, ["BUYER", "ADMIN"]);
    const body = assertObjectBody(request.body, ["cropType", "quantity", "neededBy", "deliveryLocation", "maxUnitPrice"], ["cropType", "quantity", "neededBy", "deliveryLocation"]);
    const location = readLocation(body.deliveryLocation);
    const demandId = randomUUID();
    const traceId = randomUUID();
    const maxPrice = body.maxUnitPrice as JsonObject | undefined;
    const row = await prisma.$transaction(async (tx) => {
      const demand = await tx.buyerDemand.create({ data: { id: demandId, buyerId: actor.id, cropType: asString(body.cropType, "cropType").toUpperCase(), quantity: readQuantity(body.quantity), neededBy: asDate(body.neededBy, "neededBy"), latitude: location.latitude, longitude: location.longitude, maxUnitPrice: typeof maxPrice?.amount === "number" ? maxPrice.amount : null, currency: typeof maxPrice?.currency === "string" ? maxPrice.currency : "XCD", status: "OPEN" } });
      await tx.agentTrace.create({ data: { id: traceId, subjectType: "ORDER", subjectId: demandId, status: "RUNNING", summary: "Recorded buyer demand for matching." } });
      await recordEvent(tx, { eventType: "BUYER_DEMAND_CREATED", actorId: actor.id, entityId: demandId, traceId, provenance: actor.isSynthetic ? Provenance.SYNTHETIC : Provenance.OBSERVED, payload: { demandId, cropType: demand.cropType, quantity: quantity(demand.quantity), neededBy: demand.neededBy.toISOString() } });
      return demand;
    });
    return demandDto(row);
  }));

  server.get("/v1/orders", async (request) => {
    const actor = requireRole(request, [...productRoles]);
    const query = request.query as JsonObject;
    const rows = await prisma.order.findMany({ where: { id: { in: await visibleOrderIds(actor) }, ...(typeof query.status === "string" ? { lifecycleStatus: query.status } : {}), ...(typeof query.atRisk === "string" ? { atRisk: query.atRisk === "true" } : {}) }, orderBy: { updatedAt: "desc" }, take: queryLimit(query.limit) });
    return { items: rows.map(orderDto), pageInfo };
  });

  server.post("/v1/orders", async (request, reply) => idempotent(request, reply, 201, async () => {
    const actor = requireRole(request, ["BUYER", "ADMIN"]);
    const body = assertObjectBody(request.body, ["cropType", "requestedQuantity", "neededBy", "deliveryLocation", "listingIds"], ["cropType", "requestedQuantity", "neededBy", "deliveryLocation"]);
    const listingIds = body.listingIds === undefined ? [] : body.listingIds;
    if (!Array.isArray(listingIds) || !listingIds.every((id) => typeof id === "string")) throw httpError(400, "VALIDATION_FAILED", "listingIds must be an array of UUID strings.");
    const location = readLocation(body.deliveryLocation);
    const orderId = randomUUID();
    const traceId = randomUUID();
    const requestedQuantity = readQuantity(body.requestedQuantity, "requestedQuantity");
    const row = await prisma.$transaction(async (tx) => {
      const order = await tx.order.create({ data: { id: orderId, buyerId: actor.id, cropType: asString(body.cropType, "cropType").toUpperCase(), requestedQuantity, acceptedQuantity: 0, neededBy: asDate(body.neededBy, "neededBy"), latitude: location.latitude, longitude: location.longitude, listingIds, lifecycleStatus: "REQUESTED", atRisk: false, activeExceptionIds: [] } });
      await tx.agentTrace.create({ data: { id: traceId, subjectType: "ORDER", subjectId: orderId, status: "RUNNING", summary: "Validating safe supply for a buyer order." } });
      await tx.traceStep.create({ data: { traceId, recordedAt: new Date(), kind: "INPUT", summary: `Buyer requested ${requestedQuantity} kg of ${order.cropType}.` } });
      await recordEvent(tx, { eventType: "ORDER_REQUESTED", actorId: actor.id, entityId: orderId, traceId, provenance: actor.isSynthetic ? Provenance.SYNTHETIC : Provenance.OBSERVED, payload: { orderId, cropType: order.cropType, requestedQuantity: quantity(requestedQuantity), status: "REQUESTED" } });
      return order;
    });
    await proposeAllocation(orderId, actor.id, traceId);
    return orderDto(row);
  }));

  server.get("/v1/orders/:orderId", async (request) => {
    const actor = requireRole(request, [...productRoles]);
    const { orderId } = request.params as { orderId: string };
    if (!(await canAccessOrder(actor, orderId))) throw httpError(404, "ORDER_NOT_FOUND", "Order was not found.");
    const row = await prisma.order.findUnique({ where: { id: orderId } });
    if (!row) throw httpError(404, "ORDER_NOT_FOUND", "Order was not found.");
    const allocation = await prisma.allocation.findFirst({ where: { orderId }, orderBy: { createdAt: "desc" } });
    const lines = allocation ? await prisma.allocationLine.findMany({ where: { allocationId: allocation.id } }) : [];
    const summarizedLines = [...lines.reduce((map, line) => map.set(line.cropBatchId, (map.get(line.cropBatchId) ?? 0) + line.quantity), new Map<string, number>())].map(([cropBatchId, value]) => ({ cropBatchId, quantity: quantity(value) }));
    const approvals = allocation ? await prisma.approval.findMany({ where: { subjectType: "ALLOCATION", subjectId: allocation.id } }) : [];
    const mission = await prisma.deliveryMission.findFirst({ where: { orderId }, orderBy: { deadline: "desc" } });
    const acceptance = await prisma.deliveryAcceptance.findUnique({ where: { orderId } });
    return {
      ...orderDto(row),
      ...(allocation ? { allocation: { allocationId: allocation.id, status: allocation.status, lines: summarizedLines } } : {}),
      approvalSummary: summarizeApprovals(approvals, actor.id),
      ...(mission ? { deliveryMission: missionDto(mission) } : {}),
      ...(acceptance ? { deliveryAcceptance: deliveryAcceptanceDto(acceptance) } : {}),
    };
  });

  server.get("/v1/approvals", async (request) => {
    const actor = requireRole(request, ["FARMER", "BUYER", "COORDINATOR", "ADMIN"]);
    const query = request.query as JsonObject;
    const rows = await prisma.approval.findMany({ where: { ...(actor.role !== "ADMIN" ? { requestedFromActorId: actor.id } : {}), ...(typeof query.status === "string" ? { status: query.status } : {}), ...(typeof query.subjectType === "string" ? { subjectType: query.subjectType } : {}) }, orderBy: { requestedAt: "desc" }, take: queryLimit(query.limit) });
    return { items: await Promise.all(rows.map(async (row) => approvalDto(row, await approvalContext(row)))), pageInfo };
  });

  server.post("/v1/approvals/:approvalId/decisions", async (request, reply) => idempotent(request, reply, 200, async () => {
    const actor = requireRole(request, ["FARMER", "BUYER", "COORDINATOR", "ADMIN"]);
    const { approvalId } = request.params as { approvalId: string };
    const body = assertObjectBody(request.body, ["decision", "reason"], ["decision"]);
    const decision = asString(body.decision, "decision");
    const reason = typeof body.reason === "string" ? body.reason : undefined;
    const row = decision === "APPROVE" ? await approveAllocation(approvalId, actor.id, reason) : decision === "REJECT" ? await rejectApproval(approvalId, actor.id, reason) : (() => { throw httpError(400, "VALIDATION_FAILED", "decision must be APPROVE or REJECT."); })();
    return approvalDto(row, await approvalContext(row));
  }));

  server.get("/v1/delivery-missions", async (request) => {
    const actor = requireRole(request, [...productRoles]);
    const query = request.query as JsonObject;
    const orderIds = await visibleOrderIds(actor);
    const where = actor.role === "TRANSPORTER" ? { OR: [{ status: "AVAILABLE" }, { transporterId: actor.id }] } : actor.role === "ADMIN" || actor.role === "OPERATIONS" ? {} : { orderId: { in: orderIds } };
    const rows = await prisma.deliveryMission.findMany({ where: { ...where, ...(typeof query.status === "string" ? { status: query.status } : {}) }, orderBy: { deadline: "asc" }, take: queryLimit(query.limit) });
    return { items: rows.map(missionDto), pageInfo };
  });

  server.get("/v1/delivery-missions/:missionId", async (request) => {
    const actor = requireRole(request, [...productRoles]);
    const { missionId } = request.params as { missionId: string };
    const row = await prisma.deliveryMission.findUnique({ where: { id: missionId } });
    if (!row) throw httpError(404, "MISSION_NOT_FOUND", "Delivery mission was not found.");
    if (!(await canSeeMission(actor, row))) throw httpError(404, "MISSION_NOT_FOUND", "Delivery mission was not found.");
    return missionDto(row);
  });

  server.get("/v1/delivery-missions/:missionId/updates", async (request) => {
    const actor = requireRole(request, [...productRoles]);
    const { missionId } = request.params as { missionId: string };
    const mission = await prisma.deliveryMission.findUnique({ where: { id: missionId } });
    if (!mission || !(await canSeeMission(actor, mission))) throw httpError(404, "MISSION_NOT_FOUND", "Delivery mission was not found.");
    const query = request.query as JsonObject;
    const rows = await prisma.deliveryUpdate.findMany({ where: { missionId }, orderBy: { recordedAt: "asc" }, take: queryLimit(query.limit) });
    return { items: rows.map(deliveryUpdateDto), pageInfo };
  });

  server.get("/v1/me/vehicles", async (request) => {
    const actor = requireRole(request, ["TRANSPORTER"]);
    const rows = await prisma.vehicle.findMany({ where: { transporterId: actor.id }, orderBy: [{ status: "asc" }, { label: "asc" }] });
    return { items: rows.map(vehicleDto), pageInfo };
  });

  server.post("/v1/delivery-missions/:missionId/acceptance", async (request, reply) => idempotent(request, reply, 200, async () => {
    const actor = requireRole(request, ["TRANSPORTER"]);
    const { missionId } = request.params as { missionId: string };
    const body = assertObjectBody(request.body, ["decision", "vehicleId"], ["decision", "vehicleId"]);
    if (body.decision !== "ACCEPT") throw httpError(400, "VALIDATION_FAILED", "Only ACCEPT is supported.");
    const current = await prisma.deliveryMission.findUnique({ where: { id: missionId } });
    if (!current) throw httpError(404, "MISSION_NOT_FOUND", "Delivery mission was not found.");
    if (current.status !== "AVAILABLE") throw httpError(409, "MISSION_UNAVAILABLE", "Mission is no longer available.");
    const vehicleId = asString(body.vehicleId, "vehicleId");
    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
    if (!vehicle || vehicle.transporterId !== actor.id) throw httpError(404, "VEHICLE_NOT_FOUND", "Vehicle was not found.");
    if (vehicle.status !== "AVAILABLE") throw httpError(409, "VEHICLE_UNAVAILABLE", "Vehicle is not available for this mission.");
    if (vehicle.capacityKg !== null && vehicle.capacityKg < current.quantity) throw httpError(422, "VEHICLE_CAPACITY_EXCEEDED", "Vehicle capacity is below the mission quantity.");
    const trace = await prisma.agentTrace.findFirst({ where: { subjectType: "ORDER", subjectId: current.orderId } });
    const row = await prisma.$transaction(async (tx) => {
      const claimedMission = await tx.deliveryMission.updateMany({ where: { id: missionId, status: "AVAILABLE" }, data: { status: "ASSIGNED", transporterId: actor.id, vehicleId } });
      const claimedVehicle = await tx.vehicle.updateMany({ where: { id: vehicleId, transporterId: actor.id, status: "AVAILABLE" }, data: { status: "IN_USE" } });
      if (claimedMission.count !== 1 || claimedVehicle.count !== 1) throw httpError(409, "MISSION_OR_VEHICLE_UNAVAILABLE", "The mission or vehicle was claimed by another request.");
      const mission = await tx.deliveryMission.findUniqueOrThrow({ where: { id: missionId } });
      await tx.order.update({ where: { id: current.orderId }, data: { lifecycleStatus: "IN_DELIVERY" } });
      const stops = current.stops as Array<{ location: GeoPoint }>;
      await recordEvent(tx, { eventType: "DELIVERY_MISSION_ACCEPTED", actorId: actor.id, entityId: missionId, traceId: trace?.id ?? randomUUID(), provenance: actor.isSynthetic ? Provenance.SYNTHETIC : Provenance.OBSERVED, payload: { missionId, orderId: current.orderId, status: "ASSIGNED", transporterId: actor.id, stops: stops.map((stop) => stop.location) } });
      return mission;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return missionDto(row);
  }));

  server.post("/v1/delivery-missions/:missionId/updates", async (request, reply) => idempotent(request, reply, 201, async () => {
    const actor = requireRole(request, ["TRANSPORTER"]);
    const { missionId } = request.params as { missionId: string };
    const body = assertObjectBody(request.body, ["updateType", "recordedAt", "position", "quantity", "note"], ["updateType", "recordedAt"]);
    const mission = await prisma.deliveryMission.findUnique({ where: { id: missionId } });
    if (!mission || (actor.role === "TRANSPORTER" && mission.transporterId !== actor.id)) throw httpError(404, "MISSION_NOT_FOUND", "Delivery mission was not found.");
    const updateType = asString(body.updateType, "updateType");
    if (!["PICKED_UP", "POSITION", "DELAYED", "ARRIVED", "DELIVERED"].includes(updateType)) throw httpError(422, "INVALID_DELIVERY_UPDATE", "The delivery update type is not supported.");
    const updateId = randomUUID();
    const position = body.position === undefined ? null : readLocation(body.position);
    const amount = body.quantity === undefined ? null : readQuantity(body.quantity);
    if (updateType === "POSITION" && !position) throw httpError(422, "POSITION_REQUIRED", "A position update requires latitude and longitude.");
    if (!["ASSIGNED", "PICKUP_IN_PROGRESS", "IN_TRANSIT"].includes(mission.status)) throw httpError(409, "MISSION_NOT_ACTIVE", "This mission cannot receive progress updates in its current state.");
    const recordedAt = asDate(body.recordedAt, "recordedAt");
    const previous = await prisma.deliveryUpdate.findFirst({ where: { missionId }, orderBy: { recordedAt: "desc" } });
    if (previous && recordedAt <= previous.recordedAt) throw httpError(409, "NON_MONOTONIC_DELIVERY_TIME", "Delivery updates must be later than the previous update.");
    const stops = mission.stops as DeliveryStop[];
    let status = mission.status;
    let stopSequence = mission.currentStopSequence || null;
    if (updateType === "ARRIVED") {
      if (mission.currentStopSequence > 0) {
        const currentStop = stops[mission.currentStopSequence - 1];
        if (currentStop?.kind === "PICKUP") {
          const pickup = await prisma.deliveryUpdate.findFirst({ where: { missionId, updateType: "PICKED_UP", stopSequence: mission.currentStopSequence } });
          if (!pickup) throw httpError(409, "PICKUP_NOT_CONFIRMED", "Confirm pickup before travelling to the next stop.");
        }
      }
      const next = stops[mission.currentStopSequence];
      if (!next) throw httpError(409, "ROUTE_COMPLETE", "All route stops have already been reached.");
      stopSequence = next.sequence;
      status = next.kind === "PICKUP" ? "PICKUP_IN_PROGRESS" : "IN_TRANSIT";
    } else if (updateType === "PICKED_UP") {
      const currentStop = stops[mission.currentStopSequence - 1];
      if (!currentStop || currentStop.kind !== "PICKUP" || mission.status !== "PICKUP_IN_PROGRESS") throw httpError(409, "INVALID_PICKUP_TRANSITION", "Arrive at a pickup stop before confirming pickup.");
      const alreadyPickedUp = await prisma.deliveryUpdate.findFirst({ where: { missionId, updateType: "PICKED_UP", stopSequence: mission.currentStopSequence } });
      if (alreadyPickedUp) throw httpError(409, "PICKUP_ALREADY_CONFIRMED", "Pickup at this stop was already confirmed.");
      stopSequence = mission.currentStopSequence;
      status = stops.slice(mission.currentStopSequence).some((stop) => stop.kind === "PICKUP") ? "PICKUP_IN_PROGRESS" : "IN_TRANSIT";
    } else if (updateType === "DELIVERED") {
      const currentStop = stops[mission.currentStopSequence - 1];
      if (mission.status !== "IN_TRANSIT" || mission.currentStopSequence !== stops.length || currentStop?.kind !== "DROPOFF") throw httpError(409, "INVALID_DELIVERY_TRANSITION", "Arrive at the final drop-off before marking the mission delivered.");
      stopSequence = mission.currentStopSequence;
      status = "DELIVERED";
    }
    const trace = await prisma.agentTrace.findFirst({ where: { subjectType: "ORDER", subjectId: mission.orderId } });
    const row = await prisma.$transaction(async (tx) => {
      const update = await tx.deliveryUpdate.create({ data: { id: updateId, missionId, updateType, recordedAt, position: position ?? Prisma.JsonNull, quantity: amount, note: typeof body.note === "string" ? body.note : null, stopSequence } });
      await tx.deliveryMission.update({ where: { id: missionId }, data: { status, ...(updateType === "ARRIVED" ? { currentStopSequence: stopSequence ?? mission.currentStopSequence } : {}) } });
      if (status === "DELIVERED" && mission.vehicleId) await tx.vehicle.updateMany({ where: { id: mission.vehicleId, transporterId: actor.id }, data: { status: "AVAILABLE" } });
      await recordEvent(tx, { eventType: "DELIVERY_UPDATE_POSTED", actorId: actor.id, entityId: missionId, traceId: trace?.id ?? randomUUID(), provenance: actor.isSynthetic ? Provenance.SYNTHETIC : Provenance.OBSERVED, payload: { missionId, updateType, recordedAt: update.recordedAt.toISOString(), ...(position ? { position } : {}), ...(typeof body.note === "string" ? { note: body.note } : {}) } });
      return update;
    });
    return deliveryUpdateDto(row);
  }));

  server.get("/v1/verification-tasks", async (request) => {
    const actor = requireRole(request, ["COORDINATOR", "ADMIN"]);
    const query = request.query as JsonObject;
    const farmIds = actor.role === "ADMIN"
      ? (await prisma.farm.findMany({ select: { id: true } })).map((row) => row.id)
      : await visibleFarmIds(actor);
    const rows = await prisma.verificationTask.findMany({
      where: { farmId: { in: farmIds }, ...(typeof query.status === "string" ? { status: query.status } : {}) },
      orderBy: { createdAt: "desc" },
      take: queryLimit(query.limit),
    });
    return { items: rows.map(verificationTaskDto), pageInfo };
  });

  server.post("/v1/verification-tasks/:taskId/decisions", async (request, reply) => idempotent(request, reply, 200, async () => {
    const actor = requireRole(request, ["COORDINATOR", "ADMIN"]);
    const { taskId } = request.params as { taskId: string };
    const body = assertObjectBody(request.body, ["decision", "note"], ["decision"]);
    const decision = asString(body.decision, "decision");
    if (!["VERIFY", "REQUEST_CHANGES"].includes(decision)) throw httpError(422, "INVALID_VERIFICATION_DECISION", "decision must be VERIFY or REQUEST_CHANGES.");
    const task = await prisma.verificationTask.findUnique({ where: { id: taskId } });
    const farmIds = actor.role === "ADMIN" ? [task?.farmId] : await visibleFarmIds(actor);
    if (!task || !farmIds.includes(task.farmId)) throw httpError(404, "VERIFICATION_TASK_NOT_FOUND", "Verification task was not found.");
    if (task.status !== "OPEN") throw httpError(409, "VERIFICATION_ALREADY_DECIDED", "This verification task already has a final decision.");
    const status = decision === "VERIFY" ? "VERIFIED" : "CHANGES_REQUESTED";
    const observation = await prisma.cropObservation.findUnique({ where: { id: task.subjectId } });
    const traceId = observation?.traceId ?? randomUUID();
    const row = await prisma.$transaction(async (tx) => {
      const updated = await tx.verificationTask.update({ where: { id: taskId }, data: { status, resolvedBy: actor.id, resolvedAt: new Date(), note: typeof body.note === "string" ? body.note : null } });
      await recordEvent(tx, {
        eventType: "VERIFICATION_DECIDED",
        actorId: actor.id,
        entityId: taskId,
        traceId,
        provenance: Provenance.OBSERVED,
        payload: { taskId, cropBatchId: task.cropBatchId, observationId: task.subjectId, status, ...(typeof body.note === "string" ? { note: body.note } : {}) },
      });
      return updated;
    });
    return verificationTaskDto(row);
  }));

  server.get("/v1/exceptions", async (request) => {
    const actor = requireRole(request, ["FARMER", "BUYER", "TRANSPORTER", "COORDINATOR", "ADMIN"]);
    const query = request.query as JsonObject;
    const rows = (await visibleExceptionRows(actor)).filter((row) => (typeof query.status !== "string" || row.status === query.status) && (typeof query.severity !== "string" || row.severity === query.severity)).slice(0, queryLimit(query.limit));
    return { items: rows.map(exceptionDto), pageInfo };
  });

  server.get("/v1/exceptions/:exceptionId", async (request) => {
    const actor = requireRole(request, ["FARMER", "BUYER", "TRANSPORTER", "COORDINATOR", "ADMIN"]);
    const { exceptionId } = request.params as { exceptionId: string };
    const row = (await visibleExceptionRows(actor)).find((item) => item.id === exceptionId);
    if (!row) throw httpError(404, "EXCEPTION_NOT_FOUND", "Operational exception was not found.");
    const approvals = await prisma.approval.findMany({ where: { subjectType: "RECOVERY", subjectId: exceptionId } });
    return exceptionDetailDto(row, summarizeApprovals(approvals, actor.id));
  });

  server.post("/v1/exceptions", async (request, reply) => idempotent(request, reply, 201, async () => {
    const actor = requireRole(request, ["TRANSPORTER", "COORDINATOR", "ADMIN"]);
    const body = assertObjectBody(request.body, ["exceptionType", "severity", "affectedEntityIds", "description", "provenance"], ["exceptionType", "severity", "affectedEntityIds", "description", "provenance"]);
    if (!Array.isArray(body.affectedEntityIds) || !body.affectedEntityIds.every((id) => typeof id === "string")) throw httpError(400, "VALIDATION_FAILED", "affectedEntityIds must be an array of UUID strings.");
    const requestedEntityIds = body.affectedEntityIds as string[];
    if (actor.role !== "ADMIN") {
      const orderIds = await visibleOrderIds(actor);
      const batchIds = await visibleBatchIds(actor);
      const missionIds = (await prisma.deliveryMission.findMany({ where: actor.role === "TRANSPORTER" ? { transporterId: actor.id } : { orderId: { in: orderIds } }, select: { id: true } })).map((row) => row.id);
      const allowed = new Set([...orderIds, ...batchIds, ...missionIds]);
      if (requestedEntityIds.some((id) => !allowed.has(id))) throw httpError(404, "AFFECTED_ENTITY_NOT_FOUND", "An affected record was not found.");
    }
    const affectedMissions = await prisma.deliveryMission.findMany({ where: { id: { in: requestedEntityIds } } });
    const affectedOrderIds = [...new Set([
      ...(await prisma.order.findMany({ where: { id: { in: requestedEntityIds } }, select: { id: true } })).map((row) => row.id),
      ...affectedMissions.map((mission) => mission.orderId),
    ])];
    const affectedEntityIds = [...new Set([...requestedEntityIds, ...affectedOrderIds])];
    const provenance = asString(body.provenance, "provenance") as Provenance;
    if (!Object.values(Provenance).includes(provenance) || provenance === Provenance.MODEL_PREDICTED) throw httpError(422, "INVALID_PROVENANCE", "Exceptions require observable provenance.");
    const exceptionType = asString(body.exceptionType, "exceptionType");
    const delayedMission = exceptionType === "DELAY" ? affectedMissions[0] : undefined;
    const proposedDeadline = delayedMission ? new Date(delayedMission.deadline.getTime() + 2 * 60 * 60 * 1000) : undefined;
    const coordinator = delayedMission ? (actor.role === "COORDINATOR" ? actor : await prisma.actor.findFirst({ where: { role: "COORDINATOR" } })) : null;
    if (delayedMission && !coordinator) throw httpError(409, "COORDINATOR_UNAVAILABLE", "No coordinator is available for the recovery decision.");
    const exceptionId = randomUUID();
    const approvalId = delayedMission ? randomUUID() : null;
    const traceId = randomUUID();
    const reportedAt = new Date();
    const row = await prisma.$transaction(async (tx) => {
      const exception = await tx.operationalException.create({
        data: {
          id: exceptionId,
          exceptionType,
          severity: asString(body.severity, "severity"),
          affectedEntityIds,
          description: asString(body.description, "description"),
          status: delayedMission ? "RECOVERY_PENDING" : "OPEN",
          provenance,
          reportedAt,
          ...(delayedMission && proposedDeadline ? {
            recoveryAction: "RESCHEDULE",
            recoverySummary: `Extend mission ${delayedMission.id.slice(0, 8)} by two hours to recover from the delay.`,
            recoveryChanges: { missionId: delayedMission.id, previousDeadline: delayedMission.deadline.toISOString(), proposedDeadline: proposedDeadline.toISOString() },
          } : {}),
        },
      });
      for (const orderId of affectedOrderIds) {
        const order = await tx.order.findUnique({ where: { id: orderId } });
        if (order) await tx.order.update({ where: { id: orderId }, data: { atRisk: true, activeExceptionIds: [...new Set([...(order.activeExceptionIds as string[]), exceptionId])] } });
      }
      if (approvalId && coordinator) await tx.approval.create({ data: { id: approvalId, subjectType: "RECOVERY", subjectId: exceptionId, requestedFromActorId: coordinator.id, status: "PENDING", requestedAt: reportedAt } });
      await tx.agentTrace.create({ data: { id: traceId, subjectType: "EXCEPTION", subjectId: exceptionId, status: delayedMission ? "AWAITING_APPROVAL" : "RUNNING", summary: delayedMission ? "Proposed a two-hour reschedule and paused for coordinator approval." : "Recorded an exception for coordinator review." } });
      await recordEvent(tx, { eventType: "EXCEPTION_REPORTED", actorId: actor.id, entityId: exceptionId, traceId, provenance, payload: { exceptionId, exceptionType: exception.exceptionType, severity: exception.severity, affectedEntityIds } });
      return exception;
    });
    return exceptionDto(row);
  }));

  server.post("/v1/deliveries/:deliveryId/acceptance", async (request, reply) => idempotent(request, reply, 201, async () => {
    const actor = requireRole(request, ["BUYER", "ADMIN"]);
    const { deliveryId } = request.params as { deliveryId: string };
    const body = assertObjectBody(request.body, ["outcome", "acceptedQuantity", "rejectedQuantity", "lineOutcomes", "note"], ["outcome", "acceptedQuantity", "rejectedQuantity", "lineOutcomes"]);
    const mission = await prisma.deliveryMission.findUnique({ where: { id: deliveryId } });
    if (!mission) throw httpError(404, "DELIVERY_NOT_FOUND", "Delivery mission was not found.");
    const order = await prisma.order.findUniqueOrThrow({ where: { id: mission.orderId } });
    if (actor.role === "BUYER" && order.buyerId !== actor.id) throw httpError(404, "DELIVERY_NOT_FOUND", "Delivery mission was not found.");
    if (mission.status !== "DELIVERED") throw httpError(409, "DELIVERY_NOT_READY", "The delivery has not been completed by the transporter.");
    if (await prisma.deliveryAcceptance.findUnique({ where: { orderId: order.id } })) throw httpError(409, "DELIVERY_ALREADY_ACCEPTED", "This delivery already has a final acceptance.");
    const accepted = readQuantity(body.acceptedQuantity, "acceptedQuantity");
    const rejected = readQuantity(body.rejectedQuantity, "rejectedQuantity");
    if (Math.abs(accepted + rejected - mission.quantity) > 0.0001) throw httpError(422, "DELIVERY_QUANTITY_MISMATCH", "Accepted and rejected quantities must equal the delivered quantity.");
    const outcome = asString(body.outcome, "outcome");
    if (!["ACCEPTED", "PARTIALLY_ACCEPTED", "REJECTED"].includes(outcome)) throw httpError(422, "INVALID_DELIVERY_OUTCOME", "The delivery outcome is not supported.");
    const lifecycleStatus = outcome === "ACCEPTED" ? "FULFILLED" : outcome === "PARTIALLY_ACCEPTED" ? "PARTIALLY_FULFILLED" : "REJECTED";
    const acceptanceId = randomUUID();
    const acceptedAt = new Date();
    if (!Array.isArray(body.lineOutcomes) || body.lineOutcomes.length === 0) throw httpError(400, "VALIDATION_FAILED", "lineOutcomes must contain each committed crop batch.");
    const allocation = await prisma.allocation.findFirst({ where: { orderId: order.id, status: "APPROVED" }, orderBy: { createdAt: "desc" } });
    if (!allocation) throw httpError(409, "ALLOCATION_NOT_FOUND", "The committed allocation was not found.");
    const allocationLines = await prisma.allocationLine.findMany({ where: { allocationId: allocation.id } });
    const committedByBatch = new Map<string, number>();
    for (const line of allocationLines) committedByBatch.set(line.cropBatchId, (committedByBatch.get(line.cropBatchId) ?? 0) + line.quantity);
    const rawLineOutcomes = body.lineOutcomes as unknown[];
    const lineOutcomes = rawLineOutcomes.map((item, index) => {
      const value = assertObjectBody(item, ["cropBatchId", "acceptedQuantity", "rejectedQuantity"], ["cropBatchId", "acceptedQuantity", "rejectedQuantity"]);
      return {
        cropBatchId: asString(value.cropBatchId, `lineOutcomes[${index}].cropBatchId`),
        accepted: readQuantity(value.acceptedQuantity, `lineOutcomes[${index}].acceptedQuantity`),
        rejected: readQuantity(value.rejectedQuantity, `lineOutcomes[${index}].rejectedQuantity`),
      };
    });
    if (new Set(lineOutcomes.map((line) => line.cropBatchId)).size !== lineOutcomes.length || lineOutcomes.length !== committedByBatch.size) throw httpError(422, "DELIVERY_LINE_MISMATCH", "Provide exactly one outcome for every committed crop batch.");
    for (const [cropBatchId, committedQuantity] of committedByBatch) {
      const line = lineOutcomes.find((item) => item.cropBatchId === cropBatchId);
      if (!line || Math.abs(line.accepted + line.rejected - committedQuantity) > 0.0001) throw httpError(422, "DELIVERY_LINE_MISMATCH", "Each line outcome must equal its committed allocation quantity.");
    }
    if (Math.abs(lineOutcomes.reduce((sum, line) => sum + line.accepted, 0) - accepted) > 0.0001 || Math.abs(lineOutcomes.reduce((sum, line) => sum + line.rejected, 0) - rejected) > 0.0001) throw httpError(422, "DELIVERY_TOTAL_MISMATCH", "Line outcomes must equal the delivery acceptance totals.");
    const serializedLineOutcomes = lineOutcomes.map((line) => ({ cropBatchId: line.cropBatchId, acceptedQuantity: quantity(line.accepted), rejectedQuantity: quantity(line.rejected) }));
    const trace = await prisma.agentTrace.findFirst({ where: { subjectType: "ORDER", subjectId: order.id } });
    const acceptance = await prisma.$transaction(async (tx) => {
      const created = await tx.deliveryAcceptance.create({ data: { id: acceptanceId, orderId: order.id, outcome, acceptedQuantity: accepted, rejectedQuantity: rejected, lineOutcomes: serializedLineOutcomes, note: typeof body.note === "string" ? body.note : null, acceptedBy: actor.id, acceptedAt } });
      await tx.order.update({ where: { id: order.id }, data: { lifecycleStatus, acceptedQuantity: accepted, atRisk: false, activeExceptionIds: [] } });
      await tx.reservation.updateMany({ where: { allocationId: { in: (await tx.allocation.findMany({ where: { orderId: order.id }, select: { id: true } })).map((row) => row.id) } }, data: { status: "RELEASED" } });
      for (const line of lineOutcomes) {
        const batch = await tx.cropBatch.findUnique({ where: { id: line.cropBatchId } });
        if (batch?.latestPredictionId) {
          const prediction = await tx.yieldPrediction.findUnique({ where: { id: batch.latestPredictionId } });
          if (prediction) {
            const actualQuantity = (prediction.actualQuantity ?? 0) + line.accepted;
            await tx.yieldPrediction.update({ where: { id: prediction.id }, data: { actualQuantity, absoluteError: Math.abs(prediction.q50 - actualQuantity) } });
          }
        }
      }
      const deliveryEvent = await recordEvent(tx, { eventType: "DELIVERY_ACCEPTED", actorId: actor.id, entityId: acceptanceId, traceId: trace?.id ?? randomUUID(), provenance: actor.isSynthetic ? Provenance.SYNTHETIC : Provenance.OBSERVED, payload: { deliveryId: acceptanceId, orderId: order.id, acceptedQuantity: quantity(accepted), rejectedQuantity: quantity(rejected), outcome, lineOutcomes: serializedLineOutcomes } });
      await recordEvent(tx, { eventType: `ORDER_${lifecycleStatus}`, actorId: actor.id, entityId: order.id, traceId: trace?.id ?? randomUUID(), correlationId: deliveryEvent.correlationId, causationId: deliveryEvent.id, provenance: actor.isSynthetic ? Provenance.SYNTHETIC : Provenance.OBSERVED, payload: { orderId: order.id, status: lifecycleStatus, acceptedQuantity: quantity(accepted), releasedReservationQuantity: quantity(Math.max(0, order.requestedQuantity - accepted)) } });
      return created;
    });
    return deliveryAcceptanceDto(acceptance);
  }));

  server.addHook("onClose", async () => prisma.$disconnect());
  return server;
}
