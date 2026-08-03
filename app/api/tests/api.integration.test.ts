import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildServer } from "../src/server.js";

const server = await buildServer();
const tokens: Record<string, string> = {};

async function signIn(persona: string) {
  const response = await server.inject({ method: "POST", url: "/dev/session", payload: { persona } });
  expect(response.statusCode).toBe(200);
  tokens[persona] = response.json().accessToken;
}

function auth(persona: string) {
  return { authorization: `Bearer ${tokens[persona]}` };
}

async function decide(persona: string, approvalId: string, decision: "APPROVE" | "REJECT") {
  return server.inject({ method: "POST", url: `/v1/approvals/${approvalId}/decisions`, headers: { ...auth(persona), "idempotency-key": `test-${decision.toLowerCase()}-${approvalId}` }, payload: { decision } });
}

beforeAll(async () => {
  await server.ready();
  for (const persona of ["buyer-hotel", "farmer-ana", "farmer-marcus", "transporter-daniel", "coordinator-maya"]) await signIn(persona);
});

afterAll(async () => server.close());

describe("role-scoped Product API", () => {
  it("limits crops and direct detail URLs to permitted actors", async () => {
    const ana = await server.inject({ method: "GET", url: "/v1/crop-batches", headers: auth("farmer-ana") });
    expect(ana.statusCode).toBe(200);
    expect(ana.json().items).toHaveLength(1);
    expect(ana.json().items[0].cropBatchId).toBe("11111111-1111-4111-8111-111111111111");
    const unrelated = await server.inject({ method: "GET", url: "/v1/crop-batches/11111111-1111-4111-8111-111111111111", headers: auth("farmer-marcus") });
    expect(unrelated.statusCode).toBe(404);
    const coordinator = await server.inject({ method: "GET", url: "/v1/crop-batches", headers: auth("coordinator-maya") });
    expect(coordinator.json().items).toHaveLength(2);
    expect(coordinator.body).not.toContain("actual crop condition");
    expect(coordinator.body).not.toContain("true weather damage");
  });

  it("returns only approvals targeted to the signed-in actor", async () => {
    const buyer = await server.inject({ method: "GET", url: "/v1/approvals?status=PENDING", headers: auth("buyer-hotel") });
    const ana = await server.inject({ method: "GET", url: "/v1/approvals?status=PENDING", headers: auth("farmer-ana") });
    const marcus = await server.inject({ method: "GET", url: "/v1/approvals?status=PENDING", headers: auth("farmer-marcus") });
    const transporter = await server.inject({ method: "GET", url: "/v1/approvals?status=PENDING", headers: auth("transporter-daniel") });
    expect(buyer.json().items).toHaveLength(1);
    expect(ana.json().items).toHaveLength(1);
    expect(marcus.json().items).toHaveLength(1);
    expect(transporter.statusCode).toBe(403);
    const buyerCannotDecide = await decide("buyer-hotel", ana.json().items[0].approvalId, "APPROVE");
    expect(buyerCannotDecide.statusCode).toBe(403);
  });

  it("rejects without reserving, then commits only after every required approval", async () => {
    const seeded = [
      ["buyer-hotel", "21212121-2121-4121-8121-212121212121", "APPROVE"],
      ["farmer-ana", "21212121-2121-4121-8121-212121212122", "APPROVE"],
    ] as const;
    for (const [persona, approvalId, decision] of seeded) expect((await decide(persona, approvalId, decision)).statusCode).toBe(200);
    expect((await server.inject({ method: "GET", url: "/v1/delivery-missions", headers: auth("buyer-hotel") })).json().items).toHaveLength(0);
    expect((await decide("farmer-marcus", "21212121-2121-4121-8121-212121212123", "REJECT")).statusCode).toBe(200);
    const rejected = await server.inject({ method: "GET", url: "/v1/orders/20202020-2020-4020-8020-202020202020", headers: auth("buyer-hotel") });
    expect(rejected.json().lifecycleStatus).toBe("REJECTED");
    expect((await server.inject({ method: "GET", url: "/v1/delivery-missions", headers: auth("buyer-hotel") })).json().items).toHaveLength(0);

    const payload = { cropType: "CUCUMBER", requestedQuantity: { value: 20, unit: "kg" }, neededBy: "2026-09-08T15:00:00Z", deliveryLocation: { latitude: 14.0101, longitude: -60.9875 }, listingIds: ["16161616-1616-4616-8616-161616161616", "16161616-1616-4616-8616-161616161617"] };
    const created = await server.inject({ method: "POST", url: "/v1/orders", headers: { ...auth("buyer-hotel"), "idempotency-key": "test-multiparty-order" }, payload });
    expect(created.statusCode).toBe(201);
    const orderId = created.json().orderId;
    const buyerApproval = (await server.inject({ method: "GET", url: "/v1/approvals?status=PENDING", headers: auth("buyer-hotel") })).json().items[0];
    const anaApproval = (await server.inject({ method: "GET", url: "/v1/approvals?status=PENDING", headers: auth("farmer-ana") })).json().items[0];
    const marcusApproval = (await server.inject({ method: "GET", url: "/v1/approvals?status=PENDING", headers: auth("farmer-marcus") })).json().items[0];
    await decide("buyer-hotel", buyerApproval.approvalId, "APPROVE");
    await decide("farmer-ana", anaApproval.approvalId, "APPROVE");
    expect((await server.inject({ method: "GET", url: "/v1/delivery-missions", headers: auth("buyer-hotel") })).json().items).toHaveLength(0);
    await decide("farmer-marcus", marcusApproval.approvalId, "APPROVE");
    const committed = await server.inject({ method: "GET", url: `/v1/orders/${orderId}`, headers: auth("buyer-hotel") });
    expect(committed.json().lifecycleStatus).toBe("COMMITTED");
    expect(committed.json().allocation.lines).toHaveLength(2);
    expect((await server.inject({ method: "GET", url: "/v1/delivery-missions", headers: auth("buyer-hotel") })).json().items).toHaveLength(1);
  });

  it("replays an idempotent demand and rejects a changed body", async () => {
    const payload = { cropType: "DASHEEN", quantity: { value: 10, unit: "kg" }, neededBy: "2026-09-10T12:00:00Z", deliveryLocation: { latitude: 14.0101, longitude: -60.9875 } };
    const headers = { ...auth("buyer-hotel"), "idempotency-key": "test-demand-replay" };
    const first = await server.inject({ method: "POST", url: "/v1/buyer-demands", headers, payload });
    const replay = await server.inject({ method: "POST", url: "/v1/buyer-demands", headers, payload });
    expect(first.statusCode).toBe(201);
    expect(replay.json()).toEqual(first.json());
    const conflict = await server.inject({ method: "POST", url: "/v1/buyer-demands", headers, payload: { ...payload, quantity: { value: 11, unit: "kg" } } });
    expect(conflict.statusCode).toBe(409);
  });

  it("does not serve operations or simulation runtime routes", async () => {
    for (const url of ["/v1/operations/snapshot", "/v1/simulation-runs/99999999-9999-4999-8999-999999999999", "/v1/paired-runs/99999999-9999-4999-8999-999999999999"]) {
      const response = await server.inject({ method: "GET", url, headers: auth("buyer-hotel") });
      expect(response.statusCode).toBe(404);
    }
  });
});
