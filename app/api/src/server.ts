import { randomUUID } from "node:crypto";

import cors from "@fastify/cors";
import { Prisma, Provenance } from "@prisma/client";
import Fastify from "fastify";

import { registerAuthentication, requireRole, signDevelopmentToken } from "./auth.js";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { eventDto, recordEvent } from "./events.js";
import {
  assertObjectBody,
  httpError,
  idempotent,
  readLocation,
  readQuantity,
  sendProblem,
} from "./http.js";
import {
  approvalDto,
  cropBatchDto,
  demandDto,
  exceptionDto,
  listingDto,
  missionDto,
  orderDto,
  pageInfo,
  predictionDto,
  quantity,
  simulationRunDto,
  traceDto,
} from "./serializers.js";
import {
  approveAllocation,
  produceFixturePrediction,
  proposeAllocation,
  rejectApproval,
} from "./workflows.js";

type JsonObject = Record<string, unknown>;

const asString = (value: unknown, field: string) => {
  if (typeof value !== "string" || !value.trim()) {
    throw httpError(400, "VALIDATION_FAILED", `${field} must be a non-empty string.`);
  }
  return value.trim();
};

const asDate = (value: unknown, field: string) => {
  const parsed = new Date(asString(value, field));
  if (Number.isNaN(parsed.valueOf())) throw httpError(400, "VALIDATION_FAILED", `${field} must be an ISO-8601 date or date-time.`);
  return parsed;
};

const queryLimit = (value: unknown) => Math.min(100, Math.max(1, Number(value ?? 20) || 20));

type GeoPoint = { latitude: number; longitude: number };
type FixtureWorld = {
  actors: Array<{ actorId: string; role: string; position: GeoPoint; activity: string }>;
  routes: Array<{ missionId: string; status: string; path: GeoPoint[] }>;
  disruptions: Array<{ eventId: string; type: string; description: string; observedAt: string }>;
};

const fixtureWorld = (): FixtureWorld => ({
  actors: [
    { actorId: "a0000000-0000-4000-8000-000000000001", role: "FARMER", position: { latitude: 13.953, longitude: -61.005 }, activity: "Preparing 14 kg" },
    { actorId: "a0000000-0000-4000-8000-000000000005", role: "FARMER", position: { latitude: 13.941, longitude: -60.918 }, activity: "Preparing 6 kg" },
    { actorId: "a0000000-0000-4000-8000-000000000002", role: "BUYER", position: { latitude: 14.0101, longitude: -60.9875 }, activity: "Awaiting delivery" },
    { actorId: "a0000000-0000-4000-8000-000000000004", role: "TRANSPORTER", position: { latitude: 13.998, longitude: -60.986 }, activity: "Available" },
  ],
  routes: [],
  disruptions: [],
});

export async function buildServer() {
  const server = Fastify({ logger: true, bodyLimit: 1_000_000 });
  await server.register(cors, {
    origin: config.websiteOrigin,
    allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key", "Last-Event-ID"],
    exposedHeaders: ["Content-Type"],
  });
  await registerAuthentication(server);

  server.setErrorHandler((error, _request, reply) => sendProblem(reply, error));

  server.get("/health", async () => ({
    status: "ok",
    service: "harvest-product-api",
    contractVersion: "0.2.0",
    adapters: { model: config.modelAdapter, simulation: config.simulationAdapter },
  }));

  server.post("/dev/session", async (request, reply) => {
    if (!config.enableDevAuth) throw httpError(404, "NOT_FOUND", "Development authentication is disabled.");
    const body = assertObjectBody(request.body, ["persona"], ["persona"]);
    const persona = asString(body.persona, "persona");
    const actor = await prisma.actor.findUnique({ where: { authSubject: persona } });
    if (!actor) throw httpError(404, "PERSONA_NOT_FOUND", "The requested development persona was not seeded.");
    const accessToken = await signDevelopmentToken(actor);
    return reply.send({
      accessToken,
      actor: { actorId: actor.id, authSubject: actor.authSubject, name: actor.name, role: actor.role, synthetic: actor.isSynthetic },
    });
  });

  server.get("/v1/crop-batches", async (request) => {
    const query = request.query as JsonObject;
    const rows = await prisma.cropBatch.findMany({
      where: {
        ...(typeof query.cropType === "string" ? { cropType: query.cropType } : {}),
        ...(typeof query.status === "string" ? { status: query.status } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: queryLimit(query.limit),
    });
    return { items: rows.map(cropBatchDto), pageInfo };
  });

  server.get("/v1/crop-batches/:cropBatchId", async (request) => {
    const { cropBatchId } = request.params as { cropBatchId: string };
    const row = await prisma.cropBatch.findUnique({ where: { id: cropBatchId } });
    if (!row) throw httpError(404, "CROP_BATCH_NOT_FOUND", "Crop batch was not found.");
    return cropBatchDto(row);
  });

  server.post("/v1/crop-observations", async (request, reply) =>
    idempotent(request, reply, 201, async () => {
      const actor = requireRole(request, ["FARMER", "COORDINATOR", "ADMIN"]);
      const body = assertObjectBody(request.body, ["cropBatchId", "observedAt", "cropStage", "notes", "estimatedQuantity", "provenance"], ["cropBatchId", "observedAt", "cropStage", "provenance"]);
      const cropBatchId = asString(body.cropBatchId, "cropBatchId");
      const batch = await prisma.cropBatch.findUnique({ where: { id: cropBatchId } });
      if (!batch) throw httpError(404, "CROP_BATCH_NOT_FOUND", "Crop batch was not found.");
      if (actor.role === "FARMER") {
        const farm = await prisma.farm.findUnique({ where: { id: batch.farmId } });
        if (farm?.farmerId !== actor.id) throw httpError(403, "FARM_FORBIDDEN", "The crop batch is not owned by this farmer.");
      }
      const provenance = asString(body.provenance, "provenance") as Provenance;
      if (!Object.values(Provenance).includes(provenance) || provenance === Provenance.MODEL_PREDICTED) {
        throw httpError(422, "INVALID_PROVENANCE", "Crop observations require an observable input provenance.");
      }
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
    }),
  );

  server.post("/v1/crop-batches/:cropBatchId/forecast-requests", async (request, reply) =>
    idempotent(request, reply, 202, async () => {
      const actor = requireRole(request, ["FARMER", "COORDINATOR", "OPERATIONS", "ADMIN"]);
      const { cropBatchId } = request.params as { cropBatchId: string };
      const body = assertObjectBody(request.body, ["reason"], ["reason"]);
      asString(body.reason, "reason");
      const trace = await prisma.agentTrace.findFirst({ where: { subjectType: "CROP_BATCH", subjectId: cropBatchId }, orderBy: { id: "desc" } });
      const traceId = trace?.id ?? randomUUID();
      if (!trace) await prisma.agentTrace.create({ data: { id: traceId, subjectType: "CROP_BATCH", subjectId: cropBatchId, status: "RUNNING", summary: "Requested a refreshed crop forecast." } });
      const result = await produceFixturePrediction(cropBatchId, actor.id, traceId);
      return { forecastRequestId: result.requestId, cropBatchId, status: "COMPLETED", requestedAt: new Date().toISOString() };
    }),
  );

  server.get("/v1/yield-predictions/:predictionId", async (request) => {
    const { predictionId } = request.params as { predictionId: string };
    const row = await prisma.yieldPrediction.findUnique({ where: { id: predictionId } });
    if (!row) throw httpError(404, "PREDICTION_NOT_FOUND", "Yield prediction was not found.");
    return predictionDto(row);
  });

  server.get("/v1/listings", async (request) => {
    const query = request.query as JsonObject;
    const rows = await prisma.listing.findMany({
      where: {
        ...(typeof query.cropType === "string" ? { cropType: query.cropType } : {}),
        status: { in: ["ACTIVE", "RESERVED"] },
      },
      orderBy: { createdAt: "desc" },
      take: queryLimit(query.limit),
    });
    return { items: rows.map(listingDto), pageInfo };
  });

  server.post("/v1/listings", async (request, reply) =>
    idempotent(request, reply, 201, async () => {
      const actor = requireRole(request, ["FARMER", "COORDINATOR", "ADMIN"]);
      const body = assertObjectBody(request.body, ["cropBatchId", "quantity", "unitPrice", "availableFrom", "availableUntil"], ["cropBatchId", "quantity", "unitPrice", "availableFrom", "availableUntil"]);
      const batch = await prisma.cropBatch.findUnique({ where: { id: asString(body.cropBatchId, "cropBatchId") } });
      if (!batch) throw httpError(404, "CROP_BATCH_NOT_FOUND", "Crop batch was not found.");
      const amount = readQuantity(body.quantity);
      if (amount > batch.availableToPromise) throw httpError(422, "ATP_EXCEEDED", "Listing quantity exceeds available-to-promise supply.");
      const money = body.unitPrice as JsonObject;
      if (!money || typeof money.amount !== "number" || typeof money.currency !== "string") throw httpError(400, "VALIDATION_FAILED", "unitPrice requires amount and currency.");
      const farm = await prisma.farm.findUniqueOrThrow({ where: { id: batch.farmId } });
      const id = randomUUID();
      const traceId = randomUUID();
      const row = await prisma.$transaction(async (tx) => {
        const listing = await tx.listing.create({ data: { id, cropBatchId: batch.id, farmerId: farm.farmerId, cropType: batch.cropType, quantity: amount, unitPrice: money.amount as number, currency: money.currency as string, availableFrom: asDate(body.availableFrom, "availableFrom"), availableUntil: asDate(body.availableUntil, "availableUntil"), status: "ACTIVE" } });
        await tx.agentTrace.create({ data: { id: traceId, subjectType: "CROP_BATCH", subjectId: batch.id, status: "COMPLETED", summary: "Published supply without exceeding available-to-promise." } });
        await recordEvent(tx, { eventType: "LISTING_PUBLISHED", actorId: actor.id, entityId: id, traceId, provenance: batch.provenance, payload: { listingId: id, cropBatchId: batch.id, quantity: quantity(amount), availableFrom: listing.availableFrom.toISOString().slice(0, 10) } });
        return listing;
      });
      return listingDto(row);
    }),
  );

  server.get("/v1/buyer-demands", async (request) => {
    const query = request.query as JsonObject;
    const rows = await prisma.buyerDemand.findMany({ where: { ...(typeof query.status === "string" ? { status: query.status } : {}), ...(typeof query.cropType === "string" ? { cropType: query.cropType } : {}) }, orderBy: { createdAt: "desc" }, take: queryLimit(query.limit) });
    return { items: rows.map(demandDto), pageInfo };
  });

  server.post("/v1/buyer-demands", async (request, reply) =>
    idempotent(request, reply, 201, async () => {
      const actor = requireRole(request, ["BUYER", "COORDINATOR", "ADMIN"]);
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
    }),
  );

  server.get("/v1/orders", async (request) => {
    const query = request.query as JsonObject;
    const rows = await prisma.order.findMany({ where: { ...(typeof query.status === "string" ? { lifecycleStatus: query.status } : {}), ...(typeof query.atRisk === "string" ? { atRisk: query.atRisk === "true" } : {}) }, orderBy: { updatedAt: "desc" }, take: queryLimit(query.limit) });
    return { items: rows.map(orderDto), pageInfo };
  });

  server.post("/v1/orders", async (request, reply) =>
    idempotent(request, reply, 201, async () => {
      const actor = requireRole(request, ["BUYER", "COORDINATOR", "ADMIN"]);
      const body = assertObjectBody(request.body, ["cropType", "requestedQuantity", "neededBy", "deliveryLocation", "listingIds"], ["cropType", "requestedQuantity", "neededBy", "deliveryLocation"]);
      const location = readLocation(body.deliveryLocation);
      const listingIds = body.listingIds === undefined ? [] : body.listingIds;
      if (!Array.isArray(listingIds) || !listingIds.every((id) => typeof id === "string")) throw httpError(400, "VALIDATION_FAILED", "listingIds must be an array of UUID strings.");
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
    }),
  );

  server.get("/v1/orders/:orderId", async (request) => {
    const { orderId } = request.params as { orderId: string };
    const row = await prisma.order.findUnique({ where: { id: orderId } });
    if (!row) throw httpError(404, "ORDER_NOT_FOUND", "Order was not found.");
    return orderDto(row);
  });

  server.get("/v1/approvals", async (request) => {
    const query = request.query as JsonObject;
    const rows = await prisma.approval.findMany({ where: { ...(typeof query.status === "string" ? { status: query.status } : {}), ...(typeof query.subjectType === "string" ? { subjectType: query.subjectType } : {}) }, orderBy: { requestedAt: "desc" }, take: queryLimit(query.limit) });
    return { items: rows.map(approvalDto), pageInfo };
  });

  server.post("/v1/approvals/:approvalId/decisions", async (request, reply) =>
    idempotent(request, reply, 200, async () => {
      const actor = requireRole(request, ["FARMER", "BUYER", "COORDINATOR", "OPERATIONS", "ADMIN"]);
      const { approvalId } = request.params as { approvalId: string };
      const body = assertObjectBody(request.body, ["decision", "reason"], ["decision"]);
      const decision = asString(body.decision, "decision");
      const reason = typeof body.reason === "string" ? body.reason : undefined;
      const row = decision === "APPROVE" ? await approveAllocation(approvalId, actor.id, reason) : decision === "REJECT" ? await rejectApproval(approvalId, actor.id, reason) : (() => { throw httpError(400, "VALIDATION_FAILED", "decision must be APPROVE or REJECT."); })();
      return approvalDto(row);
    }),
  );

  server.get("/v1/delivery-missions", async (request) => {
    const query = request.query as JsonObject;
    const rows = await prisma.deliveryMission.findMany({ where: { ...(typeof query.status === "string" ? { status: query.status } : {}) }, take: queryLimit(query.limit) });
    return { items: rows.map(missionDto), pageInfo };
  });

  server.get("/v1/delivery-missions/:missionId", async (request) => {
    const { missionId } = request.params as { missionId: string };
    const row = await prisma.deliveryMission.findUnique({ where: { id: missionId } });
    if (!row) throw httpError(404, "MISSION_NOT_FOUND", "Delivery mission was not found.");
    return missionDto(row);
  });

  server.post("/v1/delivery-missions/:missionId/acceptance", async (request, reply) =>
    idempotent(request, reply, 200, async () => {
      const actor = requireRole(request, ["TRANSPORTER", "COORDINATOR", "ADMIN"]);
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
    }),
  );

  server.post("/v1/delivery-missions/:missionId/updates", async (request, reply) =>
    idempotent(request, reply, 201, async () => {
      const actor = requireRole(request, ["TRANSPORTER", "COORDINATOR", "ADMIN"]);
      const { missionId } = request.params as { missionId: string };
      const body = assertObjectBody(request.body, ["updateType", "recordedAt", "position", "quantity", "note"], ["updateType", "recordedAt"]);
      const mission = await prisma.deliveryMission.findUnique({ where: { id: missionId } });
      if (!mission) throw httpError(404, "MISSION_NOT_FOUND", "Delivery mission was not found.");
      if (actor.role === "TRANSPORTER" && mission.transporterId !== actor.id) throw httpError(403, "MISSION_FORBIDDEN", "Mission is not assigned to this transporter.");
      const updateType = asString(body.updateType, "updateType");
      const id = randomUUID();
      const position = body.position === undefined ? null : readLocation(body.position);
      const amount = body.quantity === undefined ? null : readQuantity(body.quantity);
      const trace = await prisma.agentTrace.findFirst({ where: { subjectType: "ORDER", subjectId: mission.orderId } });
      const row = await prisma.$transaction(async (tx) => {
        const update = await tx.deliveryUpdate.create({ data: { id, missionId, updateType, recordedAt: asDate(body.recordedAt, "recordedAt"), position: position ?? Prisma.JsonNull, quantity: amount, note: typeof body.note === "string" ? body.note : null } });
        if (updateType === "PICKED_UP") await tx.deliveryMission.update({ where: { id: missionId }, data: { status: "PICKUP_IN_PROGRESS" } });
        if (["POSITION", "ARRIVED"].includes(updateType)) await tx.deliveryMission.update({ where: { id: missionId }, data: { status: "IN_TRANSIT" } });
        if (updateType === "DELIVERED") await tx.deliveryMission.update({ where: { id: missionId }, data: { status: "DELIVERED" } });
        await recordEvent(tx, { eventType: "DELIVERY_UPDATE_POSTED", actorId: actor.id, entityId: missionId, traceId: trace?.id ?? randomUUID(), provenance: actor.isSynthetic ? Provenance.SYNTHETIC : Provenance.OBSERVED, payload: { missionId, updateType, recordedAt: update.recordedAt.toISOString(), ...(position ? { position } : {}), ...(typeof body.note === "string" ? { note: body.note } : {}) } });
        return update;
      });
      return { updateId: row.id, missionId, updateType: row.updateType, recordedAt: row.recordedAt.toISOString(), ...(position ? { position } : {}), ...(amount !== null ? { quantity: quantity(amount) } : {}), ...(row.note ? { note: row.note } : {}) };
    }),
  );

  server.get("/v1/exceptions", async (request) => {
    const query = request.query as JsonObject;
    const rows = await prisma.operationalException.findMany({ where: { ...(typeof query.status === "string" ? { status: query.status } : {}), ...(typeof query.severity === "string" ? { severity: query.severity } : {}) }, orderBy: { reportedAt: "desc" }, take: queryLimit(query.limit) });
    return { items: rows.map(exceptionDto), pageInfo };
  });

  server.post("/v1/exceptions", async (request, reply) =>
    idempotent(request, reply, 201, async () => {
      const actor = requireRole(request, ["TRANSPORTER", "COORDINATOR", "OPERATIONS", "ADMIN"]);
      const body = assertObjectBody(request.body, ["exceptionType", "severity", "affectedEntityIds", "description", "provenance"], ["exceptionType", "severity", "affectedEntityIds", "description", "provenance"]);
      if (!Array.isArray(body.affectedEntityIds) || !body.affectedEntityIds.every((id) => typeof id === "string")) throw httpError(400, "VALIDATION_FAILED", "affectedEntityIds must be an array of UUID strings.");
      const provenance = asString(body.provenance, "provenance") as Provenance;
      const exceptionId = randomUUID();
      const traceId = randomUUID();
      const approvalId = randomUUID();
      const reportedAt = new Date();
      const row = await prisma.$transaction(async (tx) => {
        const exception = await tx.operationalException.create({ data: { id: exceptionId, exceptionType: asString(body.exceptionType, "exceptionType"), severity: asString(body.severity, "severity"), affectedEntityIds: body.affectedEntityIds as string[], description: asString(body.description, "description"), status: "RECOVERY_PENDING", provenance, reportedAt } });
        await tx.order.updateMany({ where: { id: { in: body.affectedEntityIds as string[] } }, data: { atRisk: true, activeExceptionIds: [exceptionId] } });
        await tx.approval.create({ data: { id: approvalId, subjectType: "RECOVERY", subjectId: exceptionId, status: "PENDING", requestedAt: reportedAt } });
        await tx.agentTrace.create({ data: { id: traceId, subjectType: "EXCEPTION", subjectId: exceptionId, status: "AWAITING_APPROVAL", summary: "Proposed a deterministic reroute and paused for human approval." } });
        await recordEvent(tx, { eventType: "EXCEPTION_REPORTED", actorId: actor.id, entityId: exceptionId, traceId, provenance, payload: { exceptionId, exceptionType: exception.exceptionType, severity: exception.severity, affectedEntityIds: body.affectedEntityIds as string[] } });
        return exception;
      });
      return exceptionDto(row);
    }),
  );

  server.post("/v1/deliveries/:deliveryId/acceptance", async (request, reply) =>
    idempotent(request, reply, 201, async () => {
      const actor = requireRole(request, ["BUYER", "COORDINATOR", "ADMIN"]);
      const { deliveryId } = request.params as { deliveryId: string };
      const body = assertObjectBody(request.body, ["outcome", "acceptedQuantity", "rejectedQuantity", "note"], ["outcome", "acceptedQuantity", "rejectedQuantity"]);
      const mission = await prisma.deliveryMission.findUnique({ where: { id: deliveryId } });
      if (!mission) throw httpError(404, "DELIVERY_NOT_FOUND", "Delivery mission was not found.");
      const order = await prisma.order.findUniqueOrThrow({ where: { id: mission.orderId } });
      const accepted = readQuantity(body.acceptedQuantity, "acceptedQuantity");
      const rejected = readQuantity(body.rejectedQuantity, "rejectedQuantity");
      if (Math.abs(accepted + rejected - mission.quantity) > 0.0001) throw httpError(422, "DELIVERY_QUANTITY_MISMATCH", "Accepted and rejected quantities must equal the delivered quantity.");
      const outcome = asString(body.outcome, "outcome");
      const lifecycleStatus = outcome === "ACCEPTED" ? "FULFILLED" : outcome === "PARTIALLY_ACCEPTED" ? "PARTIALLY_FULFILLED" : "REJECTED";
      const acceptanceId = randomUUID();
      const acceptedAt = new Date();
      const trace = await prisma.agentTrace.findFirst({ where: { subjectType: "ORDER", subjectId: order.id } });
      await prisma.$transaction(async (tx) => {
        await tx.deliveryAcceptance.create({ data: { id: acceptanceId, orderId: order.id, outcome, acceptedQuantity: accepted, rejectedQuantity: rejected, note: typeof body.note === "string" ? body.note : null, acceptedBy: actor.id, acceptedAt } });
        await tx.order.update({ where: { id: order.id }, data: { lifecycleStatus, acceptedQuantity: accepted, atRisk: false, activeExceptionIds: [] } });
        await tx.deliveryMission.update({ where: { id: mission.id }, data: { status: "DELIVERED" } });
        await tx.reservation.updateMany({ where: { allocationId: { in: (await tx.allocation.findMany({ where: { orderId: order.id }, select: { id: true } })).map((row) => row.id) } }, data: { status: "RELEASED" } });
        const deliveryEvent = await recordEvent(tx, { eventType: "DELIVERY_ACCEPTED", actorId: actor.id, entityId: acceptanceId, traceId: trace?.id ?? randomUUID(), provenance: actor.isSynthetic ? Provenance.SYNTHETIC : Provenance.OBSERVED, payload: { deliveryId: acceptanceId, orderId: order.id, acceptedQuantity: quantity(accepted), rejectedQuantity: quantity(rejected), outcome } });
        await recordEvent(tx, { eventType: `ORDER_${lifecycleStatus}`, actorId: actor.id, entityId: order.id, traceId: trace?.id ?? randomUUID(), correlationId: deliveryEvent.correlationId, causationId: deliveryEvent.id, provenance: actor.isSynthetic ? Provenance.SYNTHETIC : Provenance.OBSERVED, payload: { orderId: order.id, status: lifecycleStatus, acceptedQuantity: quantity(accepted), releasedReservationQuantity: quantity(Math.max(0, order.requestedQuantity - accepted)) } });
        if (trace) {
          await tx.agentTrace.update({ where: { id: trace.id }, data: { status: "COMPLETED" } });
          await tx.traceStep.create({ data: { traceId: trace.id, recordedAt: acceptedAt, kind: "OUTCOME", summary: `${accepted} kg accepted; order ${lifecycleStatus.toLowerCase().replaceAll("_", " ")}.` } });
        }
      });
      return { deliveryId: acceptanceId, orderId: order.id, outcome, acceptedQuantity: quantity(accepted), rejectedQuantity: quantity(rejected), ...(typeof body.note === "string" ? { note: body.note } : {}), acceptedBy: actor.id, acceptedAt: acceptedAt.toISOString() };
    }),
  );

  server.get("/v1/operations/snapshot", async (request) => {
    const query = request.query as JsonObject;
    const runId = typeof query.simulationRunId === "string" ? query.simulationRunId : undefined;
    const [activeListings, openDemands, orders, missions, exceptions] = await Promise.all([
      prisma.listing.count({ where: { status: "ACTIVE" } }),
      prisma.buyerDemand.count({ where: { status: { in: ["OPEN", "MATCHING"] } } }),
      prisma.order.groupBy({ by: ["lifecycleStatus"], _count: true }),
      prisma.deliveryMission.findMany({ where: { status: { notIn: ["DELIVERED", "CANCELLED"] } }, select: { id: true } }),
      prisma.operationalException.findMany({ where: { status: { not: "RESOLVED" } }, select: { id: true } }),
    ]);
    return { generatedAt: new Date().toISOString(), ...(runId ? { simulationRunId: runId } : {}), activeListings, openDemands, ordersByStatus: Object.fromEntries(orders.map((row) => [row.lifecycleStatus, row._count])), activeMissionIds: missions.map((row) => row.id), openExceptionIds: exceptions.map((row) => row.id) };
  });

  server.get("/v1/agent-traces/:traceId", async (request) => {
    const { traceId } = request.params as { traceId: string };
    const trace = await prisma.agentTrace.findUnique({ where: { id: traceId } });
    if (!trace) throw httpError(404, "TRACE_NOT_FOUND", "Agent trace was not found.");
    const steps = await prisma.traceStep.findMany({ where: { traceId }, orderBy: { recordedAt: "asc" } });
    return traceDto(trace, steps);
  });

  server.get("/v1/events/stream", async (request, reply) => {
    const query = request.query as JsonObject;
    const runId = typeof query.simulationRunId === "string" ? query.simulationRunId : undefined;
    const lastId = request.headers["last-event-id"];
    let lastCursor = 0n;
    if (typeof lastId === "string") {
      const event = await prisma.domainEvent.findUnique({ where: { id: lastId } });
      if (!event) throw httpError(409, "EVENT_CURSOR_EXPIRED", "The replay cursor is unknown; refresh a snapshot before reconnecting.");
      lastCursor = event.cursor;
    }
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": config.websiteOrigin,
    });

    let closed = false;
    request.raw.on("close", () => { closed = true; });
    const sendPending = async () => {
      const events = await prisma.domainEvent.findMany({ where: { cursor: { gt: lastCursor }, ...(runId ? { simulationRunId: runId } : {}) }, orderBy: { cursor: "asc" }, take: 100 });
      for (const event of events) {
        if (closed) return;
        reply.raw.write(`id: ${event.id}\nevent: ${event.eventType}\ndata: ${JSON.stringify(eventDto(event))}\n\n`);
        lastCursor = event.cursor;
      }
    };
    await sendPending();
    const timer = setInterval(() => { void sendPending(); if (!closed) reply.raw.write(": keep-alive\n\n"); }, 1_000);
    request.raw.on("close", () => clearInterval(timer));
  });

  server.post("/v1/simulation-runs", async (request, reply) =>
    idempotent(request, reply, 201, async () => {
      requireRole(request, ["OPERATIONS", "COORDINATOR", "ADMIN"]);
      const body = assertObjectBody(request.body, ["scenarioId", "policy", "seed", "speed"], ["scenarioId", "policy", "seed", "speed"]);
      const id = randomUUID();
      const row = await prisma.simulationRun.create({ data: { id, scenarioId: asString(body.scenarioId, "scenarioId"), policy: asString(body.policy, "policy"), seed: BigInt(Number(body.seed)), speed: Number(body.speed), status: "READY", currentTime: new Date("2026-09-04T08:00:00Z"), world: fixtureWorld() } });
      return simulationRunDto(row);
    }),
  );

  server.get("/v1/simulation-runs/:runId", async (request) => {
    const { runId } = request.params as { runId: string };
    const row = await prisma.simulationRun.findUnique({ where: { id: runId } });
    if (!row) throw httpError(404, "RUN_NOT_FOUND", "Simulation run was not found.");
    return simulationRunDto(row);
  });

  server.post("/v1/simulation-runs/:runId/commands", async (request, reply) =>
    idempotent(request, reply, 202, async () => {
      const actor = requireRole(request, ["OPERATIONS", "COORDINATOR", "ADMIN"]);
      const { runId } = request.params as { runId: string };
      const body = assertObjectBody(request.body, ["command", "speed", "targetTime", "injection"], ["command"]);
      const command = asString(body.command, "command");
      const run = await prisma.simulationRun.findUnique({ where: { id: runId } });
      if (!run) throw httpError(404, "RUN_NOT_FOUND", "Simulation run was not found.");
      let world = run.world as ReturnType<typeof fixtureWorld>;
      let status = run.status;
      let speed = run.speed;
      let currentTime = run.currentTime;
      if (command === "START" || command === "RESUME") {
        status = "RUNNING";
        currentTime = new Date(currentTime.getTime() + speed * 60_000);
        world = { ...world, actors: world.actors.map((item) => item.role === "TRANSPORTER" ? { ...item, position: { latitude: item.position.latitude + 0.006, longitude: item.position.longitude - 0.002 }, activity: "Moving toward pickup" } : item) };
      } else if (command === "PAUSE") status = "PAUSED";
      else if (command === "RESET") { status = "READY"; currentTime = new Date("2026-09-04T08:00:00Z"); world = fixtureWorld(); }
      else if (command === "SPEED") { speed = Number(body.speed); if (!(speed > 0 && speed <= 1000)) throw httpError(422, "INVALID_SPEED", "Speed must be greater than zero and no more than 1000."); }
      else if (command === "REWIND") currentTime = asDate(body.targetTime, "targetTime");
      else if (command === "INJECT") {
        const injection = assertObjectBody(body.injection, ["type", "scheduledFor", "affectedEntityIds", "publicDescription"], ["type", "scheduledFor", "affectedEntityIds"]);
        const disruptionId = randomUUID();
        const description = typeof injection.publicDescription === "string" ? injection.publicDescription : `${injection.type} disruption observed.`;
        world = { ...world, disruptions: [...world.disruptions, { eventId: disruptionId, type: asString(injection.type, "injection.type"), description, observedAt: asDate(injection.scheduledFor, "injection.scheduledFor").toISOString() }] };
        await prisma.$transaction(async (tx) => {
          await recordEvent(tx, { eventType: "SIMULATION_DISRUPTION_OBSERVED", actorId: actor.id, entityId: disruptionId, traceId: randomUUID(), simulationRunId: runId, simulationTime: currentTime, provenance: Provenance.SYNTHETIC, payload: { disruptionType: injection.type as string, affectedEntityIds: injection.affectedEntityIds as string[], observedAt: currentTime.toISOString(), description } });
        });
      } else throw httpError(400, "INVALID_COMMAND", "Unsupported simulation command.");
      await prisma.simulationRun.update({ where: { id: runId }, data: { status, speed, currentTime, world } });
      return { commandId: randomUUID(), runId, command, status: "ACCEPTED", acceptedAt: new Date().toISOString() };
    }),
  );

  server.get("/v1/simulation-runs/:runId/world", async (request) => {
    const { runId } = request.params as { runId: string };
    const run = await prisma.simulationRun.findUnique({ where: { id: runId } });
    if (!run) throw httpError(404, "RUN_NOT_FOUND", "Simulation run was not found.");
    const world = run.world as ReturnType<typeof fixtureWorld>;
    return { runId, simulationTime: run.currentTime.toISOString(), ...world };
  });

  server.post("/v1/paired-runs", async (request, reply) =>
    idempotent(request, reply, 201, async () => {
      requireRole(request, ["OPERATIONS", "COORDINATOR", "ADMIN"]);
      const body = assertObjectBody(request.body, ["scenarioId", "seed"], ["scenarioId", "seed"]);
      const pairId = randomUUID();
      const baselineRunId = randomUUID();
      const harvestRunId = randomUUID();
      const world = fixtureWorld();
      const result = { baseline: { localProcurementRate: 0.44, fulfilmentRate: 0.68, wasteQuantity: quantity(17) }, harvest: { localProcurementRate: 0.7, fulfilmentRate: 0.91, wasteQuantity: quantity(8) } };
      await prisma.$transaction(async (tx) => {
        for (const [id, policy] of [[baselineRunId, "BASELINE"], [harvestRunId, "HARVEST"]] as const) await tx.simulationRun.create({ data: { id, scenarioId: asString(body.scenarioId, "scenarioId"), policy, seed: BigInt(Number(body.seed)), speed: 30, status: "COMPLETED", currentTime: new Date("2026-09-05T18:00:00Z"), world } });
        await tx.pairedRun.create({ data: { id: pairId, scenarioId: body.scenarioId as string, seed: BigInt(Number(body.seed)), baselineRunId, harvestRunId, status: "COMPLETED", result } });
      });
      return { pairId, scenarioId: body.scenarioId, seed: Number(body.seed), baselineRunId, harvestRunId, status: "COMPLETED", result };
    }),
  );

  server.get("/v1/paired-runs/:pairId", async (request) => {
    const { pairId } = request.params as { pairId: string };
    const row = await prisma.pairedRun.findUnique({ where: { id: pairId } });
    if (!row) throw httpError(404, "PAIR_NOT_FOUND", "Paired run was not found.");
    return { pairId: row.id, scenarioId: row.scenarioId, seed: Number(row.seed), baselineRunId: row.baselineRunId, harvestRunId: row.harvestRunId, status: row.status, ...(row.result ? { result: row.result } : {}) };
  });

  server.addHook("onClose", async () => prisma.$disconnect());
  return server;
}
