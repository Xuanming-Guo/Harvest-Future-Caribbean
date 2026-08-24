import { randomUUID } from "node:crypto";

import cors from "@fastify/cors";
import { Prisma, Provenance } from "@prisma/client";
import Fastify from "fastify";

import { actorRunScope, canAccessBatch, canAccessOrder, visibleBatchIds, visibleExceptionRows, visibleFarmIds, visibleOrderIds } from "./access.js";
import { createAgentCoordinator } from "./agents/coordinator.js";
import type { ObservationSourceType } from "./agents/prompts.js";
import { registerAuthentication, requireRole, signDevelopmentToken, type AuthActor } from "./auth.js";
import { operationNow, registerOperationClock } from "./clock.js";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { recordEvent } from "./events.js";
import { assertObjectBody, httpError, idempotent, readLocation, readQuantity, sendProblem } from "./http.js";
import { registerSimulationRoutes } from "./simulation-routes.js";
import {
  approvalDto,
  cropBatchDto,
  cropObservationIntakeDto,
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
  traceDto,
  vehicleDto,
  verificationTaskDto,
} from "./serializers.js";

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

async function canSeeMission(actor: AuthActor, mission: { orderId: string; status: string; transporterId: string | null; simulationRunId: string | null }) {
  if (mission.simulationRunId !== actor.simulationRunId) return false;
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
  const listings = await prisma.listing.findMany({ where: { id: { in: lines.map((line) => line.listingId) } } });
  const listingById = new Map(listings.map((listing) => [listing.id, listing]));
  const requestedActor = await prisma.actor.findUnique({ where: { id: row.requestedFromActorId } });
  let visibleLines = lines;
  if (requestedActor?.role === "FARMER") {
    const farmIds = (await prisma.farm.findMany({ where: { farmerId: requestedActor.id }, select: { id: true } })).map((farm) => farm.id);
    const batchIds = (await prisma.cropBatch.findMany({ where: { farmId: { in: farmIds } }, select: { id: true } })).map((batch) => batch.id);
    visibleLines = lines.filter((line) => batchIds.includes(line.cropBatchId));
  }
  const amount = visibleLines.reduce((sum, line) => sum + line.quantity, 0);
  const estimatedPrice = visibleLines.reduce((sum, line) => sum + line.quantity * (listingById.get(line.listingId)?.unitPrice ?? 0), 0);
  const currency = listingById.get(visibleLines[0]?.listingId)?.currency ?? "XCD";
  return {
    title: `${order.cropType.toLowerCase()} supply commitment`,
    summary: `Confirm ${amount} kg for delivery by ${order.neededBy.toISOString()}.`,
    orderId: order.id,
    cropType: order.cropType,
    quantity: quantity(amount),
    estimatedPrice: { amount: Number(estimatedPrice.toFixed(2)), currency },
    neededBy: order.neededBy.toISOString(),
  };
}

/** A browser may use either spelling for the same local development host. */
function localOriginAliases(origin: string): string[] {
  const url = new URL(origin);
  if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") return [url.origin];
  return ["localhost", "127.0.0.1"].map((hostname) => `${url.protocol}//${hostname}${url.port ? `:${url.port}` : ""}`);
}

export async function buildServer() {
  const agentCoordinator = createAgentCoordinator();
  const server = Fastify({ logger: true, bodyLimit: 1_000_000 });
  registerOperationClock(server);
  const allowedOrigins = [...new Set([
    ...localOriginAliases(config.websiteOrigin),
    ...localOriginAliases(config.controlRoomOrigin),
  ])];
  await server.register(cors, {
    origin: allowedOrigins,
    allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key", "Last-Event-ID"],
    exposedHeaders: ["Content-Type"],
  });
  await registerAuthentication(server);
  server.addHook("preHandler", async (request) => {
    if (request.headers["x-harvest-simulation-time"] !== undefined && !request.actor?.isSynthetic) {
      throw httpError(403, "SIMULATION_CLOCK_FORBIDDEN", "Only a run-scoped synthetic participant may supply simulation time.");
    }
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method) || !request.actor?.isSynthetic || !request.actor.simulationRunId) return;
    const run = await prisma.simulationRun.findUnique({
      where: { id: request.actor.simulationRunId },
      select: { status: true },
    });
    if (run?.status === "COMPLETED" || run?.status === "FAILED") {
      throw httpError(409, "SIMULATION_RUN_IMMUTABLE", "Completed simulation participants are available for read-only replay only.");
    }
  });
  server.setErrorHandler((error, _request, reply) => sendProblem(reply, error));

  server.get("/health", async () => ({ status: "ok", service: "harvest-product-api", contractVersion: "0.7.0", adapters: { model: config.modelAdapter, agentText: agentCoordinator.textAdapterName } }));

  server.get("/v1/me", async (request) => {
    const actor = requireRole(request, [...productRoles]);
    const run = actor.simulationRunId
      ? await prisma.simulationRun.findUnique({ where: { id: actor.simulationRunId }, select: { status: true } })
      : null;
    return {
      actorId: actor.id,
      authSubject: actor.authSubject,
      name: actor.name,
      role: actor.role,
      synthetic: actor.isSynthetic,
      ...(actor.serviceZone ? { serviceZone: actor.serviceZone } : {}),
      ...(actor.simulationRunId ? {
        simulationRunId: actor.simulationRunId,
        simulationRunStatus: run?.status ?? "UNKNOWN",
        readOnly: run?.status === "COMPLETED" || run?.status === "FAILED",
      } : { readOnly: false }),
      ...(actor.defaultLatitude !== null && actor.defaultLongitude !== null
        ? { location: { latitude: actor.defaultLatitude, longitude: actor.defaultLongitude } }
        : {}),
    };
  });

  server.post("/dev/session", async (request, reply) => {
    if (!config.enableDevAuth) throw httpError(404, "NOT_FOUND", "Development authentication is disabled.");
    const body = assertObjectBody(request.body, ["persona"], ["persona"]);
    const actor = await prisma.actor.findUnique({ where: { authSubject: asString(body.persona, "persona") } });
    if (!actor || !["FARMER", "BUYER", "TRANSPORTER", "COORDINATOR", "OPERATIONS", "ADMIN"].includes(actor.role)) throw httpError(404, "PERSONA_NOT_FOUND", "The requested development persona was not seeded.");
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

  server.post("/v1/crop-observation-intakes", async (request, reply) => idempotent(request, reply, 201, async () => {
    const actor = requireRole(request, ["FARMER", "COORDINATOR", "ADMIN"]);
    const body = assertObjectBody(
      request.body,
      ["cropBatchId", "observedAt", "sourceType", "sourceText", "provenance"],
      ["cropBatchId", "observedAt", "sourceType", "sourceText", "provenance"],
    );
    const cropBatchId = asString(body.cropBatchId, "cropBatchId");
    if (!(await canAccessBatch(actor, cropBatchId))) throw httpError(404, "CROP_BATCH_NOT_FOUND", "Crop batch was not found.");
    const batch = await prisma.cropBatch.findUnique({ where: { id: cropBatchId } });
    if (!batch) throw httpError(404, "CROP_BATCH_NOT_FOUND", "Crop batch was not found.");
    const sourceType = asString(body.sourceType, "sourceType") as ObservationSourceType;
    if (!["TEXT", "VOICE_TRANSCRIPT", "COORDINATOR_NOTE"].includes(sourceType)) throw httpError(422, "INVALID_SOURCE_TYPE", "sourceType must be TEXT, VOICE_TRANSCRIPT, or COORDINATOR_NOTE.");
    const sourceText = asString(body.sourceText, "sourceText");
    if (sourceText.length > 4_000) throw httpError(422, "SOURCE_TEXT_TOO_LONG", "sourceText must be at most 4,000 characters.");
    const provenance = asString(body.provenance, "provenance") as Provenance;
    if (!Object.values(Provenance).includes(provenance) || provenance === Provenance.MODEL_PREDICTED) throw httpError(422, "INVALID_PROVENANCE", "Observation intake requires observable provenance.");
    const observedAt = asDate(body.observedAt, "observedAt");
    const startedAt = Date.now();
    const draft = await agentCoordinator.draftCropObservation({
      actorRole: actor.role,
      cropBatchId,
      cropType: batch.cropType,
      currentBatchStatus: batch.status,
      observedAt: observedAt.toISOString(),
      timezone: "America/St_Lucia",
      sourceType,
      sourceText,
    });
    const intakeId = randomUUID();
    const traceId = randomUUID();
    const createdAt = operationNow();
    const row = await prisma.$transaction(async (tx) => {
      await tx.agentTrace.create({
        data: { id: traceId, subjectType: "CROP_BATCH", subjectId: cropBatchId, workflowType: "CROP_INTELLIGENCE", stage: "DRAFT_READY", status: "AWAITING_HUMAN", summary: "Extracted a non-binding crop update draft for human review.", simulationRunId: actor.simulationRunId },
      });
      const intake = await tx.cropObservationIntake.create({
        data: {
          id: intakeId,
          cropBatchId,
          actorId: actor.id,
          observedAt,
          sourceType,
          sourceText,
          status: "DRAFT",
          suggestedCropStage: draft.suggestedCropStage,
          suggestedQuantity: draft.suggestedQuantityKg,
          suggestedNotes: draft.suggestedNotes,
          confidence: draft.confidence,
          fieldConfidence: draft.fieldConfidence,
          warnings: draft.warnings,
          promptId: draft.promptId,
          adapter: draft.adapter,
          provenance,
          traceId,
          createdAt,
          simulationRunId: actor.simulationRunId,
        },
      });
      await tx.traceStep.create({
        data: {
          traceId,
          recordedAt: createdAt,
          kind: "TOOL_CALL",
          agentName: "Intake Agent",
          toolName: "extract-crop-observation",
          provenance: Provenance.INFERRED,
          promptId: draft.promptId,
          adapter: draft.adapter,
          durationMs: Date.now() - startedAt,
          confidence: draft.confidence,
          summary: `Prepared an editable draft with ${draft.warnings.length} warning${draft.warnings.length === 1 ? "" : "s"}; no operational crop state changed.`,
          simulationRunId: actor.simulationRunId,
        },
      });
      await recordEvent(tx, {
        eventType: "CROP_OBSERVATION_INTAKE_DRAFTED",
        actorId: actor.id,
        entityId: intakeId,
        traceId,
        provenance: Provenance.INFERRED,
        simulationRunId: actor.simulationRunId,
        payload: { intakeId, cropBatchId, sourceType, status: "DRAFT", promptId: draft.promptId, adapter: draft.adapter },
      });
      return intake;
    });
    return cropObservationIntakeDto(row);
  }));

  server.post("/v1/crop-observations", async (request, reply) => idempotent(request, reply, 201, async () => {
    const actor = requireRole(request, ["FARMER", "COORDINATOR", "ADMIN"]);
    const body = assertObjectBody(request.body, ["cropBatchId", "observedAt", "cropStage", "notes", "estimatedQuantity", "provenance", "intakeId"], ["cropBatchId", "observedAt", "cropStage", "provenance"]);
    const cropBatchId = asString(body.cropBatchId, "cropBatchId");
    if (!(await canAccessBatch(actor, cropBatchId))) throw httpError(404, "CROP_BATCH_NOT_FOUND", "Crop batch was not found.");
    const intakeId = body.intakeId === undefined ? undefined : asString(body.intakeId, "intakeId");
    const intake = intakeId ? await prisma.cropObservationIntake.findUnique({ where: { id: intakeId } }) : null;
    if (intakeId && (!intake || intake.simulationRunId !== actor.simulationRunId || intake.cropBatchId !== cropBatchId || intake.status !== "DRAFT" || (actor.role === "FARMER" && intake.actorId !== actor.id))) {
      throw httpError(409, "INTAKE_NOT_CONFIRMABLE", "The observation intake is unavailable, already confirmed, or belongs to another crop batch.");
    }
    const provenance = asString(body.provenance, "provenance") as Provenance;
    if (!Object.values(Provenance).includes(provenance) || provenance === Provenance.MODEL_PREDICTED) throw httpError(422, "INVALID_PROVENANCE", "Crop observations require an observable input provenance.");
    const observationId = randomUUID();
    const traceId = intake?.traceId ?? randomUUID();
    const observedAt = asDate(body.observedAt, "observedAt");
    const recordedAt = operationNow();
    const estimatedQuantity = body.estimatedQuantity === undefined ? null : readQuantity(body.estimatedQuantity, "estimatedQuantity");
    const observationEvent = await prisma.$transaction(async (tx) => {
      if (intake) {
        await tx.cropObservationIntake.update({ where: { id: intake.id }, data: { status: "CONFIRMED", confirmedObservationId: observationId, confirmedAt: recordedAt } });
        await tx.agentTrace.update({ where: { id: traceId }, data: { status: "RUNNING", stage: "OBSERVATION_CONFIRMED", summary: "A human reviewed the draft and submitted the authoritative crop observation." } });
      } else {
        await tx.agentTrace.create({ data: { id: traceId, subjectType: "CROP_BATCH", subjectId: cropBatchId, workflowType: "CROP_INTELLIGENCE", stage: "OBSERVATION_CONFIRMED", status: "RUNNING", summary: "Validated a crop observation and requested an updated conservative forecast.", simulationRunId: actor.simulationRunId } });
      }
      await tx.traceStep.create({ data: { traceId, recordedAt, kind: "INPUT", agentName: "Intake Agent", toolName: "confirm-human-observation", provenance, summary: `Human confirmed ${asString(body.cropStage, "cropStage")} observation${estimatedQuantity !== null ? ` with ${estimatedQuantity} kg estimate` : ""}.`, simulationRunId: actor.simulationRunId } });
      await tx.cropObservation.create({ data: { id: observationId, cropBatchId, actorId: actor.id, observedAt, recordedAt, cropStage: asString(body.cropStage, "cropStage"), notes: typeof body.notes === "string" ? body.notes : null, estimatedQuantity, provenance, traceId, simulationRunId: actor.simulationRunId } });
      await tx.cropBatch.update({ where: { id: cropBatchId }, data: { latestObservationId: observationId, provenance } });
      const intakeEvent = intake ? await tx.domainEvent.findFirst({ where: { eventType: "CROP_OBSERVATION_INTAKE_DRAFTED", entityId: intake.id }, orderBy: { occurredAt: "desc" } }) : null;
      const createdEvent = await recordEvent(tx, { eventType: "CROP_OBSERVATION_SUBMITTED", actorId: actor.id, entityId: cropBatchId, traceId, correlationId: intakeEvent?.correlationId, causationId: intakeEvent?.id, provenance, simulationRunId: actor.simulationRunId, payload: { observationId, cropBatchId, observedAt: observedAt.toISOString(), cropStage: body.cropStage as string, ...(intake ? { intakeId: intake.id } : {}) } });
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
          simulationRunId: actor.simulationRunId,
        },
      });
      await recordEvent(tx, {
        eventType: "VERIFICATION_TASK_CREATED",
        actorId: actor.id,
        entityId: taskId,
        traceId,
        correlationId: createdEvent.correlationId,
        causationId: createdEvent.id,
        provenance,
        simulationRunId: actor.simulationRunId,
        payload: { taskId, cropBatchId, observationId, status: "OPEN" },
      });
      return createdEvent;
    });
    await agentCoordinator.refreshCropIntelligence(cropBatchId, actor.id, traceId, { correlationId: observationEvent.correlationId, causationId: observationEvent.id });
    return { observationId, cropBatchId, observedAt: observedAt.toISOString(), recordedAt: recordedAt.toISOString(), cropStage: body.cropStage, ...(typeof body.notes === "string" ? { notes: body.notes } : {}), ...(estimatedQuantity !== null ? { estimatedQuantity: quantity(estimatedQuantity) } : {}), provenance, traceId, ...(intake ? { intakeId: intake.id } : {}) };
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
    const result = await agentCoordinator.refreshCropIntelligence(cropBatchId, actor.id, traceId);
    return { forecastRequestId: result.requestId, cropBatchId, status: "COMPLETED", requestedAt: operationNow().toISOString() };
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
      where: { ...actorRunScope(actor), ...(typeof query.cropType === "string" ? { cropType: query.cropType } : {}), ...(actor.role === "FARMER" || actor.role === "COORDINATOR" ? { farmerId: { in: farmerIds } } : { status: "ACTIVE" }) },
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
    const visible = listing.simulationRunId === actor.simulationRunId && (actor.role === "ADMIN" || actor.role === "OPERATIONS" ||
      (actor.role === "BUYER" ? listing.status === "ACTIVE" :
        actor.role === "FARMER" ? listing.farmerId === actor.id : await canAccessBatch(actor, listing.cropBatchId)));
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
      ? (await prisma.cropBatch.findMany({ where: actorRunScope(actor), select: { id: true } })).map((row) => row.id)
      : await visibleBatchIds(actor);
    const cropTypes = [...new Set((await prisma.cropBatch.findMany({ where: { id: { in: batchIds } }, select: { cropType: true } })).map((row) => row.cropType))];
    const requestedCrop = typeof query.cropType === "string" ? query.cropType.toUpperCase() : undefined;
    const eligibleCropTypes = requestedCrop ? (cropTypes.includes(requestedCrop) ? [requestedCrop] : []) : cropTypes;
    const rows = await prisma.buyerDemand.findMany({
      where: {
        ...actorRunScope(actor),
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
      const listing = await tx.listing.create({ data: { id: listingId, cropBatchId, farmerId: farm.farmerId, cropType: batch.cropType, quantity: amount, unitPrice, currency, availableFrom: asDate(body.availableFrom, "availableFrom"), availableUntil: asDate(body.availableUntil, "availableUntil"), status: "ACTIVE", simulationRunId: actor.simulationRunId } });
      await tx.agentTrace.create({ data: { id: traceId, subjectType: "CROP_BATCH", subjectId: cropBatchId, status: "COMPLETED", summary: "Published supply without exceeding available-to-promise.", simulationRunId: actor.simulationRunId } });
      await recordEvent(tx, { eventType: "LISTING_PUBLISHED", actorId: actor.id, entityId: listingId, traceId, provenance: batch.provenance, simulationRunId: actor.simulationRunId, payload: { listingId, cropBatchId, quantity: quantity(amount), availableFrom: listing.availableFrom.toISOString().slice(0, 10) } });
      return listing;
    });
    return listingDto(row);
  }));

  server.get("/v1/buyer-demands", async (request) => {
    const actor = requireRole(request, ["BUYER", "ADMIN"]);
    const query = request.query as JsonObject;
    const rows = await prisma.buyerDemand.findMany({ where: { ...actorRunScope(actor), ...(actor.role === "BUYER" ? { buyerId: actor.id } : {}), ...(typeof query.status === "string" ? { status: query.status } : {}), ...(typeof query.cropType === "string" ? { cropType: query.cropType } : {}) }, orderBy: { createdAt: "desc" }, take: queryLimit(query.limit) });
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
      const demand = await tx.buyerDemand.create({ data: { id: demandId, buyerId: actor.id, cropType: asString(body.cropType, "cropType").toUpperCase(), quantity: readQuantity(body.quantity), neededBy: asDate(body.neededBy, "neededBy"), latitude: location.latitude, longitude: location.longitude, maxUnitPrice: typeof maxPrice?.amount === "number" ? maxPrice.amount : null, currency: typeof maxPrice?.currency === "string" ? maxPrice.currency : "XCD", status: "OPEN", simulationRunId: actor.simulationRunId } });
      await tx.agentTrace.create({ data: { id: traceId, subjectType: "ORDER", subjectId: demandId, status: "RUNNING", summary: "Recorded buyer demand for matching.", simulationRunId: actor.simulationRunId } });
      await recordEvent(tx, { eventType: "BUYER_DEMAND_CREATED", actorId: actor.id, entityId: demandId, traceId, provenance: actor.isSynthetic ? Provenance.SYNTHETIC : Provenance.OBSERVED, simulationRunId: actor.simulationRunId, payload: { demandId, cropType: demand.cropType, quantity: quantity(demand.quantity), neededBy: demand.neededBy.toISOString() } });
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
      const order = await tx.order.create({ data: { id: orderId, buyerId: actor.id, cropType: asString(body.cropType, "cropType").toUpperCase(), requestedQuantity, acceptedQuantity: 0, neededBy: asDate(body.neededBy, "neededBy"), latitude: location.latitude, longitude: location.longitude, listingIds, lifecycleStatus: "REQUESTED", atRisk: false, activeExceptionIds: [], traceId, simulationRunId: actor.simulationRunId } });
      await tx.agentTrace.create({ data: { id: traceId, subjectType: "ORDER", subjectId: orderId, workflowType: "ORDER_FULFILMENT", stage: "ORDER_REQUESTED", status: "RUNNING", summary: "Validating safe supply for a buyer order.", simulationRunId: actor.simulationRunId } });
      await tx.traceStep.create({ data: { traceId, recordedAt: operationNow(), kind: "INPUT", agentName: "Market Balance Agent", toolName: "read-order-request", provenance: actor.isSynthetic ? Provenance.SYNTHETIC : Provenance.OBSERVED, summary: `Buyer requested ${requestedQuantity} kg of ${order.cropType}.`, simulationRunId: actor.simulationRunId } });
      await recordEvent(tx, { eventType: "ORDER_REQUESTED", actorId: actor.id, entityId: orderId, traceId, provenance: actor.isSynthetic ? Provenance.SYNTHETIC : Provenance.OBSERVED, simulationRunId: actor.simulationRunId, payload: { orderId, cropType: order.cropType, requestedQuantity: quantity(requestedQuantity), status: "REQUESTED" } });
      return order;
    });
    await agentCoordinator.matchOrder(orderId, actor.id, traceId);
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

  server.get("/v1/agent-traces/:traceId", async (request) => {
    const actor = requireRole(request, [...productRoles]);
    const { traceId } = request.params as { traceId: string };
    const trace = await prisma.agentTrace.findUnique({ where: { id: traceId } });
    if (!trace) throw httpError(404, "TRACE_NOT_FOUND", "Agent trace was not found.");
    let visible = trace.simulationRunId === actor.simulationRunId && (actor.role === "ADMIN" || actor.role === "OPERATIONS");
    if (!visible && trace.subjectType === "CROP_BATCH") visible = await canAccessBatch(actor, trace.subjectId);
    if (!visible && trace.subjectType === "ORDER") visible = await canAccessOrder(actor, trace.subjectId);
    if (!visible && trace.subjectType === "EXCEPTION") visible = (await visibleExceptionRows(actor)).some((row) => row.id === trace.subjectId);
    if (!visible) throw httpError(404, "TRACE_NOT_FOUND", "Agent trace was not found.");
    const steps = await prisma.traceStep.findMany({ where: { traceId }, orderBy: [{ recordedAt: "asc" }, { id: "asc" }] });
    return traceDto(trace, steps);
  });

  server.get("/v1/approvals", async (request) => {
    const actor = requireRole(request, ["FARMER", "BUYER", "COORDINATOR", "ADMIN"]);
    const query = request.query as JsonObject;
    const rows = await prisma.approval.findMany({ where: { ...actorRunScope(actor), ...(actor.role !== "ADMIN" ? { requestedFromActorId: actor.id } : {}), ...(typeof query.status === "string" ? { status: query.status } : {}), ...(typeof query.subjectType === "string" ? { subjectType: query.subjectType } : {}) }, orderBy: { requestedAt: "desc" }, take: queryLimit(query.limit) });
    return { items: await Promise.all(rows.map(async (row) => approvalDto(row, await approvalContext(row)))), pageInfo };
  });

  server.post("/v1/approvals/:approvalId/decisions", async (request, reply) => idempotent(request, reply, 200, async () => {
    const actor = requireRole(request, ["FARMER", "BUYER", "COORDINATOR", "ADMIN"]);
    const { approvalId } = request.params as { approvalId: string };
    const body = assertObjectBody(request.body, ["decision", "reason"], ["decision"]);
    const decision = asString(body.decision, "decision");
    const reason = typeof body.reason === "string" ? body.reason : undefined;
    if (decision !== "APPROVE" && decision !== "REJECT") throw httpError(400, "VALIDATION_FAILED", "decision must be APPROVE or REJECT.");
    const row = await agentCoordinator.decideApproval(approvalId, actor.id, decision, reason);
    return approvalDto(row, await approvalContext(row));
  }));

  server.get("/v1/delivery-missions", async (request) => {
    const actor = requireRole(request, [...productRoles]);
    const query = request.query as JsonObject;
    const orderIds = await visibleOrderIds(actor);
    const where = actor.role === "TRANSPORTER" ? { OR: [{ status: "AVAILABLE" }, { transporterId: actor.id }] } : actor.role === "ADMIN" || actor.role === "OPERATIONS" ? {} : { orderId: { in: orderIds } };
    const rows = await prisma.deliveryMission.findMany({ where: { ...actorRunScope(actor), ...where, ...(typeof query.status === "string" ? { status: query.status } : {}) }, orderBy: { deadline: "asc" }, take: queryLimit(query.limit) });
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
    const rows = await prisma.vehicle.findMany({ where: { transporterId: actor.id, ...actorRunScope(actor) }, orderBy: [{ status: "asc" }, { label: "asc" }] });
    return { items: rows.map(vehicleDto), pageInfo };
  });

  server.post("/v1/delivery-missions/:missionId/acceptance", async (request, reply) => idempotent(request, reply, 200, async () => {
    const actor = requireRole(request, ["TRANSPORTER"]);
    const { missionId } = request.params as { missionId: string };
    const body = assertObjectBody(request.body, ["decision", "vehicleId"], ["decision", "vehicleId"]);
    if (body.decision !== "ACCEPT") throw httpError(400, "VALIDATION_FAILED", "Only ACCEPT is supported.");
    const current = await prisma.deliveryMission.findUnique({ where: { id: missionId } });
    if (!current || current.simulationRunId !== actor.simulationRunId) throw httpError(404, "MISSION_NOT_FOUND", "Delivery mission was not found.");
    if (current.status !== "AVAILABLE") throw httpError(409, "MISSION_UNAVAILABLE", "Mission is no longer available.");
    const vehicleId = asString(body.vehicleId, "vehicleId");
    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
    if (!vehicle || vehicle.transporterId !== actor.id || vehicle.simulationRunId !== actor.simulationRunId) throw httpError(404, "VEHICLE_NOT_FOUND", "Vehicle was not found.");
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
      await recordEvent(tx, { eventType: "DELIVERY_MISSION_ACCEPTED", actorId: actor.id, entityId: missionId, traceId: trace?.id ?? randomUUID(), provenance: actor.isSynthetic ? Provenance.SYNTHETIC : Provenance.OBSERVED, simulationRunId: actor.simulationRunId, payload: { missionId, orderId: current.orderId, status: "ASSIGNED", transporterId: actor.id, stops } });
      return mission;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return missionDto(row);
  }));

  server.post("/v1/delivery-missions/:missionId/updates", async (request, reply) => idempotent(request, reply, 201, async () => {
    const actor = requireRole(request, ["TRANSPORTER"]);
    const { missionId } = request.params as { missionId: string };
    const body = assertObjectBody(request.body, ["updateType", "recordedAt", "position", "quantity", "note"], ["updateType", "recordedAt"]);
    const mission = await prisma.deliveryMission.findUnique({ where: { id: missionId } });
    if (!mission || mission.simulationRunId !== actor.simulationRunId || (actor.role === "TRANSPORTER" && mission.transporterId !== actor.id)) throw httpError(404, "MISSION_NOT_FOUND", "Delivery mission was not found.");
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
      const update = await tx.deliveryUpdate.create({ data: { id: updateId, missionId, updateType, recordedAt, position: position ?? Prisma.JsonNull, quantity: amount, note: typeof body.note === "string" ? body.note : null, stopSequence, simulationRunId: actor.simulationRunId } });
      await tx.deliveryMission.update({ where: { id: missionId }, data: { status, ...(updateType === "ARRIVED" ? { currentStopSequence: stopSequence ?? mission.currentStopSequence } : {}) } });
      if (status === "DELIVERED" && mission.vehicleId) await tx.vehicle.updateMany({ where: { id: mission.vehicleId, transporterId: actor.id }, data: { status: "AVAILABLE" } });
      await recordEvent(tx, { eventType: "DELIVERY_UPDATE_POSTED", actorId: actor.id, entityId: missionId, traceId: trace?.id ?? randomUUID(), provenance: actor.isSynthetic ? Provenance.SYNTHETIC : Provenance.OBSERVED, simulationRunId: actor.simulationRunId, payload: { missionId, updateType, recordedAt: update.recordedAt.toISOString(), ...(position ? { position } : {}), ...(typeof body.note === "string" ? { note: body.note } : {}) } });
      return update;
    });
    return deliveryUpdateDto(row);
  }));

  server.get("/v1/verification-tasks", async (request) => {
    const actor = requireRole(request, ["COORDINATOR", "ADMIN"]);
    const query = request.query as JsonObject;
    const farmIds = actor.role === "ADMIN"
      ? (await prisma.farm.findMany({ where: actorRunScope(actor), select: { id: true } })).map((row) => row.id)
      : await visibleFarmIds(actor);
    const rows = await prisma.verificationTask.findMany({
      where: { ...actorRunScope(actor), farmId: { in: farmIds }, ...(typeof query.status === "string" ? { status: query.status } : {}) },
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
    if (!task || task.simulationRunId !== actor.simulationRunId || !farmIds.includes(task.farmId)) throw httpError(404, "VERIFICATION_TASK_NOT_FOUND", "Verification task was not found.");
    if (task.status !== "OPEN") throw httpError(409, "VERIFICATION_ALREADY_DECIDED", "This verification task already has a final decision.");
    const status = decision === "VERIFY" ? "VERIFIED" : "CHANGES_REQUESTED";
    const observation = await prisma.cropObservation.findUnique({ where: { id: task.subjectId } });
    const traceId = observation?.traceId ?? randomUUID();
    const row = await prisma.$transaction(async (tx) => {
      const updated = await tx.verificationTask.update({ where: { id: taskId }, data: { status, resolvedBy: actor.id, resolvedAt: operationNow(), note: typeof body.note === "string" ? body.note : null } });
      await recordEvent(tx, {
        eventType: "VERIFICATION_DECIDED",
        actorId: actor.id,
        entityId: taskId,
        traceId,
        provenance: Provenance.OBSERVED,
        simulationRunId: actor.simulationRunId,
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
      const missionIds = (await prisma.deliveryMission.findMany({ where: actor.role === "TRANSPORTER" ? { transporterId: actor.id, ...actorRunScope(actor) } : { orderId: { in: orderIds }, ...actorRunScope(actor) }, select: { id: true } })).map((row) => row.id);
      const allowed = new Set([...orderIds, ...batchIds, ...missionIds]);
      if (requestedEntityIds.some((id) => !allowed.has(id))) throw httpError(404, "AFFECTED_ENTITY_NOT_FOUND", "An affected record was not found.");
    }
    const affectedMissions = await prisma.deliveryMission.findMany({ where: { id: { in: requestedEntityIds }, ...actorRunScope(actor) } });
    const affectedOrderIds = [...new Set([
      ...(await prisma.order.findMany({ where: { id: { in: requestedEntityIds }, ...actorRunScope(actor) }, select: { id: true } })).map((row) => row.id),
      ...affectedMissions.map((mission) => mission.orderId),
    ])];
    const affectedEntityIds = [...new Set([...requestedEntityIds, ...affectedOrderIds])];
    const provenance = asString(body.provenance, "provenance") as Provenance;
    if (!Object.values(Provenance).includes(provenance) || provenance === Provenance.MODEL_PREDICTED) throw httpError(422, "INVALID_PROVENANCE", "Exceptions require observable provenance.");
    const exceptionType = asString(body.exceptionType, "exceptionType");
    const delayedMission = exceptionType === "DELAY" ? affectedMissions[0] : undefined;
    const proposedDeadline = delayedMission ? new Date(delayedMission.deadline.getTime() + 2 * 60 * 60 * 1000) : undefined;
    const delayedOrder = delayedMission ? await prisma.order.findUnique({ where: { id: delayedMission.orderId } }) : null;
    const parentTrace = delayedOrder ? await prisma.agentTrace.findFirst({ where: { subjectType: "ORDER", subjectId: delayedOrder.id } }) : null;
    const coordinator = delayedMission ? (actor.role === "COORDINATOR" ? actor : await prisma.actor.findFirst({ where: { role: "COORDINATOR", ...actorRunScope(actor) } })) : null;
    if (delayedMission && !coordinator) throw httpError(409, "COORDINATOR_UNAVAILABLE", "No coordinator is available for the recovery decision.");
    const recoveryExplanation = delayedMission && proposedDeadline && delayedOrder
      ? await agentCoordinator.explainDelayRecovery({
          exceptionType: "DELAY",
          severity: asString(body.severity, "severity"),
          reportedAt: operationNow().toISOString(),
          description: asString(body.description, "description"),
          missionId: delayedMission.id,
          missionStatus: delayedMission.status,
          routeSummary: `${(delayedMission.stops as unknown[]).length} planned stops`,
          orderQuantityKg: delayedOrder.requestedQuantity,
          previousDeadline: delayedMission.deadline.toISOString(),
          proposedDeadline: proposedDeadline.toISOString(),
        })
      : null;
    const exceptionId = randomUUID();
    const approvalId = delayedMission ? randomUUID() : null;
    const traceId = randomUUID();
    const reportedAt = operationNow();
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
          traceId,
          simulationRunId: actor.simulationRunId,
          ...(delayedMission && proposedDeadline ? {
            recoveryAction: "RESCHEDULE",
            recoverySummary: recoveryExplanation?.summary ?? `Extend mission ${delayedMission.id.slice(0, 8)} by two hours to recover from the delay.`,
            recoveryChanges: {
              missionId: delayedMission.id,
              previousDeadline: delayedMission.deadline.toISOString(),
              proposedDeadline: proposedDeadline.toISOString(),
              ...(recoveryExplanation ? { evidence: recoveryExplanation.evidence, risks: recoveryExplanation.risks, requiresClarification: recoveryExplanation.requiresClarification } : {}),
            },
          } : {}),
        },
      });
      for (const orderId of affectedOrderIds) {
        const order = await tx.order.findUnique({ where: { id: orderId } });
        if (order) await tx.order.update({ where: { id: orderId }, data: { atRisk: true, activeExceptionIds: [...new Set([...(order.activeExceptionIds as string[]), exceptionId])] } });
      }
      if (approvalId && coordinator) await tx.approval.create({ data: { id: approvalId, subjectType: "RECOVERY", subjectId: exceptionId, requestedFromActorId: coordinator.id, status: "PENDING", requestedAt: reportedAt, simulationRunId: actor.simulationRunId } });
      await tx.agentTrace.create({ data: { id: traceId, subjectType: "EXCEPTION", subjectId: exceptionId, parentTraceId: parentTrace?.id, workflowType: "EXCEPTION_RECOVERY", stage: delayedMission ? "RECOVERY_PROPOSED" : "MANUAL_RECOVERY", status: delayedMission ? "AWAITING_APPROVAL" : "WAITING", summary: delayedMission ? "Proposed a deterministic two-hour reschedule and paused for coordinator approval." : "Recorded an unsupported exception type for manual coordinator review.", simulationRunId: actor.simulationRunId } });
      await tx.traceStep.create({ data: { traceId, recordedAt: reportedAt, kind: "INPUT", agentName: "Exception Agent", toolName: "validate-exception", provenance, summary: `Recorded a ${exception.severity.toLowerCase()} ${exception.exceptionType.toLowerCase()} exception affecting ${affectedEntityIds.length} visible record${affectedEntityIds.length === 1 ? "" : "s"}.`, simulationRunId: actor.simulationRunId } });
      const exceptionEvent = await recordEvent(tx, { eventType: "EXCEPTION_REPORTED", actorId: actor.id, entityId: exceptionId, traceId, provenance, simulationRunId: actor.simulationRunId, payload: { exceptionId, exceptionType: exception.exceptionType, severity: exception.severity, affectedEntityIds } });
      if (delayedMission && proposedDeadline && recoveryExplanation) {
        await tx.traceStep.create({ data: { traceId, recordedAt: reportedAt, kind: "DECISION", agentName: "Exception Agent", toolName: "calculate-delay-recovery", provenance: Provenance.INFERRED, summary: `Deterministic policy proposed changing the deadline from ${delayedMission.deadline.toISOString()} to ${proposedDeadline.toISOString()}.`, simulationRunId: actor.simulationRunId } });
        await tx.traceStep.create({ data: { traceId, recordedAt: reportedAt, kind: "TOOL_CALL", agentName: "Exception Agent", toolName: "explain-delay-recovery", provenance: Provenance.INFERRED, promptId: recoveryExplanation.promptId, adapter: recoveryExplanation.adapter, summary: "Prepared a participant-facing explanation of the fixed recovery proposal; the text adapter could not change or approve it.", simulationRunId: actor.simulationRunId } });
        await tx.traceStep.create({ data: { traceId, recordedAt: reportedAt, kind: "APPROVAL", agentName: "Exception Agent", toolName: "request-human-approval", provenance: Provenance.INFERRED, summary: "Paused before applying the deadline change for explicit coordinator approval.", simulationRunId: actor.simulationRunId } });
        await recordEvent(tx, { eventType: "RECOVERY_PROPOSED", actorId: actor.id, entityId: exceptionId, traceId, correlationId: exceptionEvent.correlationId, causationId: exceptionEvent.id, provenance: Provenance.INFERRED, simulationRunId: actor.simulationRunId, payload: { exceptionId, approvalId, actionType: "RESCHEDULE", missionId: delayedMission.id, previousDeadline: delayedMission.deadline.toISOString(), proposedDeadline: proposedDeadline.toISOString() } });
      }
      return exception;
    });
    return exceptionDto(row);
  }));

  server.post("/v1/deliveries/:deliveryId/acceptance", async (request, reply) => idempotent(request, reply, 201, async () => {
    const actor = requireRole(request, ["BUYER", "ADMIN"]);
    const { deliveryId } = request.params as { deliveryId: string };
    const body = assertObjectBody(request.body, ["outcome", "acceptedQuantity", "rejectedQuantity", "lineOutcomes", "note"], ["outcome", "acceptedQuantity", "rejectedQuantity", "lineOutcomes"]);
    const mission = await prisma.deliveryMission.findUnique({ where: { id: deliveryId } });
    if (!mission || mission.simulationRunId !== actor.simulationRunId) throw httpError(404, "DELIVERY_NOT_FOUND", "Delivery mission was not found.");
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
    const acceptedAt = operationNow();
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
    const priorEvent = await prisma.domainEvent.findFirst({ where: { traceId: trace?.id, entityId: { in: [order.id, mission.id] } }, orderBy: { occurredAt: "desc" } });
    const acceptance = await prisma.$transaction(async (tx) => {
      const created = await tx.deliveryAcceptance.create({ data: { id: acceptanceId, orderId: order.id, outcome, acceptedQuantity: accepted, rejectedQuantity: rejected, lineOutcomes: serializedLineOutcomes, note: typeof body.note === "string" ? body.note : null, acceptedBy: actor.id, acceptedAt, simulationRunId: actor.simulationRunId } });
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
      if (trace) {
        await tx.agentTrace.update({ where: { id: trace.id }, data: { status: "COMPLETED", stage: "DELIVERY_OUTCOME_RECORDED", summary: `Delivery finished with ${accepted} kg accepted and ${rejected} kg rejected.` } });
        await tx.traceStep.create({ data: { traceId: trace.id, recordedAt: acceptedAt, kind: "STATE_CHANGE", agentName: "Traceability Agent", toolName: "record-delivery-outcome", provenance: actor.isSynthetic ? Provenance.SYNTHETIC : Provenance.OBSERVED, summary: `Recorded ${outcome.toLowerCase().replaceAll("_", " ")}: ${accepted} kg accepted and ${rejected} kg rejected; reservations were released and model outcomes updated.`, simulationRunId: actor.simulationRunId } });
      }
      const deliveryEvent = await recordEvent(tx, { eventType: "DELIVERY_ACCEPTED", actorId: actor.id, entityId: acceptanceId, traceId: trace?.id ?? randomUUID(), correlationId: priorEvent?.correlationId, causationId: priorEvent?.id, provenance: actor.isSynthetic ? Provenance.SYNTHETIC : Provenance.OBSERVED, simulationRunId: actor.simulationRunId, payload: { deliveryId: acceptanceId, orderId: order.id, acceptedQuantity: quantity(accepted), rejectedQuantity: quantity(rejected), outcome, lineOutcomes: serializedLineOutcomes } });
      await recordEvent(tx, { eventType: `ORDER_${lifecycleStatus}`, actorId: actor.id, entityId: order.id, traceId: trace?.id ?? randomUUID(), correlationId: deliveryEvent.correlationId, causationId: deliveryEvent.id, provenance: actor.isSynthetic ? Provenance.SYNTHETIC : Provenance.OBSERVED, simulationRunId: actor.simulationRunId, payload: { orderId: order.id, status: lifecycleStatus, acceptedQuantity: quantity(accepted), releasedReservationQuantity: quantity(Math.max(0, order.requestedQuantity - accepted)) } });
      return created;
    });
    return deliveryAcceptanceDto(acceptance);
  }));

  await registerSimulationRoutes(server);

  server.addHook("onClose", async () => prisma.$disconnect());
  return server;
}
