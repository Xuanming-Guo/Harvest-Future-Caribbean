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

  it("creates exactly one prediction and one verification task per crop update", async () => {
    const batchId = "11111111-1111-4111-8111-111111111111";
    const beforePredictions = await prisma.yieldPrediction.count({ where: { cropBatchId: batchId } });
    const beforeTasks = await prisma.verificationTask.count({ where: { cropBatchId: batchId } });
    const response = await server.inject({
      method: "POST",
      url: "/v1/crop-observations",
      headers: mutationHeaders("farmer-ana", "single-forecast"),
      payload: { cropBatchId: batchId, observedAt: new Date().toISOString(), cropStage: "HARVEST_READY", estimatedQuantity: { value: 24, unit: "kg" }, notes: "Updated field estimate.", provenance: "OBSERVED" },
    });
    expect(response.statusCode).toBe(201);
    expect(await prisma.yieldPrediction.count({ where: { cropBatchId: batchId } })).toBe(beforePredictions + 1);
    expect(await prisma.verificationTask.count({ where: { cropBatchId: batchId } })).toBe(beforeTasks + 1);
  });

  it("runs the corrected commitment, vehicle, recovery, and delivery workflow", async () => {
    const neededBy = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    const created = await server.inject({
      method: "POST",
      url: "/v1/orders",
      headers: mutationHeaders("buyer-hotel", "partial-listing-order"),
      payload: { cropType: "CUCUMBER", requestedQuantity: { value: 10, unit: "kg" }, neededBy, deliveryLocation: { latitude: 14.0101, longitude: -60.9875 }, listingIds: ["16161616-1616-4616-8616-161616161616"] },
    });
    expect(created.statusCode).toBe(201);
    const orderId = created.json().orderId as string;

    const buyerApprovals = (await server.inject({ method: "GET", url: "/v1/approvals?status=PENDING", headers: auth("buyer-hotel") })).json().items;
    const farmerApprovals = (await server.inject({ method: "GET", url: "/v1/approvals?status=PENDING", headers: auth("farmer-ana") })).json().items;
    const buyerApproval = buyerApprovals.find((item: { context?: { orderId?: string } }) => item.context?.orderId === orderId);
    const farmerApproval = farmerApprovals.find((item: { context?: { orderId?: string } }) => item.context?.orderId === orderId);
    expect(buyerApproval.context.quantity.value).toBe(10);
    expect(farmerApproval.context.quantity.value).toBe(10);
    expect((await decide("buyer-hotel", buyerApproval.approvalId, "APPROVE")).statusCode).toBe(200);
    expect((await decide("farmer-ana", farmerApproval.approvalId, "APPROVE")).statusCode).toBe(200);

    const committed = await server.inject({ method: "GET", url: `/v1/orders/${orderId}`, headers: auth("buyer-hotel") });
    expect(committed.json().lifecycleStatus).toBe("COMMITTED");
    expect(committed.json().approvalSummary).toMatchObject({ required: 2, approved: 2, pending: 0 });
    const missionId = committed.json().deliveryMission.missionId as string;
    const listing = await prisma.listing.findUniqueOrThrow({ where: { id: "16161616-1616-4616-8616-161616161616" } });
    expect(listing).toMatchObject({ quantity: 4, status: "ACTIVE" });

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

    const recoveryApprovals = (await server.inject({ method: "GET", url: "/v1/approvals?status=PENDING", headers: auth("coordinator-maya") })).json().items;
    const recoveryApproval = recoveryApprovals.find((item: { context?: { exceptionId?: string } }) => item.context?.exceptionId === exceptionId);
    expect((await decide("coordinator-maya", recoveryApproval.approvalId, "APPROVE")).statusCode).toBe(200);
    const recoveredMission = await prisma.deliveryMission.findUniqueOrThrow({ where: { id: missionId } });
    expect(recoveredMission.deadline.getTime()).toBe(oldDeadline + 2 * 60 * 60 * 1000);
    expect((await server.inject({ method: "GET", url: `/v1/orders/${orderId}`, headers: auth("buyer-hotel") })).json().atRisk).toBe(false);

    expect((await update("ARRIVED")).json().stopSequence).toBe(2);
    expect((await update("DELIVERED")).statusCode).toBe(201);
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: "d0000000-0000-4000-8000-000000000001" } })).status).toBe("AVAILABLE");
    const history = await server.inject({ method: "GET", url: `/v1/delivery-missions/${missionId}/updates`, headers: auth("buyer-hotel") });
    expect(history.json().items.map((item: { updateType: string }) => item.updateType)).toEqual(["ARRIVED", "PICKED_UP", "DELAYED", "ARRIVED", "DELIVERED"]);

    const acceptance = await server.inject({
      method: "POST",
      url: `/v1/deliveries/${missionId}/acceptance`,
      headers: mutationHeaders("buyer-hotel", "partial-acceptance"),
      payload: { outcome: "PARTIALLY_ACCEPTED", acceptedQuantity: { value: 8, unit: "kg" }, rejectedQuantity: { value: 2, unit: "kg" }, lineOutcomes: [{ cropBatchId: "11111111-1111-4111-8111-111111111111", acceptedQuantity: { value: 8, unit: "kg" }, rejectedQuantity: { value: 2, unit: "kg" } }], note: "Two kilograms did not meet the agreed quality." },
    });
    expect(acceptance.statusCode).toBe(201);
    const completed = await server.inject({ method: "GET", url: `/v1/orders/${orderId}`, headers: auth("buyer-hotel") });
    expect(completed.json()).toMatchObject({ lifecycleStatus: "PARTIALLY_FULFILLED", acceptedQuantity: { value: 8, unit: "kg" }, deliveryAcceptance: { outcome: "PARTIALLY_ACCEPTED" } });
    const batch = await prisma.cropBatch.findUniqueOrThrow({ where: { id: "11111111-1111-4111-8111-111111111111" } });
    const prediction = await prisma.yieldPrediction.findUniqueOrThrow({ where: { id: batch.latestPredictionId! } });
    expect(prediction.actualQuantity).toBe(8);
    expect(prediction.absoluteError).not.toBeNull();
  });

  it("records coordinator verification and keeps planned simulation routes unserved", async () => {
    const tasks = (await server.inject({ method: "GET", url: "/v1/verification-tasks?status=OPEN", headers: auth("coordinator-maya") })).json().items;
    const latest = tasks.find((task: { subjectId: string }) => task.subjectId !== "12121212-1212-4212-8212-121212121212");
    const decision = await server.inject({ method: "POST", url: `/v1/verification-tasks/${latest.taskId}/decisions`, headers: mutationHeaders("coordinator-maya", "verify-observation"), payload: { decision: "VERIFY", note: "Field update confirmed." } });
    expect(decision.statusCode).toBe(200);
    expect(decision.json().status).toBe("VERIFIED");

    for (const url of ["/v1/operations/snapshot", "/v1/agent-traces/99999999-9999-4999-8999-999999999999", "/v1/events/stream", "/v1/simulation-runs/99999999-9999-4999-8999-999999999999", "/v1/paired-runs/99999999-9999-4999-8999-999999999999"]) {
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
