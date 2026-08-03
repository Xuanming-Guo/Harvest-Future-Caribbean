import { randomUUID } from "node:crypto";

import cors from "@fastify/cors";
import { Prisma, Provenance } from "@prisma/client";
import Fastify from "fastify";

import { canAccessBatch, canAccessOrder, visibleBatchIds, visibleExceptionRows, visibleFarmIds, visibleOrderIds } from "./access.js";
import { registerAuthentication, requireRole, signDevelopmentToken } from "./auth.js";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { recordEvent } from "./events.js";
import { assertObjectBody, httpError, idempotent, readLocation, readQuantity, sendProblem } from "./http.js";
import { approvalDto, cropBatchDto, demandDto, exceptionDto, listingDto, missionDto, orderDto, pageInfo, predictionDto, quantity } from "./serializers.js";
import { approveAllocation, produceFixturePrediction, proposeAllocation, rejectApproval } from "./workflows.js";

type JsonObject = Record<string, unknown>;
type GeoPoint = { latitude: number; longitude: number };

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

export async function buildServer() {
  const server = Fastify({ logger: true, bodyLimit: 1_000_000 });
  await server.register(cors, {
    origin: config.websiteOrigin,
    allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key"],
    exposedHeaders: ["Content-Type"],
  });
  await registerAuthentication(server);
  server.setErrorHandler((error, _request, reply) => sendProblem(reply, error));

  server.get("/health", async () => ({ status: "ok", service: "harvest-product-api", contractVersion: "0.2.0", adapters: { model: config.modelAdapter } }));

  server.post("/dev/session", async (request, reply) => {
    if (!config.enableDevAuth) throw httpError(404, "NOT_FOUND", "Development authentication is disabled.");
    const body = assertObjectBody(request.body, ["persona"], ["persona"]);
    const actor = await prisma.actor.findUnique({ where: { authSubject: asString(body.persona, "persona") } });
    if (!actor || !["FARMER", "BUYER", "TRANSPORTER", "COORDINATOR"].includes(actor.role)) throw httpError(404, "PERSONA_NOT_FOUND", "The requested development persona was not seeded.");
    return reply.send({
      accessToken: await signDevelopmentToken(actor),
      actor: { actorId: actor.id, authSubject: actor.authSubject, name: actor.name, role: actor.role, synthetic: actor.isSynthetic },
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
    return { items: rows.map(cropBatchDto), pageInfo };
  });

  server.get("/v1/crop-batches/:cropBatchId", async (request) => {
    const actor = requireRole(request, ["FARMER", "COORDINATOR", "OPERATIONS", "ADMIN"]);
    const { cropBatchId } = request.params as { cropBatchId: string };
    if (!(await canAccessBatch(actor, cropBatchId))) throw httpError(404, "CROP_BATCH_NOT_FOUND", "Crop batch was not found.");
    const row = await prisma.cropBatch.findUnique({ where: { id: cropBatchId } });
    if (!row) throw httpError(404, "CROP_BATCH_NOT_FOUND", "Crop batch was not found.");
    return cropBatchDto(row);
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
      await recordEvent(tx, { eventType: "CROP_OBSERVATION_SUBMITTED", actorId: actor.id, entityId: cropBatchId, traceId, provenance, payload: { observationId, cropBatchId, observedAt: observedAt.toISOString(), cropStage: body.cropStage as string } });
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
    return { ...orderDto(row), ...(allocation ? { allocation: { allocationId: allocation.id, status: allocation.status, lines: lines.map((line) => ({ cropBatchId: line.cropBatchId, quantity: quantity(line.quantity) })) } } : {}) };
  });

  server.get("/v1/approvals", async (request) => {
    const actor = requireRole(request, ["FARMER", "BUYER", "COORDINATOR", "ADMIN"]);
    const query = request.query as JsonObject;
    const rows = await prisma.approval.findMany({ where: { ...(actor.role !== "ADMIN" ? { requestedFromActorId: actor.id } : {}), ...(typeof query.status === "string" ? { status: query.status } : {}), ...(typeof query.subjectType === "string" ? { subjectType: query.subjectType } : {}) }, orderBy: { requestedAt: "desc" }, take: queryLimit(query.limit) });
    return { items: rows.map(approvalDto), pageInfo };
  });

  server.post("/v1/approvals/:approvalId/decisions", async (request, reply) => idempotent(request, reply, 200, async () => {
    const actor = requireRole(request, ["FARMER", "BUYER", "COORDINATOR", "ADMIN"]);
    const { approvalId } = request.params as { approvalId: string };
    const body = assertObjectBody(request.body, ["decision", "reason"], ["decision"]);
    const decision = asString(body.decision, "decision");
    const reason = typeof body.reason === "string" ? body.reason : undefined;
    const row = decision === "APPROVE" ? await approveAllocation(approvalId, actor.id, reason) : decision === "REJECT" ? await rejectApproval(approvalId, actor.id, reason) : (() => { throw httpError(400, "VALIDATION_FAILED", "decision must be APPROVE or REJECT."); })();
    return approvalDto(row);
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
    const visible = actor.role === "ADMIN" || actor.role === "OPERATIONS" || (actor.role === "TRANSPORTER" ? row.status === "AVAILABLE" || row.transporterId === actor.id : await canAccessOrder(actor, row.orderId));
    if (!visible) throw httpError(404, "MISSION_NOT_FOUND", "Delivery mission was not found.");
    return missionDto(row);
  });

  server.post("/v1/delivery-missions/:missionId/acceptance", async (request, reply) => idempotent(request, reply, 200, async () => {
    const actor = requireRole(request, ["TRANSPORTER", "ADMIN"]);
    const { missionId } = request.params as { missionId: string };
    const body = assertObjectBody(request.body, ["decision", "vehicleId"], ["decision", "vehicleId"]);
    if (body.decision !== "ACCEPT") throw httpError(400, "VALIDATION_FAILED", "Only ACCEPT is supported.");
    const current = await prisma.deliveryMission.findUnique({ where: { id: missionId } });
    if (!current) throw httpError(404, "MISSION_NOT_FOUND", "Delivery mission was not found.");
    if (current.status !== "AVAILABLE") throw httpError(409, "MISSION_UNAVAILABLE", "Mission is no longer available.");
    const trace = await prisma.agentTrace.findFirst({ where: { subjectType: "ORDER", subjectId: current.orderId } });
    const row = await prisma.$transaction(async (tx) => {
      const mission = await tx.deliveryMission.update({ where: { id: missionId }, data: { status: "ASSIGNED", transporterId: actor.id, vehicleId: asString(body.vehicleId, "vehicleId") } });
      await tx.order.update({ where: { id: current.orderId }, data: { lifecycleStatus: "IN_DELIVERY" } });
      const stops = current.stops as Array<{ location: GeoPoint }>;
      await recordEvent(tx, { eventType: "DELIVERY_MISSION_ACCEPTED", actorId: actor.id, entityId: missionId, traceId: trace?.id ?? randomUUID(), provenance: actor.isSynthetic ? Provenance.SYNTHETIC : Provenance.OBSERVED, payload: { missionId, orderId: current.orderId, status: "ASSIGNED", transporterId: actor.id, stops: stops.map((stop) => stop.location) } });
      return mission;
    });
    return missionDto(row);
  }));

  server.post("/v1/delivery-missions/:missionId/updates", async (request, reply) => idempotent(request, reply, 201, async () => {
    const actor = requireRole(request, ["TRANSPORTER", "ADMIN"]);
    const { missionId } = request.params as { missionId: string };
    const body = assertObjectBody(request.body, ["updateType", "recordedAt", "position", "quantity", "note"], ["updateType", "recordedAt"]);
    const mission = await prisma.deliveryMission.findUnique({ where: { id: missionId } });
    if (!mission || (actor.role === "TRANSPORTER" && mission.transporterId !== actor.id)) throw httpError(404, "MISSION_NOT_FOUND", "Delivery mission was not found.");
    const updateType = asString(body.updateType, "updateType");
    if (!["PICKED_UP", "POSITION", "DELAYED", "ARRIVED", "DELIVERED"].includes(updateType)) throw httpError(422, "INVALID_DELIVERY_UPDATE", "The delivery update type is not supported.");
    const updateId = randomUUID();
    const position = body.position === undefined ? null : readLocation(body.position);
    const amount = body.quantity === undefined ? null : readQuantity(body.quantity);
    const trace = await prisma.agentTrace.findFirst({ where: { subjectType: "ORDER", subjectId: mission.orderId } });
    const row = await prisma.$transaction(async (tx) => {
      const update = await tx.deliveryUpdate.create({ data: { id: updateId, missionId, updateType, recordedAt: asDate(body.recordedAt, "recordedAt"), position: position ?? Prisma.JsonNull, quantity: amount, note: typeof body.note === "string" ? body.note : null } });
      const status = updateType === "PICKED_UP" ? "PICKUP_IN_PROGRESS" : updateType === "DELIVERED" ? "DELIVERED" : updateType === "DELAYED" ? mission.status : "IN_TRANSIT";
      await tx.deliveryMission.update({ where: { id: missionId }, data: { status } });
      await recordEvent(tx, { eventType: "DELIVERY_UPDATE_POSTED", actorId: actor.id, entityId: missionId, traceId: trace?.id ?? randomUUID(), provenance: actor.isSynthetic ? Provenance.SYNTHETIC : Provenance.OBSERVED, payload: { missionId, updateType, recordedAt: update.recordedAt.toISOString(), ...(position ? { position } : {}), ...(typeof body.note === "string" ? { note: body.note } : {}) } });
      return update;
    });
    return { updateId: row.id, missionId, updateType: row.updateType, recordedAt: row.recordedAt.toISOString(), ...(position ? { position } : {}), ...(amount !== null ? { quantity: quantity(amount) } : {}), ...(row.note ? { note: row.note } : {}) };
  }));

  server.get("/v1/exceptions", async (request) => {
    const actor = requireRole(request, ["FARMER", "BUYER", "TRANSPORTER", "COORDINATOR", "ADMIN"]);
    const query = request.query as JsonObject;
    const rows = (await visibleExceptionRows(actor)).filter((row) => (typeof query.status !== "string" || row.status === query.status) && (typeof query.severity !== "string" || row.severity === query.severity)).slice(0, queryLimit(query.limit));
    return { items: rows.map(exceptionDto), pageInfo };
  });

  server.post("/v1/exceptions", async (request, reply) => idempotent(request, reply, 201, async () => {
    const actor = requireRole(request, ["TRANSPORTER", "COORDINATOR", "ADMIN"]);
    const body = assertObjectBody(request.body, ["exceptionType", "severity", "affectedEntityIds", "description", "provenance"], ["exceptionType", "severity", "affectedEntityIds", "description", "provenance"]);
    if (!Array.isArray(body.affectedEntityIds) || !body.affectedEntityIds.every((id) => typeof id === "string")) throw httpError(400, "VALIDATION_FAILED", "affectedEntityIds must be an array of UUID strings.");
    const affectedEntityIds = body.affectedEntityIds as string[];
    if (actor.role !== "ADMIN") {
      const orderIds = await visibleOrderIds(actor);
      const batchIds = await visibleBatchIds(actor);
      const missionIds = (await prisma.deliveryMission.findMany({ where: actor.role === "TRANSPORTER" ? { transporterId: actor.id } : { orderId: { in: orderIds } }, select: { id: true } })).map((row) => row.id);
      const allowed = new Set([...orderIds, ...batchIds, ...missionIds]);
      if (affectedEntityIds.some((id) => !allowed.has(id))) throw httpError(404, "AFFECTED_ENTITY_NOT_FOUND", "An affected record was not found.");
    }
    const coordinator = actor.role === "COORDINATOR" ? actor : await prisma.actor.findFirst({ where: { role: "COORDINATOR" } });
    if (!coordinator) throw httpError(409, "COORDINATOR_UNAVAILABLE", "No coordinator is available for the recovery decision.");
    const provenance = asString(body.provenance, "provenance") as Provenance;
    const exceptionId = randomUUID();
    const approvalId = randomUUID();
    const traceId = randomUUID();
    const reportedAt = new Date();
    const row = await prisma.$transaction(async (tx) => {
      const exception = await tx.operationalException.create({ data: { id: exceptionId, exceptionType: asString(body.exceptionType, "exceptionType"), severity: asString(body.severity, "severity"), affectedEntityIds, description: asString(body.description, "description"), status: "RECOVERY_PENDING", provenance, reportedAt } });
      await tx.order.updateMany({ where: { id: { in: affectedEntityIds } }, data: { atRisk: true, activeExceptionIds: [exceptionId] } });
      await tx.approval.create({ data: { id: approvalId, subjectType: "RECOVERY", subjectId: exceptionId, requestedFromActorId: coordinator.id, status: "PENDING", requestedAt: reportedAt } });
      await tx.agentTrace.create({ data: { id: traceId, subjectType: "EXCEPTION", subjectId: exceptionId, status: "AWAITING_APPROVAL", summary: "Proposed a deterministic recovery and paused for coordinator approval." } });
      await recordEvent(tx, { eventType: "EXCEPTION_REPORTED", actorId: actor.id, entityId: exceptionId, traceId, provenance, payload: { exceptionId, exceptionType: exception.exceptionType, severity: exception.severity, affectedEntityIds } });
      return exception;
    });
    return exceptionDto(row);
  }));

  server.post("/v1/deliveries/:deliveryId/acceptance", async (request, reply) => idempotent(request, reply, 201, async () => {
    const actor = requireRole(request, ["BUYER", "ADMIN"]);
    const { deliveryId } = request.params as { deliveryId: string };
    const body = assertObjectBody(request.body, ["outcome", "acceptedQuantity", "rejectedQuantity", "note"], ["outcome", "acceptedQuantity", "rejectedQuantity"]);
    const mission = await prisma.deliveryMission.findUnique({ where: { id: deliveryId } });
    if (!mission) throw httpError(404, "DELIVERY_NOT_FOUND", "Delivery mission was not found.");
    const order = await prisma.order.findUniqueOrThrow({ where: { id: mission.orderId } });
    if (actor.role === "BUYER" && order.buyerId !== actor.id) throw httpError(404, "DELIVERY_NOT_FOUND", "Delivery mission was not found.");
    if (mission.status !== "DELIVERED") throw httpError(409, "DELIVERY_NOT_READY", "The delivery has not been completed by the transporter.");
    const accepted = readQuantity(body.acceptedQuantity, "acceptedQuantity");
    const rejected = readQuantity(body.rejectedQuantity, "rejectedQuantity");
    if (Math.abs(accepted + rejected - mission.quantity) > 0.0001) throw httpError(422, "DELIVERY_QUANTITY_MISMATCH", "Accepted and rejected quantities must equal the delivered quantity.");
    const outcome = asString(body.outcome, "outcome");
    if (!["ACCEPTED", "PARTIALLY_ACCEPTED", "REJECTED"].includes(outcome)) throw httpError(422, "INVALID_DELIVERY_OUTCOME", "The delivery outcome is not supported.");
    const lifecycleStatus = outcome === "ACCEPTED" ? "FULFILLED" : outcome === "PARTIALLY_ACCEPTED" ? "PARTIALLY_FULFILLED" : "REJECTED";
    const acceptanceId = randomUUID();
    const acceptedAt = new Date();
    const trace = await prisma.agentTrace.findFirst({ where: { subjectType: "ORDER", subjectId: order.id } });
    await prisma.$transaction(async (tx) => {
      await tx.deliveryAcceptance.create({ data: { id: acceptanceId, orderId: order.id, outcome, acceptedQuantity: accepted, rejectedQuantity: rejected, note: typeof body.note === "string" ? body.note : null, acceptedBy: actor.id, acceptedAt } });
      await tx.order.update({ where: { id: order.id }, data: { lifecycleStatus, acceptedQuantity: accepted, atRisk: false, activeExceptionIds: [] } });
      await tx.reservation.updateMany({ where: { allocationId: { in: (await tx.allocation.findMany({ where: { orderId: order.id }, select: { id: true } })).map((row) => row.id) } }, data: { status: "RELEASED" } });
      const deliveryEvent = await recordEvent(tx, { eventType: "DELIVERY_ACCEPTED", actorId: actor.id, entityId: acceptanceId, traceId: trace?.id ?? randomUUID(), provenance: actor.isSynthetic ? Provenance.SYNTHETIC : Provenance.OBSERVED, payload: { deliveryId: acceptanceId, orderId: order.id, acceptedQuantity: quantity(accepted), rejectedQuantity: quantity(rejected), outcome } });
      await recordEvent(tx, { eventType: `ORDER_${lifecycleStatus}`, actorId: actor.id, entityId: order.id, traceId: trace?.id ?? randomUUID(), correlationId: deliveryEvent.correlationId, causationId: deliveryEvent.id, provenance: actor.isSynthetic ? Provenance.SYNTHETIC : Provenance.OBSERVED, payload: { orderId: order.id, status: lifecycleStatus, acceptedQuantity: quantity(accepted), releasedReservationQuantity: quantity(Math.max(0, order.requestedQuantity - accepted)) } });
    });
    return { deliveryId: acceptanceId, orderId: order.id, outcome, acceptedQuantity: quantity(accepted), rejectedQuantity: quantity(rejected), ...(typeof body.note === "string" ? { note: body.note } : {}), acceptedBy: actor.id, acceptedAt: acceptedAt.toISOString() };
  }));

  server.addHook("onClose", async () => prisma.$disconnect());
  return server;
}
