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

async function decide(persona: string, approvalId: string, decision: "APPROVE" | "REJECT", reason?: Record<string, unknown>) {
  return server.inject({
    method: "POST",
    url: `/v1/approvals/${approvalId}/decisions`,
    headers: mutationHeaders(persona, `decision-${decision.toLowerCase()}`),
    payload: { decision, ...(decision === "REJECT" ? { reasonCode: "MISSING_INFORMATION", nextAction: "Send an updated crop photograph before the next order." } : {}), ...reason },
  });
}

function cropStandardPayload(status: "DRAFT" | "PUBLISHED" = "PUBLISHED") {
  return {
    cropType: "PAPAYA",
    status,
    reviewedAt: "2026-09-03T12:00:00Z",
    geography: "Saint Lucia test reference",
    source: { title: "Test quality reference", url: "https://example.com/papaya-quality", licence: "Test reference", retrievedAt: "2026-09-03" },
    checklist: [{ key: "MATURITY_AND_APPEARANCE", requirement: "Fruit must meet the buyer's agreed maturity and appearance." }],
    images: [],
    guidance: [{ topic: "HARVEST_READINESS", text: "Use the documented maturity indicators in the cited reference.", source: { title: "Test harvest reference", url: "https://example.com/papaya-harvest", retrievedAt: "2026-09-03" } }],
  };
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
    expect(ana.json().items[0].latestDecision).toMatchObject({
      source: "DELIVERY",
      reasonCode: "SIZE_OR_GRADE",
      nextAction: "Grade cucumbers to at least 15 cm before the next pickup and keep smaller fruit for the local market.",
    });
    const anaHistory = await server.inject({ method: "GET", url: "/v1/orders?cropBatchId=11111111-1111-4111-8111-111111111111", headers: auth("farmer-ana") });
    expect(anaHistory.json().items.map((item: { orderId: string }) => item.orderId)).toContain("20202020-2020-4020-8020-202020202021");
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

  it("versions sourced crop standards, lists them by crop, and snapshots the latest published version on orders", async () => {
    const first = await server.inject({ method: "POST", url: "/v1/crop-standards", headers: mutationHeaders("buyer-hotel", "papaya-standard-one"), payload: cropStandardPayload() });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ cropType: "PAPAYA", publisherName: "Bay Gardens Hotel", version: 1, status: "PUBLISHED" });

    const second = await server.inject({ method: "POST", url: "/v1/crop-standards", headers: mutationHeaders("buyer-hotel", "papaya-standard-two"), payload: cropStandardPayload() });
    expect(second.statusCode).toBe(201);
    expect(second.json().version).toBe(2);

    const draft = await server.inject({ method: "POST", url: "/v1/crop-standards", headers: mutationHeaders("buyer-hotel", "papaya-standard-draft"), payload: cropStandardPayload("DRAFT") });
    expect(draft.statusCode).toBe(201);
    expect(draft.json()).toMatchObject({ version: 3, status: "DRAFT" });

    const buyerList = await server.inject({ method: "GET", url: "/v1/crop-standards?cropType=papaya", headers: auth("buyer-hotel") });
    expect(buyerList.statusCode).toBe(200);
    expect(buyerList.json().items.map((item: { version: number }) => item.version)).toEqual([3, 2, 1]);
    const farmerList = await server.inject({ method: "GET", url: "/v1/crop-standards?cropType=PAPAYA", headers: auth("farmer-ana") });
    expect(farmerList.statusCode).toBe(200);
    expect(farmerList.json().items.map((item: { version: number }) => item.version)).toEqual([2, 1]);

    const order = await server.inject({
      method: "POST",
      url: "/v1/orders",
      headers: mutationHeaders("buyer-hotel", "papaya-order"),
      payload: { cropType: "PAPAYA", requestedQuantity: { value: 1, unit: "kg" }, neededBy: new Date(Date.now() + 86_400_000).toISOString(), deliveryLocation: { latitude: 14.0101, longitude: -60.9875 } },
    });
    expect(order.statusCode).toBe(201);
    expect(order.json().cropStandardId).toBe(second.json().standardId);

    const chemical = await server.inject({
      method: "POST",
      url: "/v1/crop-standards",
      headers: mutationHeaders("buyer-hotel", "papaya-standard-chemical"),
      payload: { ...cropStandardPayload(), checklist: [{ key: "CLEANING", requirement: "Rinse with bleach before packing." }] },
    });
    expect(chemical.statusCode).toBe(422);
    expect(chemical.json().code).toBe("CHEMICAL_GUIDANCE_NOT_REVIEWED");

    const chemicalGuidance = await server.inject({
      method: "POST",
      url: "/v1/crop-standards",
      headers: mutationHeaders("buyer-hotel", "papaya-guidance-chemical"),
      payload: { ...cropStandardPayload(), guidance: [{ topic: "HARVEST_READINESS", text: "Apply a pesticide dose before harvest.", source: { title: "Test harvest reference", url: "https://example.com/papaya-harvest", retrievedAt: "2026-09-03" } }] },
    });
    expect(chemicalGuidance.statusCode).toBe(422);
    expect(chemicalGuidance.json().code).toBe("CHEMICAL_GUIDANCE_NOT_REVIEWED");

    const farmerPost = await server.inject({ method: "POST", url: "/v1/crop-standards", headers: mutationHeaders("farmer-ana", "farmer-standard"), payload: cropStandardPayload() });
    expect(farmerPost.statusCode).toBe(403);
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

    const acceptanceLines = [
      { cropBatchId: "11111111-1111-4111-8111-111111111111", acceptedQuantity: { value: 13, unit: "kg" }, rejectedQuantity: { value: 1, unit: "kg" } },
      { cropBatchId: "11111111-1111-4111-8111-111111111112", acceptedQuantity: { value: 5, unit: "kg" }, rejectedQuantity: { value: 1, unit: "kg" } },
    ];
    const unexplained = await server.inject({
      method: "POST",
      url: `/v1/deliveries/${missionId}/acceptance`,
      headers: mutationHeaders("buyer-hotel", "unexplained-rejection"),
      payload: { outcome: "PARTIALLY_ACCEPTED", acceptedQuantity: { value: 18, unit: "kg" }, rejectedQuantity: { value: 2, unit: "kg" }, lineOutcomes: acceptanceLines, note: "Two kilograms did not meet the agreed quality." },
    });
    expect(unexplained.statusCode).toBe(422);
    expect(unexplained.json().code).toBe("DECISION_REASON_REQUIRED");
    expect(await prisma.deliveryAcceptance.findUnique({ where: { orderId } })).toBeNull();

    const acceptance = await server.inject({
      method: "POST",
      url: `/v1/deliveries/${missionId}/acceptance`,
      headers: mutationHeaders("buyer-hotel", "partial-acceptance"),
      payload: {
        outcome: "PARTIALLY_ACCEPTED",
        acceptedQuantity: { value: 18, unit: "kg" },
        rejectedQuantity: { value: 2, unit: "kg" },
        lineOutcomes: [{ ...acceptanceLines[0], reasonCode: "DAMAGE", nextAction: "Pack the crates with more padding for the next pickup." }, acceptanceLines[1]],
        note: "Two kilograms did not meet the agreed quality.",
        reasonCode: "MATURITY_OR_QUALITY",
        nextAction: "Harvest one day later so the fruit reaches full size.",
      },
    });
    expect(acceptance.statusCode).toBe(201);
    expect(acceptance.json()).toMatchObject({ reasonCode: "MATURITY_OR_QUALITY", nextAction: "Harvest one day later so the fruit reaches full size." });
    expect(acceptance.json().lineOutcomes[0]).toMatchObject({ reasonCode: "DAMAGE", nextAction: "Pack the crates with more padding for the next pickup." });
    expect(acceptance.json().lineOutcomes[1]).toMatchObject({ reasonCode: "MATURITY_OR_QUALITY" });
    const completed = await server.inject({ method: "GET", url: `/v1/orders/${orderId}`, headers: auth("buyer-hotel") });
    expect(completed.json()).toMatchObject({ lifecycleStatus: "PARTIALLY_FULFILLED", acceptedQuantity: { value: 18, unit: "kg" }, deliveryAcceptance: { outcome: "PARTIALLY_ACCEPTED", reasonCode: "MATURITY_OR_QUALITY", nextAction: "Harvest one day later so the fruit reaches full size." } });
    expect(completed.json().outcomeCause).toBe("DELIVERY_REJECTED");
    expect(completed.json().outcomeNote).toContain("MATURITY_OR_QUALITY");

    const anaBatch = await server.inject({ method: "GET", url: "/v1/crop-batches/11111111-1111-4111-8111-111111111111", headers: auth("farmer-ana") });
    expect(anaBatch.json().latestDecision).toMatchObject({ source: "DELIVERY", reasonCode: "DAMAGE", nextAction: "Pack the crates with more padding for the next pickup." });
    const marcusBatch = await server.inject({ method: "GET", url: "/v1/crop-batches/11111111-1111-4111-8111-111111111112", headers: auth("farmer-marcus") });
    expect(marcusBatch.json().latestDecision).toMatchObject({ source: "DELIVERY", reasonCode: "MATURITY_OR_QUALITY" });
    const journey = await server.inject({ method: "GET", url: "/v1/orders?cropBatchId=11111111-1111-4111-8111-111111111112", headers: auth("farmer-marcus") });
    expect(journey.json().items.map((item: { orderId: string }) => item.orderId)).toEqual([orderId]);
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

  it("refuses a declined approval without an actionable reason and records one with it", async () => {
    const batchId = "11111111-1111-4111-8111-111111111111";
    await prisma.cropBatch.update({ where: { id: batchId }, data: { availableToPromise: 5, status: "HARVEST_READY" } });
    const listingId = randomUUID();
    await prisma.listing.create({
      data: { id: listingId, cropBatchId: batchId, farmerId: "a0000000-0000-4000-8000-000000000001", cropType: "CUCUMBER", quantity: 5, unitPrice: 7, currency: "XCD", availableFrom: new Date("2026-09-05T00:00:00Z"), availableUntil: new Date("2026-09-08T00:00:00Z"), status: "ACTIVE" },
    });
    const created = await server.inject({
      method: "POST",
      url: "/v1/orders",
      headers: mutationHeaders("buyer-hotel", "declined-order"),
      payload: { cropType: "CUCUMBER", requestedQuantity: { value: 5, unit: "kg" }, neededBy: "2026-09-07T12:00:00Z", deliveryLocation: { latitude: 14.0101, longitude: -60.9875 }, listingIds: [listingId] },
    });
    const declinedOrderId = created.json().orderId as string;
    const approval = (await server.inject({ method: "GET", url: "/v1/approvals?status=PENDING", headers: auth("farmer-ana") })).json().items
      .find((item: { context?: { orderId?: string } }) => item.context?.orderId === declinedOrderId);
    expect(approval).toBeTruthy();

    const unexplained = await server.inject({ method: "POST", url: `/v1/approvals/${approval.approvalId}/decisions`, headers: mutationHeaders("farmer-ana", "unexplained-decline"), payload: { decision: "REJECT", reason: "Cannot supply." } });
    expect(unexplained.statusCode).toBe(422);
    expect(unexplained.json().code).toBe("DECISION_REASON_REQUIRED");
    expect((await prisma.approval.findUniqueOrThrow({ where: { id: approval.approvalId } })).status).toBe("PENDING");

    const declined = await server.inject({
      method: "POST",
      url: `/v1/approvals/${approval.approvalId}/decisions`,
      headers: mutationHeaders("farmer-ana", "explained-decline"),
      payload: { decision: "REJECT", reason: "Cannot supply.", reasonCode: "QUANTITY_MISMATCH", nextAction: "List only the quantity you can pick this week." },
    });
    expect(declined.statusCode).toBe(200);
    expect(declined.json()).toMatchObject({ status: "REJECTED", reasonCode: "QUANTITY_MISMATCH", nextAction: "List only the quantity you can pick this week." });
    const declinedOrder = await server.inject({ method: "GET", url: `/v1/orders/${declinedOrderId}`, headers: auth("buyer-hotel") });
    expect(declinedOrder.json()).toMatchObject({ lifecycleStatus: "REJECTED", outcomeCause: "APPROVAL_REJECTED" });
    expect(declinedOrder.json().outcomeNote).toContain("List only the quantity you can pick this week.");
  });

  it("refuses a change request without an actionable reason and shows the farmer the recorded one", async () => {
    const batchId = "11111111-1111-4111-8111-111111111111";
    const task = await prisma.verificationTask.findFirstOrThrow({ where: { cropBatchId: batchId, status: "OPEN" }, orderBy: { createdAt: "desc" } });

    const unexplained = await server.inject({ method: "POST", url: `/v1/verification-tasks/${task.id}/decisions`, headers: mutationHeaders("coordinator-maya", "unexplained-changes"), payload: { decision: "REQUEST_CHANGES", note: "Not enough detail." } });
    expect(unexplained.statusCode).toBe(422);
    expect(unexplained.json().code).toBe("DECISION_REASON_REQUIRED");
    expect((await prisma.verificationTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("OPEN");

    const decided = await server.inject({
      method: "POST",
      url: `/v1/verification-tasks/${task.id}/decisions`,
      headers: mutationHeaders("coordinator-maya", "explained-changes"),
      payload: { decision: "REQUEST_CHANGES", note: "Not enough detail.", reasonCode: "MISSING_INFORMATION", nextAction: "Add a photograph of the picked crate and the measured weight." },
    });
    expect(decided.statusCode).toBe(200);
    expect(decided.json()).toMatchObject({ status: "CHANGES_REQUESTED", reasonCode: "MISSING_INFORMATION", nextAction: "Add a photograph of the picked crate and the measured weight." });

    const farmerBatch = await server.inject({ method: "GET", url: `/v1/crop-batches/${batchId}`, headers: auth("farmer-ana") });
    expect(farmerBatch.json().latestDecision).toMatchObject({
      source: "VERIFICATION",
      reasonCode: "MISSING_INFORMATION",
      nextAction: "Add a photograph of the picked crate and the measured weight.",
      note: "Not enough detail.",
    });
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
    // Re-recorded from a real seed-42 run after safe partial commitment landed.
    expect(created.json()).toMatchObject({ frameCount: 127, metrics: { eventsProcessed: 80, totalAcceptedKg: 1545.13 } });
    expect(created.json().metrics.productActions).toMatchObject({ attempted: 151, succeeded: 151, rejected: 0, domainEventsCreated: 238 });
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
    expect(finalFrame.operationsSnapshot.orderOutcomes).toMatchObject({ total: 11, fulfilled: 4, partiallyFulfilled: 2, unfulfilled: 5, pending: 0 });
    // One order's deadline falls after the scenario horizon, so it is reported
    // as truncated by the run window rather than as an operational failure.
    expect(finalFrame.operationsSnapshot.orderOutcomes.causes).toEqual({ DELIVERY_REJECTED: 2, HORIZON_TRUNCATED: 1, INSUFFICIENT_SUPPLY: 2, NO_READY_SUPPLY: 2 });
    expect(finalFrame.operationsSnapshot).toMatchObject({ activeListings: 3, openDemands: 11, deliveryAcceptedKg: 1545.13, approvedCommitmentCount: 7, completedMissionCount: 7 });
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
  }, 120_000);

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

describe("fulfilment defects (#53)", () => {
  const anaBatchId = "11111111-1111-4111-8111-111111111111";
  const listingPayload = { cropBatchId: anaBatchId, quantity: { value: 5, unit: "kg" }, unitPrice: { amount: 6.5, currency: "XCD" }, availableFrom: "2026-09-05", availableUntil: "2026-09-12" };
  const orderPayload = { cropType: "CUCUMBER", neededBy: "2026-09-11T12:00:00Z", deliveryLocation: { latitude: 14.0101, longitude: -60.9875 } };

  async function observe(cropStage: string, estimate = 40) {
    return server.inject({
      method: "POST",
      url: "/v1/crop-observations",
      headers: mutationHeaders("farmer-ana", `observe-${cropStage.toLowerCase()}`),
      payload: { cropBatchId: anaBatchId, observedAt: "2026-09-06T08:00:00Z", cropStage, estimatedQuantity: { value: estimate, unit: "kg" }, provenance: "OBSERVED" },
    });
  }

  it("keeps a growing crop unlistable and withdraws its offers, then reopens supply once it is reported ready", async () => {
    await prisma.listing.updateMany({ where: { cropBatchId: anaBatchId }, data: { status: "ACTIVE", quantity: 20 } });
    expect((await observe("GROWING")).statusCode).toBe(201);

    const growing = await prisma.cropBatch.findUniqueOrThrow({ where: { id: anaBatchId } });
    expect(growing.status).toBe("GROWING");
    expect(growing.availableToPromise).toBe(0);
    expect(await prisma.listing.count({ where: { cropBatchId: anaBatchId, status: "ACTIVE" } })).toBe(0);
    expect(await prisma.listing.count({ where: { cropBatchId: anaBatchId, status: "WITHDRAWN" } })).toBeGreaterThan(0);

    const blocked = await server.inject({ method: "POST", url: "/v1/listings", headers: mutationHeaders("farmer-ana", "list-growing"), payload: listingPayload });
    expect(blocked.statusCode).toBe(422);
    expect(blocked.json().code).toBe("CROP_NOT_READY");

    expect((await observe("HARVEST_READY")).statusCode).toBe(201);
    const ready = await prisma.cropBatch.findUniqueOrThrow({ where: { id: anaBatchId } });
    expect(ready.status).toBe("HARVEST_READY");
    expect(ready.availableToPromise).toBeGreaterThan(0);

    const published = await server.inject({ method: "POST", url: "/v1/listings", headers: mutationHeaders("farmer-ana", "list-ready"), payload: listingPayload });
    expect(published.statusCode).toBe(201);
  });

  it("expires lapsed listings, records why an order waits, and re-matches it when new supply is published", async () => {
    await prisma.listing.updateMany({ where: { cropType: "CUCUMBER" }, data: { status: "SOLD_OUT" } });
    const lapsedId = randomUUID();
    await prisma.listing.create({
      data: { id: lapsedId, cropBatchId: anaBatchId, farmerId: "a0000000-0000-4000-8000-000000000001", cropType: "CUCUMBER", quantity: 30, unitPrice: 6, currency: "XCD", availableFrom: new Date("2026-08-20T00:00:00Z"), availableUntil: new Date("2026-08-25T00:00:00Z"), status: "ACTIVE" },
    });

    const waiting = await server.inject({ method: "POST", url: "/v1/orders", headers: mutationHeaders("buyer-hotel", "waiting-order"), payload: { ...orderPayload, requestedQuantity: { value: 5, unit: "kg" } } });
    expect(waiting.statusCode).toBe(201);
    const orderId = waiting.json().orderId as string;
    expect(await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).toMatchObject({ lifecycleStatus: "REQUESTED", outcomeCause: "NO_READY_SUPPLY" });
    expect((await prisma.listing.findUniqueOrThrow({ where: { id: lapsedId } })).status).toBe("EXPIRED");
    expect(await prisma.domainEvent.count({ where: { eventType: "LISTING_EXPIRED", entityId: lapsedId } })).toBe(1);

    const detail = await server.inject({ method: "GET", url: `/v1/orders/${orderId}`, headers: auth("buyer-hotel") });
    expect(detail.json().outcomeCause).toBe("NO_READY_SUPPLY");

    await prisma.cropBatch.update({ where: { id: anaBatchId }, data: { status: "HARVEST_READY", availableToPromise: 12 } });
    const published = await server.inject({ method: "POST", url: "/v1/listings", headers: mutationHeaders("farmer-ana", "rematch-supply"), payload: listingPayload });
    expect(published.statusCode).toBe(201);

    const rematched = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(rematched.lifecycleStatus).toBe("AWAITING_APPROVAL");
    expect(rematched.outcomeCause).toBeNull();
    expect(await prisma.allocation.count({ where: { orderId, status: "PROPOSED" } })).toBe(1);
  });

  it("soft-holds supply already proposed to another order so re-matching cannot over-promise one batch", async () => {
    // Earlier cases leave waiting and proposed cucumber orders behind; park them so this case owns the supply.
    await prisma.order.updateMany({ where: { cropType: "CUCUMBER", lifecycleStatus: { in: ["REQUESTED", "AWAITING_APPROVAL"] } }, data: { lifecycleStatus: "CANCELLED" } });
    await prisma.allocation.updateMany({ where: { status: "PROPOSED" }, data: { status: "STALE" } });
    await prisma.listing.updateMany({ where: { cropType: "CUCUMBER" }, data: { status: "SOLD_OUT" } });
    await prisma.cropBatch.update({ where: { id: anaBatchId }, data: { status: "HARVEST_READY", availableToPromise: 6 } });
    const published = await server.inject({ method: "POST", url: "/v1/listings", headers: mutationHeaders("farmer-ana", "soft-hold-supply"), payload: { ...listingPayload, quantity: { value: 6, unit: "kg" } } });
    expect(published.statusCode).toBe(201);

    const first = await server.inject({ method: "POST", url: "/v1/orders", headers: mutationHeaders("buyer-hotel", "soft-hold-first"), payload: { ...orderPayload, requestedQuantity: { value: 4, unit: "kg" } } });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: first.json().orderId } })).lifecycleStatus).toBe("AWAITING_APPROVAL");

    const second = await server.inject({ method: "POST", url: "/v1/orders", headers: mutationHeaders("buyer-hotel", "soft-hold-second"), payload: { ...orderPayload, requestedQuantity: { value: 4, unit: "kg" } } });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: second.json().orderId } })).toMatchObject({ lifecycleStatus: "REQUESTED", outcomeCause: "INSUFFICIENT_SUPPLY" });
  });
});

describe("safe partial commitment (#53)", () => {
  const anaBatchId = "11111111-1111-4111-8111-111111111111";
  const orderPayload = { cropType: "CUCUMBER", neededBy: "2026-09-11T12:00:00Z", deliveryLocation: { latitude: 14.0101, longitude: -60.9875 } };

  /** Leaves exactly `available` kg of one ready cucumber batch orderable. */
  async function onlySupply(available: number) {
    await prisma.order.updateMany({ where: { cropType: "CUCUMBER", lifecycleStatus: { in: ["REQUESTED", "AWAITING_APPROVAL"] } }, data: { lifecycleStatus: "CANCELLED" } });
    await prisma.allocation.updateMany({ where: { status: "PROPOSED" }, data: { status: "STALE" } });
    await prisma.listing.updateMany({ where: { cropType: "CUCUMBER" }, data: { status: "SOLD_OUT" } });
    await prisma.cropBatch.update({ where: { id: anaBatchId }, data: { status: "HARVEST_READY", availableToPromise: available } });
    const published = await server.inject({
      method: "POST",
      url: "/v1/listings",
      headers: mutationHeaders("farmer-ana", "partial-supply"),
      payload: { cropBatchId: anaBatchId, quantity: { value: available, unit: "kg" }, unitPrice: { amount: 6.5, currency: "XCD" }, availableFrom: "2026-09-05", availableUntil: "2026-09-12" },
    });
    expect(published.statusCode).toBe(201);
  }

  async function pendingApproval(persona: string, orderId: string) {
    const approvals = (await server.inject({ method: "GET", url: "/v1/approvals?status=PENDING", headers: auth(persona) })).json().items;
    return approvals.find((item: { context?: { orderId?: string } }) => item.context?.orderId === orderId);
  }

  it("proposes, commits, and delivers a partial order the buyer accepted in advance", async () => {
    await onlySupply(5);
    const placed = await server.inject({ method: "POST", url: "/v1/orders", headers: mutationHeaders("buyer-hotel", "partial-order"), payload: { ...orderPayload, requestedQuantity: { value: 6, unit: "kg" } } });
    expect(placed.statusCode).toBe(201);
    expect(placed.json()).toMatchObject({ minimumAcceptableFraction: 0.8, committedQuantity: { value: 0, unit: "kg" } });
    const orderId = placed.json().orderId as string;
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).lifecycleStatus).toBe("AWAITING_APPROVAL");

    const proposedEvent = await prisma.domainEvent.findFirstOrThrow({ where: { eventType: "ALLOCATION_PROPOSED", simulationRunId: null }, orderBy: { cursor: "desc" } });
    const proposedPayload = proposedEvent.payload as { orderId: string; coverageFraction: number };
    expect(proposedPayload.orderId).toBe(orderId);
    expect(proposedPayload.coverageFraction).toBeCloseTo(0.8333, 3);

    const buyerApproval = await pendingApproval("buyer-hotel", orderId);
    expect(buyerApproval.context.coverage).toMatchObject({ requestedQuantity: { value: 6, unit: "kg" }, proposedQuantity: { value: 5, unit: "kg" }, partial: true });
    expect(buyerApproval.context.summary).toContain("covers 5 of 6 kg (83%)");

    expect((await decide("buyer-hotel", buyerApproval.approvalId, "APPROVE")).statusCode).toBe(200);
    const farmerApproval = await pendingApproval("farmer-ana", orderId);
    expect((await decide("farmer-ana", farmerApproval.approvalId, "APPROVE")).statusCode).toBe(200);

    const committed = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(committed).toMatchObject({ lifecycleStatus: "COMMITTED", committedQuantity: 5 });
    const mission = await prisma.deliveryMission.findFirstOrThrow({ where: { orderId } });
    expect(mission.quantity).toBe(5);

    const vehicles = (await server.inject({ method: "GET", url: "/v1/me/vehicles", headers: auth("transporter-daniel") })).json().items;
    expect((await server.inject({ method: "POST", url: `/v1/delivery-missions/${mission.id}/acceptance`, headers: mutationHeaders("transporter-daniel", "partial-mission"), payload: { decision: "ACCEPT", vehicleId: vehicles[0].vehicleId } })).statusCode).toBe(200);
    // One pickup then the drop-off: arrive, confirm, arrive, deliver.
    for (const [index, updateType] of ["ARRIVED", "PICKED_UP", "ARRIVED", "DELIVERED"].entries()) {
      const update = await server.inject({ method: "POST", url: `/v1/delivery-missions/${mission.id}/updates`, headers: mutationHeaders("transporter-daniel", `partial-${updateType.toLowerCase()}-${index}`), payload: { updateType, recordedAt: new Date(Date.UTC(2026, 8, 10, 9 + index)).toISOString() } });
      expect(update.statusCode).toBe(201);
    }

    const acceptance = await server.inject({
      method: "POST",
      url: `/v1/deliveries/${mission.id}/acceptance`,
      headers: mutationHeaders("buyer-hotel", "partial-acceptance"),
      payload: { outcome: "ACCEPTED", acceptedQuantity: { value: 5, unit: "kg" }, rejectedQuantity: { value: 0, unit: "kg" }, lineOutcomes: [{ cropBatchId: anaBatchId, acceptedQuantity: { value: 5, unit: "kg" }, rejectedQuantity: { value: 0, unit: "kg" } }] },
    });
    expect(acceptance.statusCode).toBe(201);

    // Everything delivered did arrive; the order was only ever 5 of 6 kg, so
    // the shortfall keeps its real cause instead of blaming the delivery.
    const settled = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(settled).toMatchObject({ lifecycleStatus: "PARTIALLY_FULFILLED", outcomeCause: "INSUFFICIENT_SUPPLY", acceptedQuantity: 5 });
    expect(settled.outcomeNote).toBe("Committed 5 of 6 kg; the buyer sourced the rest elsewhere.");
    const outcomeEvent = await prisma.domainEvent.findFirstOrThrow({ where: { eventType: "ORDER_PARTIALLY_FULFILLED", entityId: orderId }, orderBy: { cursor: "desc" } });
    expect(outcomeEvent.payload).toMatchObject({ acceptedQuantity: { value: 5, unit: "kg" }, releasedReservationQuantity: { value: 0, unit: "kg" } });
  });

  it("still waits on the same supply when the buyer requires complete coverage", async () => {
    await onlySupply(5);
    const strict = await server.inject({ method: "POST", url: "/v1/orders", headers: mutationHeaders("buyer-hotel", "strict-order"), payload: { ...orderPayload, requestedQuantity: { value: 6, unit: "kg" }, minimumAcceptableFraction: 1 } });
    expect(strict.statusCode).toBe(201);
    expect(strict.json().minimumAcceptableFraction).toBe(1);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: strict.json().orderId } })).toMatchObject({ lifecycleStatus: "REQUESTED", outcomeCause: "INSUFFICIENT_SUPPLY" });
    expect(await prisma.allocation.count({ where: { orderId: strict.json().orderId } })).toBe(0);
  });

  it("rejects an acceptance threshold below the supported floor", async () => {
    const invalid = await server.inject({ method: "POST", url: "/v1/orders", headers: mutationHeaders("buyer-hotel", "invalid-threshold"), payload: { ...orderPayload, requestedQuantity: { value: 6, unit: "kg" }, minimumAcceptableFraction: 0.3 } });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json().code).toBe("INVALID_ACCEPTANCE_THRESHOLD");
  });
});
