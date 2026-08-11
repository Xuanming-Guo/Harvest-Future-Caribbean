import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "../src/db.js";
import { buildServer } from "../src/server.js";

const server = await buildServer();
const tokens: Record<string, string> = {};

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
  await server.ready();
  for (const persona of ["buyer-hotel", "farmer-ana", "farmer-marcus", "transporter-daniel", "coordinator-maya"]) await signIn(persona);
});

afterAll(async () => server.close());

describe("participant Product API", () => {
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

  it("records coordinator verification, protects traces, and keeps planned simulation routes unserved", async () => {
    const tasks = (await server.inject({ method: "GET", url: "/v1/verification-tasks?status=OPEN", headers: auth("coordinator-maya") })).json().items;
    const latest = tasks.find((task: { subjectId: string }) => task.subjectId !== "12121212-1212-4212-8212-121212121212");
    const decision = await server.inject({ method: "POST", url: `/v1/verification-tasks/${latest.taskId}/decisions`, headers: mutationHeaders("coordinator-maya", "verify-observation"), payload: { decision: "VERIFY", note: "Field update confirmed." } });
    expect(decision.statusCode).toBe(200);
    expect(decision.json().status).toBe("VERIFIED");

    const cropTrace = await prisma.agentTrace.findFirstOrThrow({ where: { subjectType: "CROP_BATCH", subjectId: "11111111-1111-4111-8111-111111111111" }, orderBy: { createdAt: "desc" } });
    const hiddenTrace = await server.inject({ method: "GET", url: `/v1/agent-traces/${cropTrace.id}`, headers: auth("farmer-marcus") });
    expect(hiddenTrace.statusCode).toBe(404);

    for (const url of ["/v1/operations/snapshot", "/v1/events/stream", "/v1/simulation-runs/99999999-9999-4999-8999-999999999999", "/v1/paired-runs/99999999-9999-4999-8999-999999999999"]) {
      const response = await server.inject({ method: "GET", url, headers: auth("buyer-hotel") });
      expect(response.statusCode).toBe(404);
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
});
