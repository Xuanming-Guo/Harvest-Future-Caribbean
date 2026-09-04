/**
 * Scoped inter-island trade over the Product API (#40).
 *
 * The property this file exists to hold: **an inter-island commitment cannot
 * bind anybody, and nothing can sail against it, until every human approval on
 * it is granted.** That is checked by trying to skip the gate and being refused,
 * then trying again after the gate clears and being allowed.
 *
 * The second property is that no route is ever created here. A link the
 * reviewed offline dataset does not record between the two islands asked for is
 * rejected rather than treated as a new service.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CUSTOMS_DISCLAIMER, SAILING_CAPACITY_KG, scopeMaritimeNetwork } from "@harvest/simulation";

import { signDevelopmentToken } from "../src/auth.js";
import { prisma } from "../src/db.js";
import { buildServer } from "../src/server.js";

const server = await buildServer();
const tokens: Record<string, string> = {};
const auth = (persona: string) => ({ authorization: `Bearer ${tokens[persona]}` });

const PERSONAS = ["coordinator-maya", "operations-demo"];

/**
 * Tokens for the two participants this commitment would actually bind.
 *
 * Signed for the order's own buyer and the batch's own farmer rather than for a
 * named persona: the approvals are addressed to those actor ids, and a test
 * that logged in as a *different* farmer would silently see no pending
 * approval and pass for the wrong reason.
 */
const actorTokens: Record<string, string> = {};

async function tokenForActor(actorId: string): Promise<string> {
  const existing = actorTokens[actorId];
  if (existing) return existing;
  const actor = await prisma.actor.findUniqueOrThrow({ where: { id: actorId } });
  const token = await signDevelopmentToken(actor);
  actorTokens[actorId] = token;
  return token;
}

const actorAuth = async (actorId: string) => ({ authorization: "Bearer " + (await tokenForActor(actorId)) });

/** The one published Saint Lucia connection in the reviewed dataset. */
const LINK_ID = "link-martinique-saint-lucia";
const ORIGIN = "martinique";
const DESTINATION = "saint-lucia";

let orderId = "";
let cropBatchId = "";
let buyerActorId = "";
let farmerActorId = "";

beforeAll(async () => {
  for (const persona of PERSONAS) {
    const response = await server.inject({ method: "POST", url: "/dev/session", payload: { persona } });
    expect(response.statusCode).toBe(200);
    tokens[persona] = response.json().accessToken;
  }

  const orders = await server.inject({ method: "GET", url: "/v1/orders?limit=50", headers: auth("coordinator-maya") });
  expect(orders.statusCode).toBe(200);
  orderId = orders.json().items[0].orderId;
  expect(orderId).toBeTruthy();

  const batches = await server.inject({ method: "GET", url: "/v1/crop-batches?limit=50", headers: auth("coordinator-maya") });
  expect(batches.statusCode).toBe(200);
  cropBatchId = batches.json().items[0].cropBatchId;

  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  buyerActorId = order.buyerId;
  const batch = await prisma.cropBatch.findUniqueOrThrow({ where: { id: cropBatchId } });
  const farm = await prisma.farm.findUniqueOrThrow({ where: { id: batch.farmId } });
  farmerActorId = farm.farmerId;
  expect(buyerActorId).toBeTruthy();
  expect(farmerActorId).toBeTruthy();
});

afterAll(async () => {
  await prisma.maritimeShipment.deleteMany({});
  await prisma.approval.deleteMany({ where: { subjectType: "INTER_ISLAND_COMMITMENT" } });
  await prisma.interIslandCommitment.deleteMany({});
  await server.close();
});

async function propose(overrides: Record<string, unknown> = {}) {
  return server.inject({
    method: "POST",
    url: "/v1/inter-island-commitments",
    headers: { ...auth("coordinator-maya"), "idempotency-key": `propose-${Math.random()}` },
    payload: {
      orderId,
      originIslandId: ORIGIN,
      destinationIslandId: DESTINATION,
      linkId: LINK_ID,
      lines: [{ cropBatchId, quantity: { value: 120, unit: "kg" } }],
      ...overrides,
    },
  });
}

function shipmentPayload() {
  const depart = new Date("2026-09-10T06:00:00Z");
  const arrive = new Date("2026-09-10T12:00:00Z");
  return {
    legs: [
      { kind: "PICKUP", fromLabel: "Farm", toLabel: "Fort-de-France", from: { latitude: 14.6, longitude: -61.07 }, to: { latitude: 14.6, longitude: -61.07 }, startsAt: depart.toISOString(), endsAt: depart.toISOString() },
      { kind: "SEA", fromLabel: "Fort-de-France", toLabel: "Castries", from: { latitude: 14.6, longitude: -61.07 }, to: { latitude: 14.01, longitude: -60.99 }, startsAt: depart.toISOString(), endsAt: arrive.toISOString(), journeyHoursSource: "PUBLIC_TIMETABLE" },
      { kind: "DELIVERY", fromLabel: "Castries", toLabel: "Buyer", from: { latitude: 14.01, longitude: -60.99 }, to: { latitude: 14.07, longitude: -60.95 }, startsAt: arrive.toISOString(), endsAt: arrive.toISOString() },
    ],
    customs: {
      portId: "port-saint-lucia-castries",
      status: "PENDING",
      documentationReference: "SYN-CUSTOMS-TEST0001",
      inspected: false,
      delayHours: 2,
      clearedAt: null,
      feeXcd: 75,
      disclaimer: CUSTOMS_DISCLAIMER,
      provenance: "SYNTHETIC",
    },
    scheduledDepartureAt: depart.toISOString(),
    scheduledArrivalAt: arrive.toISOString(),
    capacityKg: SAILING_CAPACITY_KG,
    loadedKg: 120,
  };
}

async function approveAll(commitmentId: string) {
  const pending = await prisma.approval.findMany({
    where: { subjectType: "INTER_ISLAND_COMMITMENT", subjectId: commitmentId, status: "PENDING" },
  });
  expect(pending.length).toBeGreaterThan(0);
  for (const approval of pending) {
    const response = await server.inject({
      method: "POST",
      url: `/v1/approvals/${approval.id}/decisions`,
      headers: { ...(await actorAuth(approval.requestedFromActorId)), "idempotency-key": `decide-${approval.id}` },
      payload: { decision: "APPROVE", reason: "Quantity, sailing and clearance window confirmed." },
    });
    expect(response.statusCode).toBe(200);
  }
}

describe("the public-reference network", () => {
  it("returns only ports and links inside the requested scope", async () => {
    const response = await server.inject({ method: "GET", url: `/v1/maritime-network?islandIds=${ORIGIN},${DESTINATION}`, headers: auth("coordinator-maya") });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    for (const port of body.ports) expect([ORIGIN, DESTINATION]).toContain(port.islandId);
    expect(body.links.map((link: { linkId: string }) => link.linkId)).toEqual([LINK_ID]);
    expect(body.disclaimer).toMatch(/SYNTHETIC/);
  });

  it("returns no link at all for a single island", async () => {
    const response = await server.inject({ method: "GET", url: `/v1/maritime-network?islandIds=${DESTINATION}`, headers: auth("operations-demo") });
    expect(response.statusCode).toBe(200);
    expect(response.json().links).toEqual([]);
  });

  it("carries source, licence and retrieval date on every record", async () => {
    const response = await server.inject({ method: "GET", url: `/v1/maritime-network?islandIds=${ORIGIN},${DESTINATION}`, headers: auth("operations-demo") });
    const body = response.json();
    const records = [...body.ports, ...body.links, ...body.rates];
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      expect(record.reference.evidenceType).toBe("PUBLIC_REFERENCE");
      expect(record.reference.sourceUrl).toMatch(/^https?:\/\//);
      expect(record.reference.publisher.length).toBeGreaterThan(0);
      expect(record.reference.licence.length).toBeGreaterThan(0);
      expect(record.reference.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("refuses an island the manifest does not carry", async () => {
    const response = await server.inject({ method: "GET", url: "/v1/maritime-network?islandIds=atlantis", headers: auth("coordinator-maya") });
    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe("UNKNOWN_ISLAND");
  });
});

describe("proposing a cross-island commitment", () => {
  it("stores the promise, the route citation and both currencies", async () => {
    const response = await propose();
    expect(response.statusCode).toBe(201);
    const body = response.json();

    expect(body.status).toBe("PROPOSED");
    expect(body.boundAt).toBeNull();
    expect(body.shipmentId).toBeNull();
    expect(body.route.linkId).toBe(LINK_ID);
    expect(body.route.journeyHoursSource).toBe("PUBLIC_TIMETABLE");
    expect(body.route.references.length).toBeGreaterThan(0);
    for (const reference of body.route.references) {
      expect(reference.evidenceType).toBe("PUBLIC_REFERENCE");
      expect(reference.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    // Saint Lucia is an XCD island, so both halves read XCD, and the rate that
    // says so is still cited rather than assumed.
    expect(body.cost.comparisonCurrency).toBe("XCD");
    expect(body.cost.localCurrency).toBe("XCD");
    expect(body.cost.rateProvenance).toBe("PUBLIC_REFERENCE");
    expect(body.cost.amountProvenance).toBe("SYNTHETIC");
    expect(body.approvalSummary.required).toBeGreaterThanOrEqual(2);
    expect(body.approvalSummary.pending).toBe(body.approvalSummary.required);

    await prisma.approval.deleteMany({ where: { subjectId: body.commitmentId } });
    await prisma.interIslandCommitment.delete({ where: { id: body.commitmentId } });
  });

  it("refuses a link the reviewed dataset does not record between these islands", async () => {
    const response = await propose({ linkId: "link-guadeloupe-dominica" });
    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe("UNKNOWN_MARITIME_ROUTE");
  });

  it("refuses an island pair with no published connection rather than inventing one", async () => {
    expect(scopeMaritimeNetwork(["barbados", DESTINATION]).links).toHaveLength(0);
    const response = await propose({ originIslandId: "barbados" });
    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe("NO_PUBLIC_ROUTE");
  });

  it("refuses a consignment past the synthetic sailing capacity", async () => {
    const response = await propose({ lines: [{ cropBatchId, quantity: { value: SAILING_CAPACITY_KG + 1, unit: "kg" } }] });
    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe("SAILING_CAPACITY_EXCEEDED");
  });

  it("is a coordinator's decision, not a buyer's", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/v1/inter-island-commitments",
      headers: { ...(await actorAuth(buyerActorId)), "idempotency-key": `propose-forbidden-${Math.random()}` },
      payload: { orderId, originIslandId: ORIGIN, destinationIslandId: DESTINATION, linkId: LINK_ID, lines: [{ cropBatchId, quantity: { value: 10, unit: "kg" } }] },
    });
    expect(response.statusCode).toBe(403);
  });
});

describe("the approval boundary", () => {
  it("refuses to book a sailing while any approval is still pending", async () => {
    const proposed = await propose();
    expect(proposed.statusCode).toBe(201);
    const commitmentId = proposed.json().commitmentId;

    const early = await server.inject({
      method: "POST",
      url: `/v1/inter-island-commitments/${commitmentId}/shipments`,
      headers: { ...auth("coordinator-maya"), "idempotency-key": `ship-early-${commitmentId}` },
      payload: shipmentPayload(),
    });
    expect(early.statusCode).toBe(409);
    expect(early.json().code).toBe("INTER_ISLAND_APPROVAL_REQUIRED");
    expect(await prisma.maritimeShipment.count({ where: { commitmentId } })).toBe(0);

    // One of two approvals is not enough either: a commitment binds when the
    // last participant agrees, not the first.
    const pending = await prisma.approval.findMany({
      where: { subjectType: "INTER_ISLAND_COMMITMENT", subjectId: commitmentId, status: "PENDING" },
      orderBy: { id: "asc" },
    });
    expect(pending.length).toBeGreaterThan(1);
    const first = pending[0]!;
    const decided = await server.inject({
      method: "POST",
      url: `/v1/approvals/${first.id}/decisions`,
      headers: { ...(await actorAuth(first.requestedFromActorId)), "idempotency-key": `decide-partial-${first.id}` },
      payload: { decision: "APPROVE" },
    });
    expect(decided.statusCode).toBe(200);

    const stillPending = await prisma.interIslandCommitment.findUniqueOrThrow({ where: { id: commitmentId } });
    expect(stillPending.status).toBe("PROPOSED");
    expect(stillPending.boundAt).toBeNull();

    const midway = await server.inject({
      method: "POST",
      url: `/v1/inter-island-commitments/${commitmentId}/shipments`,
      headers: { ...auth("coordinator-maya"), "idempotency-key": `ship-midway-${commitmentId}` },
      payload: shipmentPayload(),
    });
    expect(midway.statusCode).toBe(409);
    expect(await prisma.maritimeShipment.count({ where: { commitmentId } })).toBe(0);

    await prisma.approval.deleteMany({ where: { subjectId: commitmentId } });
    await prisma.interIslandCommitment.delete({ where: { id: commitmentId } });
  });

  it("books the sailing once every approval is granted, and only then", async () => {
    const proposed = await propose();
    const commitmentId = proposed.json().commitmentId;
    await approveAll(commitmentId);

    const bound = await prisma.interIslandCommitment.findUniqueOrThrow({ where: { id: commitmentId } });
    expect(bound.status).toBe("APPROVED");
    expect(bound.boundAt).not.toBeNull();

    const shipped = await server.inject({
      method: "POST",
      url: `/v1/inter-island-commitments/${commitmentId}/shipments`,
      headers: { ...auth("coordinator-maya"), "idempotency-key": `ship-${commitmentId}` },
      payload: shipmentPayload(),
    });
    expect(shipped.statusCode).toBe(201);
    const shipment = shipped.json();
    expect(shipment.status).toBe("SCHEDULED");
    expect(shipment.legs.map((leg: { kind: string }) => leg.kind)).toEqual(["PICKUP", "SEA", "DELIVERY"]);
    expect(shipment.customs.disclaimer).toMatch(/not a legal customs model/i);
    expect(shipment.networkProvenance).toBe("PUBLIC_REFERENCE");
    expect(shipment.operationsProvenance).toBe("SYNTHETIC");
    expect(shipment.cost.comparisonCurrency).toBe("XCD");

    // The events say the same thing the rows do.
    const events = await prisma.domainEvent.findMany({ where: { entityId: { in: [commitmentId, shipment.shipmentId] } }, orderBy: { occurredAt: "asc" } });
    const types = events.map((event) => event.eventType);
    expect(types).toContain("INTER_ISLAND_COMMITMENT_PROPOSED");
    expect(types).toContain("INTER_ISLAND_COMMITMENT_APPROVED");
    expect(types).toContain("MARITIME_SHIPMENT_SCHEDULED");
    expect(types.indexOf("INTER_ISLAND_COMMITMENT_APPROVED")).toBeLessThan(types.indexOf("MARITIME_SHIPMENT_SCHEDULED"));

    // And the order page can see both halves.
    const order = await server.inject({ method: "GET", url: `/v1/orders/${orderId}`, headers: await actorAuth(buyerActorId) });
    expect(order.statusCode).toBe(200);
    expect(order.json().interIslandCommitment.commitmentId).toBe(commitmentId);
    expect(order.json().maritimeShipment.shipmentId).toBe(shipment.shipmentId);
    expect(order.json().maritimeShipment.legs).toHaveLength(3);

    const listed = await server.inject({ method: "GET", url: `/v1/maritime-shipments?orderId=${orderId}`, headers: auth("coordinator-maya") });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items.map((item: { shipmentId: string }) => item.shipmentId)).toContain(shipment.shipmentId);

    await prisma.maritimeShipment.deleteMany({ where: { commitmentId } });
    await prisma.approval.deleteMany({ where: { subjectId: commitmentId } });
    await prisma.interIslandCommitment.delete({ where: { id: commitmentId } });
  });

  it("kills the commitment outright when one participant rejects it", async () => {
    const proposed = await propose();
    const commitmentId = proposed.json().commitmentId;

    const pending = await prisma.approval.findMany({
      where: { subjectType: "INTER_ISLAND_COMMITMENT", subjectId: commitmentId, status: "PENDING" },
      orderBy: { id: "asc" },
    });
    const mine = pending[0]!;
    expect(mine).toBeTruthy();
    const rejected = await server.inject({
      method: "POST",
      url: `/v1/approvals/${mine.id}/decisions`,
      headers: { ...(await actorAuth(mine.requestedFromActorId)), "idempotency-key": `reject-${mine.id}` },
      payload: { decision: "REJECT", reason: "The crop is promised locally.", reasonCode: "QUANTITY_MISMATCH", nextAction: "Offer the buyer a later sailing." },
    });
    expect(rejected.statusCode).toBe(200);

    const row = await prisma.interIslandCommitment.findUniqueOrThrow({ where: { id: commitmentId } });
    expect(row.status).toBe("REJECTED");
    expect(row.boundAt).toBeNull();
    const remaining = await prisma.approval.findMany({ where: { subjectId: commitmentId } });
    expect(remaining.every((approval) => approval.status !== "PENDING")).toBe(true);

    const attempted = await server.inject({
      method: "POST",
      url: `/v1/inter-island-commitments/${commitmentId}/shipments`,
      headers: { ...auth("coordinator-maya"), "idempotency-key": `ship-rejected-${commitmentId}` },
      payload: shipmentPayload(),
    });
    expect(attempted.statusCode).toBe(409);
    expect(attempted.json().code).toBe("INTER_ISLAND_APPROVAL_REQUIRED");

    await prisma.approval.deleteMany({ where: { subjectId: commitmentId } });
    await prisma.interIslandCommitment.delete({ where: { id: commitmentId } });
  });
});
