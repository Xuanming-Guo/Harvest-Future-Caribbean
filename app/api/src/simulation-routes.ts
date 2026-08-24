import { randomUUID } from "node:crypto";

import {
  ActorRole,
  Prisma,
  type PairedRun,
  type SimulationRun,
} from "@prisma/client";
import {
  SCENARIOS,
  CARIBBEAN_ISLANDS_V1,
  assertNoTruthLeak,
  compactReplayTimeline,
  runScenario,
  type ControlRoomScene,
  type InjectedDisruption,
  type PolicyName,
  type RunMetrics,
} from "@harvest/simulation";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { visibleBatchIds, visibleExceptionRows, visibleOrderIds } from "./access.js";
import type { AuthActor } from "./auth.js";
import { requireRole, signDevelopmentToken } from "./auth.js";
import { operationNow } from "./clock.js";
import { prisma } from "./db.js";
import { eventDto } from "./events.js";
import { assertObjectBody, httpError, idempotent } from "./http.js";
import { buildOperationsSnapshot } from "./operations-snapshot.js";
import { runConnectedHarvest } from "./simulation-agents.js";

type JsonObject = Record<string, unknown>;
type RunScope =
  | { mode: "ALL" }
  | { mode: "SELECTED"; islandIds: string[] };

const ISLANDS = CARIBBEAN_ISLANDS_V1;
const RUN_ROLES = [ActorRole.OPERATIONS, ActorRole.ADMIN];
const SNAPSHOT_ROLES = [ActorRole.COORDINATOR, ActorRole.OPERATIONS, ActorRole.ADMIN];
const PRODUCT_ROLES = [
  ActorRole.FARMER,
  ActorRole.BUYER,
  ActorRole.TRANSPORTER,
  ActorRole.COORDINATOR,
  ActorRole.OPERATIONS,
  ActorRole.ADMIN,
];
/**
 * A full M49 Caribbean replay persists substantially more immutable frames
 * than the Saint Lucia benchmark. The transaction contains only the final
 * atomic replay write, but PostgreSQL can still require over 30 seconds to
 * store that document on a development Docker volume.
 */
const REPLAY_WRITE_TIMEOUT_MS = 120_000;
/** Six-hour checkpoints keep full-region replays navigable without hiding important changes. */
const REGIONAL_REPLAY_CHECKPOINT_INTERVAL_MS = 6 * 60 * 60 * 1_000;

const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

function asString(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw httpError(400, "VALIDATION_FAILED", `${field} must be a non-empty string.`);
  }
  return value.trim();
}

function readSeed(value: unknown) {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 4_294_967_295) {
    throw httpError(422, "INVALID_SIMULATION_SEED", "seed must be an integer between 0 and 4294967295.");
  }
  return Number(value);
}

function readDecisionMode(value: unknown): "DETERMINISTIC" | "LLM_ASSISTED" {
  if (value !== "DETERMINISTIC" && value !== "LLM_ASSISTED") {
    throw httpError(422, "INVALID_DECISION_MODE", "decisionMode must be DETERMINISTIC or LLM_ASSISTED.");
  }
  return value;
}

function readPolicy(value: unknown): PolicyName {
  if (value !== "BASELINE" && value !== "HARVEST") {
    throw httpError(422, "INVALID_SIMULATION_POLICY", "policy must be BASELINE or HARVEST.");
  }
  return value;
}

function readScenario(value: unknown) {
  const scenarioId = asString(value, "scenarioId");
  const scenario = SCENARIOS[scenarioId];
  if (!scenario) {
    throw httpError(404, "SIMULATION_SCENARIO_NOT_FOUND", `Simulation scenario '${scenarioId}' was not found.`);
  }
  return scenario;
}

function readScope(value: unknown, scenarioId: string): { scope: RunScope; resolvedIslandIds: string[] } {
  const scenario = readScenario(scenarioId);
  const allowedIslandIds = new Set(scenario.availableIslandIds);
  const scope = assertObjectBody(value, ["mode", "islandIds"], ["mode"]);
  if (scope.mode === "ALL") {
    if (scope.islandIds !== undefined) {
      throw httpError(400, "VALIDATION_FAILED", "ALL scope must not include islandIds.");
    }
    return { scope: { mode: "ALL" }, resolvedIslandIds: [...allowedIslandIds] };
  }
  if (scope.mode !== "SELECTED" || !Array.isArray(scope.islandIds) || scope.islandIds.length === 0) {
    throw httpError(422, "INVALID_SIMULATION_SCOPE", "SELECTED scope requires at least one islandId.");
  }
  const islandIds = scope.islandIds.map((item, index) => asString(item, `scope.islandIds[${index}]`));
  if (new Set(islandIds).size !== islandIds.length) {
    throw httpError(422, "INVALID_SIMULATION_SCOPE", "scope.islandIds must not contain duplicates.");
  }
  const unavailable = islandIds.filter((islandId) => !allowedIslandIds.has(islandId));
  if (unavailable.length) {
    throw httpError(
      422,
      "SIMULATION_ISLAND_UNAVAILABLE",
      `Unavailable islandId${unavailable.length === 1 ? "" : "s"}: ${unavailable.join(", ")}.`,
    );
  }
  return { scope: { mode: "SELECTED", islandIds }, resolvedIslandIds: islandIds };
}

function readDisruptions(value: unknown, durationDays: number): InjectedDisruption[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw httpError(400, "VALIDATION_FAILED", "disruptions must be an array.");
  }
  const horizonMs = durationDays * 24 * 60 * 60 * 1_000;
  return value.map((item, index) => {
    const disruption = assertObjectBody(
      item,
      ["type", "offsetMs", "durationMs", "affectedEntityIds", "publicDescription"],
      ["type", "offsetMs", "durationMs", "affectedEntityIds", "publicDescription"],
    );
    if (!["WEATHER", "ROAD", "VEHICLE", "CROP", "DEMAND"].includes(String(disruption.type))) {
      throw httpError(422, "INVALID_DISRUPTION", `disruptions[${index}].type is not supported.`);
    }
    if (!Number.isInteger(disruption.offsetMs) || Number(disruption.offsetMs) < 0 || Number(disruption.offsetMs) >= horizonMs) {
      throw httpError(422, "INVALID_DISRUPTION", `disruptions[${index}].offsetMs must fall before the scenario horizon.`);
    }
    if (!Number.isInteger(disruption.durationMs) || Number(disruption.durationMs) <= 0) {
      throw httpError(422, "INVALID_DISRUPTION", `disruptions[${index}].durationMs must be a positive integer.`);
    }
    if (!Array.isArray(disruption.affectedEntityIds) || disruption.affectedEntityIds.length === 0) {
      throw httpError(422, "INVALID_DISRUPTION", `disruptions[${index}].affectedEntityIds must not be empty.`);
    }
    const affectedEntityIds = disruption.affectedEntityIds.map((itemId, itemIndex) =>
      asString(itemId, `disruptions[${index}].affectedEntityIds[${itemIndex}]`),
    );
    const publicDescription = asString(disruption.publicDescription, `disruptions[${index}].publicDescription`);
    if (publicDescription.length > 500) {
      throw httpError(422, "INVALID_DISRUPTION", `disruptions[${index}].publicDescription must be at most 500 characters.`);
    }
    return {
      type: disruption.type as InjectedDisruption["type"],
      offsetMs: Number(disruption.offsetMs),
      durationMs: Number(disruption.durationMs),
      affectedEntityIds,
      publicDescription,
    };
  });
}

function simulationRunDto(row: SimulationRun) {
  return {
    runId: row.id,
    scenarioId: row.scenarioId,
    policy: row.policy,
    seed: Number(row.seed),
    decisionMode: row.decisionMode,
    decisionAdapter: row.decisionAdapter,
    scope: row.scope,
    resolvedIslandIds: row.resolvedIslandIds,
    disruptions: row.disruptions,
    ...(row.derivedFromRunId ? { derivedFromRunId: row.derivedFromRunId } : {}),
    status: row.status,
    ...(row.startedAt ? { startedAt: row.startedAt.toISOString() } : {}),
    ...(row.endedAt ? { endedAt: row.endedAt.toISOString() } : {}),
    frameCount: row.frameCount,
    decisionCount: Array.isArray(row.decisions) ? row.decisions.length : 0,
    ...(row.metrics ? { metrics: row.metrics } : {}),
    ...(row.evidenceLabel ? { evidenceLabel: row.evidenceLabel } : {}),
    ...(row.provenanceNote ? { provenanceNote: row.provenanceNote } : {}),
    ...(row.errorCode ? { error: { code: row.errorCode, detail: row.errorMessage } } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function pairedRunDto(row: PairedRun) {
  return {
    pairId: row.id,
    scenarioId: row.scenarioId,
    seed: Number(row.seed),
    decisionMode: row.decisionMode,
    scope: row.scope,
    resolvedIslandIds: row.resolvedIslandIds,
    disruptions: row.disruptions,
    baselineRunId: row.baselineRunId,
    harvestRunId: row.harvestRunId,
    status: row.status,
    ...(row.comparison ? { result: row.comparison } : {}),
    ...(row.evidenceLabel ? { evidenceLabel: row.evidenceLabel } : {}),
    ...(row.errorCode ? { error: { code: row.errorCode, detail: row.errorMessage } } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

interface SavedRunInput {
  runId: string;
  scenarioId: string;
  policy: PolicyName;
  seed: number;
  decisionMode: "DETERMINISTIC" | "LLM_ASSISTED";
  scope: RunScope;
  resolvedIslandIds: string[];
  disruptions: InjectedDisruption[];
  derivedFromRunId?: string;
  createdByActorId: string;
}

async function saveActorMappings(runId: string, scene: ControlRoomScene) {
  const mappings = scene.participants.map((participant) => ({
    simulationRunId: runId,
    simulationActorId: participant.simulationActorId,
    productActorId: participant.productActorId,
    role: participant.role as ActorRole,
    displayName: participant.displayName,
    islandId: participant.islandId,
  }));
  if (mappings.length) await prisma.simulationActorMapping.createMany({ data: mappings });
}

async function executeAndSaveRun(server: FastifyInstance, input: SavedRunInput) {
  await prisma.simulationRun.create({
    data: {
      id: input.runId,
      scenarioId: input.scenarioId,
      policy: input.policy,
      seed: BigInt(input.seed),
      decisionMode: input.decisionMode,
      scope: json(input.scope),
      resolvedIslandIds: json(input.resolvedIslandIds),
      disruptions: json(input.disruptions),
      derivedFromRunId: input.derivedFromRunId,
      status: "CREATING",
      createdByActorId: input.createdByActorId,
    },
  });

  try {
    const connected = input.policy === "HARVEST"
      ? await runConnectedHarvest(server, input.runId, {
          scenarioId: input.scenarioId,
          islandIds: input.resolvedIslandIds,
          seed: input.seed,
          disruptions: input.disruptions,
        }, input.decisionMode)
      : (() => {
          const result = runScenario({
            runId: input.runId,
            scenarioId: input.scenarioId,
            islandIds: input.resolvedIslandIds,
            policy: input.policy,
            seed: input.seed,
            captureFrames: true,
            injectedDisruptions: input.disruptions,
          });
          if (!result.timeline) throw new Error("Simulation completed without a replay timeline.");
          return { result, timeline: result.timeline, decisionAdapter: "deterministic", actions: [] };
        })();
    const result = connected.result;
    const timeline = input.resolvedIslandIds.length > 1
      ? compactReplayTimeline(connected.timeline, REGIONAL_REPLAY_CHECKPOINT_INTERVAL_MS)
      : connected.timeline;
    const finalProductSnapshot = timeline.frames.at(-1)?.operationsSnapshot;
    const metrics = connected.actions.length
      ? {
          ...result.metrics,
          productActions: {
            attempted: connected.actions.length,
            succeeded: connected.actions.filter((action) => action.status === "SUCCEEDED").length,
            rejected: connected.actions.filter((action) => action.status === "REJECTED").length,
            domainEventsCreated: connected.actions.reduce((sum, action) => sum + action.eventIds.length, 0),
            finalCounts: finalProductSnapshot ? {
              activeListings: finalProductSnapshot.activeListings,
              openDemands: finalProductSnapshot.openDemands,
              ordersByStatus: finalProductSnapshot.ordersByStatus,
              orderOutcomes: finalProductSnapshot.orderOutcomes,
              deliveryAcceptedKg: finalProductSnapshot.deliveryAcceptedKg,
              approvedCommitmentCount: finalProductSnapshot.approvedCommitmentCount,
              completedMissionCount: finalProductSnapshot.completedMissionCount,
              activeMissions: finalProductSnapshot.activeMissionIds.length,
              openExceptions: finalProductSnapshot.openExceptionIds.length,
            } : undefined,
          },
        }
      : result.metrics;
    assertNoTruthLeak({ timeline, decisions: result.decisions }, "saved Product API simulation run");

    // Whole-Caribbean replays contain many more immutable frames than the hero
    // scenario. Keep the transaction atomic, but allow the PostgreSQL write to
    // finish instead of inheriting Prisma's short interactive default.
    const completed = await prisma.$transaction(async (tx) => {
      const row = await tx.simulationRun.update({
        where: { id: input.runId },
        data: {
          status: "COMPLETED",
          startedAt: new Date(result.startedAt),
          endedAt: new Date(result.endedAt),
          frameCount: timeline.frames.length,
          metrics: json(metrics),
          decisions: json(result.decisions),
          decisionAdapter: connected.decisionAdapter,
          evidenceLabel: result.evidenceLabel,
          provenanceNote: result.provenanceNote,
          determinismDigest: result.digest,
          scene: json(timeline.scene),
          frames: json(timeline.frames),
        },
      });
      return row;
    }, { timeout: REPLAY_WRITE_TIMEOUT_MS, maxWait: 10_000 });
    if (input.policy === "BASELINE") await saveActorMappings(input.runId, timeline.scene);
    return completed;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Simulation execution failed.";
    await prisma.simulationRun.update({
      where: { id: input.runId },
      data: { status: "FAILED", errorCode: "SIMULATION_RUN_FAILED", errorMessage: detail },
    });
    throw httpError(500, "SIMULATION_RUN_FAILED", `Run ${input.runId} failed: ${detail}`);
  }
}

function benchmarkMetrics(metrics: RunMetrics) {
  return {
    localProcurementRate: metrics.localProcurementRate,
    fulfilmentRate: metrics.fulfilmentRate,
    wasteQuantity: metrics.wasteQuantity,
  };
}

function readRunQueryScope(actor: AuthActor, requestedRunId: unknown) {
  if (actor.simulationRunId) {
    if (requestedRunId !== undefined && requestedRunId !== actor.simulationRunId) {
      throw httpError(403, "RUN_SCOPE_FORBIDDEN", "A simulated actor cannot access another simulation run.");
    }
    return actor.simulationRunId;
  }
  if (requestedRunId !== undefined) {
    if (actor.role !== ActorRole.OPERATIONS && actor.role !== ActorRole.ADMIN) {
      throw httpError(403, "RUN_SCOPE_FORBIDDEN", "Only operations or admin actors may select a simulation run.");
    }
    return asString(requestedRunId, "simulationRunId");
  }
  return null;
}

async function requireRunExists(runId: string | null) {
  if (!runId) return null;
  const run = await prisma.simulationRun.findUnique({
    where: { id: runId },
    select: { id: true, status: true, endedAt: true },
  });
  if (!run) {
    throw httpError(404, "SIMULATION_RUN_NOT_FOUND", "Simulation run was not found.");
  }
  return run;
}

async function visibleEventEntityIds(actor: AuthActor) {
  const ids = new Set<string>([actor.id]);
  const batchIds = await visibleBatchIds(actor);
  const orderIds = await visibleOrderIds(actor);
  for (const id of [...batchIds, ...orderIds]) ids.add(id);

  const [listings, demands, missions, approvals, tasks, exceptions] = await Promise.all([
    prisma.listing.findMany({ where: { cropBatchId: { in: batchIds } }, select: { id: true } }),
    actor.role === ActorRole.BUYER
      ? prisma.buyerDemand.findMany({ where: { buyerId: actor.id }, select: { id: true } })
      : Promise.resolve([]),
    prisma.deliveryMission.findMany({
      where: actor.role === ActorRole.TRANSPORTER
        ? { transporterId: actor.id }
        : { orderId: { in: orderIds } },
      select: { id: true },
    }),
    prisma.approval.findMany({ where: { requestedFromActorId: actor.id }, select: { id: true, subjectId: true } }),
    actor.role === ActorRole.COORDINATOR
      ? prisma.verificationTask.findMany({ where: { cropBatchId: { in: batchIds } }, select: { id: true, subjectId: true } })
      : Promise.resolve([]),
    visibleExceptionRows(actor),
  ]);
  for (const row of [...listings, ...demands, ...missions, ...approvals, ...tasks, ...exceptions]) {
    ids.add(row.id);
    if ("subjectId" in row && typeof row.subjectId === "string") ids.add(row.subjectId);
  }
  return [...ids];
}

async function eventWhere(actor: AuthActor, runId: string | null, cursor: bigint): Promise<Prisma.DomainEventWhereInput> {
  const base: Prisma.DomainEventWhereInput = { cursor: { gt: cursor }, simulationRunId: runId };
  if (actor.role === ActorRole.OPERATIONS || actor.role === ActorRole.ADMIN) return base;
  const entityIds = await visibleEventEntityIds(actor);
  return { ...base, OR: [{ actorId: actor.id }, { entityId: { in: entityIds } }] };
}

async function parseEventCursor(request: FastifyRequest, runId: string | null) {
  const raw = request.headers["last-event-id"];
  if (raw === undefined || raw === "") return 0n;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) {
    throw httpError(409, "INVALID_EVENT_CURSOR", "Last-Event-ID must be a non-negative decimal event cursor.");
  }
  const cursor = BigInt(raw);
  const latest = await prisma.domainEvent.findFirst({
    where: { simulationRunId: runId },
    orderBy: { cursor: "desc" },
    select: { cursor: true },
  });
  if (latest && cursor > latest.cursor) {
    throw httpError(409, "INVALID_EVENT_CURSOR", "Last-Event-ID is beyond the latest retained event cursor.");
  }
  return cursor;
}

export async function registerSimulationRoutes(server: FastifyInstance) {
  server.get("/v1/simulation-scenarios", async (request) => {
    requireRole(request, RUN_ROLES);
    return {
      items: Object.values(SCENARIOS).map((scenario) => ({
        scenarioId: scenario.scenarioId,
        description: scenario.description,
        startsAt: scenario.startsAtIso,
        durationDays: scenario.durationDays,
        availablePolicies: ["BASELINE", "HARVEST"],
        availableDecisionModes: ["DETERMINISTIC", "LLM_ASSISTED"],
        islands: ISLANDS.filter((island) => scenario.availableIslandIds.includes(island.islandId)),
        provenanceNote: scenario.provenanceNote,
      })),
    };
  });

  server.get("/v1/simulation-runs", async (request) => {
    requireRole(request, RUN_ROLES);
    const query = request.query as JsonObject;
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20) || 20));
    const cursor = typeof query.cursor === "string" ? query.cursor : undefined;
    if (cursor && !(await prisma.simulationRun.findUnique({ where: { id: cursor }, select: { id: true } }))) {
      throw httpError(400, "INVALID_CURSOR", "cursor does not identify a saved simulation run.");
    }
    const rows = await prisma.simulationRun.findMany({
      where: {
        ...(typeof query.scenarioId === "string" ? { scenarioId: query.scenarioId } : {}),
        ...(typeof query.policy === "string" ? { policy: query.policy } : {}),
        ...(typeof query.status === "string" ? { status: query.status as never } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: limit + 1,
    });
    const hasNextPage = rows.length > limit;
    const items = rows.slice(0, limit);
    return {
      items: items.map(simulationRunDto),
      pageInfo: {
        hasNextPage,
        ...(hasNextPage ? { nextCursor: items.at(-1)?.id } : {}),
      },
    };
  });

  server.post("/v1/simulation-runs", async (request, reply) => {
    const actor = requireRole(request, RUN_ROLES);
    return idempotent(request, reply, 201, async () => {
      const body = assertObjectBody(
        request.body,
        ["scenarioId", "policy", "seed", "decisionMode", "scope", "disruptions", "derivedFromRunId"],
      );

      if (body.derivedFromRunId !== undefined) {
        const allowed = new Set(["derivedFromRunId", "disruptions"]);
        const incompatible = Object.keys(body).filter((key) => !allowed.has(key));
        if (incompatible.length) {
          throw httpError(400, "VALIDATION_FAILED", "A derived run inherits scenario, policy, seed, decision mode, and scope from its source run.");
        }
        const sourceId = asString(body.derivedFromRunId, "derivedFromRunId");
        const source = await prisma.simulationRun.findUnique({ where: { id: sourceId } });
        if (!source || source.status !== "COMPLETED") {
          throw httpError(409, "SOURCE_RUN_NOT_REPLAYABLE", "A derived run requires a completed source run.");
        }
        const scenario = readScenario(source.scenarioId);
        const additions = readDisruptions(body.disruptions, scenario.durationDays);
        if (!additions.length) {
          throw httpError(422, "DERIVED_RUN_REQUIRES_DISRUPTION", "A derived run must add at least one disruption.");
        }
        const disruptions = [...(source.disruptions as unknown as InjectedDisruption[]), ...additions];
        const row = await executeAndSaveRun(server, {
          runId: randomUUID(),
          scenarioId: source.scenarioId,
          policy: readPolicy(source.policy),
          seed: Number(source.seed),
          decisionMode: source.decisionMode,
          scope: source.scope as unknown as RunScope,
          resolvedIslandIds: source.resolvedIslandIds as unknown as string[],
          disruptions,
          derivedFromRunId: source.id,
          createdByActorId: actor.id,
        });
        return simulationRunDto(row);
      }

      const required = ["scenarioId", "policy", "seed", "decisionMode", "scope"];
      const missing = required.filter((key) => body[key] === undefined);
      if (missing.length) {
        throw httpError(400, "VALIDATION_FAILED", `Missing required fields: ${missing.join(", ")}.`);
      }
      const scenario = readScenario(body.scenarioId);
      const decisionMode = readDecisionMode(body.decisionMode);
      const { scope, resolvedIslandIds } = readScope(body.scope, scenario.scenarioId);
      const row = await executeAndSaveRun(server, {
        runId: randomUUID(),
        scenarioId: scenario.scenarioId,
        policy: readPolicy(body.policy),
        seed: readSeed(body.seed),
        decisionMode,
        scope,
        resolvedIslandIds,
        disruptions: readDisruptions(body.disruptions, scenario.durationDays),
        createdByActorId: actor.id,
      });
      return simulationRunDto(row);
    });
  });

  server.get("/v1/simulation-runs/:runId", async (request) => {
    requireRole(request, RUN_ROLES);
    const { runId } = request.params as { runId: string };
    const row = await prisma.simulationRun.findUnique({ where: { id: runId } });
    if (!row) throw httpError(404, "SIMULATION_RUN_NOT_FOUND", "Simulation run was not found.");
    return simulationRunDto(row);
  });

  server.post("/v1/simulation-runs/:runId/participant-sessions", async (request, reply) => {
    requireRole(request, RUN_ROLES);
    return idempotent(request, reply, 201, async () => {
      const { runId } = request.params as { runId: string };
      const body = assertObjectBody(request.body, ["productActorId"], ["productActorId"]);
      const productActorId = asString(body.productActorId, "productActorId");
      const run = await prisma.simulationRun.findUnique({ where: { id: runId } });
      if (!run) throw httpError(404, "SIMULATION_RUN_NOT_FOUND", "Simulation run was not found.");
      if (run.status !== "COMPLETED" || run.policy !== "HARVEST") {
        throw httpError(409, "PARTICIPANT_REPLAY_UNAVAILABLE", "Participant replay requires a completed Harvest run.");
      }
      const mapping = await prisma.simulationActorMapping.findFirst({ where: { simulationRunId: runId, productActorId } });
      const actor = mapping ? await prisma.actor.findUnique({ where: { id: productActorId } }) : null;
      if (!mapping || !actor || !actor.isSynthetic || actor.simulationRunId !== runId) {
        throw httpError(404, "SIMULATION_PARTICIPANT_NOT_FOUND", "The mapped synthetic participant was not found.");
      }
      return {
        accessToken: await signDevelopmentToken(actor, "15m"),
        expiresInSeconds: 900,
        participant: {
          simulationActorId: mapping.simulationActorId,
          productActorId: actor.id,
          name: actor.name,
          role: actor.role,
          simulationRunId: runId,
          readOnly: true,
        },
      };
    });
  });

  server.get("/v1/simulation-runs/:runId/timeline", async (request) => {
    requireRole(request, RUN_ROLES);
    const { runId } = request.params as { runId: string };
    const row = await prisma.simulationRun.findUnique({ where: { id: runId } });
    if (!row) throw httpError(404, "SIMULATION_RUN_NOT_FOUND", "Simulation run was not found.");
    if (row.status !== "COMPLETED" || !row.scene || !row.frames) {
      throw httpError(409, "SIMULATION_RUN_NOT_REPLAYABLE", "Only a completed run has a replay timeline.");
    }
    return {
      runId: row.id,
      evidenceLabel: row.evidenceLabel,
      provenanceNote: row.provenanceNote,
      scene: row.scene,
      frames: row.frames,
    };
  });

  server.get("/v1/simulation-runs/:runId/world", async (request) => {
    requireRole(request, RUN_ROLES);
    const { runId } = request.params as { runId: string };
    const query = request.query as JsonObject;
    const frameIndex = Number(query.frameIndex);
    if (!Number.isInteger(frameIndex) || frameIndex < 0) {
      throw httpError(422, "INVALID_FRAME_INDEX", "frameIndex must be a non-negative integer.");
    }
    const row = await prisma.simulationRun.findUnique({ where: { id: runId } });
    if (!row) throw httpError(404, "SIMULATION_RUN_NOT_FOUND", "Simulation run was not found.");
    const frames = row.frames as unknown as unknown[] | null;
    if (row.status !== "COMPLETED" || !frames) {
      throw httpError(409, "SIMULATION_RUN_NOT_REPLAYABLE", "Only a completed run has observable frames.");
    }
    if (frameIndex >= frames.length) {
      throw httpError(422, "INVALID_FRAME_INDEX", `frameIndex must be between 0 and ${Math.max(0, frames.length - 1)}.`);
    }
    return { runId: row.id, frameIndex, frameCount: frames.length, frame: frames[frameIndex] };
  });

  server.post("/v1/paired-runs", async (request, reply) => {
    const actor = requireRole(request, RUN_ROLES);
    return idempotent(request, reply, 201, async () => {
      const body = assertObjectBody(
        request.body,
        ["scenarioId", "seed", "decisionMode", "scope", "disruptions"],
        ["scenarioId", "seed", "decisionMode", "scope"],
      );
      const scenario = readScenario(body.scenarioId);
      const decisionMode = readDecisionMode(body.decisionMode);
      const seed = readSeed(body.seed);
      const { scope, resolvedIslandIds } = readScope(body.scope, scenario.scenarioId);
      const disruptions = readDisruptions(body.disruptions, scenario.durationDays);
      const pairId = randomUUID();
      const baselineRunId = randomUUID();
      const harvestRunId = randomUUID();
      await prisma.pairedRun.create({
        data: {
          id: pairId,
          scenarioId: scenario.scenarioId,
          seed: BigInt(seed),
          decisionMode,
          scope: json(scope),
          resolvedIslandIds: json(resolvedIslandIds),
          disruptions: json(disruptions),
          baselineRunId,
          harvestRunId,
          status: "CREATING",
          createdByActorId: actor.id,
        },
      });

      try {
        const baseline = await executeAndSaveRun(server, {
          runId: baselineRunId,
          scenarioId: scenario.scenarioId,
          policy: "BASELINE",
          seed,
          decisionMode,
          scope,
          resolvedIslandIds,
          disruptions,
          createdByActorId: actor.id,
        });
        const harvest = await executeAndSaveRun(server, {
          runId: harvestRunId,
          scenarioId: scenario.scenarioId,
          policy: "HARVEST",
          seed,
          decisionMode,
          scope,
          resolvedIslandIds,
          disruptions,
          createdByActorId: actor.id,
        });
        const baselineMetrics = baseline.metrics as unknown as RunMetrics;
        const harvestMetrics = harvest.metrics as unknown as RunMetrics;
        const comparison = {
          baseline: benchmarkMetrics(baselineMetrics),
          harvest: benchmarkMetrics(harvestMetrics),
          delta: {
            localProcurementRate: Number((harvestMetrics.localProcurementRate - baselineMetrics.localProcurementRate).toFixed(6)),
            fulfilmentRate: Number((harvestMetrics.fulfilmentRate - baselineMetrics.fulfilmentRate).toFixed(6)),
            wasteQuantity: {
              value: Number((harvestMetrics.wasteQuantity.value - baselineMetrics.wasteQuantity.value).toFixed(2)),
              unit: "kg",
            },
          },
        };
        const row = await prisma.pairedRun.update({
          where: { id: pairId },
          data: {
            status: "COMPLETED",
            comparison: json(comparison),
            evidenceLabel: baseline.evidenceLabel,
          },
        });
        return pairedRunDto(row);
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Paired simulation execution failed.";
        await prisma.pairedRun.update({
          where: { id: pairId },
          data: { status: "FAILED", errorCode: "PAIRED_RUN_FAILED", errorMessage: detail },
        });
        throw error;
      }
    });
  });

  server.get("/v1/paired-runs/:pairId", async (request) => {
    requireRole(request, RUN_ROLES);
    const { pairId } = request.params as { pairId: string };
    const row = await prisma.pairedRun.findUnique({ where: { id: pairId } });
    if (!row) throw httpError(404, "PAIRED_RUN_NOT_FOUND", "Paired run was not found.");
    return pairedRunDto(row);
  });

  server.get("/v1/operations/snapshot", async (request) => {
    const actor = requireRole(request, SNAPSHOT_ROLES);
    const query = request.query as JsonObject;
    const runId = readRunQueryScope(actor, query.simulationRunId);
    const selectedRun = await requireRunExists(runId);
    const runWhere = { simulationRunId: runId };

    let listingWhere: Prisma.ListingWhereInput = { ...runWhere, status: "ACTIVE" };
    let demandWhere: Prisma.BuyerDemandWhereInput = { ...runWhere, status: { in: ["OPEN", "MATCHING"] } };
    let orderWhere: Prisma.OrderWhereInput = runWhere;
    let missionWhere: Prisma.DeliveryMissionWhereInput = { ...runWhere, status: { notIn: ["DELIVERED", "COMPLETED", "CANCELLED"] } };
    let exceptionWhere: Prisma.OperationalExceptionWhereInput = { ...runWhere, status: { in: ["OPEN", "RECOVERY_PENDING"] } };

    if (actor.role === ActorRole.COORDINATOR) {
      const batchIds = await visibleBatchIds(actor);
      const orderIds = await visibleOrderIds(actor);
      const exceptions = await visibleExceptionRows(actor);
      listingWhere = { ...listingWhere, cropBatchId: { in: batchIds } };
      demandWhere = { ...demandWhere, id: { in: [] } };
      orderWhere = { ...orderWhere, id: { in: orderIds } };
      missionWhere = { ...missionWhere, orderId: { in: orderIds } };
      exceptionWhere = { ...exceptionWhere, id: { in: exceptions.map((row) => row.id) } };
    }

    const snapshot = await buildOperationsSnapshot({
      asOf: selectedRun?.status === "COMPLETED" && selectedRun.endedAt
        ? selectedRun.endedAt
        : operationNow(),
      listingWhere,
      demandWhere,
      orderWhere,
      activeMissionWhere: missionWhere,
      openExceptionWhere: exceptionWhere,
    });
    return {
      generatedAt: new Date().toISOString(),
      ...(runId ? { simulationRunId: runId } : {}),
      ...snapshot,
    };
  });

  server.get("/v1/events/stream", async (request, reply) => {
    const actor = requireRole(request, PRODUCT_ROLES);
    const query = request.query as JsonObject;
    const runId = readRunQueryScope(actor, query.simulationRunId);
    await requireRunExists(runId);
    let cursor = await parseEventCursor(request, runId);
    let closed = false;

    const sendAvailable = async () => {
      const rows = await prisma.domainEvent.findMany({
        where: await eventWhere(actor, runId, cursor),
        orderBy: { cursor: "asc" },
        take: 200,
      });
      for (const row of rows) {
        reply.raw.write(`id: ${row.cursor.toString()}\n`);
        reply.raw.write(`event: ${row.eventType}\n`);
        reply.raw.write(`data: ${JSON.stringify(eventDto(row))}\n\n`);
        cursor = row.cursor;
      }
    };

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write(": connected\n\n");
    await sendAvailable();

    const poll = setInterval(() => {
      if (closed) return;
      void sendAvailable().catch((error) => {
        request.log.error({ error }, "SSE event polling failed");
        cleanup();
      });
    }, 500);
    const heartbeat = setInterval(() => {
      if (!closed) reply.raw.write(": heartbeat\n\n");
    }, 15_000);
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(poll);
      clearInterval(heartbeat);
      if (!reply.raw.destroyed) reply.raw.end();
    };
    request.raw.on("close", cleanup);
  });
}
