import { randomUUID } from "node:crypto";

import { ActorRole, Provenance, type Actor, type DomainEvent } from "@prisma/client";
import {
  SimulationEngine,
  type ControlRoomBatch,
  type ControlRoomFrame,
  type ControlRoomScene,
  type InjectedDisruption,
  type ProductSimulationEffect,
  type ReplayTimeline,
  type RunResult,
  type SimulationAgentAction,
  type SimulationOperationsSnapshot,
  type SimulationParticipant,
} from "@harvest/simulation";
import type { FastifyInstance } from "fastify";

import { SimulationDecisionProvider } from "./agents/simulation-decision.js";
import { signDevelopmentToken } from "./auth.js";
import { prisma } from "./db.js";

type DecisionMode = "DETERMINISTIC" | "LLM_ASSISTED";
type JsonObject = Record<string, unknown>;
type QuantityDto = { value: number; unit: "kg" };
type GeoPoint = { latitude: number; longitude: number };

interface ProductParticipant extends SimulationParticipant {
  actor: Actor;
  token: string;
  farmId?: string;
  vehicleId?: string;
}

interface ProductApiPrincipal {
  actor: Actor;
  token: string;
}

interface ToolSuccess<T> {
  ok: true;
  data: T;
  events: DomainEvent[];
  action: SimulationAgentAction;
}

interface ToolRejection {
  ok: false;
  data: JsonObject | null;
  events: [];
  error: { status: number; code: string; detail: string };
  action: SimulationAgentAction;
}

type ToolResult<T = JsonObject> = ToolSuccess<T> | ToolRejection;

interface Page<T> {
  items: T[];
}

interface CropBatchDto {
  cropBatchId: string;
  cropType: string;
  status: string;
  availableToPromise: QuantityDto;
  latestObservationId?: string;
}

interface ListingDto {
  listingId: string;
  cropBatchId: string;
  cropType: string;
  quantity: QuantityDto;
  status: string;
}

interface OrderDto {
  orderId: string;
  buyerId: string;
  lifecycleStatus: string;
  requestedQuantity: QuantityDto;
  acceptedQuantity: QuantityDto;
  neededBy: string;
}

interface ApprovalDto {
  approvalId: string;
  subjectType: "ALLOCATION" | "RECOVERY";
  subjectId: string;
  requestedFromActorId: string;
  status: string;
}

interface VehicleDto {
  vehicleId: string;
  status: string;
  capacity?: QuantityDto;
}

interface MissionStopDto {
  sequence: number;
  kind: "PICKUP" | "DROPOFF";
  cropBatchIds?: string[];
  quantity: QuantityDto;
  location: GeoPoint;
}

interface MissionDto {
  missionId: string;
  orderId: string;
  status: string;
  transporterId?: string;
  quantity: QuantityDto;
  deadline: string;
  stops: MissionStopDto[];
  estimatedDurationMinutes?: number;
  estimatedArrival?: string;
}

interface VerificationTaskDto {
  taskId: string;
  status: string;
}

interface ExceptionDto {
  exceptionId: string;
  status: string;
}

interface ConnectedRunInput {
  scenarioId: string;
  islandIds?: readonly string[];
  seed: number;
  disruptions: InjectedDisruption[];
}

export interface ConnectedRunResult {
  result: RunResult;
  timeline: ReplayTimeline;
  decisionAdapter: string;
  actions: SimulationAgentAction[];
}

const COORDINATOR_SIMULATION_ID = "30000000-0000-4000-8000-000000000030";
const kilograms = (value: number): QuantityDto => ({ value: Number(value.toFixed(2)), unit: "kg" });
const plusDays = (iso: string, days: number) => new Date(Date.parse(iso) + days * 86_400_000).toISOString();
const asRecord = (value: unknown): JsonObject => value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
const textValue = (value: unknown) => typeof value === "string" ? value : undefined;
const numberValue = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : undefined;
const quantityValue = (value: unknown) => numberValue(asRecord(value).value);

const productStage = (stage: ControlRoomBatch["lastReportedStage"]) => {
  switch (stage) {
    case "READY": return "HARVEST_READY";
    case "HARVESTED": return "HARVESTED";
    case "MATURING": return "MATURING";
    case "SPOILED": return "DAMAGED";
    default: return "GROWING";
  }
};

/**
 * Creates Product-owned synthetic identities and inventory for one run.
 * This is an API bootstrap operation, not a simulation database write: the
 * engine supplies only its safe scene/first frame and never receives Prisma.
 */
async function bootstrapParticipants(runId: string, scene: ControlRoomScene, firstFrame: ControlRoomFrame) {
  const participants: ProductParticipant[] = [];
  const batchIds = new Map<string, string>();
  let operationsObserver: Actor | undefined;

  await prisma.$transaction(async (tx) => {
    for (const farm of scene.farms) {
      const actor = await tx.actor.create({
        data: {
          id: randomUUID(),
          authSubject: `simulation:${runId}:farmer:${farm.farmId}`,
          name: farm.name,
          role: ActorRole.FARMER,
          isSynthetic: true,
          defaultLatitude: farm.position.latitude,
          defaultLongitude: farm.position.longitude,
          serviceZone: "Saint Lucia",
          simulationRunId: runId,
        },
      });
      const productFarm = await tx.farm.create({
        data: {
          id: randomUUID(),
          name: farm.name,
          farmerId: actor.id,
          latitude: farm.position.latitude,
          longitude: farm.position.longitude,
          productionZone: "Saint Lucia",
          simulationRunId: runId,
        },
      });
      participants.push({
        simulationActorId: farm.farmId,
        productActorId: actor.id,
        role: "FARMER",
        displayName: farm.name,
        islandId: "saint-lucia",
        actor,
        token: "",
        farmId: productFarm.id,
      });
    }

    for (const buyer of scene.buyers) {
      const actor = await tx.actor.create({
        data: {
          id: randomUUID(),
          authSubject: `simulation:${runId}:buyer:${buyer.buyerId}`,
          name: buyer.name,
          role: ActorRole.BUYER,
          isSynthetic: true,
          defaultLatitude: buyer.position.latitude,
          defaultLongitude: buyer.position.longitude,
          serviceZone: "Saint Lucia",
          simulationRunId: runId,
        },
      });
      participants.push({
        simulationActorId: buyer.buyerId,
        productActorId: actor.id,
        role: "BUYER",
        displayName: buyer.name,
        islandId: "saint-lucia",
        actor,
        token: "",
      });
    }

    for (const transporter of scene.transporters) {
      const actor = await tx.actor.create({
        data: {
          id: randomUUID(),
          authSubject: `simulation:${runId}:transporter:${transporter.transporterId}`,
          name: transporter.name,
          role: ActorRole.TRANSPORTER,
          isSynthetic: true,
          defaultLatitude: transporter.homePosition.latitude,
          defaultLongitude: transporter.homePosition.longitude,
          serviceZone: "Saint Lucia",
          simulationRunId: runId,
        },
      });
      const vehicle = await tx.vehicle.create({
        data: {
          id: randomUUID(),
          transporterId: actor.id,
          label: `${transporter.name} vehicle`,
          registrationNumber: `SIM-${transporter.transporterId.slice(0, 6).toUpperCase()}`,
          capacityKg: transporter.capacityKg,
          status: "AVAILABLE",
          simulationRunId: runId,
        },
      });
      participants.push({
        simulationActorId: transporter.transporterId,
        productActorId: actor.id,
        role: "TRANSPORTER",
        displayName: transporter.name,
        islandId: "saint-lucia",
        actor,
        token: "",
        vehicleId: vehicle.id,
      });
    }

    const coordinator = await tx.actor.create({
      data: {
        id: randomUUID(),
        authSubject: `simulation:${runId}:coordinator`,
        name: "Harvest Saint Lucia Coordinator",
        role: ActorRole.COORDINATOR,
        isSynthetic: true,
        defaultLatitude: 13.9094,
        defaultLongitude: -60.9789,
        serviceZone: "Saint Lucia",
        simulationRunId: runId,
      },
    });
    participants.push({
      simulationActorId: COORDINATOR_SIMULATION_ID,
      productActorId: coordinator.id,
      role: "COORDINATOR",
      displayName: coordinator.name,
      islandId: "saint-lucia",
      actor: coordinator,
      token: "",
    });

    // The control-room projection needs complete run visibility. It is kept
    // separate from the simulated participants because it observes outcomes;
    // it never makes a Product decision or appears as a participant on the map.
    operationsObserver = await tx.actor.create({
      data: {
        id: randomUUID(),
        authSubject: `simulation:${runId}:operations-observer`,
        name: "Harvest Simulation Operations Observer",
        role: ActorRole.OPERATIONS,
        isSynthetic: true,
        serviceZone: "Saint Lucia",
        simulationRunId: runId,
      },
    });

    for (const farmer of participants.filter((item) => item.role === "FARMER")) {
      await tx.farmPermission.create({
        data: {
          farmId: farmer.farmId as string,
          actorId: coordinator.id,
          role: ActorRole.COORDINATOR,
          simulationRunId: runId,
        },
      });
    }

    for (const batch of firstFrame.batches) {
      const farmer = participants.find((item) => item.role === "FARMER" && item.simulationActorId === batch.farmId);
      if (!farmer?.farmId) continue;
      const cropBatchId = randomUUID();
      batchIds.set(batch.batchId, cropBatchId);
      await tx.cropBatch.create({
        data: {
          id: cropBatchId,
          farmId: farmer.farmId,
          cropType: batch.crop.toUpperCase(),
          status: "GROWING",
          availableToPromise: 0,
          provenance: Provenance.SYNTHETIC,
          simulationRunId: runId,
        },
      });
    }

    for (const participant of participants) {
      await tx.simulationActorMapping.create({
        data: {
          simulationRunId: runId,
          simulationActorId: participant.simulationActorId,
          productActorId: participant.actor.id,
          role: participant.actor.role,
          displayName: participant.displayName,
          islandId: participant.islandId,
        },
      });
    }
  });

  for (const participant of participants) participant.token = await signDevelopmentToken(participant.actor);
  if (!operationsObserver) throw new Error("The connected simulation requires an operations observer.");
  const observer: ProductApiPrincipal = {
    actor: operationsObserver,
    token: await signDevelopmentToken(operationsObserver),
  };
  return { participants, batchIds, observer };
}

/**
 * Typed participant gateway. Both simulated tools and the website reach the
 * same Fastify route handlers, so validation, permission checks, idempotency,
 * transactions and emitted events cannot drift into a second implementation.
 */
class ProductTools {
  private ordinal = 0;

  constructor(
    private readonly server: FastifyInstance,
    private readonly runId: string,
    private readonly decisions: SimulationDecisionProvider,
  ) {}

  async query<T>(participant: ProductApiPrincipal, url: string, simulationTime?: string): Promise<T> {
    const response = await this.server.inject({
      method: "GET",
      url,
      headers: {
        authorization: `Bearer ${participant.token}`,
        ...(simulationTime ? { "x-harvest-simulation-time": simulationTime } : {}),
      },
    });
    const parsed = response.body ? response.json<unknown>() : null;
    if (response.statusCode >= 400) {
      const problem = asRecord(parsed);
      throw new Error(`${textValue(problem.code) ?? "PRODUCT_QUERY_FAILED"}: ${textValue(problem.detail) ?? response.statusMessage}`);
    }
    return parsed as T;
  }

  private async observableContext(participant: ProductParticipant) {
    const approvals = participant.role === "TRANSPORTER"
      ? { items: [] as ApprovalDto[] }
      : await this.query<Page<ApprovalDto>>(participant, "/v1/approvals?status=PENDING&limit=100");
    if (participant.role === "FARMER") {
      const batches = await this.query<Page<CropBatchDto>>(participant, "/v1/crop-batches?limit=100");
      return {
        pendingApprovals: approvals.items.length,
        batches: batches.items.map((batch) => ({
          cropType: batch.cropType,
          status: batch.status,
          availableToPromiseKg: batch.availableToPromise.value,
          hasObservation: Boolean(batch.latestObservationId),
        })),
      };
    }
    if (participant.role === "BUYER") {
      const [listings, orders] = await Promise.all([
        this.query<Page<ListingDto>>(participant, "/v1/listings?limit=100"),
        this.query<Page<OrderDto>>(participant, "/v1/orders?limit=100"),
      ]);
      return {
        pendingApprovals: approvals.items.length,
        activeSupply: listings.items.filter((item) => item.status === "ACTIVE").map((item) => ({ cropType: item.cropType, quantityKg: item.quantity.value })),
        ownOrders: orders.items.map((item) => ({ status: item.lifecycleStatus, requestedKg: item.requestedQuantity.value })),
      };
    }
    if (participant.role === "TRANSPORTER") {
      const [vehicles, missions] = await Promise.all([
        this.query<Page<VehicleDto>>(participant, "/v1/me/vehicles?limit=100"),
        this.query<Page<MissionDto>>(participant, "/v1/delivery-missions?limit=100"),
      ]);
      return {
        vehicles: vehicles.items.map((item) => ({ status: item.status, capacityKg: item.capacity?.value ?? null })),
        availableMissions: missions.items.filter((item) => item.status === "AVAILABLE").length,
        assignedMissions: missions.items.filter((item) => item.transporterId === participant.productActorId).map((item) => ({ status: item.status, quantityKg: item.quantity.value })),
      };
    }
    const [tasks, exceptions] = await Promise.all([
      this.query<Page<VerificationTaskDto>>(participant, "/v1/verification-tasks?status=OPEN&limit=100"),
      this.query<Page<ExceptionDto>>(participant, "/v1/exceptions?limit=100"),
    ]);
    return {
      pendingApprovals: approvals.items.length,
      verificationTasks: tasks.items.filter((item) => item.status === "OPEN").length,
      openExceptions: exceptions.items.filter((item) => item.status === "OPEN" || item.status === "RECOVERY_PENDING").length,
    };
  }

  private async mutate<T>(
    participant: ProductParticipant,
    simulationTime: string,
    toolName: string,
    url: string,
    payload: JsonObject,
    summary: string,
  ): Promise<ToolResult<T>> {
    const decision = await this.decisions.decide(participant, simulationTime, await this.observableContext(participant));
    const approval = toolName === "decide_approval" ? "SYNTHETIC_PARTICIPANT" as const : "NONE" as const;
    if (!decision.allowedTools.has(toolName)) {
      return {
        ok: false,
        data: null,
        events: [],
        error: { status: 409, code: "TOOL_NOT_SELECTED", detail: decision.summary },
        action: {
          actionId: randomUUID(),
          at: simulationTime,
          simulationActorId: participant.simulationActorId,
          productActorId: participant.actor.id,
          role: participant.role,
          toolName,
          status: "REJECTED",
          summary: `${summary} Not selected by the bounded daily decision: ${decision.summary}`,
          eventIds: [],
          adapter: decision.adapter,
          approval,
        },
      };
    }

    const before = await prisma.domainEvent.findFirst({
      where: { simulationRunId: this.runId },
      orderBy: { cursor: "desc" },
      select: { cursor: true },
    });
    const response = await this.server.inject({
      method: "POST",
      url,
      headers: {
        authorization: `Bearer ${participant.token}`,
        "x-harvest-simulation-time": simulationTime,
        "idempotency-key": `simulation-${this.runId.slice(0, 8)}-${String(++this.ordinal).padStart(5, "0")}`,
      },
      payload,
    });
    const parsed = response.body ? response.json<JsonObject>() : {};
    const events = response.statusCode < 400
      ? await prisma.domainEvent.findMany({
          where: { simulationRunId: this.runId, cursor: { gt: before?.cursor ?? 0n } },
          orderBy: { cursor: "asc" },
        })
      : [];
    const lastEvent = events.at(-1);
    const commonAction = {
      actionId: randomUUID(),
      at: simulationTime,
      simulationActorId: participant.simulationActorId,
      productActorId: participant.actor.id,
      role: participant.role,
      toolName,
      eventIds: events.map((event) => event.id),
      adapter: decision.adapter,
      approval,
      ...(lastEvent?.traceId ? { traceId: lastEvent.traceId } : {}),
      ...(lastEvent?.entityId ? { entityId: lastEvent.entityId } : {}),
      ...(lastEvent?.correlationId ? { correlationId: lastEvent.correlationId } : {}),
      ...(lastEvent?.causationId ? { causationId: lastEvent.causationId } : {}),
    };
    if (response.statusCode >= 400) {
      const detail = textValue(parsed.detail) ?? response.statusMessage;
      const code = textValue(parsed.code) ?? "PRODUCT_TOOL_REJECTED";
      return {
        ok: false,
        data: parsed,
        events: [],
        error: { status: response.statusCode, code, detail },
        action: { ...commonAction, status: "REJECTED", summary: `${summary} Rejected: ${detail}` },
      };
    }
    return {
      ok: true,
      data: parsed as T,
      events,
      action: { ...commonAction, status: "SUCCEEDED", summary },
    };
  }

  submitCropObservation(participant: ProductParticipant, at: string, payload: JsonObject, summary: string) {
    return this.mutate<JsonObject>(participant, at, "submit_crop_observation", "/v1/crop-observations", payload, summary);
  }
  publishListing(participant: ProductParticipant, at: string, payload: JsonObject, summary: string) {
    return this.mutate<ListingDto>(participant, at, "publish_listing", "/v1/listings", payload, summary);
  }
  createBuyerDemand(participant: ProductParticipant, at: string, payload: JsonObject, summary: string) {
    return this.mutate<JsonObject>(participant, at, "create_buyer_demand", "/v1/buyer-demands", payload, summary);
  }
  placeOrder(participant: ProductParticipant, at: string, payload: JsonObject, summary: string) {
    return this.mutate<OrderDto>(participant, at, "place_order", "/v1/orders", payload, summary);
  }
  decideApproval(participant: ProductParticipant, at: string, approvalId: string, summary: string, decision: "APPROVE" | "REJECT" = "APPROVE") {
    return this.mutate<ApprovalDto>(participant, at, "decide_approval", `/v1/approvals/${approvalId}/decisions`, decision === "APPROVE"
      ? { decision, reason: "Synthetic participant approved this feasible run-scoped proposal." }
      : { decision, reason: "Synthetic participant declined this proposal.", ...SYNTHETIC_REJECTION_REASON }, summary);
  }
  acceptMission(participant: ProductParticipant, at: string, missionId: string, vehicleId: string, quantityKg: number) {
    return this.mutate<MissionDto>(participant, at, "accept_delivery_mission", `/v1/delivery-missions/${missionId}/acceptance`, {
      decision: "ACCEPT",
      vehicleId,
    }, `Accepted a ${quantityKg.toFixed(2)} kg delivery mission.`);
  }
  updateMission(participant: ProductParticipant, at: string, missionId: string, payload: JsonObject, summary: string) {
    return this.mutate<JsonObject>(participant, at, "report_mission_progress", `/v1/delivery-missions/${missionId}/updates`, payload, summary);
  }
  reportException(participant: ProductParticipant, at: string, missionId: string, description: string) {
    return this.mutate<ExceptionDto>(participant, at, "report_exception", "/v1/exceptions", {
      exceptionType: "DELAY",
      severity: "MEDIUM",
      affectedEntityIds: [missionId],
      description,
      provenance: "SYNTHETIC",
    }, "Reported an observable disruption affecting an active delivery.");
  }
  verifyObservation(participant: ProductParticipant, at: string, taskId: string, decision: "VERIFY" | "REQUEST_CHANGES" = "VERIFY") {
    return this.mutate<VerificationTaskDto>(participant, at, "verify_observation", `/v1/verification-tasks/${taskId}/decisions`, decision === "VERIFY"
      ? { decision, note: "Synthetic coordinator verified the observable simulation update." }
      : { decision, note: "Synthetic coordinator could not confirm the observable simulation update.", ...SYNTHETIC_REJECTION_REASON },
      decision === "VERIFY" ? "Verified the newly visible crop observation." : "Requested changes to the newly visible crop observation.");
  }
  acceptDelivery(participant: ProductParticipant, at: string, missionId: string, payload: JsonObject, acceptedKg: number) {
    return this.mutate<JsonObject>(participant, at, "record_delivery_acceptance", `/v1/deliveries/${missionId}/acceptance`, payload, `Recorded ${acceptedKg.toFixed(2)} kg as physically accepted.`);
  }
}

/**
 * Deterministic explanation attached to every synthetic rejection so connected
 * runs satisfy the same actionable-reason rule the website enforces.
 */
const SYNTHETIC_REJECTION_REASON = {
  reasonCode: "MATURITY_OR_QUALITY",
  nextAction: "Re-check ripeness before the next pickup and record an updated observation.",
} as const;

interface ProductMissionBinding {
  missionId: string;
  orderId: string;
  demandId: string;
  quantityKg: number;
  stops: MissionStopDto[];
  estimatedArrivalAt: number;
  transporterProductId?: string;
  simulationMissionId?: string;
  pickedByProductBatch: Map<string, number>;
}

/** Converts ordered Product API events into validated future engine effects. */
class ProductEventProjector {
  private readonly productBatchToSimulation = new Map<string, string>();
  private readonly productOrderToDemand = new Map<string, string>();
  private readonly buyerByOrder = new Map<string, string>();
  private readonly allocationsByOrder = new Map<string, Map<string, number>>();
  private readonly missions = new Map<string, ProductMissionBinding>();
  private readonly productMissionByOrder = new Map<string, string>();
  private readonly productMissionBySimulation = new Map<string, string>();
  private readonly simulationActorByProduct = new Map<string, string>();

  constructor(
    private readonly engine: SimulationEngine,
    batchIds: Map<string, string>,
    participants: ProductParticipant[],
  ) {
    for (const [simulationId, productId] of batchIds) this.productBatchToSimulation.set(productId, simulationId);
    for (const participant of participants) this.simulationActorByProduct.set(participant.actor.id, participant.simulationActorId);
  }

  bindOrder(productOrderId: string, simulationDemandId: string, buyerProductId: string) {
    this.productOrderToDemand.set(productOrderId, simulationDemandId);
    this.buyerByOrder.set(productOrderId, buyerProductId);
  }

  productMissionForSimulation(simulationMissionId: string) {
    const productId = this.productMissionBySimulation.get(simulationMissionId);
    return productId ? this.missions.get(productId) : undefined;
  }

  simulationBatchForProduct(productBatchId: string) {
    return this.productBatchToSimulation.get(productBatchId);
  }

  buyerForOrder(orderId: string) {
    return this.buyerByOrder.get(orderId);
  }

  consume(events: DomainEvent[]) {
    for (const event of events) {
      const effect = this.project(event);
      const result = this.engine.applyProductEffect(effect);
      if (effect.type === "MISSION_ACCEPTED" && result.simulationMissionId) {
        const binding = this.missions.get(effect.productMissionId);
        if (binding) {
          binding.simulationMissionId = result.simulationMissionId;
          this.productMissionBySimulation.set(result.simulationMissionId, effect.productMissionId);
        }
      }
    }
  }

  private base(event: DomainEvent) {
    return {
      eventId: event.id,
      cursor: event.cursor.toString(),
      atMs: this.engine.currentTime,
    };
  }

  private project(event: DomainEvent): ProductSimulationEffect {
    const payload = asRecord(event.payload);
    const base = this.base(event);
    if (event.eventType === "CROP_OBSERVATION_SUBMITTED") return { ...base, type: "OBSERVATION_BOUND" };
    if (event.eventType === "ORDER_REQUESTED") return { ...base, type: "ORDER_BOUND" };

    if (event.eventType === "ALLOCATION_APPROVED") {
      const orderId = textValue(payload.orderId);
      const demandId = orderId ? this.productOrderToDemand.get(orderId) : undefined;
      const allocations = Array.isArray(payload.lines) ? payload.lines.flatMap((value) => {
        const line = asRecord(value);
        const productBatchId = textValue(line.cropBatchId);
        const simulationBatchId = productBatchId ? this.productBatchToSimulation.get(productBatchId) : undefined;
        const quantityKg = quantityValue(line.quantity);
        return simulationBatchId && quantityKg !== undefined ? [{ batchId: simulationBatchId, quantityKg }] : [];
      }) : [];
      if (orderId) {
        this.allocationsByOrder.set(orderId, new Map(Array.isArray(payload.lines) ? payload.lines.flatMap((value) => {
          const line = asRecord(value);
          const batchId = textValue(line.cropBatchId);
          const amount = quantityValue(line.quantity);
          return batchId && amount !== undefined ? [[batchId, amount] as const] : [];
        }) : []));
      }
      if (demandId && allocations.length) return { ...base, type: "ALLOCATION_APPROVED", demandId, allocations };
    }

    if (event.eventType === "DELIVERY_MISSION_CREATED") {
      const missionId = textValue(payload.missionId);
      const orderId = textValue(payload.orderId);
      const demandId = orderId ? this.productOrderToDemand.get(orderId) : undefined;
      const stops = Array.isArray(payload.stops) ? payload.stops as unknown as MissionStopDto[] : [];
      const quantityKg = stops.find((stop) => stop.kind === "DROPOFF")?.quantity.value ??
        stops.filter((stop) => stop.kind === "PICKUP").reduce((sum, stop) => sum + stop.quantity.value, 0);
      const estimatedArrivalAt = Date.parse(textValue(payload.estimatedArrival) ?? "");
      if (missionId && orderId && demandId && stops.length >= 2) {
        this.missions.set(missionId, {
          missionId,
          orderId,
          demandId,
          quantityKg,
          stops,
          estimatedArrivalAt: Number.isFinite(estimatedArrivalAt) ? estimatedArrivalAt : this.engine.currentTime + 60_000,
          pickedByProductBatch: new Map(),
        });
        this.productMissionByOrder.set(orderId, missionId);
      }
      return { ...base, type: "NO_PHYSICAL_EFFECT" };
    }

    if (event.eventType === "DELIVERY_MISSION_ACCEPTED") {
      const missionId = textValue(payload.missionId);
      const transporterProductId = textValue(payload.transporterId);
      const binding = missionId ? this.missions.get(missionId) : undefined;
      const transporterId = transporterProductId ? this.simulationActorByProduct.get(transporterProductId) : undefined;
      if (binding && transporterId) {
        binding.transporterProductId = transporterProductId;
        const path = binding.stops.map((stop) => stop.location);
        return {
          ...base,
          type: "MISSION_ACCEPTED",
          productMissionId: binding.missionId,
          demandId: binding.demandId,
          transporterId,
          path,
          plannedDepartureAt: this.engine.currentTime + 60_000,
          plannedArrivalAt: Math.max(this.engine.currentTime + 120_000, binding.estimatedArrivalAt),
        };
      }
    }

    if (event.eventType === "RECOVERY_APPROVED") {
      const missionId = textValue(payload.missionId);
      const deadline = Date.parse(textValue(payload.deadline) ?? "");
      if (missionId && this.missions.has(missionId) && Number.isFinite(deadline)) {
        return { ...base, type: "MISSION_DELAYED", productMissionId: missionId, plannedArrivalAt: deadline };
      }
    }

    if (event.eventType === "DELIVERY_ACCEPTED") {
      const orderId = textValue(payload.orderId);
      const missionId = orderId ? this.productMissionByOrder.get(orderId) : undefined;
      const binding = missionId ? this.missions.get(missionId) : undefined;
      const acceptedKg = quantityValue(payload.acceptedQuantity);
      const rejectedKg = quantityValue(payload.rejectedQuantity);
      if (binding && acceptedKg !== undefined && rejectedKg !== undefined) {
        return {
          ...base,
          type: "DELIVERY_ACCEPTED",
          productMissionId: binding.missionId,
          demandId: binding.demandId,
          acceptedKg,
          rejectedKg,
        };
      }
    }

    if (event.eventType === "ALLOCATION_INVALIDATED" || event.eventType === "ORDER_CANCELLED") {
      const orderId = textValue(payload.orderId);
      const demandId = orderId ? this.productOrderToDemand.get(orderId) : undefined;
      if (demandId) return { ...base, type: event.eventType, demandId };
    }

    return {
      ...base,
      type: "NO_PHYSICAL_EFFECT",
      ...(event.eventType === "DELIVERY_UPDATE_POSTED" ? { origin: "PHYSICAL_ECHO" as const } : {}),
    };
  }

  allocationForOrder(orderId: string) {
    return this.allocationsByOrder.get(orderId) ?? new Map<string, number>();
  }
}

function participantBySimulationId(participants: ProductParticipant[], id: string) {
  return participants.find((participant) => participant.simulationActorId === id);
}

function participantByProductId(participants: ProductParticipant[], id: string) {
  return participants.find((participant) => participant.actor.id === id);
}

function recordResult(result: ToolResult<unknown>, actions: SimulationAgentAction[], projector: ProductEventProjector) {
  actions.push(result.action);
  projector.consume(result.events);
  return result.ok;
}

async function operationsSnapshot(tools: ProductTools, observer: ProductApiPrincipal, simulationTime: string) {
  return tools.query<SimulationOperationsSnapshot>(observer, "/v1/operations/snapshot", simulationTime);
}

async function verifyEvidence(
  tools: ProductTools,
  coordinator: ProductParticipant,
  at: string,
  actions: SimulationAgentAction[],
  projector: ProductEventProjector,
) {
  const page = await tools.query<Page<VerificationTaskDto>>(coordinator, "/v1/verification-tasks?status=OPEN&limit=100");
  for (const task of [...page.items].sort((a, b) => a.taskId.localeCompare(b.taskId))) {
    recordResult(await tools.verifyObservation(coordinator, at, task.taskId), actions, projector);
  }
}

async function decideApprovals(
  tools: ProductTools,
  participants: ProductParticipant[],
  at: string,
  actions: SimulationAgentAction[],
  projector: ProductEventProjector,
) {
  const roleOrder: Record<ProductParticipant["role"], number> = { FARMER: 0, BUYER: 1, TRANSPORTER: 2, COORDINATOR: 3 };
  const ordered = participants.filter((item) => item.role !== "TRANSPORTER").sort((a, b) => roleOrder[a.role] - roleOrder[b.role] || a.simulationActorId.localeCompare(b.simulationActorId));
  for (const participant of ordered) {
    const page = await tools.query<Page<ApprovalDto>>(participant, "/v1/approvals?status=PENDING&limit=100");
    for (const approval of [...page.items].sort((a, b) => a.approvalId.localeCompare(b.approvalId))) {
      recordResult(
        await tools.decideApproval(participant, at, approval.approvalId, `Approved the ${approval.subjectType.toLowerCase()} proposal.`),
        actions,
        projector,
      );
    }
  }
}

async function acceptAvailableMissions(
  tools: ProductTools,
  participants: ProductParticipant[],
  at: string,
  actions: SimulationAgentAction[],
  projector: ProductEventProjector,
) {
  const transporters = participants
    .filter((item) => item.role === "TRANSPORTER")
    .sort((a, b) => a.simulationActorId.localeCompare(b.simulationActorId));
  if (!transporters.length) return;
  const missions = await tools.query<Page<MissionDto>>(transporters[0] as ProductParticipant, "/v1/delivery-missions?status=AVAILABLE&limit=100");
  for (const mission of [...missions.items].filter((item) => item.status === "AVAILABLE").sort((a, b) => a.orderId.localeCompare(b.orderId))) {
    for (const transporter of transporters) {
      const vehicles = await tools.query<Page<VehicleDto>>(transporter, "/v1/me/vehicles?limit=100");
      const vehicle = vehicles.items
        .filter((item) => item.status === "AVAILABLE" && (item.capacity?.value ?? Number.MAX_SAFE_INTEGER) >= mission.quantity.value)
        .sort((a, b) => (a.capacity?.value ?? Number.MAX_SAFE_INTEGER) - (b.capacity?.value ?? Number.MAX_SAFE_INTEGER) || a.vehicleId.localeCompare(b.vehicleId))[0];
      if (!vehicle) continue;
      const result = await tools.acceptMission(transporter, at, mission.missionId, vehicle.vehicleId, mission.quantity.value);
      recordResult(result, actions, projector);
      if (result.ok) break;
    }
  }
}

async function processObservationFrame(
  tools: ProductTools,
  participants: ProductParticipant[],
  batchIds: Map<string, string>,
  frame: ControlRoomFrame,
  observed: Set<string>,
  actions: SimulationAgentAction[],
  projector: ProductEventProjector,
  coordinator: ProductParticipant,
) {
  for (const batch of [...frame.batches].sort((a, b) => a.batchId.localeCompare(b.batchId))) {
    if (batch.lastObservedAt !== frame.atMs) continue;
    const observationKey = `${batch.batchId}:${batch.lastObservedAt}`;
    if (observed.has(observationKey)) continue;
    observed.add(observationKey);
    const farmer = participantBySimulationId(participants, batch.farmId);
    const cropBatchId = batchIds.get(batch.batchId);
    if (!farmer || !cropBatchId) continue;
    recordResult(await tools.submitCropObservation(farmer, frame.at, {
      cropBatchId,
      observedAt: frame.at,
      cropStage: productStage(batch.lastReportedStage),
      notes: "Synthetic observation revealed by the physical simulation at this time.",
      ...(batch.latestEstimateKg !== null ? { estimatedQuantity: kilograms(batch.latestEstimateKg) } : {}),
      provenance: "SYNTHETIC",
    }, `Submitted an observable ${batch.crop} crop update.`), actions, projector);

    const [productBatch, listings] = await Promise.all([
      tools.query<CropBatchDto>(farmer, `/v1/crop-batches/${cropBatchId}`),
      tools.query<Page<ListingDto>>(farmer, "/v1/listings?limit=100"),
    ]);
    // Only observably ready produce is offered. ATP is already zero for a
    // growing batch, but the stage check keeps the participant's intent
    // honest even if a forecast path ever leaks supply early.
    const readyToList = productBatch.status === "HARVEST_READY" || productBatch.status === "HARVESTED";
    if (readyToList && !listings.items.some((item) => item.cropBatchId === cropBatchId && item.status === "ACTIVE") && productBatch.availableToPromise.value > 0) {
      recordResult(await tools.publishListing(farmer, frame.at, {
        cropBatchId,
        quantity: kilograms(productBatch.availableToPromise.value),
        unitPrice: { amount: 6.5, currency: "XCD" },
        availableFrom: frame.at.slice(0, 10),
        availableUntil: plusDays(frame.at, 7).slice(0, 10),
      }, `Published ${productBatch.availableToPromise.value.toFixed(2)} kg of available ${batch.crop}.`), actions, projector);
    }
  }
  await verifyEvidence(tools, coordinator, frame.at, actions, projector);
}

async function processDemandFrame(
  tools: ProductTools,
  participants: ProductParticipant[],
  frame: ControlRoomFrame,
  demanded: Set<string>,
  actions: SimulationAgentAction[],
  projector: ProductEventProjector,
  acceptanceThresholds: Map<string, number>,
) {
  for (const demand of [...frame.demands].sort((a, b) => a.demandId.localeCompare(b.demandId))) {
    if (demanded.has(demand.demandId)) continue;
    demanded.add(demand.demandId);
    const buyer = participantBySimulationId(participants, demand.buyerId);
    if (!buyer) continue;
    const deliveryLocation = {
      latitude: buyer.actor.defaultLatitude ?? 13.9094,
      longitude: buyer.actor.defaultLongitude ?? -60.9789,
    };
    recordResult(await tools.createBuyerDemand(buyer, frame.at, {
      cropType: demand.crop,
      quantity: kilograms(demand.quantityKg),
      neededBy: new Date(demand.neededBy).toISOString(),
      deliveryLocation,
      maxUnitPrice: { amount: 8, currency: "XCD" },
    }, `Recorded demand for ${demand.quantityKg.toFixed(2)} kg of ${demand.crop}.`), actions, projector);

    // The buyer persona already carries the share of an order it treats as
    // fulfilled; the Product order states the same number so matching can
    // safely offer a partial commitment this buyer would actually accept.
    const minimumAcceptableFraction = acceptanceThresholds.get(demand.buyerId) ?? 0.8;
    const order = await tools.placeOrder(buyer, frame.at, {
      cropType: demand.crop,
      requestedQuantity: kilograms(demand.quantityKg),
      neededBy: new Date(demand.neededBy).toISOString(),
      deliveryLocation,
      minimumAcceptableFraction,
    }, `Placed an order for ${demand.quantityKg.toFixed(2)} kg of ${demand.crop}, accepting at least ${Math.round(minimumAcceptableFraction * 100)}%.`);
    actions.push(order.action);
    if (order.ok) projector.bindOrder(order.data.orderId, demand.demandId, buyer.actor.id);
    projector.consume(order.events);
  }
  await decideApprovals(tools, participants, frame.at, actions, projector);
  await acceptAvailableMissions(tools, participants, frame.at, actions, projector);
}

async function processDisruptionImpacts(
  tools: ProductTools,
  participants: ProductParticipant[],
  frame: ControlRoomFrame,
  handled: Set<string>,
  actions: SimulationAgentAction[],
  projector: ProductEventProjector,
  engine: SimulationEngine,
) {
  let reportedAny = false;
  for (const impact of engine.observedDisruptionMissionImpacts) {
    const impactKey = `${impact.disruptionId}:${impact.missionId}`;
    if (handled.has(impactKey)) continue;

    const disruption = frame.disruptions.find((item) => item.eventId === impact.disruptionId);
    const binding = projector.productMissionForSimulation(impact.missionId);
    const transporter = binding?.transporterProductId
      ? participantByProductId(participants, binding.transporterProductId)
      : undefined;
    if (!disruption || !binding || !transporter || transporter.role !== "TRANSPORTER") continue;

    // One attempt per causal mission/disruption pair. A rejected Product tool
    // stays visible in the trace instead of being retried on every later frame.
    handled.add(impactKey);
    const result = await tools.reportException(transporter, frame.at, binding.missionId, disruption.description);
    if (recordResult(result, actions, projector)) reportedAny = true;
  }
  if (reportedAny) await decideApprovals(tools, participants, frame.at, actions, projector);
}

function batchHarvestDeltas(previous: ControlRoomFrame | undefined, frame: ControlRoomFrame) {
  const before = new Map((previous?.batches ?? []).map((batch) => [batch.batchId, batch.confirmedHarvestedKg]));
  return new Map(frame.batches.map((batch) => [batch.batchId, Math.max(0, batch.confirmedHarvestedKg - (before.get(batch.batchId) ?? 0))]));
}

async function processMissionDeparture(
  tools: ProductTools,
  participants: ProductParticipant[],
  frame: ControlRoomFrame,
  previous: ControlRoomFrame | undefined,
  actions: SimulationAgentAction[],
  projector: ProductEventProjector,
) {
  const changedMission = frame.missions.find((mission) => mission.status === "ACTIVE" && !previous?.missions.some((old) => old.missionId === mission.missionId && old.status === "ACTIVE"));
  if (!changedMission) return;
  const binding = projector.productMissionForSimulation(changedMission.missionId);
  if (!binding?.transporterProductId) return;
  const transporter = participantByProductId(participants, binding.transporterProductId);
  if (!transporter) return;
  const deltas = batchHarvestDeltas(previous, frame);
  let seconds = 1;
  for (const stop of binding.stops.filter((item) => item.kind === "PICKUP").sort((a, b) => a.sequence - b.sequence)) {
    const arrivedAt = new Date(frame.atMs + seconds++ * 1_000).toISOString();
    recordResult(await tools.updateMission(transporter, frame.at, binding.missionId, {
      updateType: "ARRIVED",
      recordedAt: arrivedAt,
      position: stop.location,
      note: `Arrived at synthetic pickup stop ${stop.sequence}.`,
    }, `Arrived at pickup stop ${stop.sequence}.`), actions, projector);

    let pickedAtStop = 0;
    for (const productBatchId of stop.cropBatchIds ?? []) {
      const simulationBatchId = projector.simulationBatchForProduct(productBatchId);
      const picked = simulationBatchId ? deltas.get(simulationBatchId) ?? 0 : 0;
      binding.pickedByProductBatch.set(productBatchId, Number(picked.toFixed(2)));
      pickedAtStop += picked;
    }
    const pickedAt = new Date(frame.atMs + seconds++ * 1_000).toISOString();
    recordResult(await tools.updateMission(transporter, frame.at, binding.missionId, {
      updateType: "PICKED_UP",
      recordedAt: pickedAt,
      quantity: kilograms(pickedAtStop),
      note: "Recorded the quantity physically available at this pickup.",
    }, `Confirmed ${pickedAtStop.toFixed(2)} kg picked up at stop ${stop.sequence}.`), actions, projector);
  }
}

async function processMissionArrival(
  tools: ProductTools,
  participants: ProductParticipant[],
  frame: ControlRoomFrame,
  previous: ControlRoomFrame | undefined,
  actions: SimulationAgentAction[],
  projector: ProductEventProjector,
) {
  const changedMission = frame.missions.find((mission) => mission.status === "COMPLETED" && !previous?.missions.some((old) => old.missionId === mission.missionId && old.status === "COMPLETED"));
  if (!changedMission) return;
  const binding = projector.productMissionForSimulation(changedMission.missionId);
  if (!binding?.transporterProductId) return;
  const transporter = participantByProductId(participants, binding.transporterProductId);
  if (!transporter) return;
  const dropoff = binding.stops.find((stop) => stop.kind === "DROPOFF");
  if (!dropoff) return;
  const arrivedAt = new Date(frame.atMs + 1_000).toISOString();
  recordResult(await tools.updateMission(transporter, frame.at, binding.missionId, {
    updateType: "ARRIVED",
    recordedAt: arrivedAt,
    position: dropoff.location,
    note: "Arrived at the synthetic buyer drop-off.",
  }, "Arrived at the buyer drop-off."), actions, projector);
  const deliveredAt = new Date(frame.atMs + 2_000).toISOString();
  recordResult(await tools.updateMission(transporter, frame.at, binding.missionId, {
    updateType: "DELIVERED",
    recordedAt: deliveredAt,
    quantity: kilograms(changedMission.loadedKg),
    note: "Completed the physical delivery route.",
  }, `Completed the route with ${changedMission.loadedKg.toFixed(2)} kg physically loaded.`), actions, projector);

  const buyerProductId = projector.buyerForOrder(binding.orderId);
  const orderOwner = buyerProductId ? participantByProductId(participants, buyerProductId) : undefined;
  if (!orderOwner) return;
  const allocation = projector.allocationForOrder(binding.orderId);
  const lineOutcomes = [...allocation.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([cropBatchId, committed]) => {
    const accepted = Math.min(committed, binding.pickedByProductBatch.get(cropBatchId) ?? 0);
    const rejected = Math.max(0, committed - accepted);
    return {
      cropBatchId,
      acceptedQuantity: kilograms(accepted),
      rejectedQuantity: kilograms(rejected),
      ...(rejected > 0 ? SYNTHETIC_REJECTION_REASON : {}),
    };
  });
  const acceptedKg = Number(lineOutcomes.reduce((sum, line) => sum + line.acceptedQuantity.value, 0).toFixed(2));
  const rejectedKg = Number(lineOutcomes.reduce((sum, line) => sum + line.rejectedQuantity.value, 0).toFixed(2));
  const outcome = acceptedKg <= 0 ? "REJECTED" : rejectedKg <= 0 ? "ACCEPTED" : "PARTIALLY_ACCEPTED";
  recordResult(await tools.acceptDelivery(orderOwner, frame.at, binding.missionId, {
    outcome,
    acceptedQuantity: kilograms(acceptedKg),
    rejectedQuantity: kilograms(rejectedKg),
    lineOutcomes,
    note: "Synthetic buyer recorded the physically loaded quantity; unavailable promised produce is rejected.",
    ...(rejectedKg > 0 ? SYNTHETIC_REJECTION_REASON : {}),
  }, acceptedKg), actions, projector);
}

/** Runs the physical engine and Product API participants as one interleaved cycle. */
export async function runConnectedHarvest(
  server: FastifyInstance,
  runId: string,
  input: ConnectedRunInput,
  decisionMode: DecisionMode,
): Promise<ConnectedRunResult> {
  const engine = new SimulationEngine({
    runId,
    scenarioId: input.scenarioId,
    islandIds: input.islandIds,
    policy: "HARVEST",
    seed: input.seed,
    captureFrames: true,
    coordinationMode: "EXTERNAL_PRODUCT_API",
    injectedDisruptions: input.disruptions,
  });
  engine.start();
  const firstFrame = engine.checkpoint("RUN_STARTED");
  const { participants, batchIds, observer } = await bootstrapParticipants(runId, engine.controlRoomScene, firstFrame);
  const decisions = new SimulationDecisionProvider(decisionMode);
  const tools = new ProductTools(server, runId, decisions);
  const projector = new ProductEventProjector(engine, batchIds, participants);
  const coordinator = participants.find((item) => item.role === "COORDINATOR");
  if (!coordinator) throw new Error("The connected simulation requires a coordinator.");

  const observed = new Set<string>();
  const demanded = new Set<string>();
  const acceptanceThresholds = new Map(
    engine.controlRoomScene.buyers.map((buyer) => [buyer.buyerId, buyer.minimumAcceptableFraction] as const),
  );
  const handledDisruptionImpacts = new Set<string>();
  const allActions: SimulationAgentAction[] = [];
  let previousFrame: ControlRoomFrame | undefined = firstFrame;
  let latestSnapshot = await operationsSnapshot(tools, observer, new Date(engine.currentTime).toISOString());
  firstFrame.operationsSnapshot = structuredClone(latestSnapshot);

  for (;;) {
    const nextAt = engine.nextEventAt;
    if (nextAt === null || nextAt > engine.horizon.endsAt) break;
    const physicalFrames = engine.advanceTo(nextAt);
    const actions: SimulationAgentAction[] = [];
    for (const frame of physicalFrames) {
      if (frame.eventType === "FARMER_OBSERVATION") {
        await processObservationFrame(tools, participants, batchIds, frame, observed, actions, projector, coordinator);
      } else if (frame.eventType === "BUYER_DEMAND") {
        await processDemandFrame(tools, participants, frame, demanded, actions, projector, acceptanceThresholds);
      } else if (frame.eventType === "MISSION_DEPART") {
        await processMissionDeparture(tools, participants, frame, previousFrame, actions, projector);
      } else if (frame.eventType === "MISSION_ARRIVE") {
        await processMissionArrival(tools, participants, frame, previousFrame, actions, projector);
      }
      await processDisruptionImpacts(
        tools,
        participants,
        frame,
        handledDisruptionImpacts,
        actions,
        projector,
        engine,
      );
      previousFrame = frame;
    }
    if (actions.length) {
      latestSnapshot = await operationsSnapshot(tools, observer, new Date(engine.currentTime).toISOString());
      previousFrame = engine.checkpoint("PRODUCT_AGENT_CYCLE", actions, latestSnapshot);
      allActions.push(...actions);
    }
  }

  const result = engine.finish();
  if (!result.timeline) throw new Error("Connected simulation completed without a replay timeline.");
  latestSnapshot = await operationsSnapshot(tools, observer, result.endedAt);
  // Carry the most recent Product projection across intervening physical
  // frames; replay therefore never jumps backwards to stale operational data.
  let carriedSnapshot = firstFrame.operationsSnapshot ?? latestSnapshot;
  for (const frame of result.timeline.frames) {
    if (frame.operationsSnapshot) carriedSnapshot = frame.operationsSnapshot;
    else frame.operationsSnapshot = structuredClone(carriedSnapshot);
  }
  result.timeline.frames.at(-1)!.operationsSnapshot = structuredClone(latestSnapshot);
  result.timeline.scene.participants = participants.map(({ actor: _actor, token: _token, farmId: _farmId, vehicleId: _vehicleId, ...participant }) => participant);

  return {
    result,
    timeline: result.timeline,
    decisionAdapter: decisions.adapterName(),
    actions: allActions,
  };
}
