import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "../src/db.js";
import { buildServer } from "../src/server.js";

const server = await buildServer();
const tokens: Record<string, string> = {};
let apiBaseUrl = "";

async function signIn(persona: string) {
  const response = await server.inject({ method: "POST", url: "/dev/session", payload: { persona } });
  expect(response.statusCode).toBe(200);
  tokens[persona] = response.json().accessToken;
  return response.json();
}

function auth(persona: string) {
  return { authorization: `Bearer ${tokens[persona]}` };
}

function mutationHeaders(persona: string, prefix: string) {
  return { ...auth(persona), "idempotency-key": `${prefix}-${randomUUID()}` };
}

async function decide(persona: string, approvalId: string, decision: "APPROVE" | "REJECT") {
  return server.inject({ method: "POST", url: `/v1/approvals/${approvalId}/decisions`, headers: mutationHeaders(persona, `decision-${decision.toLowerCase()}`), payload: { decision } });
}

beforeAll(async () => {
  await server.listen({ host: "127.0.0.1", port: 0 });
  const address = server.server.address() as AddressInfo;
  apiBaseUrl = `http://127.0.0.1:${address.port}`;
  for (const persona of ["buyer-hotel", "farmer-ana", "farmer-marcus", "transporter-daniel", "coordinator-maya", "operations-demo"]) await signIn(persona);
});

afterAll(async () => server.close());

describe("participant Product API", () => {
  it("accepts the loopback spelling used by the local control-room preview", async () => {
    const response = await server.inject({
      method: "OPTIONS",
      url: "/dev/session",
      headers: {
        origin: "http://127.0.0.1:3002",
        "access-control-request-method": "POST",
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:3002");
  });

  it("scopes participant data and exposes the P0 read projections", async () => {
    const buyerSession = await signIn("buyer-hotel");
    expect(buyerSession.actor.serviceZone).toBe("Castries");
    expect(buyerSession.actor.deliveryLocation).toEqual({ latitude: 14.0101, longitude: -60.9875 });

    const ana = await server.inject({ method: "GET", url: "/v1/crop-batches", headers: auth("farmer-ana") });
    expect(ana.statusCode).toBe(200);
    expect(ana.json().items).toHaveLength(1);
    expect(ana.json().items[0].verificationStatus).toBe("OPEN");
    const unrelated = await server.inject({ method: "GET", url: "/v1/crop-batches/11111111-1111-4111-8111-111111111111", headers: auth("farmer-marcus") });
    expect(unrelated.statusCode).toBe(404);

    const listing = await server.inject({ method: "GET", url: "/v1/listings/16161616-1616-4616-8616-161616161616", headers: auth("buyer-hotel") });
    expect(listing.statusCode).toBe(200);
    expect(listing.json().productionZone).toBe("Roseau Valley");
    expect(listing.json().supplyEvidence).toMatchObject({ provenance: "MODEL_PREDICTED", verificationStatus: "OPEN" });
    expect(listing.body).not.toContain("13.953");

    const opportunities = await server.inject({ method: "GET", url: "/v1/market-opportunities", headers: auth("farmer-ana") });
    expect(opportunities.statusCode).toBe(200);
    expect(opportunities.json().items[0]).toMatchObject({ cropType: "CUCUMBER", deliveryZone: "Castries" });
    expect(opportunities.body).not.toContain("buyerId");
    expect(opportunities.body).not.toContain("deliveryLocation");

    const vehicles = await server.inject({ method: "GET", url: "/v1/me/vehicles", headers: auth("transporter-daniel") });
    expect(vehicles.statusCode).toBe(200);
    expect(vehicles.json().items).toEqual([expect.objectContaining({ vehicleId: "d0000000-0000-4000-8000-000000000001", status: "AVAILABLE" })]);

    const coordinatorTasks = await server.inject({ method: "GET", url: "/v1/verification-tasks?status=OPEN", headers: auth("coordinator-maya") });
    expect(coordinatorTasks.statusCode).toBe(200);
    expect(coordinatorTasks.json().items).toHaveLength(1);
    const farmerTasks = await server.inject({ method: "GET", url: "/v1/verification-tasks", headers: auth("farmer-ana") });
    expect(farmerTasks.statusCode).toBe(403);
  });

  it("builds the island world from newly accessible farms and actionable hotel demand", async () => {
    const farmId = randomUUID();
    const batchId = randomUUID();
    await prisma.farm.create({ data: { id: farmId, name: "Canaries Hillside Plot", farmerId: "a0000000-0000-4000-8000-000000000001", latitude: 13.90, longitude: -61.07, productionZone: "Canaries" } });
    await prisma.cropBatch.create({ data: { id: batchId, farmId, cropType: "DASHEEN", status: "GROWING", availableToPromise: 9, provenance: "OBSERVED" } });

    try {
      const farmer = await server.inject({ method: "GET", url: "/v1/world-map", headers: auth("farmer-ana") });
      expect(farmer.statusCode).toBe(200);
      expect(farmer.json()).toMatchObject({ region: "Saint Lucia" });
      expect(farmer.json().locations).toEqual(expect.arrayContaining([
        expect.objectContaining({ locationId: farmId, kind: "FARM", displayName: "Canaries Hillside Plot", access: "CROP_PROGRESS", crops: [expect.objectContaining({ cropBatchId: batchId, cropType: "DASHEEN", status: "GROWING" })] }),
        expect.objectContaining({ kind: "HOTEL", displayName: "Bay Gardens Hotel", access: "BUYER_DEMAND", opportunities: [expect.objectContaining({ cropType: "CUCUMBER", quantity: { value: 20, unit: "kg" } })] }),
      ]));
      expect(farmer.body).not.toContain("13.9");
      expect(farmer.body).not.toContain("-61.07");

      const transporter = await server.inject({ method: "GET", url: "/v1/world-map", headers: auth("transporter-daniel") });
      expect(transporter.statusCode).toBe(200);
      expect(transporter.json().locations.every((location: { crops: unknown[]; opportunities: unknown[] }) => !location.crops.length && !location.opportunities.length)).toBe(true);
      expect(transporter.body).not.toContain(farmId);
    } finally {
      await prisma.cropBatch.delete({ where: { id: batchId } });
      await prisma.farm.delete({ where: { id: farmId } });
    }
  });

  it("returns safe delivery labels when enrichment records are incomplete", async () => {
    const orderId = randomUUID();
    const missionId = randomUUID();
    await prisma.order.create({
      data: {
        id: orderId,
        buyerId: "a0000000-0000-4000-8000-000000000002",
        cropType: "DASHEEN",
        requestedQuantity: 5,
        neededBy: new Date("2026-09-09T12:00:00Z"),
        latitude: 14.0101,
        longitude: -60.9875,
        listingIds: [],
        lifecycleStatus: "COMMITTED",
        activeExceptionIds: [],
      },
    });
    await prisma.deliveryMission.create({
      data: {
        id: missionId,
        orderId,
        status: "AVAILABLE",
        quantity: 5,
        deadline: new Date("2026-09-09T12:00:00Z"),
        stops: [
          { sequence: 1, kind: "PICKUP", farmId: randomUUID(), location: { latitude: 13.95, longitude: -61 } },
          { sequence: 2, kind: "DROPOFF", quantity: { value: 5, unit: "kg" }, location: { latitude: 14.0101, longitude: -60.9875 } },
        ],
      },
    });

    try {
      const buyer = await server.inject({ method: "GET", url: "/v1/orders/" + orderId, headers: auth("buyer-hotel") });
      expect(buyer.statusCode).toBe(200);
      expect(buyer.json().deliveryMission).toMatchObject({
        buyerName: "Bay Gardens Hotel",
        cropType: "DASHEEN",
        cargo: [],
        stops: [
          expect.objectContaining({ displayName: "Pickup 1" }),
          expect.objectContaining({ displayName: "Bay Gardens Hotel" }),
        ],
      });
      const transporter = await server.inject({ method: "GET", url: "/v1/delivery-missions/" + missionId, headers: auth("transporter-daniel") });
      expect(transporter.statusCode).toBe(200);
      expect(transporter.json().cargo).toEqual([]);
    } finally {
      await prisma.deliveryMission.delete({ where: { id: missionId } });
      await prisma.order.delete({ where: { id: orderId } });
    }
  });

  it("drafts, human-confirms, forecasts, and exposes a safe crop trace", async () => {
    const batchId = "11111111-1111-4111-8111-111111111111";
    const beforePredictions = await prisma.yieldPrediction.count({ where: { cropBatchId: batchId } });
    const beforeTasks = await prisma.verificationTask.count({ where: { cropBatchId: batchId } });
    const intake = await server.inject({
      method: "POST",
      url: "/v1/crop-observation-intakes",
      headers: mutationHeaders("farmer-ana", "observation-draft"),
      payload: { cropBatchId: batchId, observedAt: new Date().toISOString(), sourceType: "TEXT", sourceText: "Approximately 20 kg of cucumbers are harvest ready, with some rain damage.", provenance: "OBSERVED" },
    });
    expect(intake.statusCode).toBe(201);
    expect(intake.json()).toMatchObject({
      cropBatchId: batchId,
      status: "DRAFT",
      adapter: "fixture",
      promptId: "crop-observation-extraction-v1",
      draft: { suggestedCropStage: "HARVEST_READY", suggestedEstimatedQuantity: { value: 20, unit: "kg" } },
    });
    expect(await prisma.cropObservation.count({ where: { cropBatchId: batchId } })).toBe(1);
    const response = await server.inject({
      method: "POST",
      url: "/v1/crop-observations",
      headers: mutationHeaders("farmer-ana", "single-forecast"),
      payload: { cropBatchId: batchId, intakeId: intake.json().intakeId, observedAt: new Date().toISOString(), cropStage: "HARVEST_READY", estimatedQuantity: { value: 20, unit: "kg" }, notes: "Approximately 20 kg of cucumbers are harvest ready, with some rain damage.", provenance: "OBSERVED" },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().intakeId).toBe(intake.json().intakeId);
    expect(await prisma.yieldPrediction.count({ where: { cropBatchId: batchId } })).toBe(beforePredictions + 1);
    expect(await prisma.verificationTask.count({ where: { cropBatchId: batchId } })).toBe(beforeTasks + 1);
    const batch = await prisma.cropBatch.findUniqueOrThrow({ where: { id: batchId } });
    const prediction = await prisma.yieldPrediction.findUniqueOrThrow({ where: { id: batch.latestPredictionId! } });
    expect(prediction.q10).toBe(14);
    expect(batch.availableToPromise).toBe(14);
    const trace = await server.inject({ method: "GET", url: `/v1/agent-traces/${intake.json().traceId}`, headers: auth("farmer-ana") });
    expect(trace.statusCode).toBe(200);
    expect(trace.json()).toMatchObject({ workflowType: "CROP_INTELLIGENCE", stage: "FORECAST_READY", status: "COMPLETED" });
    expect(trace.body).not.toContain("Approximately 20 kg");
    expect(trace.body).not.toContain("AGENT_LLM_API_KEY");
  });

  it("runs the 14 kg + 6 kg commitment, route, recovery, and delivery workflow", async () => {
    const orderId = "20202020-2020-4020-8020-202020202020";

    const buyerApprovals = (await server.inject({ method: "GET", url: "/v1/approvals?status=PENDING", headers: auth("buyer-hotel") })).json().items;
    const anaApprovals = (await server.inject({ method: "GET", url: "/v1/approvals?status=PENDING", headers: auth("farmer-ana") })).json().items;
    const marcusApprovals = (await server.inject({ method: "GET", url: "/v1/approvals?status=PENDING", headers: auth("farmer-marcus") })).json().items;
    const buyerApproval = buyerApprovals.find((item: { context?: { orderId?: string } }) => item.context?.orderId === orderId);
    const anaApproval = anaApprovals.find((item: { context?: { orderId?: string } }) => item.context?.orderId === orderId);
    const marcusApproval = marcusApprovals.find((item: { context?: { orderId?: string } }) => item.context?.orderId === orderId);
    expect(buyerApproval.context.quantity.value).toBe(20);
    expect(buyerApproval.context.estimatedPrice).toEqual({ amount: 148.5, currency: "XCD" });
    expect(anaApproval.context.quantity.value).toBe(14);
    expect(marcusApproval.context.quantity.value).toBe(6);
    expect((await decide("buyer-hotel", buyerApproval.approvalId, "APPROVE")).statusCode).toBe(200);
    expect((await decide("farmer-ana", anaApproval.approvalId, "APPROVE")).statusCode).toBe(200);
    expect((await decide("farmer-marcus", marcusApproval.approvalId, "APPROVE")).statusCode).toBe(200);

    const committed = await server.inject({ method: "GET", url: `/v1/orders/${orderId}`, headers: auth("buyer-hotel") });
    expect(committed.json().lifecycleStatus).toBe("COMMITTED");
    expect(committed.json().approvalSummary).toMatchObject({ required: 3, approved: 3, pending: 0 });
    expect(committed.json().traceId).toBe("c0000000-0000-4000-8000-000000000001");
    const missionId = committed.json().deliveryMission.missionId as string;
    expect(committed.json().deliveryMission.stops).toHaveLength(3);
    expect(committed.json().deliveryMission.stops.slice(0, 2).map((stop: { quantity: { value: number } }) => stop.quantity.value).sort((a: number, b: number) => a - b)).toEqual([6, 14]);
    expect(committed.json().deliveryMission.estimatedDistanceKm).toBeGreaterThan(0);
    expect(committed.json().deliveryMission.estimatedDurationMinutes).toBeGreaterThan(0);
    expect(committed.json().deliveryMission).toMatchObject({
      routeRegion: "Saint Lucia",
      buyerName: "Bay Gardens Hotel",
      cropType: "CUCUMBER",
      atRisk: false,
      stops: [
        expect.objectContaining({ kind: "PICKUP", displayName: expect.any(String) }),
        expect.objectContaining({ kind: "PICKUP", displayName: expect.any(String) }),
        expect.objectContaining({ kind: "DROPOFF", displayName: "Bay Gardens Hotel" }),
      ],
    });
    expect(committed.json().deliveryMission.cargo).toEqual(expect.arrayContaining([
      expect.objectContaining({ farmName: "Roseau Valley Farm", cropStatus: "HARVEST_READY", quantity: { value: 14, unit: "kg" } }),
      expect.objectContaining({ farmName: "Mabouya Growers", cropStatus: "HARVEST_READY", quantity: { value: 6, unit: "kg" } }),
    ]));
    expect(committed.body).not.toContain("Rain damage visible");
    const availableView = await server.inject({ method: "GET", url: "/v1/delivery-missions/" + missionId, headers: auth("transporter-daniel") });
    expect(availableView.statusCode).toBe(200);
    expect(availableView.json().cargo).toHaveLength(2);
    expect(availableView.json().cargo.every((item: { cropStatus?: string }) => item.cropStatus === undefined)).toBe(true);
    const availablePage = await server.inject({ method: "GET", url: "/v1/delivery-missions?status=AVAILABLE", headers: auth("transporter-daniel") });
    expect(availablePage.json().items.find((item: { missionId: string }) => item.missionId === missionId)).toMatchObject({
      buyerName: "Bay Gardens Hotel",
      cropType: "CUCUMBER",
    });
    const listing = await prisma.listing.findUniqueOrThrow({ where: { id: "16161616-1616-4616-8616-161616161616" } });
    expect(listing).toMatchObject({ quantity: 0, status: "SOLD_OUT" });
    const refreshed = await server.inject({ method: "POST", url: "/v1/crop-batches/11111111-1111-4111-8111-111111111111/forecast-requests", headers: mutationHeaders("farmer-ana", "committed-reforecast"), payload: { reason: "MANUAL_REFRESH" } });
    expect(refreshed.statusCode).toBe(202);
    expect((await prisma.cropBatch.findUniqueOrThrow({ where: { id: "11111111-1111-4111-8111-111111111111" } })).availableToPromise).toBe(0);

    const wrongVehicle = await server.inject({ method: "POST", url: `/v1/delivery-missions/${missionId}/acceptance`, headers: mutationHeaders("transporter-daniel", "wrong-vehicle"), payload: { decision: "ACCEPT", vehicleId: randomUUID() } });
    expect(wrongVehicle.statusCode).toBe(404);
    const acceptedMission = await server.inject({ method: "POST", url: `/v1/delivery-missions/${missionId}/acceptance`, headers: mutationHeaders("transporter-daniel", "accept-mission"), payload: { decision: "ACCEPT", vehicleId: "d0000000-0000-4000-8000-000000000001" } });
    expect(acceptedMission.statusCode).toBe(200);
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: "d0000000-0000-4000-8000-000000000001" } })).status).toBe("IN_USE");
    const assignedView = await server.inject({ method: "GET", url: "/v1/delivery-missions/" + missionId, headers: auth("transporter-daniel") });
    expect(assignedView.json().cargo.every((item: { cropStatus?: string }) => item.cropStatus === "HARVEST_READY")).toBe(true);

    let updateTime = Date.now() + 1_000;
    const update = (updateType: string, note?: string) => server.inject({ method: "POST", url: `/v1/delivery-missions/${missionId}/updates`, headers: mutationHeaders("transporter-daniel", `mission-${updateType.toLowerCase()}`), payload: { updateType, recordedAt: new Date(updateTime += 1_000).toISOString(), ...(note ? { note } : {}) } });
    expect((await update("DELIVERED")).statusCode).toBe(409);
    expect((await update("ARRIVED")).json().stopSequence).toBe(1);
    expect((await update("PICKED_UP")).statusCode).toBe(201);
    expect((await update("DELAYED", "Road closure near Castries.")).statusCode).toBe(201);

    const delayedMission = await prisma.deliveryMission.findUniqueOrThrow({ where: { id: missionId } });
    const oldDeadline = delayedMission.deadline.getTime();
    const exception = await server.inject({
      method: "POST",
      url: "/v1/exceptions",
      headers: mutationHeaders("transporter-daniel", "delay-exception"),
      payload: { exceptionType: "DELAY", severity: "HIGH", affectedEntityIds: [missionId], description: "Road closure near Castries.", provenance: "OBSERVED" },
    });
    expect(exception.statusCode).toBe(201);
    const exceptionId = exception.json().exceptionId as string;
    const atRisk = await server.inject({ method: "GET", url: `/v1/orders/${orderId}`, headers: auth("buyer-hotel") });
    expect(atRisk.json().atRisk).toBe(true);
    expect(atRisk.json().activeExceptionIds).toContain(exceptionId);
    const detail = await server.inject({ method: "GET", url: `/v1/exceptions/${exceptionId}`, headers: auth("coordinator-maya") });
    expect(detail.json().recoveryProposal).toMatchObject({ action: "RESCHEDULE" });
    expect(detail.json().recoveryProposal.summary).toContain("exactly two hours");
    expect(detail.json().recoveryProposal.changes.evidence).toHaveLength(2);
    expect(detail.json().traceId).toBeTruthy();
    const recoveryTrace = await server.inject({ method: "GET", url: `/v1/agent-traces/${detail.json().traceId}`, headers: auth("coordinator-maya") });
    expect(recoveryTrace.json()).toMatchObject({ workflowType: "EXCEPTION_RECOVERY", stage: "RECOVERY_PROPOSED", status: "AWAITING_APPROVAL" });
    expect(recoveryTrace.body).not.toContain("Road closure near Castries");

    const recoveryApprovals = (await server.inject({ method: "GET", url: "/v1/approvals?status=PENDING", headers: auth("coordinator-maya") })).json().items;
    const recoveryApproval = recoveryApprovals.find((item: { context?: { exceptionId?: string } }) => item.context?.exceptionId === exceptionId);
    expect((await decide("coordinator-maya", recoveryApproval.approvalId, "APPROVE")).statusCode).toBe(200);
    const recoveredMission = await prisma.deliveryMission.findUniqueOrThrow({ where: { id: missionId } });
    expect(recoveredMission.deadline.getTime()).toBe(oldDeadline + 2 * 60 * 60 * 1000);
    expect((await server.inject({ method: "GET", url: `/v1/orders/${orderId}`, headers: auth("buyer-hotel") })).json().atRisk).toBe(false);

    expect((await update("ARRIVED")).json().stopSequence).toBe(2);
    expect((await update("PICKED_UP")).statusCode).toBe(201);
    expect((await update("ARRIVED")).json().stopSequence).toBe(3);
    expect((await update("DELIVERED")).statusCode).toBe(201);
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: "d0000000-0000-4000-8000-000000000001" } })).status).toBe("AVAILABLE");
    const history = await server.inject({ method: "GET", url: `/v1/delivery-missions/${missionId}/updates`, headers: auth("buyer-hotel") });
    expect(history.json().items.map((item: { updateType: string }) => item.updateType)).toEqual(["ARRIVED", "PICKED_UP", "DELAYED", "ARRIVED", "PICKED_UP", "ARRIVED", "DELIVERED"]);

    const acceptance = await server.inject({
      method: "POST",
      url: `/v1/deliveries/${missionId}/acceptance`,
      headers: mutationHeaders("buyer-hotel", "partial-acceptance"),
      payload: { outcome: "PARTIALLY_ACCEPTED", acceptedQuantity: { value: 18, unit: "kg" }, rejectedQuantity: { value: 2, unit: "kg" }, lineOutcomes: [{ cropBatchId: "11111111-1111-4111-8111-111111111111", acceptedQuantity: { value: 13, unit: "kg" }, rejectedQuantity: { value: 1, unit: "kg" } }, { cropBatchId: "11111111-1111-4111-8111-111111111112", acceptedQuantity: { value: 5, unit: "kg" }, rejectedQuantity: { value: 1, unit: "kg" } }], note: "Two kilograms did not meet the agreed quality." },
    });
    expect(acceptance.statusCode).toBe(201);
    const completed = await server.inject({ method: "GET", url: `/v1/orders/${orderId}`, headers: auth("buyer-hotel") });
    expect(completed.json()).toMatchObject({ lifecycleStatus: "PARTIALLY_FULFILLED", acceptedQuantity: { value: 18, unit: "kg" }, deliveryAcceptance: { outcome: "PARTIALLY_ACCEPTED" } });
    const batch = await prisma.cropBatch.findUniqueOrThrow({ where: { id: "11111111-1111-4111-8111-111111111111" } });
    const prediction = await prisma.yieldPrediction.findUniqueOrThrow({ where: { id: batch.latestPredictionId! } });
    expect(prediction.actualQuantity).toBe(13);
    expect(prediction.absoluteError).not.toBeNull();
    const orderTrace = await server.inject({ method: "GET", url: `/v1/agent-traces/${completed.json().traceId}`, headers: auth("buyer-hotel") });
    expect(orderTrace.json()).toMatchObject({ workflowType: "ORDER_FULFILMENT", stage: "DELIVERY_OUTCOME_RECORDED", status: "COMPLETED" });
  });

  it("does not double-count one batch and invalidates stale supply without partial reservations", async () => {
    const batchId = "11111111-1111-4111-8111-111111111111";
    const firstListingId = "16161616-1616-4616-8616-161616161616";
    await prisma.cropBatch.update({ where: { id: batchId }, data: { availableToPromise: 4 } });
    await prisma.listing.update({ where: { id: firstListingId }, data: { quantity: 4, status: "ACTIVE" } });
    const secondListingId = randomUUID();
    await prisma.listing.create({
      data: { id: secondListingId, cropBatchId: batchId, farmerId: "a0000000-0000-4000-8000-000000000001", cropType: "CUCUMBER", quantity: 4, unitPrice: 7, currency: "XCD", availableFrom: new Date("2026-09-05T00:00:00Z"), availableUntil: new Date("2026-09-08T00:00:00Z"), status: "ACTIVE" },
    });
    const orderPayload = { cropType: "CUCUMBER", neededBy: "2026-09-07T12:00:00Z", deliveryLocation: { latitude: 14.0101, longitude: -60.9875 }, listingIds: [firstListingId, secondListingId] };
    const uncovered = await server.inject({ method: "POST", url: "/v1/orders", headers: mutationHeaders("buyer-hotel", "shared-batch-uncovered"), payload: { ...orderPayload, requestedQuantity: { value: 6, unit: "kg" } } });
    expect(uncovered.statusCode).toBe(201);
    const uncoveredOrder = await prisma.order.findUniqueOrThrow({ where: { id: uncovered.json().orderId } });
    expect(uncoveredOrder).toMatchObject({ lifecycleStatus: "REQUESTED", atRisk: false });
    expect(await prisma.allocation.count({ where: { orderId: uncoveredOrder.id } })).toBe(0);

    const proposed = await server.inject({ method: "POST", url: "/v1/orders", headers: mutationHeaders("buyer-hotel", "stale-supply-order"), payload: { ...orderPayload, requestedQuantity: { value: 4, unit: "kg" } } });
    const proposedOrderId = proposed.json().orderId as string;
    const buyerApproval = (await server.inject({ method: "GET", url: "/v1/approvals?status=PENDING", headers: auth("buyer-hotel") })).json().items.find((item: { context?: { orderId?: string } }) => item.context?.orderId === proposedOrderId);
    const farmerApproval = (await server.inject({ method: "GET", url: "/v1/approvals?status=PENDING", headers: auth("farmer-ana") })).json().items.find((item: { context?: { orderId?: string } }) => item.context?.orderId === proposedOrderId);
    expect((await decide("buyer-hotel", buyerApproval.approvalId, "APPROVE")).statusCode).toBe(200);
    await prisma.cropBatch.update({ where: { id: batchId }, data: { availableToPromise: 0 } });
    expect((await decide("farmer-ana", farmerApproval.approvalId, "APPROVE")).statusCode).toBe(200);
    const allocation = await prisma.allocation.findFirstOrThrow({ where: { orderId: proposedOrderId }, orderBy: { createdAt: "desc" } });
    expect(allocation.status).toBe("STALE");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: proposedOrderId } })).lifecycleStatus).toBe("REQUESTED");
    expect(await prisma.reservation.count({ where: { allocationId: allocation.id } })).toBe(0);
  });

  it("records coordinator verification, protects traces, and restricts technical simulation routes", async () => {
    const tasks = (await server.inject({ method: "GET", url: "/v1/verification-tasks?status=OPEN", headers: auth("coordinator-maya") })).json().items;
    const latest = tasks.find((task: { subjectId: string }) => task.subjectId !== "12121212-1212-4212-8212-121212121212");
    const decision = await server.inject({ method: "POST", url: `/v1/verification-tasks/${latest.taskId}/decisions`, headers: mutationHeaders("coordinator-maya", "verify-observation"), payload: { decision: "VERIFY", note: "Field update confirmed." } });
    expect(decision.statusCode).toBe(200);
    expect(decision.json().status).toBe("VERIFIED");

    const cropTrace = await prisma.agentTrace.findFirstOrThrow({ where: { subjectType: "CROP_BATCH", subjectId: "11111111-1111-4111-8111-111111111111" }, orderBy: { createdAt: "desc" } });
    const hiddenTrace = await server.inject({ method: "GET", url: `/v1/agent-traces/${cropTrace.id}`, headers: auth("farmer-marcus") });
    expect(hiddenTrace.statusCode).toBe(404);

    for (const url of ["/v1/operations/snapshot", "/v1/simulation-runs", "/v1/simulation-runs/99999999-9999-4999-8999-999999999999", "/v1/paired-runs/99999999-9999-4999-8999-999999999999"]) {
      const response = await server.inject({ method: "GET", url, headers: auth("buyer-hotel") });
      expect(response.statusCode).toBe(403);
    }
  });

  it("replays an idempotent demand and rejects a changed body", async () => {
    const payload = { cropType: "DASHEEN", quantity: { value: 10, unit: "kg" }, neededBy: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), deliveryLocation: { latitude: 14.0101, longitude: -60.9875 } };
    const headers = { ...auth("buyer-hotel"), "idempotency-key": "test-demand-replay" };
    const first = await server.inject({ method: "POST", url: "/v1/buyer-demands", headers, payload });
    const replay = await server.inject({ method: "POST", url: "/v1/buyer-demands", headers, payload });
    expect(first.statusCode).toBe(201);
    expect(replay.json()).toEqual(first.json());
    const conflict = await server.inject({ method: "POST", url: "/v1/buyer-demands", headers, payload: { ...payload, quantity: { value: 11, unit: "kg" } } });
    expect(conflict.statusCode).toBe(409);
  });

  it("creates immutable replayable runs, derived runs, and deterministic pairs", async () => {
    const payload = {
      scenarioId: "saint-lucia-demo-v1",
      policy: "HARVEST",
      seed: 42,
      decisionMode: "DETERMINISTIC",
      scope: { mode: "SELECTED", islandIds: ["saint-lucia"] },
    };
    const headers = { ...auth("operations-demo"), "idempotency-key": "simulation-run-seed-42" };

    const scenarios = await server.inject({ method: "GET", url: "/v1/simulation-scenarios", headers: auth("operations-demo") });
    expect(scenarios.statusCode).toBe(200);
    expect(scenarios.json().items[0]).toMatchObject({
      scenarioId: "saint-lucia-demo-v1",
      availableDecisionModes: ["DETERMINISTIC", "LLM_ASSISTED"],
      islands: [{ islandId: "saint-lucia", countryCode: "LC" }],
    });
    const focusedCaribbeanScenarios = scenarios.json().items.filter((scenario: { scenarioId: string }) => scenario.scenarioId.startsWith("caribbean-") && scenario.scenarioId !== "caribbean-islands-v1");
    expect(focusedCaribbeanScenarios).toHaveLength(28);
    expect(focusedCaribbeanScenarios.every((scenario: { islands: unknown[] }) => scenario.islands.length === 1)).toBe(true);

    const fixtureLlm = await server.inject({
      method: "POST",
      url: "/v1/simulation-runs",
      headers: mutationHeaders("operations-demo", "llm-run"),
      payload: { ...payload, decisionMode: "LLM_ASSISTED" },
    });
    expect(fixtureLlm.statusCode).toBe(201);
    expect(fixtureLlm.json()).toMatchObject({ decisionMode: "LLM_ASSISTED", decisionAdapter: "fixture", status: "COMPLETED" });

    const created = await server.inject({ method: "POST", url: "/v1/simulation-runs", headers, payload });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      scenarioId: payload.scenarioId,
      policy: "HARVEST",
      seed: 42,
      decisionMode: "DETERMINISTIC",
      decisionAdapter: "deterministic",
      status: "COMPLETED",
      resolvedIslandIds: ["saint-lucia"],
      evidenceLabel: expect.stringContaining("SYNTHETIC"),
    });
    expect(created.json().frameCount).toBeGreaterThan(20);
    expect(created.json()).toMatchObject({ frameCount: 130, metrics: { eventsProcessed: 82 } });
    const runId = created.json().runId as string;

    const replayedRequest = await server.inject({ method: "POST", url: "/v1/simulation-runs", headers, payload });
    expect(replayedRequest.json()).toEqual(created.json());
    const changedRequest = await server.inject({ method: "POST", url: "/v1/simulation-runs", headers, payload: { ...payload, seed: 43 } });
    expect(changedRequest.statusCode).toBe(409);

    const run = await server.inject({ method: "GET", url: `/v1/simulation-runs/${runId}`, headers: auth("operations-demo") });
    expect(run.statusCode).toBe(200);
    expect(run.body).not.toContain("determinismDigest");
    expect(run.body).not.toContain("potentialYieldKg");

    const timeline = await server.inject({ method: "GET", url: `/v1/simulation-runs/${runId}/timeline`, headers: auth("operations-demo") });
    expect(timeline.statusCode).toBe(200);
    expect(timeline.json().frames).toHaveLength(created.json().frameCount);
    expect(timeline.json().scene.runId).toBe(runId);
    expect(timeline.json().scene.participants.every((participant: { productActorId: string | null }) => participant.productActorId)).toBe(true);
    expect(timeline.json().scene.referencePlaces).toHaveLength(13);
    expect(timeline.json().scene.referenceDataSources).toMatchObject([{
      sourceId: "openstreetmap-v1",
      licenceName: "Open Data Commons Open Database License 1.0",
    }]);
    const referenceIds = new Set(timeline.json().scene.referencePlaces.map((place: { referencePlaceId: string }) => place.referencePlaceId));
    const actors = [...timeline.json().scene.farms, ...timeline.json().scene.buyers, ...timeline.json().scene.transporters];
    expect(actors.filter((actor: { referencePlaceId?: string }) => actor.referencePlaceId)).toHaveLength(4);
    expect(actors.every((actor: { referencePlaceId?: string }) => !actor.referencePlaceId || referenceIds.has(actor.referencePlaceId))).toBe(true);
    expect(timeline.json().frames.some((frame: { agentActions?: unknown[] }) => (frame.agentActions?.length ?? 0) > 0)).toBe(true);
    expect(timeline.json().frames.every((frame: { operationsSnapshot?: unknown }) => frame.operationsSnapshot)).toBe(true);
    const finalFrame = timeline.json().frames.at(-1);
    expect(finalFrame).toMatchObject({ eventType: "RUN_SETTLED", at: created.json().endedAt });
    expect(finalFrame.operationsSnapshot.orderOutcomes).toMatchObject({ total: 11, fulfilled: 2, partiallyFulfilled: 0, unfulfilled: 8, pending: 1 });
    for (const forbidden of ["potentialYieldKg", "qualityFraction", "dailySpoilageRate", "severity"]) {
      expect(timeline.body).not.toContain(forbidden);
    }

    const firstFrame = await server.inject({ method: "GET", url: `/v1/simulation-runs/${runId}/world?frameIndex=0`, headers: auth("operations-demo") });
    expect(firstFrame.statusCode).toBe(200);
    expect(firstFrame.json()).toMatchObject({ runId, frameIndex: 0, frameCount: created.json().frameCount });
    const invalidFrame = await server.inject({ method: "GET", url: `/v1/simulation-runs/${runId}/world?frameIndex=${created.json().frameCount}`, headers: auth("operations-demo") });
    expect(invalidFrame.statusCode).toBe(422);

    const reproducible = await server.inject({
      method: "POST",
      url: "/v1/simulation-runs",
      headers: mutationHeaders("operations-demo", "same-seed-run"),
      payload,
    });
    expect(reproducible.statusCode).toBe(201);
    expect(reproducible.json().runId).not.toBe(runId);
    const [storedFirst, storedSecond] = await Promise.all([
      prisma.simulationRun.findUniqueOrThrow({ where: { id: runId } }),
      prisma.simulationRun.findUniqueOrThrow({ where: { id: reproducible.json().runId } }),
    ]);
    expect(storedSecond.determinismDigest).toBe(storedFirst.determinismDigest);
    expect(storedSecond.metrics).toEqual(storedFirst.metrics);
    const repeatedTimeline = await server.inject({
      method: "GET",
      url: `/v1/simulation-runs/${reproducible.json().runId}/timeline`,
      headers: auth("operations-demo"),
    });
    const normalizeFrames = (frames: Array<Record<string, unknown>>) => frames.map((frame) => {
      const snapshot = frame.operationsSnapshot as {
        activeListings: number;
        openDemands: number;
        ordersByStatus: Record<string, number>;
        orderOutcomes: Record<string, number>;
        deliveryAcceptedKg: number;
        approvedCommitmentCount: number;
        completedMissionCount: number;
        activeMissionIds: string[];
        openExceptionIds: string[];
      } | undefined;
      return {
        at: frame.at,
        eventType: frame.eventType,
        actors: frame.actors,
        missions: frame.missions,
        batches: frame.batches,
        demands: frame.demands,
        disruptions: frame.disruptions,
        degradedRoadSegmentIds: frame.degradedRoadSegmentIds,
        newDecisions: frame.newDecisions,
        totals: frame.totals,
        agentActions: (frame.agentActions as Array<Record<string, unknown>> | undefined)?.map((action) => ({
          at: action.at,
          simulationActorId: action.simulationActorId,
          role: action.role,
          toolName: action.toolName,
          status: action.status,
          adapter: action.adapter,
        })) ?? [],
        operationsSnapshot: snapshot ? {
          activeListings: snapshot.activeListings,
          openDemands: snapshot.openDemands,
          ordersByStatus: snapshot.ordersByStatus,
          orderOutcomes: snapshot.orderOutcomes,
          deliveryAcceptedKg: snapshot.deliveryAcceptedKg,
          approvedCommitmentCount: snapshot.approvedCommitmentCount,
          completedMissionCount: snapshot.completedMissionCount,
          activeMissions: snapshot.activeMissionIds.length,
          openExceptions: snapshot.openExceptionIds.length,
        } : null,
      };
    });
    expect(normalizeFrames(repeatedTimeline.json().frames)).toEqual(normalizeFrames(timeline.json().frames));

    const connectedCounts = await Promise.all([
      prisma.actor.count({ where: { simulationRunId: runId } }),
      prisma.cropObservation.count({ where: { simulationRunId: runId } }),
      prisma.listing.count({ where: { simulationRunId: runId } }),
      prisma.order.count({ where: { simulationRunId: runId } }),
      prisma.approval.count({ where: { simulationRunId: runId } }),
      prisma.deliveryMission.count({ where: { simulationRunId: runId } }),
      prisma.deliveryUpdate.count({ where: { simulationRunId: runId } }),
      prisma.deliveryAcceptance.count({ where: { simulationRunId: runId } }),
      prisma.domainEvent.count({ where: { simulationRunId: runId } }),
      prisma.agentTrace.count({ where: { simulationRunId: runId } }),
    ]);
    expect(connectedCounts.every((count) => count > 0)).toBe(true);

    const derived = await server.inject({
      method: "POST",
      url: "/v1/simulation-runs",
      headers: mutationHeaders("operations-demo", "derived-storm"),
      payload: {
        derivedFromRunId: runId,
        disruptions: [{
          type: "WEATHER",
          offsetMs: 0,
          durationMs: 1_814_400_000,
          affectedEntityIds: ["all"],
          publicDescription: "Synthetic storm introduced for a derived replay.",
        }],
      },
    });
    expect(derived.statusCode).toBe(201);
    expect(derived.json()).toMatchObject({ derivedFromRunId: runId, status: "COMPLETED" });
    expect(derived.json().disruptions).toHaveLength(1);
    expect((await prisma.simulationRun.findUniqueOrThrow({ where: { id: runId } })).disruptions).toEqual([]);

    const derivedTimeline = await server.inject({
      method: "GET",
      url: `/v1/simulation-runs/${derived.json().runId}/timeline`,
      headers: auth("operations-demo"),
    });
    expect(derivedTimeline.statusCode).toBe(200);
    const derivedActions = derivedTimeline.json().frames.flatMap((frame: { agentActions?: Array<{ toolName: string }> }) => frame.agentActions ?? []);
    expect(derivedActions.some((action: { toolName: string }) => action.toolName === "report_exception")).toBe(true);

    const horizonInjection = await server.inject({
      method: "POST",
      url: "/v1/simulation-runs",
      headers: mutationHeaders("operations-demo", "derived-at-horizon"),
      payload: {
        derivedFromRunId: runId,
        disruptions: [{
          type: "WEATHER",
          offsetMs: 1_814_400_000,
          durationMs: 86_400_000,
          affectedEntityIds: ["all"],
          publicDescription: "This starts too late to affect the scenario.",
        }],
      },
    });
    expect(horizonInjection.statusCode).toBe(422);
    expect(horizonInjection.json()).toMatchObject({ code: "INVALID_DISRUPTION" });

    const pair = await server.inject({
      method: "POST",
      url: "/v1/paired-runs",
      headers: mutationHeaders("operations-demo", "paired-seed-42"),
      payload: { scenarioId: payload.scenarioId, seed: 42, decisionMode: "DETERMINISTIC", scope: payload.scope },
    });
    expect(pair.statusCode).toBe(201);
    expect(pair.json()).toMatchObject({ status: "COMPLETED", evidenceLabel: expect.stringContaining("SYNTHETIC") });
    expect(pair.json().baselineRunId).not.toBe(pair.json().harvestRunId);
    expect(pair.json().result).toHaveProperty("baseline.fulfilmentRate");
    expect(pair.json().result).toHaveProperty("harvest.fulfilmentRate");
    expect(pair.json().result).toHaveProperty("delta.wasteQuantity.value");

    const list = await server.inject({ method: "GET", url: "/v1/simulation-runs?limit=2", headers: auth("operations-demo") });
    expect(list.statusCode).toBe(200);
    expect(list.json().items).toHaveLength(2);
    expect(await prisma.simulationActorMapping.count({ where: { simulationRunId: runId, productActorId: { not: null } } })).toBeGreaterThan(0);

    const realSnapshot = await server.inject({ method: "GET", url: "/v1/operations/snapshot", headers: auth("operations-demo") });
    const runSnapshot = await server.inject({ method: "GET", url: `/v1/operations/snapshot?simulationRunId=${runId}`, headers: auth("operations-demo") });
    expect(realSnapshot.statusCode).toBe(200);
    expect(realSnapshot.json()).not.toHaveProperty("simulationRunId");
    const { generatedAt: _generatedAt, ...finalStoredSnapshot } = finalFrame.operationsSnapshot;
    expect(runSnapshot.json()).toMatchObject({ simulationRunId: runId, ...finalStoredSnapshot });
    expect(runSnapshot.json().generatedAt).toEqual(expect.any(String));
    expect(runSnapshot.json().orderOutcomes.total).toBeGreaterThan(0);
    const outcomes = runSnapshot.json().orderOutcomes;
    expect(outcomes.fulfilled + outcomes.partiallyFulfilled + outcomes.unfulfilled + outcomes.pending).toBe(outcomes.total);
    const [acceptedDelivery, approvedCommitments, completedMissions] = await Promise.all([
      prisma.deliveryAcceptance.aggregate({ where: { simulationRunId: runId }, _sum: { acceptedQuantity: true } }),
      prisma.allocation.count({ where: { simulationRunId: runId, status: "APPROVED" } }),
      prisma.deliveryMission.count({ where: { simulationRunId: runId, status: { in: ["DELIVERED", "COMPLETED"] } } }),
    ]);
    expect(runSnapshot.json().deliveryAcceptedKg).toBe(acceptedDelivery._sum.acceptedQuantity ?? 0);
    expect(runSnapshot.json().deliveryAcceptedKg).toBe(created.json().metrics.totalAcceptedKg);
    expect(runSnapshot.json().approvedCommitmentCount).toBe(approvedCommitments);
    expect(runSnapshot.json().completedMissionCount).toBe(completedMissions);

    const buyerMapping = await prisma.simulationActorMapping.findFirstOrThrow({ where: { simulationRunId: runId, role: "BUYER", productActorId: { not: null } } });
    const participantSession = await server.inject({
      method: "POST",
      url: `/v1/simulation-runs/${runId}/participant-sessions`,
      headers: mutationHeaders("operations-demo", "participant-replay"),
      payload: { productActorId: buyerMapping.productActorId },
    });
    expect(participantSession.statusCode).toBe(201);
    const participantAuth = { authorization: `Bearer ${participantSession.json().accessToken}` };
    const me = await server.inject({ method: "GET", url: "/v1/me", headers: participantAuth });
    expect(me.json()).toMatchObject({ role: "BUYER", synthetic: true, simulationRunId: runId, readOnly: true });
    const blockedMutation = await server.inject({
      method: "POST",
      url: "/v1/buyer-demands",
      headers: { ...participantAuth, "idempotency-key": "blocked-replay-mutation" },
      payload: { cropType: "CARROT", quantity: { value: 1, unit: "kg" }, neededBy: "2026-09-20T10:00:00Z", deliveryLocation: { latitude: 14, longitude: -61 } },
    });
    expect(blockedMutation.statusCode).toBe(409);
    expect(blockedMutation.json().code).toBe("SIMULATION_RUN_IMMUTABLE");

    const baselineWorkflowCounts = await Promise.all([
      prisma.actor.count({ where: { simulationRunId: pair.json().baselineRunId } }),
      prisma.listing.count({ where: { simulationRunId: pair.json().baselineRunId } }),
      prisma.buyerDemand.count({ where: { simulationRunId: pair.json().baselineRunId } }),
      prisma.order.count({ where: { simulationRunId: pair.json().baselineRunId } }),
      prisma.allocation.count({ where: { simulationRunId: pair.json().baselineRunId } }),
      prisma.deliveryMission.count({ where: { simulationRunId: pair.json().baselineRunId } }),
      prisma.domainEvent.count({ where: { simulationRunId: pair.json().baselineRunId } }),
    ]);
    expect(baselineWorkflowCounts.every((count) => count === 0)).toBe(true);
  }, 90_000);

  it("keeps marketplace records isolated between real users and simulation runs", async () => {
    const runs = await prisma.simulationRun.findMany({ where: { status: "COMPLETED" }, take: 2, orderBy: { createdAt: "asc" } });
    expect(runs).toHaveLength(2);
    const createdIds: string[] = [];
    try {
      for (const [index, run] of runs.entries()) {
        const farmerId = randomUUID();
        const buyerId = randomUUID();
        const farmId = randomUUID();
        const batchId = randomUUID();
        const listingId = randomUUID();
        createdIds.push(listingId, batchId, farmId, farmerId, buyerId);
        await prisma.actor.createMany({ data: [
          { id: farmerId, authSubject: `sim-farmer-${index}`, name: `Sim Farmer ${index}`, role: "FARMER", isSynthetic: true, simulationRunId: run.id },
          { id: buyerId, authSubject: `sim-buyer-${index}`, name: `Sim Buyer ${index}`, role: "BUYER", isSynthetic: true, simulationRunId: run.id },
        ] });
        await prisma.farm.create({ data: { id: farmId, name: `Run ${index} Farm`, farmerId, latitude: 13.95, longitude: -61, simulationRunId: run.id } });
        await prisma.cropBatch.create({ data: { id: batchId, farmId, cropType: "CUCUMBER", status: "HARVEST_READY", availableToPromise: 10, provenance: "SYNTHETIC", simulationRunId: run.id } });
        await prisma.listing.create({ data: { id: listingId, cropBatchId: batchId, farmerId, cropType: "CUCUMBER", quantity: 10, unitPrice: 5, availableFrom: new Date("2026-09-01"), availableUntil: new Date("2026-10-01"), status: "ACTIVE", simulationRunId: run.id } });
        await signIn(`sim-buyer-${index}`);
      }

      const first = await server.inject({ method: "GET", url: "/v1/listings", headers: auth("sim-buyer-0") });
      const second = await server.inject({ method: "GET", url: "/v1/listings", headers: auth("sim-buyer-1") });
      const real = await server.inject({ method: "GET", url: "/v1/listings", headers: auth("buyer-hotel") });
      const firstIds = first.json().items.map((item: { listingId: string }) => item.listingId);
      const secondIds = second.json().items.map((item: { listingId: string }) => item.listingId);
      expect(firstIds).toContain(createdIds[0]);
      expect(firstIds).not.toContain(createdIds[5]);
      expect(secondIds).toContain(createdIds[5]);
      expect(secondIds).not.toContain(createdIds[0]);
      expect(real.json().items.every((item: { listingId: string }) => !createdIds.includes(item.listingId))).toBe(true);
    } finally {
      await prisma.listing.deleteMany({ where: { id: { in: createdIds } } });
      await prisma.cropBatch.deleteMany({ where: { id: { in: createdIds } } });
      await prisma.farm.deleteMany({ where: { id: { in: createdIds } } });
      await prisma.actor.deleteMany({ where: { id: { in: createdIds } } });
    }
  });

  it("replays SSE events strictly after the monotonic Last-Event-ID cursor", async () => {
    const readEvents = async (lastEventId?: string) => {
      const controller = new AbortController();
      const response = await fetch(`${apiBaseUrl}/v1/events/stream`, {
        headers: {
          ...auth("operations-demo"),
          ...(lastEventId ? { "Last-Event-ID": lastEventId } : {}),
        },
        signal: controller.signal,
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let text = "";
      for (let attempt = 0; attempt < 5 && (text.match(/^id: /gm)?.length ?? 0) < 2; attempt += 1) {
        const chunk = await reader.read();
        if (chunk.done) break;
        text += decoder.decode(chunk.value, { stream: true });
      }
      controller.abort();
      await reader.cancel().catch(() => undefined);
      return text;
    };

    const initial = await readEvents();
    const initialIds = [...initial.matchAll(/^id: (\d+)$/gm)].map((match) => BigInt(match[1]!));
    expect(initialIds.length).toBeGreaterThan(1);
    expect(new Set(initialIds.map(String)).size).toBe(initialIds.length);
    expect(initialIds).toEqual([...initialIds].sort((a, b) => (a < b ? -1 : 1)));
    expect(initial).toMatch(/^data: \{"eventId":"[0-9a-f-]+","eventType":/m);

    const resumed = await readEvents(initialIds[0]!.toString());
    const resumedIds = [...resumed.matchAll(/^id: (\d+)$/gm)].map((match) => BigInt(match[1]!));
    expect(resumedIds.length).toBeGreaterThan(0);
    expect(resumedIds.every((cursor) => cursor > initialIds[0]!)).toBe(true);
    expect(resumedIds).not.toContain(initialIds[0]);
  });
});
