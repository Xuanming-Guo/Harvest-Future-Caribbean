import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

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

/** The OrderOutcomeCause vocabulary declared in contracts/openapi.yaml. */
const ORDER_OUTCOME_CAUSES = [
  "NO_READY_SUPPLY",
  "NOT_READY_IN_TIME",
  "INSUFFICIENT_SUPPLY",
  "SUPPLY_CHANGED",
  "APPROVAL_REJECTED",
  "APPROVAL_TIMEOUT",
  "MISSION_LATE",
  "DELIVERY_REJECTED",
  "CANCELLED",
  "HORIZON_TRUNCATED",
];

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
  // The seeded workflow has dated September orders; only freeze Date, not I/O timers.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-06T08:00:00Z"));
  await server.listen({ host: "127.0.0.1", port: 0 });
  const address = server.server.address() as AddressInfo;
  apiBaseUrl = `http://127.0.0.1:${address.port}`;
  for (const persona of ["buyer-hotel", "farmer-ana", "farmer-marcus", "transporter-daniel", "coordinator-maya", "operations-demo"]) await signIn(persona);
});

afterAll(async () => {
  await server.close();
  vi.useRealTimers();
});

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
    const anaCucumber = ana.json().items.find((item: { cropBatchId: string }) => item.cropBatchId === "11111111-1111-4111-8111-111111111111");
    expect(anaCucumber).toBeDefined();
    expect(anaCucumber.verificationStatus).toBe("OPEN");
    expect(anaCucumber.latestDecision).toMatchObject({
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
        expect.objectContaining({ locationId: farmId, kind: "FARM", displayName: "Canaries Hillside Plot", identified: true, access: "CROP_PROGRESS", crops: [expect.objectContaining({ cropBatchId: batchId, cropType: "DASHEEN", status: "GROWING" })] }),
        // Bay Gardens already took a delivery from Ana, so it keeps its name.
        expect.objectContaining({ kind: "HOTEL", displayName: "Bay Gardens Hotel", identified: true, access: "BUYER_DEMAND", opportunities: [expect.objectContaining({ cropType: "CUCUMBER", quantity: { value: 20, unit: "kg" } })] }),
        expect.objectContaining({ kind: "FARM", displayName: "Choiseul Roots Cooperative", identified: true, serviceZone: "Choiseul", access: "CROP_PROGRESS", crops: [expect.objectContaining({ cropType: "DASHEEN", status: "HARVEST_READY" })] }),
        // Piton Lantern has an open request Ana can fill and no agreed order
        // with her, so the request is actionable while the hotel stays a
        // zone-level marker.
        expect.objectContaining({ kind: "HOTEL", displayName: "A buyer in Soufrière", identified: false, serviceZone: "Soufrière", access: "BUYER_DEMAND", opportunities: [expect.objectContaining({ cropType: "DASHEEN", quantity: { value: 24, unit: "kg" } })] }),
      ]));
      expect(farmer.body).not.toContain("Piton Lantern Hotel");
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

  it("scopes the map and the delivery view to what each role may see", async () => {
    const ids = {
      ana: "a0000000-0000-4000-8000-000000000001",
      marcus: "a0000000-0000-4000-8000-000000000005",
      bayGardens: "a0000000-0000-4000-8000-000000000002",
      piton: "a0000000-0000-4000-8000-000000000007",
      rodney: "a0000000-0000-4000-8000-000000000009",
      farmAna: "14141414-1414-4414-8414-141414141414",
      farmMarcus: "14141414-1414-4414-8414-141414141415",
      farmChoiseul: "14141414-1414-4414-8414-141414141418",
      batchAna: "11111111-1111-4111-8111-111111111111",
      batchMarcus: "11111111-1111-4111-8111-111111111112",
      bayGardensOrder: "20202020-2020-4020-8020-202020202020",
    };
    const pitonOrderId = randomUUID();
    const sharedOrderId = randomUUID();
    const sharedAllocationId = randomUUID();
    const sharedMissionId = randomUUID();
    const rivalTransporterId = randomUUID();
    const rivalMissionId = randomUUID();

    await prisma.order.create({ data: { id: pitonOrderId, buyerId: ids.piton, cropType: "DASHEEN", requestedQuantity: 8, neededBy: new Date("2026-09-10T12:00:00Z"), latitude: 13.826, longitude: -61.058, listingIds: [], lifecycleStatus: "REQUESTED", activeExceptionIds: [] } });
    // One order, two farms, no approval yet: the shape the demo commits to and
    // the sharpest test of what each side may read before anyone has agreed.
    await prisma.order.create({ data: { id: sharedOrderId, buyerId: ids.rodney, cropType: "CUCUMBER", requestedQuantity: 16, neededBy: new Date("2026-09-11T12:00:00Z"), latitude: 14.073, longitude: -60.951, listingIds: [], lifecycleStatus: "AWAITING_APPROVAL", activeExceptionIds: [] } });
    await prisma.allocation.create({ data: { id: sharedAllocationId, orderId: sharedOrderId, status: "PROPOSED" } });
    await prisma.allocationLine.createMany({ data: [
      { allocationId: sharedAllocationId, cropBatchId: ids.batchAna, listingId: "16161616-1616-4616-8616-161616161616", quantity: 10 },
      { allocationId: sharedAllocationId, cropBatchId: ids.batchMarcus, listingId: "16161616-1616-4616-8616-161616161617", quantity: 6 },
    ] });
    await prisma.deliveryMission.create({ data: {
      id: sharedMissionId,
      orderId: sharedOrderId,
      status: "AVAILABLE",
      quantity: 16,
      deadline: new Date("2026-09-11T12:00:00Z"),
      currentStopSequence: 0,
      stops: [
        { sequence: 1, kind: "PICKUP", farmId: ids.farmAna, cropBatchIds: [ids.batchAna], quantity: { value: 10, unit: "kg" }, location: { latitude: 13.953, longitude: -61.005 } },
        { sequence: 2, kind: "PICKUP", farmId: ids.farmMarcus, cropBatchIds: [ids.batchMarcus], quantity: { value: 6, unit: "kg" }, location: { latitude: 13.941, longitude: -60.918 } },
        { sequence: 3, kind: "DROPOFF", quantity: { value: 16, unit: "kg" }, location: { latitude: 14.073, longitude: -60.951 } },
      ],
    } });
    await prisma.actor.create({ data: { id: rivalTransporterId, authSubject: "transporter-rival-" + rivalTransporterId, name: "Rival Haulage", role: "TRANSPORTER", isSynthetic: true } });
    await prisma.deliveryMission.create({ data: {
      id: rivalMissionId,
      orderId: pitonOrderId,
      status: "ASSIGNED",
      transporterId: rivalTransporterId,
      quantity: 8,
      deadline: new Date("2026-09-10T12:00:00Z"),
      currentStopSequence: 0,
      stops: [
        { sequence: 1, kind: "PICKUP", farmId: ids.farmChoiseul, cropBatchIds: [], quantity: { value: 8, unit: "kg" }, location: { latitude: 13.775, longitude: -61.047 } },
        { sequence: 2, kind: "DROPOFF", quantity: { value: 8, unit: "kg" }, location: { latitude: 13.826, longitude: -61.058 } },
      ],
    } });
    await signIn("buyer-piton-demo");

    try {
      // FARMER: another grower's farm is not a place, and its crop is not a read.
      const marcusMap = await server.inject({ method: "GET", url: "/v1/world-map", headers: auth("farmer-marcus") });
      expect(marcusMap.statusCode).toBe(200);
      expect(marcusMap.json().locations.filter((location: { kind: string }) => location.kind === "FARM").map((location: { locationId: string }) => location.locationId)).toEqual([ids.farmMarcus]);
      expect(marcusMap.body).not.toContain("Roseau Valley Farm");
      expect(marcusMap.body).not.toContain(ids.farmAna);
      expect(marcusMap.body).not.toContain(ids.batchAna);
      expect((await server.inject({ method: "GET", url: "/v1/crop-batches/" + ids.batchAna, headers: auth("farmer-marcus") })).statusCode).toBe(404);
      expect((await server.inject({ method: "GET", url: "/v1/crop-batches", headers: auth("farmer-marcus") })).json().items.map((item: { cropBatchId: string }) => item.cropBatchId)).toEqual([ids.batchMarcus]);

      // FARMER: a buyer stays anonymous until an order with it has been agreed.
      const anaMap = await server.inject({ method: "GET", url: "/v1/world-map", headers: auth("farmer-ana") });
      const rodney = anaMap.json().locations.find((location: { locationId: string }) => location.locationId === ids.rodney);
      expect(rodney).toMatchObject({ kind: "HOTEL", displayName: "A buyer in Gros Islet", identified: false, serviceZone: "Gros Islet" });
      expect(anaMap.body).not.toContain("Rodney Bay House");
      expect(anaMap.json().locations.find((location: { locationId: string }) => location.locationId === ids.bayGardens)).toMatchObject({ displayName: "Bay Gardens Hotel", identified: true });

      // FARMER: a shared order shows this farm's own line and nobody else's.
      const marcusOrder = await server.inject({ method: "GET", url: "/v1/orders/" + sharedOrderId, headers: auth("farmer-marcus") });
      expect(marcusOrder.statusCode).toBe(200);
      expect(marcusOrder.json().allocation.lines).toEqual([{ cropBatchId: ids.batchMarcus, quantity: { value: 6, unit: "kg" } }]);
      expect(marcusOrder.json().deliveryMission.cargo).toEqual([expect.objectContaining({ farmId: ids.farmMarcus, farmName: "Mabouya Growers" })]);
      expect(marcusOrder.json().deliveryMission.buyerName).toBe("A buyer in Gros Islet");
      expect(marcusOrder.json().deliveryMission.stops[0]).toMatchObject({ kind: "PICKUP", displayName: "A farm in Roseau Valley", location: { latitude: 13.95, longitude: -61 } });
      expect(marcusOrder.json().deliveryMission.stops[0].farmId).toBeUndefined();
      expect(marcusOrder.json().deliveryMission.stops[1]).toMatchObject({ kind: "PICKUP", displayName: "Mabouya Growers", farmId: ids.farmMarcus, location: { latitude: 13.941, longitude: -60.918 } });
      expect(marcusOrder.body).not.toContain("Roseau Valley Farm");
      expect(marcusOrder.body).not.toContain(ids.batchAna);
      expect(marcusOrder.body).not.toContain("Rodney Bay House");

      // BUYER: one hotel never lists, opens, or maps another hotel's business.
      const pitonOrders = await server.inject({ method: "GET", url: "/v1/orders", headers: auth("buyer-piton-demo") });
      expect(pitonOrders.statusCode).toBe(200);
      expect(pitonOrders.json().items.map((item: { orderId: string }) => item.orderId)).toEqual([pitonOrderId]);
      expect((await server.inject({ method: "GET", url: "/v1/orders/" + ids.bayGardensOrder, headers: auth("buyer-piton-demo") })).statusCode).toBe(404);
      const bayOrders = await server.inject({ method: "GET", url: "/v1/orders", headers: auth("buyer-hotel") });
      expect(bayOrders.json().items.map((item: { orderId: string }) => item.orderId)).not.toContain(pitonOrderId);
      expect((await server.inject({ method: "GET", url: "/v1/orders/" + pitonOrderId, headers: auth("buyer-hotel") })).statusCode).toBe(404);
      const pitonMap = await server.inject({ method: "GET", url: "/v1/world-map", headers: auth("buyer-piton-demo") });
      expect(pitonMap.json().locations.filter((location: { kind: string }) => location.kind === "HOTEL").map((location: { locationId: string }) => location.locationId)).toEqual([ids.piton]);
      expect(pitonMap.body).not.toContain("Bay Gardens Hotel");
      // Listed supply is a crop and a quantity; the seller is a zone until agreed.
      const pitonFarms = pitonMap.json().locations.filter((location: { kind: string }) => location.kind === "FARM");
      expect(pitonFarms.length).toBeGreaterThan(0);
      expect(pitonFarms.every((location: { identified: boolean; displayName: string }) => location.identified === false && location.displayName.startsWith("A farm in "))).toBe(true);
      expect(pitonMap.body).not.toContain("Roseau Valley Farm");

      // TRANSPORTER: mission stops, and no other transporter's job.
      const transporterMap = await server.inject({ method: "GET", url: "/v1/world-map", headers: auth("transporter-daniel") });
      const transporterLocationIds = transporterMap.json().locations.map((location: { locationId: string }) => location.locationId);
      expect(transporterLocationIds).toEqual(expect.arrayContaining([ids.farmAna, ids.farmMarcus, ids.rodney]));
      expect(transporterLocationIds).not.toContain(ids.farmChoiseul);
      expect(transporterMap.body).not.toContain("Choiseul Roots Cooperative");
      expect(transporterMap.json().locations.every((location: { crops: unknown[]; opportunities: unknown[] }) => !location.crops.length && !location.opportunities.length)).toBe(true);
      const danielMissionIds = (await server.inject({ method: "GET", url: "/v1/delivery-missions", headers: auth("transporter-daniel") })).json().items.map((item: { missionId: string }) => item.missionId);
      expect(danielMissionIds).toContain(sharedMissionId);
      expect(danielMissionIds).not.toContain(rivalMissionId);
      expect((await server.inject({ method: "GET", url: "/v1/delivery-missions/" + rivalMissionId, headers: auth("transporter-daniel") })).statusCode).toBe(404);
      expect((await server.inject({ method: "GET", url: "/v1/delivery-missions/" + rivalMissionId + "/updates", headers: auth("transporter-daniel") })).statusCode).toBe(404);

      // COORDINATOR: the permitted island, by name.
      const coordinatorMap = await server.inject({ method: "GET", url: "/v1/world-map", headers: auth("coordinator-maya") });
      const coordinatorFarms = coordinatorMap.json().locations.filter((location: { kind: string }) => location.kind === "FARM");
      expect(coordinatorFarms.map((location: { locationId: string }) => location.locationId)).toEqual(expect.arrayContaining([ids.farmAna, ids.farmMarcus, ids.farmChoiseul]));
      expect(coordinatorMap.json().locations.every((location: { identified: boolean }) => location.identified)).toBe(true);
      expect(coordinatorMap.body).toContain("Roseau Valley Farm");
      expect(coordinatorMap.body).toContain("Mabouya Growers");
      const coordinatorBatches = (await server.inject({ method: "GET", url: "/v1/crop-batches", headers: auth("coordinator-maya") })).json().items.map((item: { cropBatchId: string }) => item.cropBatchId);
      expect(coordinatorBatches).toEqual(expect.arrayContaining([ids.batchAna, ids.batchMarcus]));
      const coordinatorOrder = await server.inject({ method: "GET", url: "/v1/orders/" + sharedOrderId, headers: auth("coordinator-maya") });
      expect(coordinatorOrder.json().allocation.lines).toHaveLength(2);
      expect(coordinatorOrder.json().deliveryMission.buyerName).toBe("Rodney Bay House");
    } finally {
      await prisma.deliveryMission.deleteMany({ where: { id: { in: [sharedMissionId, rivalMissionId] } } });
      await prisma.allocationLine.deleteMany({ where: { allocationId: sharedAllocationId } });
      await prisma.allocation.delete({ where: { id: sharedAllocationId } });
      await prisma.order.deleteMany({ where: { id: { in: [sharedOrderId, pitonOrderId] } } });
      await prisma.actor.delete({ where: { id: rivalTransporterId } });
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
    const allocation = await prisma.allocation.findFirstOrThrow({ where: { orderId, status: "PROPOSED" } });
    const proposalLines = await prisma.allocationLine.findMany({ where: { allocationId: allocation.id }, orderBy: { creationOrder: "asc" } });
    expect(proposalLines).toHaveLength(2);
    // Move the first row physically behind the second without changing its
    // identity or persisted order. Reads must survive PostgreSQL heap changes.
    await prisma.$transaction(async (tx) => {
      await tx.allocationLine.delete({ where: { id: proposalLines[0]!.id } });
      await tx.allocationLine.create({ data: proposalLines[0]! });
    });
    const reordered = await server.inject({ method: "GET", url: `/v1/orders/${orderId}`, headers: auth("buyer-hotel") });
    expect(reordered.json().allocation.lines.map((line: { cropBatchId: string }) => line.cropBatchId))
      .toEqual(proposalLines.map((line) => line.cropBatchId));

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
    const approvedEvent = await prisma.domainEvent.findFirstOrThrow({ where: { eventType: "ALLOCATION_APPROVED", entityId: allocation.id } });
    expect((approvedEvent.payload as { lines: Array<{ cropBatchId: string }> }).lines.map((line) => line.cropBatchId))
      .toEqual(proposalLines.map((line) => line.cropBatchId));
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
      // This payload omits estimationMode, so the run records the labelled
      // fallback rather than inheriting the server MODEL_ADAPTER setting.
      estimationMode: "DETERMINISTIC_FALLBACK",
      status: "COMPLETED",
      resolvedIslandIds: ["saint-lucia"],
      evidenceLabel: expect.stringContaining("SYNTHETIC"),
    });
    expect(created.json().frameCount).toBeGreaterThan(20);
    // Exact frame, event, and action counts are recorded in
    // docs/simulation_api_local_testing.md and re-recorded whenever the engine or
    // Product API changes; the determinism and arithmetic checks below are what
    // guard the run, so a hard-coded count here would only fail every time the
    // world legitimately moves.
    expect(created.json().metrics.eventsProcessed).toBeGreaterThan(20);
    expect(created.json().metrics.totalAcceptedKg).toBeGreaterThan(0);
    // Every action the run attempted against the Product API was accepted, and
    // each accepted action recorded at least one domain event. That is the
    // invariant the recorded counts were really guarding.
    const productActions = created.json().metrics.productActions;
    expect(productActions.attempted).toBeGreaterThan(0);
    expect(productActions.succeeded).toBe(productActions.attempted);
    expect(productActions.rejected).toBe(0);
    expect(productActions.domainEventsCreated).toBeGreaterThanOrEqual(productActions.succeeded);
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
    const finalSnapshot = finalFrame.operationsSnapshot;
    const finalOutcomes = finalSnapshot.orderOutcomes;
    expect(finalOutcomes.total).toBeGreaterThan(0);
    const recordedMetrics = created.json().metrics;
    expect(recordedMetrics.demandsFullyMet).toBe(finalOutcomes.fulfilled);
    expect(recordedMetrics.demandsPartiallyMet).toBe(finalOutcomes.partiallyFulfilled);
    expect(recordedMetrics.demandsUnmet).toBe(finalOutcomes.unfulfilled);
    expect(finalFrame.demands.filter((demand: { status: string }) => demand.status === "FULFILLED")).toHaveLength(finalOutcomes.fulfilled);
    expect(finalFrame.demands.filter((demand: { status: string }) => demand.status === "PARTIALLY_FULFILLED")).toHaveLength(finalOutcomes.partiallyFulfilled);

    expect(finalOutcomes.fulfilled + finalOutcomes.partiallyFulfilled + finalOutcomes.unfulfilled + finalOutcomes.pending).toBe(finalOutcomes.total);
    // Every order that did not fully settle carries exactly one cause, and each
    // cause is one the contract names. The counts themselves are recorded in
    // docs/simulation_api_local_testing.md rather than pinned here.
    const causeCounts = finalOutcomes.causes as Record<string, number>;
    expect(Object.values(causeCounts).reduce((sum, count) => sum + count, 0)).toBe(finalOutcomes.partiallyFulfilled + finalOutcomes.unfulfilled);
    expect(Object.keys(causeCounts).every((cause) => ORDER_OUTCOME_CAUSES.includes(cause))).toBe(true);
    // The run continues for a settlement window after buyers stop ordering, long
    // enough for every deadline the ordering window can produce, so no order is
    // truncated by the horizon. Zero because late orders are followed through,
    // not because they are withheld.
    expect(causeCounts.HORIZON_TRUNCATED ?? 0).toBe(0);
    // The Product API's delivery acceptances are what the engine applies back to
    // physical state, so the projection and the engine metric agree.
    expect(finalSnapshot.deliveryAcceptedKg).toBeCloseTo(created.json().metrics.totalAcceptedKg, 2);
    expect(finalSnapshot.openDemands).toBe(finalOutcomes.total);
    expect(finalSnapshot.completedMissionCount).toBeGreaterThan(0);
    expect(finalSnapshot.approvedCommitmentCount).toBeGreaterThanOrEqual(finalSnapshot.completedMissionCount);
    // Payment behaviour is asserted by its arithmetic rather than by recorded
    // counts, which live in docs/simulation_api_local_testing.md. Synthetic
    // buyers order on simulated 7-day terms and pay once their wait elapses, so
    // nothing is paid for that was never delivered and an order that goes
    // overdue either gets paid or is still overdue when the run ends.
    const overduePerFrame = timeline.json().frames.map((frame: { operationsSnapshot?: { paymentOverdueCount?: number } }) => frame.operationsSnapshot?.paymentOverdueCount);
    expect(overduePerFrame.every((count: number | undefined) => typeof count === "number")).toBe(true);
    expect(overduePerFrame.at(-1)).toBe(finalSnapshot.paymentOverdueCount);
    const paymentConfirmations = await prisma.domainEvent.count({ where: { simulationRunId: runId, eventType: "PAYMENT_CONFIRMED" } });
    const settled = await prisma.order.findMany({ where: { simulationRunId: runId, paidAt: { not: null } }, select: { paymentTermsDays: true } });
    expect(settled).toHaveLength(paymentConfirmations);
    // A buyer can only pay for produce it accepted, and an order can only be
    // overdue on produce it accepted, so the two together cannot exceed the
    // recorded delivery acceptances. Counted from the acceptances rather than
    // from the fulfilled orders, because a delivery the buyer refused outright
    // is still an acceptance record and still prices the order.
    const acceptances = await prisma.deliveryAcceptance.count({ where: { simulationRunId: runId } });
    expect(settled.length + finalSnapshot.paymentOverdueCount).toBeLessThanOrEqual(acceptances);
    // Overdue is absorbing until payment, so the most that were ever overdue at
    // once is bounded by those eventually paid plus those still overdue at the
    // end. Harvest records these terms; it moves no money.
    expect(Math.max(...(overduePerFrame as number[]))).toBeLessThanOrEqual(paymentConfirmations + finalSnapshot.paymentOverdueCount);
    expect(settled.every((order) => order.paymentTermsDays === 7)).toBe(true);
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
        paymentOverdueCount?: number;
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
        weather: frame.weather,
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
          paymentOverdueCount: snapshot.paymentOverdueCount,
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

    // Weather the run published is the run's own, and it is only ever a day
    // that had already occurred when it was written.
    const runWeatherRows = await prisma.weatherObservation.findMany({
      where: { simulationRunId: runId },
      orderBy: { observedOn: "asc" },
    });
    expect(runWeatherRows.length).toBeGreaterThan(0);
    expect(runWeatherRows.every((row) => row.provenance === "SYNTHETIC")).toBe(true);
    expect(runWeatherRows.every((row) => row.forecastProvenance === "MODEL_PREDICTED")).toBe(true);
    const runWeather = await server.inject({
      method: "GET",
      url: `/v1/weather?islandId=saint-lucia&simulationRunId=${runId}`,
      headers: auth("operations-demo"),
    });
    expect(runWeather.statusCode).toBe(200);
    expect(runWeather.json()).toMatchObject({ islandId: "saint-lucia", simulationRunId: runId });
    expect(runWeather.json().current.provenance).toBe("SYNTHETIC");
    // The seeded development world is a different island-day series entirely.
    const seededWeather = await server.inject({ method: "GET", url: "/v1/weather", headers: auth("farmer-ana") });
    expect(seededWeather.statusCode).toBe(200);
    expect(seededWeather.json().simulationRunId).toBeUndefined();
    expect(seededWeather.json().asOf).not.toBe(runWeather.json().asOf);

    // Every simulated participant that plans around the weather actually read it.
    const weatherReads = timeline.json().frames
      .flatMap((frame: { agentActions?: Array<{ toolName: string; role: string; status: string }> }) => frame.agentActions ?? [])
      .filter((action: { toolName: string }) => action.toolName === "read_weather");
    expect(weatherReads.length).toBeGreaterThan(0);
    expect(weatherReads.every((action: { status: string }) => action.status === "SUCCEEDED")).toBe(true);
    expect(new Set(weatherReads.map((action: { role: string }) => action.role))).toEqual(
      new Set(["FARMER", "COORDINATOR", "TRANSPORTER"]),
    );

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
        // Day 28: the end of the run, ordering window plus settlement window.
        // A day-21 injection is now inside it, because the run keeps going
        // while the last orders are delivered.
        disruptions: [{
          type: "WEATHER",
          offsetMs: 2_419_200_000,
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
    // To the hundredth of a kilogram, not to the bit: the snapshot rounds its
    // total and the database sums the acceptances one row at a time, so the two
    // agree on the figure a participant reads rather than on a double.
    expect(runSnapshot.json().deliveryAcceptedKg).toBeCloseTo(acceptedDelivery._sum.acceptedQuantity ?? 0, 2);
    expect(runSnapshot.json().deliveryAcceptedKg).toBeCloseTo(created.json().metrics.totalAcceptedKg, 2);
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
    const participantWeather = await server.inject({ method: "GET", url: "/v1/weather", headers: participantAuth });
    expect(participantWeather.statusCode).toBe(200);
    expect(participantWeather.json().simulationRunId).toBe(runId);
    const otherRunWeather = await server.inject({
      method: "GET",
      url: `/v1/weather?simulationRunId=${pair.json().baselineRunId}`,
      headers: participantAuth,
    });
    expect(otherRunWeather.statusCode).toBe(403);
    expect(otherRunWeather.json().code).toBe("RUN_SCOPE_FORBIDDEN");

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
        await prisma.cropBatch.create({ data: { id: batchId, farmId, cropType: "CUCUMBER", status: "HARVEST_READY", promisableFrom: new Date("2026-09-06"), availableToPromise: 10, provenance: "SYNTHETIC", simulationRunId: run.id } });
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
  const listingPayload = { cropBatchId: anaBatchId, quantity: { value: 5, unit: "kg" }, unitPrice: { amount: 6.5, currency: "XCD" }, availableFrom: "2026-09-06", availableUntil: "2026-09-12" };
  const orderPayload = { cropType: "CUCUMBER", neededBy: "2026-09-11T12:00:00Z", deliveryLocation: { latitude: 14.0101, longitude: -60.9875 } };

  async function observe(cropStage: string, estimate = 40) {
    return server.inject({
      method: "POST",
      url: "/v1/crop-observations",
      headers: mutationHeaders("farmer-ana", `observe-${cropStage.toLowerCase()}`),
      payload: { cropBatchId: anaBatchId, observedAt: "2026-09-06T08:00:00Z", cropStage, estimatedQuantity: { value: estimate, unit: "kg" }, provenance: "OBSERVED" },
    });
  }

  it("withdraws a ready crop's offers when it stops being ready, then reopens supply once it is reported ready again", async () => {
    await prisma.listing.updateMany({ where: { cropBatchId: anaBatchId }, data: { status: "ACTIVE", quantity: 20 } });
    expect((await observe("GROWING")).statusCode).toBe(201);

    // A crop that was on offer as ready and no longer is has its offers pulled:
    // a buyer must not be matched to produce that is not there. The forecast
    // itself survives, and so does a conservative promise dated from the window
    // the forecast gives, which is the product rather than a leak.
    const growing = await prisma.cropBatch.findUniqueOrThrow({ where: { id: anaBatchId } });
    expect(growing.status).toBe("GROWING");
    expect(growing.availableToPromise).toBeGreaterThan(0);
    expect(growing.promisableFrom).not.toBeNull();
    expect(growing.promisableFrom!.getTime()).toBeGreaterThan(Date.now());
    expect(await prisma.listing.count({ where: { cropBatchId: anaBatchId, status: "ACTIVE" } })).toBe(0);
    expect(await prisma.listing.count({ where: { cropBatchId: anaBatchId, status: "WITHDRAWN" } })).toBeGreaterThan(0);

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

    await prisma.cropBatch.update({ where: { id: anaBatchId }, data: { status: "HARVEST_READY", promisableFrom: new Date("2026-09-06"), availableToPromise: 12 } });
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
    await prisma.cropBatch.update({ where: { id: anaBatchId }, data: { status: "HARVEST_READY", promisableFrom: new Date("2026-09-06"), availableToPromise: 6 } });
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
    await prisma.cropBatch.update({ where: { id: anaBatchId }, data: { status: "HARVEST_READY", promisableFrom: new Date("2026-09-06"), availableToPromise: available } });
    const published = await server.inject({
      method: "POST",
      url: "/v1/listings",
      headers: mutationHeaders("farmer-ana", "partial-supply"),
      payload: { cropBatchId: anaBatchId, quantity: { value: available, unit: "kg" }, unitPrice: { amount: 6.5, currency: "XCD" }, availableFrom: "2026-09-06", availableUntil: "2026-09-12" },
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

describe("forward promises (#91)", () => {
  const anaBatchId = "11111111-1111-4111-8111-111111111111";
  const deliveryLocation = { latitude: 14.0101, longitude: -60.9875 };

  // Dates are relative because the forecast window is: the fixture model dates a
  // harvest from when it ran, so a hard-coded window would only be right on the
  // day it was written.
  const dayFromNow = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10);

  /** Leaves one growing cucumber batch as the only supply on the marketplace. */
  async function onlyGrowingSupply() {
    await prisma.order.updateMany({ where: { cropType: "CUCUMBER", lifecycleStatus: { in: ["REQUESTED", "AWAITING_APPROVAL"] } }, data: { lifecycleStatus: "CANCELLED" } });
    await prisma.allocation.updateMany({ where: { status: "PROPOSED" }, data: { status: "STALE" } });
    await prisma.listing.updateMany({ where: { cropType: "CUCUMBER" }, data: { status: "SOLD_OUT" } });
    const observed = await server.inject({
      method: "POST",
      url: "/v1/crop-observations",
      headers: mutationHeaders("farmer-ana", "observe-forward-growing"),
      payload: { cropBatchId: anaBatchId, observedAt: new Date().toISOString(), cropStage: "GROWING", estimatedQuantity: { value: 40, unit: "kg" }, provenance: "OBSERVED" },
    });
    expect(observed.statusCode).toBe(201);
    const batch = await server.inject({ method: "GET", url: `/v1/crop-batches/${anaBatchId}`, headers: auth("farmer-ana") });
    expect(batch.statusCode).toBe(200);
    return batch.json() as { status: string; availableToPromise: { value: number }; promisableFrom?: string };
  }

  it("promises a growing crop from its forecast window and refuses a listing that opens before it", async () => {
    const batch = await onlyGrowingSupply();
    // The conservative q10, not the optimistic maximum, and dated.
    expect(batch.status).toBe("GROWING");
    expect(batch.availableToPromise.value).toBeGreaterThan(0);
    expect(batch.promisableFrom).toBe(dayFromNow(1));

    const early = await server.inject({
      method: "POST",
      url: "/v1/listings",
      headers: mutationHeaders("farmer-ana", "forward-listing-early"),
      payload: { cropBatchId: anaBatchId, quantity: { value: 5, unit: "kg" }, unitPrice: { amount: 6.5, currency: "XCD" }, availableFrom: dayFromNow(0), availableUntil: dayFromNow(8) },
    });
    expect(early.statusCode).toBe(422);
    expect(early.json().code).toBe("LISTING_BEFORE_HARVEST_WINDOW");

    const published = await server.inject({
      method: "POST",
      url: "/v1/listings",
      headers: mutationHeaders("farmer-ana", "forward-listing"),
      payload: { cropBatchId: anaBatchId, quantity: { value: 5, unit: "kg" }, unitPrice: { amount: 6.5, currency: "XCD" }, availableFrom: batch.promisableFrom, availableUntil: dayFromNow(8) },
    });
    expect(published.statusCode).toBe(201);
    expect(published.json().availableFrom).toBe(batch.promisableFrom);
  });

  it("matches an order the growing crop can reach and names why it cannot reach an earlier one", async () => {
    const batch = await onlyGrowingSupply();
    const published = await server.inject({
      method: "POST",
      url: "/v1/listings",
      headers: mutationHeaders("farmer-ana", "forward-listing-match"),
      payload: { cropBatchId: anaBatchId, quantity: { value: 5, unit: "kg" }, unitPrice: { amount: 6.5, currency: "XCD" }, availableFrom: batch.promisableFrom, availableUntil: dayFromNow(8) },
    });
    expect(published.statusCode).toBe(201);

    // Due minutes after the harvest window opens: the produce exists on paper
    // but cannot be picked, driven and unloaded in five minutes.
    const tooSoon = await server.inject({
      method: "POST",
      url: "/v1/orders",
      headers: mutationHeaders("buyer-hotel", "forward-order-too-soon"),
      payload: { cropType: "CUCUMBER", requestedQuantity: { value: 5, unit: "kg" }, neededBy: `${batch.promisableFrom}T00:05:00Z`, deliveryLocation },
    });
    expect(tooSoon.statusCode).toBe(201);
    const waiting = await prisma.order.findUniqueOrThrow({ where: { id: tooSoon.json().orderId } });
    expect(waiting.lifecycleStatus).toBe("REQUESTED");
    expect(waiting.outcomeCause).toBe("NOT_READY_IN_TIME");
    expect(waiting.outcomeNote).toContain("cannot be harvested and delivered");

    // Two days later the same supply is a keepable promise.
    const inTime = await server.inject({
      method: "POST",
      url: "/v1/orders",
      headers: mutationHeaders("buyer-hotel", "forward-order-in-time"),
      payload: { cropType: "CUCUMBER", requestedQuantity: { value: 5, unit: "kg" }, neededBy: `${dayFromNow(3)}T12:00:00Z`, deliveryLocation },
    });
    expect(inTime.statusCode).toBe(201);
    const matched = await prisma.order.findUniqueOrThrow({ where: { id: inTime.json().orderId } });
    expect(matched.lifecycleStatus).toBe("AWAITING_APPROVAL");
    expect(matched.outcomeCause).toBeNull();
  });

  it("dates the delivery mission from the harvest window rather than from today", async () => {
    const batch = await onlyGrowingSupply();
    await server.inject({
      method: "POST",
      url: "/v1/listings",
      headers: mutationHeaders("farmer-ana", "forward-listing-mission"),
      payload: { cropBatchId: anaBatchId, quantity: { value: 5, unit: "kg" }, unitPrice: { amount: 6.5, currency: "XCD" }, availableFrom: batch.promisableFrom, availableUntil: dayFromNow(8) },
    });
    const placed = await server.inject({
      method: "POST",
      url: "/v1/orders",
      headers: mutationHeaders("buyer-hotel", "forward-order-mission"),
      payload: { cropType: "CUCUMBER", requestedQuantity: { value: 5, unit: "kg" }, neededBy: `${dayFromNow(4)}T12:00:00Z`, deliveryLocation },
    });
    const orderId = placed.json().orderId as string;

    for (const persona of ["buyer-hotel", "farmer-ana"]) {
      const approvals = (await server.inject({ method: "GET", url: "/v1/approvals?status=PENDING", headers: auth(persona) })).json().items;
      const approval = approvals.find((item: { context?: { orderId?: string } }) => item.context?.orderId === orderId);
      if (approval) expect((await decide(persona, approval.approvalId, "APPROVE")).statusCode).toBe(200);
    }

    const mission = await prisma.deliveryMission.findFirstOrThrow({ where: { orderId } });
    expect(mission.collectFrom).not.toBeNull();
    // The load is collectable when the crop is, and the estimated arrival runs
    // from there. Dating it from today would tell a transporter to leave now
    // for a field with nothing in it.
    expect(mission.collectFrom!.toISOString().slice(0, 10)).toBe(batch.promisableFrom);
    expect(mission.estimatedArrival!.getTime()).toBeGreaterThan(mission.collectFrom!.getTime());
    expect(mission.estimatedArrival!.getTime()).toBeLessThanOrEqual(mission.deadline.getTime());
  });
});

describe("payment terms and status (#74)", () => {
  const anaBatchId = "11111111-1111-4111-8111-111111111111";
  const unitPrice = 7.5;
  const dayMs = 24 * 60 * 60 * 1_000;
  const orderPayload = { cropType: "CUCUMBER", neededBy: "2026-09-25T12:00:00Z", deliveryLocation: { latitude: 14.0101, longitude: -60.9875 } };

  /** Leaves exactly `available` kg of one ready cucumber batch orderable at a known price. */
  async function onlySupply(available: number) {
    await prisma.order.updateMany({ where: { cropType: "CUCUMBER", lifecycleStatus: { in: ["REQUESTED", "AWAITING_APPROVAL"] } }, data: { lifecycleStatus: "CANCELLED" } });
    await prisma.allocation.updateMany({ where: { status: "PROPOSED" }, data: { status: "STALE" } });
    await prisma.listing.updateMany({ where: { cropType: "CUCUMBER" }, data: { status: "SOLD_OUT" } });
    await prisma.cropBatch.update({ where: { id: anaBatchId }, data: { status: "HARVEST_READY", promisableFrom: new Date("2026-09-06"), availableToPromise: available } });
    const published = await server.inject({
      method: "POST",
      url: "/v1/listings",
      headers: mutationHeaders("farmer-ana", "payment-supply"),
      payload: { cropBatchId: anaBatchId, quantity: { value: available, unit: "kg" }, unitPrice: { amount: unitPrice, currency: "XCD" }, availableFrom: "2026-09-06", availableUntil: "2026-09-26" },
    });
    expect(published.statusCode).toBe(201);
  }

  async function approveFor(persona: string, orderId: string) {
    const approvals = (await server.inject({ method: "GET", url: "/v1/approvals?status=PENDING", headers: auth(persona) })).json().items;
    const approval = approvals.find((item: { context?: { orderId?: string } }) => item.context?.orderId === orderId);
    expect((await decide(persona, approval.approvalId, "APPROVE")).statusCode).toBe(200);
  }

  async function completeDelivery(orderId: string, quantityKg: number, acceptedKg: number, prefix: string) {
    const mission = await prisma.deliveryMission.findFirstOrThrow({ where: { orderId } });
    const vehicles = (await server.inject({ method: "GET", url: "/v1/me/vehicles", headers: auth("transporter-daniel") })).json().items;
    expect((await server.inject({ method: "POST", url: `/v1/delivery-missions/${mission.id}/acceptance`, headers: mutationHeaders("transporter-daniel", `${prefix}-mission`), payload: { decision: "ACCEPT", vehicleId: vehicles[0].vehicleId } })).statusCode).toBe(200);
    for (const [index, updateType] of ["ARRIVED", "PICKED_UP", "ARRIVED", "DELIVERED"].entries()) {
      const update = await server.inject({ method: "POST", url: `/v1/delivery-missions/${mission.id}/updates`, headers: mutationHeaders("transporter-daniel", `${prefix}-${updateType.toLowerCase()}-${index}`), payload: { updateType, recordedAt: new Date(Date.UTC(2026, 8, 20, 9 + index)).toISOString() } });
      expect(update.statusCode).toBe(201);
    }
    const rejectedKg = Number((quantityKg - acceptedKg).toFixed(2));
    const acceptance = await server.inject({
      method: "POST",
      url: `/v1/deliveries/${mission.id}/acceptance`,
      headers: mutationHeaders("buyer-hotel", `${prefix}-acceptance`),
      payload: {
        outcome: rejectedKg > 0 ? "PARTIALLY_ACCEPTED" : "ACCEPTED",
        acceptedQuantity: { value: acceptedKg, unit: "kg" },
        rejectedQuantity: { value: rejectedKg, unit: "kg" },
        lineOutcomes: [{ cropBatchId: anaBatchId, acceptedQuantity: { value: acceptedKg, unit: "kg" }, rejectedQuantity: { value: rejectedKg, unit: "kg" } }],
        // The Product API refuses a rejection without an actionable reason, so a
        // priced delivery that is short still tells the farmer what to do next.
        ...(rejectedKg > 0 ? { reasonCode: "MATURITY_OR_QUALITY", nextAction: "Harvest one day later so the fruit reaches full size." } : {}),
      },
    });
    expect(acceptance.statusCode).toBe(201);
    return new Date(acceptance.json().acceptedAt as string);
  }

  /** Runs one order all the way to an accepted delivery. */
  async function deliveredOrder(quantityKg: number, acceptedKg: number, prefix: string) {
    await onlySupply(quantityKg);
    const placed = await server.inject({
      method: "POST",
      url: "/v1/orders",
      headers: mutationHeaders("buyer-hotel", `${prefix}-order`),
      payload: { ...orderPayload, requestedQuantity: { value: quantityKg, unit: "kg" } },
    });
    expect(placed.statusCode).toBe(201);
    const orderId = placed.json().orderId as string;

    // Nothing is owed before a commitment prices the order.
    const beforeCommitment = await server.inject({ method: "GET", url: `/v1/orders/${orderId}`, headers: auth("buyer-hotel") });
    expect(beforeCommitment.json().payment).toBeUndefined();

    await approveFor("buyer-hotel", orderId);
    await approveFor("farmer-ana", orderId);
    const acceptedAt = await completeDelivery(orderId, quantityKg, acceptedKg, prefix);
    return { orderId, acceptedAt };
  }

  it("applies the stakeholder-calibrated 14-day default and records an agreed 30-day term", async () => {
    await onlySupply(4);
    const standard = await server.inject({ method: "POST", url: "/v1/orders", headers: mutationHeaders("buyer-hotel", "payment-default-terms"), payload: { ...orderPayload, requestedQuantity: { value: 4, unit: "kg" } } });
    expect(standard.statusCode).toBe(201);
    expect(standard.json().paymentTermsDays).toBe(14);
    expect(standard.json().payment).toBeUndefined();

    await onlySupply(4);
    const negotiated = await server.inject({ method: "POST", url: "/v1/orders", headers: mutationHeaders("buyer-hotel", "payment-custom-terms"), payload: { ...orderPayload, requestedQuantity: { value: 4, unit: "kg" }, paymentTermsDays: 30 } });
    expect(negotiated.statusCode).toBe(201);
    expect(negotiated.json().paymentTermsDays).toBe(30);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: negotiated.json().orderId } })).paymentTermsDays).toBe(30);

    const invalid = await server.inject({ method: "POST", url: "/v1/orders", headers: mutationHeaders("buyer-hotel", "payment-invalid-terms"), payload: { ...orderPayload, requestedQuantity: { value: 4, unit: "kg" }, paymentTermsDays: 120 } });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json().code).toBe("INVALID_PAYMENT_TERMS");
  });

  it("prices the commitment, recomputes it on what arrived, and only starts the term at acceptance", async () => {
    await onlySupply(8);
    const placed = await server.inject({ method: "POST", url: "/v1/orders", headers: mutationHeaders("buyer-hotel", "payment-priced-order"), payload: { ...orderPayload, requestedQuantity: { value: 8, unit: "kg" } } });
    const orderId = placed.json().orderId as string;
    await approveFor("buyer-hotel", orderId);
    await approveFor("farmer-ana", orderId);

    // Committed but not delivered: the whole commitment is priced, nothing is due.
    const committed = await server.inject({ method: "GET", url: `/v1/orders/${orderId}`, headers: auth("buyer-hotel") });
    expect(committed.json().payment).toMatchObject({ status: "NOT_DUE", amount: { amount: 8 * unitPrice, currency: "XCD" } });
    expect(committed.json().payment.dueAt).toBeUndefined();

    const acceptedAt = await completeDelivery(orderId, 8, 6, "payment-priced");

    // Rejected produce is not billed: 6 kg at the 7.50 listing price.
    const settled = await server.inject({ method: "GET", url: `/v1/orders/${orderId}`, headers: auth("buyer-hotel") });
    expect(settled.json().payment).toMatchObject({ status: "NOT_DUE", amount: { amount: 6 * unitPrice, currency: "XCD" }, daysOutstanding: 0 });
    expect(new Date(settled.json().payment.dueAt).getTime()).toBe(acceptedAt.getTime() + 14 * dayMs);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).paymentAmount).toBe(45);
  });

  it("derives due and overdue from the caller's clock without storing a status", async () => {
    const { orderId, acceptedAt } = await deliveredOrder(6, 6, "payment-clock");
    const readAt = (offsetMs: number) => server.inject({
      method: "GET",
      url: `/v1/orders/${orderId}`,
      headers: { ...auth("buyer-hotel"), "x-harvest-simulation-time": new Date(acceptedAt.getTime() + offsetMs).toISOString() },
    });

    expect((await readAt(13 * dayMs)).json().payment).toMatchObject({ status: "NOT_DUE", daysOutstanding: 13 });
    expect((await readAt(14 * dayMs)).json().payment).toMatchObject({ status: "DUE", daysOutstanding: 14 });
    expect((await readAt(20 * dayMs)).json().payment).toMatchObject({ status: "OVERDUE", daysOutstanding: 20 });
    // No read wrote anything: the status is derived every time.
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).paidAt).toBeNull();
  });

  it("records one payment confirmation, replays it, and refuses a second", async () => {
    const { orderId, acceptedAt } = await deliveredOrder(6, 6, "payment-confirm");
    const paidAt = new Date(acceptedAt.getTime() + 20 * dayMs);
    const headers = { ...auth("buyer-hotel"), "idempotency-key": `payment-confirmation-${orderId}`, "x-harvest-simulation-time": paidAt.toISOString() };

    const confirmed = await server.inject({ method: "POST", url: `/v1/orders/${orderId}/payment-confirmations`, headers, payload: { reference: "Bank transfer 4471" } });
    expect(confirmed.statusCode).toBe(201);
    expect(confirmed.json()).toMatchObject({
      orderId,
      payment: { status: "PAID", amount: { amount: 6 * unitPrice, currency: "XCD" }, reference: "Bank transfer 4471", daysOutstanding: 20 },
    });
    expect(confirmed.json().payment.paidAt).toBe(paidAt.toISOString());

    const replayed = await server.inject({ method: "POST", url: `/v1/orders/${orderId}/payment-confirmations`, headers, payload: { reference: "Bank transfer 4471" } });
    expect(replayed.statusCode).toBe(201);
    expect(replayed.json()).toEqual(confirmed.json());

    const second = await server.inject({ method: "POST", url: `/v1/orders/${orderId}/payment-confirmations`, headers: mutationHeaders("buyer-hotel", "payment-second"), payload: { reference: "Bank transfer 4472" } });
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe("PAYMENT_ALREADY_CONFIRMED");

    // A paid order stays paid however far past its due date it is read.
    const long = await server.inject({ method: "GET", url: `/v1/orders/${orderId}`, headers: { ...auth("buyer-hotel"), "x-harvest-simulation-time": new Date(acceptedAt.getTime() + 400 * dayMs).toISOString() } });
    expect(long.json().payment).toMatchObject({ status: "PAID", daysOutstanding: 20 });

    const event = await prisma.domainEvent.findFirstOrThrow({ where: { eventType: "PAYMENT_CONFIRMED", entityId: orderId }, orderBy: { cursor: "desc" } });
    expect(event.payload).toMatchObject({ orderId, paymentTermsDays: 14, amount: { amount: 45, currency: "XCD" }, reference: "Bank transfer 4471", daysOutstanding: 20 });
  });

  it("refuses a confirmation before the delivery outcome is recorded", async () => {
    await onlySupply(4);
    const placed = await server.inject({ method: "POST", url: "/v1/orders", headers: mutationHeaders("buyer-hotel", "payment-undelivered"), payload: { ...orderPayload, requestedQuantity: { value: 4, unit: "kg" } } });
    const orderId = placed.json().orderId as string;
    const early = await server.inject({ method: "POST", url: `/v1/orders/${orderId}/payment-confirmations`, headers: mutationHeaders("buyer-hotel", "payment-early"), payload: {} });
    expect(early.statusCode).toBe(409);
    expect(early.json().code).toBe("PAYMENT_NOT_PAYABLE");
  });

  it("shows the supplying farmer what is owed and hides it from an unrelated farm", async () => {
    const { orderId } = await deliveredOrder(6, 6, "payment-visibility");

    const supplier = await server.inject({ method: "GET", url: `/v1/orders/${orderId}`, headers: auth("farmer-ana") });
    expect(supplier.statusCode).toBe(200);
    expect(supplier.json().payment).toMatchObject({ status: "NOT_DUE", amount: { amount: 6 * unitPrice, currency: "XCD" } });
    const listed = await server.inject({ method: "GET", url: "/v1/orders", headers: auth("farmer-ana") });
    expect(listed.json().items.find((item: { orderId: string }) => item.orderId === orderId).payment).toMatchObject({ amount: { amount: 6 * unitPrice, currency: "XCD" } });

    const unrelated = await server.inject({ method: "GET", url: `/v1/orders/${orderId}`, headers: auth("farmer-marcus") });
    expect(unrelated.statusCode).toBe(404);
    const unrelatedConfirmation = await server.inject({ method: "POST", url: `/v1/orders/${orderId}/payment-confirmations`, headers: mutationHeaders("farmer-marcus", "payment-forbidden"), payload: {} });
    expect(unrelatedConfirmation.statusCode).toBe(403);
  });
});

/**
 * The estimation method is chosen per run and stored with it, so these tests
 * assert what a reader of a saved run can trust: which method ran, that a
 * fallback forecast is labelled everywhere it surfaces, and that selecting the
 * learned model while it is unreachable fails the run instead of quietly
 * producing fixture numbers under a learned-model label.
 */
describe("per-run harvest estimation (#51)", () => {
  const basePayload = {
    scenarioId: "saint-lucia-demo-v1",
    policy: "HARVEST",
    seed: 42,
    decisionMode: "DETERMINISTIC",
    scope: { mode: "SELECTED", islandIds: ["saint-lucia"] },
  };

  const FALLBACK_LABEL = "Deterministic fallback estimate, not a learned-model prediction";
  /** The completed fallback run the later tests read back; set by the second test. */
  let fallbackRunId = "";

  function createRun(key: string, overrides: Record<string, unknown> = {}) {
    return server.inject({
      method: "POST",
      url: "/v1/simulation-runs",
      headers: mutationHeaders("operations-demo", key),
      payload: { ...basePayload, ...overrides },
    });
  }

  /**
   * What a run's forecasts claim, as a sorted multiset. Prediction and request
   * IDs are freshly generated per run by design, so they are excluded and the
   * comparison is order-independent rather than resting on a UUID tiebreak.
   */
  async function forecastFingerprint(runId: string) {
    const rows = await prisma.yieldPrediction.findMany({
      where: { simulationRunId: runId },
      select: { estimationMode: true, modelVersion: true, q10: true, q50: true, q90: true, readiness: true, confidence: true, generatedAt: true, warnings: true },
    });
    return rows.map((row) => JSON.stringify(row)).sort();
  }

  afterEach(() => vi.unstubAllGlobals());

  it("refuses a method the contract does not name", async () => {
    const rejected = await createRun("estimation-invalid", { estimationMode: "BEST_GUESS" });

    expect(rejected.statusCode).toBe(422);
    expect(rejected.json().code).toBe("INVALID_ESTIMATION_MODE");
    expect(await prisma.simulationRun.count({ where: { estimationMode: "LEARNED_MODEL" } })).toBe(0);
  });

  it("stores the fallback choice and labels every forecast the run produced", async () => {
    const created = await createRun("estimation-fallback", { estimationMode: "DETERMINISTIC_FALLBACK" });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ status: "COMPLETED", estimationMode: "DETERMINISTIC_FALLBACK" });
    const runId = created.json().runId as string;
    fallbackRunId = runId;

    // The fallback keeps the whole crop, listing, and marketplace chain
    // working; a run with no forecasts would make these assertions vacuous.
    const predictions = await prisma.yieldPrediction.findMany({ where: { simulationRunId: runId } });
    expect(predictions.length).toBeGreaterThan(0);
    expect(predictions.every((row) => row.estimationMode === "DETERMINISTIC_FALLBACK")).toBe(true);
    expect(predictions.every((row) => row.modelVersion.startsWith("fixture-"))).toBe(true);
    expect(predictions.every((row) => (row.warnings as string[])[0] === FALLBACK_LABEL)).toBe(true);

    // The saved trace names the method that ran, so a reader is not left
    // inferring it from the model version alone.
    const forecastSteps = await prisma.traceStep.findMany({ where: { simulationRunId: runId, kind: "TOOL_CALL", toolName: "deterministic-fallback-yield-model" } });
    expect(forecastSteps).toHaveLength(predictions.length);
    expect(await prisma.traceStep.count({ where: { simulationRunId: runId, toolName: "learned-yield-model" } })).toBe(0);
    expect(forecastSteps.every((step) => step.summary.includes("deterministic fallback"))).toBe(true);

    // What a participant sees. The prediction is read through the run's own
    // participant session, because run-scoped records stay inside their run.
    const farmerMapping = await prisma.simulationActorMapping.findFirstOrThrow({ where: { simulationRunId: runId, role: "FARMER", productActorId: { not: null } } });
    const participantSession = await server.inject({
      method: "POST",
      url: `/v1/simulation-runs/${runId}/participant-sessions`,
      headers: mutationHeaders("operations-demo", "estimation-participant"),
      payload: { productActorId: farmerMapping.productActorId },
    });
    expect(participantSession.statusCode).toBe(201);
    const participantAuth = { authorization: `Bearer ${participantSession.json().accessToken}` };
    const batches = await server.inject({ method: "GET", url: "/v1/crop-batches", headers: participantAuth });
    const forecastBatch = batches.json().items.find((item: { latestPredictionId: string | null }) => item.latestPredictionId);
    expect(forecastBatch).toBeDefined();
    const evidence = await server.inject({ method: "GET", url: `/v1/yield-predictions/${forecastBatch.latestPredictionId}`, headers: participantAuth });
    expect(evidence.statusCode).toBe(200);
    expect(evidence.json()).toMatchObject({ estimationMode: "DETERMINISTIC_FALLBACK", provenance: "MODEL_PREDICTED" });
    expect(evidence.json().modelVersion).toMatch(/^fixture-/);
    expect(evidence.json().warnings[0]).toBe(FALLBACK_LABEL);

    // Agent-action provenance. Only the forecast-producing tool carries the
    // method, so its absence elsewhere is information rather than an omission.
    const timeline = await server.inject({ method: "GET", url: `/v1/simulation-runs/${runId}/timeline`, headers: auth("operations-demo") });
    expect(timeline.json().estimationMode).toBe("DETERMINISTIC_FALLBACK");
    const actions = timeline.json().frames.flatMap((frame: { agentActions?: Array<{ toolName: string; estimationMode?: string }> }) => frame.agentActions ?? []);
    const forecastActions = actions.filter((action: { toolName: string }) => action.toolName === "submit_crop_observation");
    expect(forecastActions.length).toBeGreaterThan(0);
    expect(forecastActions.every((action: { estimationMode?: string }) => action.estimationMode === "DETERMINISTIC_FALLBACK")).toBe(true);
    expect(actions.filter((action: { toolName: string }) => action.toolName !== "submit_crop_observation").every((action: { estimationMode?: string }) => action.estimationMode === undefined)).toBe(true);

    const frame = await server.inject({ method: "GET", url: `/v1/simulation-runs/${runId}/world?frameIndex=0`, headers: auth("operations-demo") });
    expect(frame.json().estimationMode).toBe("DETERMINISTIC_FALLBACK");
  }, 180_000);

  it("reproduces identical forecasts for the same seed and method", async () => {
    expect(fallbackRunId).not.toBe("");
    const first = await prisma.simulationRun.findUniqueOrThrow({ where: { id: fallbackRunId } });
    const repeated = await createRun("estimation-fallback-repeat", { estimationMode: "DETERMINISTIC_FALLBACK" });
    expect(repeated.statusCode).toBe(201);
    const repeatedId = repeated.json().runId as string;
    expect(repeatedId).not.toBe(first.id);

    const stored = await prisma.simulationRun.findUniqueOrThrow({ where: { id: repeatedId } });
    expect(stored.determinismDigest).toBe(first.determinismDigest);
    expect(stored.metrics).toEqual(first.metrics);
    expect(await forecastFingerprint(repeatedId)).toEqual(await forecastFingerprint(first.id));
  }, 180_000);

  it("fails a learned-model run that cannot reach the service, writing no forecast", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", fetchSpy);

    const attempted = await createRun("estimation-learned-unreachable", { estimationMode: "LEARNED_MODEL" });

    expect(attempted.statusCode).toBe(502);
    expect(attempted.json().code).toBe("MODEL_UNAVAILABLE");
    expect(fetchSpy).toHaveBeenCalled();
    const failed = await prisma.simulationRun.findFirstOrThrow({ where: { estimationMode: "LEARNED_MODEL", policy: "HARVEST" }, orderBy: { createdAt: "desc" } });
    expect(failed).toMatchObject({ status: "FAILED", errorCode: "MODEL_UNAVAILABLE" });
    // The whole point of failing: not one fixture number was written under a
    // run that says it used the learned model.
    expect(await prisma.yieldPrediction.count({ where: { simulationRunId: failed.id } })).toBe(0);
    expect(await prisma.domainEvent.count({ where: { simulationRunId: failed.id, eventType: "FORECAST_PRODUCED" } })).toBe(0);
  }, 180_000);

  it("fails the same way when the learned service answers but rejects the request", async () => {
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 422 }));
    vi.stubGlobal("fetch", fetchSpy);

    const attempted = await createRun("estimation-learned-rejected", { estimationMode: "LEARNED_MODEL" });

    expect(attempted.statusCode).toBe(502);
    expect(attempted.json().code).toBe("MODEL_UNAVAILABLE");
    expect(attempted.json().detail).toContain("no fallback estimate was substituted");
    const failed = await prisma.simulationRun.findFirstOrThrow({ where: { estimationMode: "LEARNED_MODEL", policy: "HARVEST" }, orderBy: { createdAt: "desc" } });
    expect(await prisma.yieldPrediction.count({ where: { simulationRunId: failed.id } })).toBe(0);
  }, 180_000);

  it("replays and scrubs a completed run without asking any model for a forecast", async () => {
    expect(fallbackRunId).not.toBe("");
    const run = await prisma.simulationRun.findUniqueOrThrow({ where: { id: fallbackRunId } });
    const before = {
      predictions: await prisma.yieldPrediction.count({ where: { simulationRunId: run.id } }),
      forecasts: await prisma.domainEvent.count({ where: { simulationRunId: run.id, eventType: "FORECAST_PRODUCED" } }),
    };
    const fetchSpy = vi.fn(async () => {
      throw new Error("Replay must never request a forecast.");
    });
    vi.stubGlobal("fetch", fetchSpy);
    // Flipping the stored method is what makes this test mean anything: if a
    // replay path re-derived a forecast it would now resolve to the learned
    // service and hit the spy, instead of reading the saved prediction.
    await prisma.simulationRun.update({ where: { id: run.id }, data: { estimationMode: "LEARNED_MODEL" } });
    try {
      const timeline = await server.inject({ method: "GET", url: `/v1/simulation-runs/${run.id}/timeline`, headers: auth("operations-demo") });
      expect(timeline.statusCode).toBe(200);
      for (const frameIndex of [0, Math.floor(run.frameCount / 2), run.frameCount - 1]) {
        const frame = await server.inject({ method: "GET", url: `/v1/simulation-runs/${run.id}/world?frameIndex=${frameIndex}`, headers: auth("operations-demo") });
        expect(frame.statusCode).toBe(200);
      }
      const mapping = await prisma.simulationActorMapping.findFirstOrThrow({ where: { simulationRunId: run.id, role: "FARMER", productActorId: { not: null } } });
      const session = await server.inject({
        method: "POST",
        url: `/v1/simulation-runs/${run.id}/participant-sessions`,
        headers: mutationHeaders("operations-demo", "estimation-replay-read"),
        payload: { productActorId: mapping.productActorId },
      });
      const replayAuth = { authorization: `Bearer ${session.json().accessToken}` };
      const batches = await server.inject({ method: "GET", url: "/v1/crop-batches", headers: replayAuth });
      const batch = batches.json().items.find((item: { latestPredictionId: string | null }) => item.latestPredictionId);
      const evidence = await server.inject({ method: "GET", url: `/v1/yield-predictions/${batch.latestPredictionId}`, headers: replayAuth });
      expect(evidence.statusCode).toBe(200);
      // The saved forecast keeps the method that produced it, not the method
      // the run row now names.
      expect(evidence.json().estimationMode).toBe("DETERMINISTIC_FALLBACK");
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      await prisma.simulationRun.update({ where: { id: run.id }, data: { estimationMode: "DETERMINISTIC_FALLBACK" } });
    }

    expect(await prisma.yieldPrediction.count({ where: { simulationRunId: run.id } })).toBe(before.predictions);
    expect(await prisma.domainEvent.count({ where: { simulationRunId: run.id, eventType: "FORECAST_PRODUCED" } })).toBe(before.forecasts);
  }, 120_000);

  it("records the choice on a Baseline run and never acts on it", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error("Baseline runs must never request a forecast.");
    });
    vi.stubGlobal("fetch", fetchSpy);

    const baseline = await createRun("estimation-baseline", { policy: "BASELINE", estimationMode: "LEARNED_MODEL" });

    expect(baseline.statusCode).toBe(201);
    expect(baseline.json()).toMatchObject({ policy: "BASELINE", status: "COMPLETED", estimationMode: "LEARNED_MODEL" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await prisma.yieldPrediction.count({ where: { simulationRunId: baseline.json().runId } })).toBe(0);
  }, 180_000);
});

/**
 * Reproducibility is a product non-negotiable: an identical scenario, scope,
 * policy, seed and estimation mode must produce identical normalised results.
 * Connected runs used to hold only for some seeds (#83), because the
 * participants worked through their pending approvals, verification tasks and
 * available missions in Product identifier order and every Product identifier
 * is a random UUID. These seeds are checked three times each rather than twice
 * so a run that agrees with one neighbour by chance still fails.
 */
describe("connected run reproducibility (#83)", () => {
  const RUNS_PER_SEED = 3;
  const REPRODUCIBILITY_TIMEOUT_MS = 300_000;

  interface FrameSnapshot {
    activeListings: number;
    openDemands: number;
    ordersByStatus: Record<string, number>;
    orderOutcomes: Record<string, unknown>;
    deliveryAcceptedKg: number;
    approvedCommitmentCount: number;
    completedMissionCount: number;
    paymentOverdueCount?: number;
    activeMissionIds: string[];
    openExceptionIds: string[];
  }

  interface SavedFrame {
    eventType: string;
    at: string;
    agentActions?: Array<{ at: string; role: string; simulationActorId: string; toolName: string; status: string }>;
    operationsSnapshot?: FrameSnapshot;
  }

  /**
   * Everything about a run that the seed alone must decide. Identifiers are
   * left out because they are new in every run by design; counts stand in for
   * the two snapshot fields that carry them.
   */
  async function fingerprint(seed: number, attempt: number) {
    const created = await server.inject({
      method: "POST",
      url: "/v1/simulation-runs",
      headers: mutationHeaders("operations-demo", `reproducibility-${seed}-${attempt}`),
      payload: {
        scenarioId: "saint-lucia-demo-v1",
        policy: "HARVEST",
        seed,
        decisionMode: "DETERMINISTIC",
        scope: { mode: "SELECTED", islandIds: ["saint-lucia"] },
      },
    });
    expect(created.statusCode).toBe(201);
    const stored = await prisma.simulationRun.findUniqueOrThrow({ where: { id: created.json().runId as string } });
    const frames = (stored.frames as unknown as SavedFrame[]) ?? [];
    const closing = frames.at(-1)?.operationsSnapshot;
    const rejectedDeliveries = await prisma.deliveryAcceptance.findMany({ where: { simulationRunId: stored.id, rejectedQuantity: { gt: 0 }, acceptedQuantity: { gt: 0 } } });
    let multiLineRejections = 0;
    for (const delivery of rejectedDeliveries) {
      const approved = await prisma.allocation.findFirst({ where: { orderId: delivery.orderId, status: "APPROVED" } });
      if (approved && await prisma.allocationLine.count({ where: { allocationId: approved.id } }) > 1) multiLineRejections += 1;
    }
    // Explicitly keep the two-batch partial-rejection case in this repeated-seed
    // suite: first-line attribution feeds crop state and the world digest (#86).
    if (seed === 42) expect(multiLineRejections).toBeGreaterThan(0);
    return {
      multiLineRejections,
      digest: stored.determinismDigest,
      frameCount: stored.frameCount,
      metrics: stored.metrics,
      outcomeSummary: closing ? {
        activeListings: closing.activeListings,
        openDemands: closing.openDemands,
        ordersByStatus: closing.ordersByStatus,
        orderOutcomes: closing.orderOutcomes,
        deliveryAcceptedKg: closing.deliveryAcceptedKg,
        approvedCommitmentCount: closing.approvedCommitmentCount,
        completedMissionCount: closing.completedMissionCount,
        paymentOverdueCount: closing.paymentOverdueCount,
        activeMissions: closing.activeMissionIds.length,
        openExceptions: closing.openExceptionIds.length,
      } : null,
      toolSequence: frames.flatMap((frame, index) => (frame.agentActions ?? []).map((action) =>
        [index, frame.eventType, action.at, action.role, action.simulationActorId, action.toolName, action.status].join("|"))),
    };
  }

  it.each([42, 51, 99, 123])(
    "produces an identical world, frame count, outcome summary and action sequence for seed %i",
    async (seed) => {
      const attempts: Array<Awaited<ReturnType<typeof fingerprint>>> = [];
      for (let attempt = 1; attempt <= RUNS_PER_SEED; attempt += 1) attempts.push(await fingerprint(seed, attempt));
      const [first, ...repeats] = attempts;
      expect(first.digest).toEqual(expect.any(String));
      expect(first.frameCount).toBeGreaterThan(20);
      expect(first.outcomeSummary).not.toBeNull();
      expect(first.toolSequence.length).toBeGreaterThan(0);
      for (const repeat of repeats) {
        expect(repeat.multiLineRejections).toBe(first.multiLineRejections);
        expect(repeat.digest).toBe(first.digest);
        expect(repeat.frameCount).toBe(first.frameCount);
        expect(repeat.outcomeSummary).toEqual(first.outcomeSummary);
        expect(repeat.metrics).toEqual(first.metrics);
        expect(repeat.toolSequence).toEqual(first.toolSequence);
      }
    },
    REPRODUCIBILITY_TIMEOUT_MS,
  );
});
