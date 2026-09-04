/**
 * A connected two-island run, end to end (#40).
 *
 * The property this file exists to hold: **the Product API records, the
 * physical simulation state, the participant view and the control-room route
 * describe the same consignment.** It is checked by running one seeded
 * two-island run through the real connected loop and asserting that the
 * shipment id, the ports, the link and the three legs match in every place they
 * appear.
 *
 * The second property is the approval boundary seen from the other side: every
 * shipment the run stored has an approved commitment behind it with a `boundAt`
 * that precedes the shipment, and every commitment that was never approved has
 * no shipment at all.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MARITIME_NETWORK_V1 } from "@harvest/simulation";

import { prisma } from "../src/db.js";
import { buildServer } from "../src/server.js";

const server = await buildServer();
let operationsToken = "";
const auth = () => ({ authorization: `Bearer ${operationsToken}` });

/** Saint Lucia and Martinique: one published FRS Express des Iles connection. */
const SCOPE = ["martinique", "saint-lucia"];
const SEED = 8675309;

interface RunRow {
  runId: string;
  status: string;
}

let runId = "";

beforeAll(async () => {
  const session = await server.inject({ method: "POST", url: "/dev/session", payload: { persona: "operations-demo" } });
  expect(session.statusCode).toBe(200);
  operationsToken = session.json().accessToken;

  const created = await server.inject({
    method: "POST",
    url: "/v1/simulation-runs",
    // Fresh key per test process: the API caches an idempotent run by key, and
    // reusing one would silently return a run created by an earlier version of
    // this code instead of exercising the current one.
    headers: { ...auth(), "idempotency-key": `ws40-connected-${SEED}-${Date.now()}` },
    payload: {
      scenarioId: "caribbean-islands-v1",
      policy: "HARVEST",
      seed: SEED,
      decisionMode: "DETERMINISTIC",
      scope: { mode: "SELECTED", islandIds: SCOPE },
    },
  });
  expect(created.statusCode).toBe(201);
  const run = created.json() as RunRow;
  expect(run.status).toBe("COMPLETED");
  runId = run.runId;
}, 300_000);

afterAll(async () => {
  await server.close();
});

describe("a connected two-island run", () => {
  it("scopes the maritime network to the two selected islands", async () => {
    const timeline = await server.inject({ method: "GET", url: `/v1/simulation-runs/${runId}/timeline`, headers: auth() });
    expect(timeline.statusCode).toBe(200);
    const scene = timeline.json().scene;
    expect(scene.maritime).toBeTruthy();
    for (const port of scene.maritime.ports) expect(SCOPE).toContain(port.islandId);
    expect(scene.maritime.links.map((link: { id: string }) => link.id)).toEqual(["link-martinique-saint-lucia"]);
    expect(scene.maritimeDisclaimer).toMatch(/SYNTHETIC/);
    expect(scene.maritimeAttributions.length).toBeGreaterThan(0);
    for (const attribution of scene.maritimeAttributions) {
      expect(attribution.sourceUrl).toMatch(/^https?:\/\//);
      expect(attribution.licence.length).toBeGreaterThan(0);
      expect(attribution.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("raises inter-island commitments through the human approval gate", async () => {
    const commitments = await prisma.interIslandCommitment.findMany({ where: { simulationRunId: runId } });
    expect(commitments.length).toBeGreaterThan(0);

    for (const commitment of commitments) {
      const approvals = await prisma.approval.findMany({
        where: { subjectType: "INTER_ISLAND_COMMITMENT", subjectId: commitment.id },
      });
      expect(approvals.length).toBeGreaterThan(0);

      const shipment = await prisma.maritimeShipment.findFirst({ where: { commitmentId: commitment.id } });
      if (shipment === null) {
        // A commitment with no sailing must not be marked shipped. It may well
        // be APPROVED: approval clears the gate, and the physical run may still
        // decline to load a boat when the crop no longer covers the promise.
        expect(commitment.status).not.toBe("SHIPPED");
        continue;
      }
      // A sailing exists, so every approval must have been granted first.
      expect(commitment.boundAt).not.toBeNull();
      expect(approvals.every((approval) => approval.status === "APPROVED")).toBe(true);

      // Ordering is asserted on the outbox cursor rather than on timestamps:
      // `boundAt` is simulation time and `createdAt` is wall clock, so
      // comparing the two would compare two different clocks.
      const approvedEvent = await prisma.domainEvent.findFirstOrThrow({
        where: { eventType: "INTER_ISLAND_COMMITMENT_APPROVED", entityId: commitment.id },
      });
      const scheduledEvent = await prisma.domainEvent.findFirstOrThrow({
        where: { eventType: "MARITIME_SHIPMENT_SCHEDULED", entityId: shipment.id },
      });
      expect(approvedEvent.cursor < scheduledEvent.cursor).toBe(true);
    }
  });

  it("agrees on the same consignment across the Product record, the replay frame and the route", async () => {
    const shipments = await prisma.maritimeShipment.findMany({ where: { simulationRunId: runId } });
    expect(shipments.length).toBeGreaterThan(0);

    const timeline = await server.inject({ method: "GET", url: `/v1/simulation-runs/${runId}/timeline`, headers: auth() });
    const frames = timeline.json().frames as Array<{ shipments?: Array<Record<string, unknown>>; missions: Array<Record<string, unknown>> }>;
    const framed = new Map<string, Record<string, unknown>>();
    for (const frame of frames) {
      for (const shipment of frame.shipments ?? []) framed.set(shipment.shipmentId as string, shipment);
    }
    expect(framed.size).toBeGreaterThan(0);

    // The legs are compared against the frame the shipment was *booked* in.
    // A later frame may carry a weather-delayed sea leg, which is a change the
    // run reported afterwards rather than a disagreement about what was booked.
    const firstSeen = new Map<string, Record<string, unknown>>();
    for (const frame of frames) {
      for (const shipment of frame.shipments ?? []) {
        if (!firstSeen.has(shipment.shipmentId as string)) firstSeen.set(shipment.shipmentId as string, shipment);
      }
    }

    for (const stored of shipments) {
      const simulationShipmentId = stored.simulationShipmentId;
      expect(simulationShipmentId, "Product record must name its simulation shipment").toBeTruthy();
      const replayed = framed.get(simulationShipmentId as string);
      const booked = firstSeen.get(simulationShipmentId as string);
      expect(replayed, `replay carries no shipment ${simulationShipmentId}`).toBeTruthy();
      expect(booked).toBeTruthy();
      // The final Product status is the final simulation status: the record is
      // kept current as the sailing happens rather than frozen at booking.
      expect(stored.status).toBe(replayed?.status);

      const commitment = await prisma.interIslandCommitment.findUniqueOrThrow({ where: { id: stored.commitmentId } });
      expect(commitment.linkId).toBe(replayed?.linkId);
      expect(commitment.originPortId).toBe(replayed?.originPortId);
      expect(commitment.destinationPortId).toBe(replayed?.destinationPortId);
      expect(commitment.operator).toBe(replayed?.operator);

      // The legs are the load-bearing part: a control room draws the sea leg
      // between exactly these two points.
      const storedLegs = stored.legs as unknown as Array<{ kind: string; startsAt: string; endsAt: string }>;
      const replayedLegs = booked?.legs as Array<{ kind: string; startsAt: number; endsAt: number }>;
      expect(storedLegs.map((leg) => leg.kind)).toEqual(["PICKUP", "SEA", "DELIVERY"]);
      expect(storedLegs.map((leg) => leg.kind)).toEqual(replayedLegs.map((leg) => leg.kind));
      for (const [index, leg] of storedLegs.entries()) {
        // The stored record is ISO-8601, which is whole milliseconds; the
        // engine instant can carry a fraction of one. Same instant, one
        // rounding.
        expect(Date.parse(leg.startsAt)).toBeCloseTo(replayedLegs[index]?.startsAt ?? -1, -1);
        expect(Date.parse(leg.endsAt)).toBeCloseTo(replayedLegs[index]?.endsAt ?? -1, -1);
      }

      // And the route it cites is one the reviewed dataset actually records.
      const link = MARITIME_NETWORK_V1.links.find((candidate) => candidate.id === commitment.linkId);
      expect(link, "shipment cites a link the dataset does not record").toBeTruthy();
      expect([link?.fromPortId, link?.toPortId]).toContain(commitment.originPortId);
      expect([link?.fromPortId, link?.toPortId]).toContain(commitment.destinationPortId);

      // The mission that carries it is in the replay too, so the globe has a
      // vehicle to draw along the route the shipment describes.
      const missionId = replayed?.missionId as string;
      const missionFrames = frames.flatMap((frame) => frame.missions).filter((mission) => mission.missionId === missionId);
      expect(missionFrames.length).toBeGreaterThan(0);
      expect(missionFrames.at(-1)?.mode).toBe("MARITIME");
    }
  });

  it("shows the buyer the legs, the checkpoint and both currencies", async () => {
    const shipment = await prisma.maritimeShipment.findFirstOrThrow({ where: { simulationRunId: runId } });
    const commitment = await prisma.interIslandCommitment.findUniqueOrThrow({ where: { id: shipment.commitmentId } });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: commitment.orderId } });
    const buyer = await prisma.actor.findUniqueOrThrow({ where: { id: order.buyerId } });

    const session = await server.inject({ method: "POST", url: "/dev/session", payload: { persona: buyer.authSubject } });
    const token = session.statusCode === 200 ? session.json().accessToken : null;
    // Simulated participants are created per run and are not dev personas, so
    // fall back to reading as operations, which sees every run-scoped order.
    const headers = token ? { authorization: `Bearer ${token}` } : auth();

    const response = await server.inject({ method: "GET", url: `/v1/orders/${commitment.orderId}`, headers });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.interIslandCommitment.commitmentId).toBe(commitment.id);
    expect(body.maritimeShipment.shipmentId).toBe(shipment.id);
    expect(body.maritimeShipment.legs).toHaveLength(3);
    expect(body.maritimeShipment.customs.disclaimer).toMatch(/not a legal customs model/i);
    expect(body.maritimeShipment.cost.comparisonCurrency).toBe("XCD");
    expect(body.maritimeShipment.cost.localCurrency.length).toBe(3);
    expect(body.maritimeShipment.networkProvenance).toBe("PUBLIC_REFERENCE");
    expect(body.maritimeShipment.operationsProvenance).toBe("SYNTHETIC");
    for (const reference of body.interIslandCommitment.route.references) {
      expect(reference.evidenceType).toBe("PUBLIC_REFERENCE");
      expect(reference.sourceUrl).toMatch(/^https?:\/\//);
      expect(reference.licence.length).toBeGreaterThan(0);
      expect(reference.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
