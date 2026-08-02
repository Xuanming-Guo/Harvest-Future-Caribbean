import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildServer } from "../src/server.js";

const server = await buildServer();
let buyerToken = "";
let operationsToken = "";

beforeAll(async () => {
  await server.ready();
  const buyer = await server.inject({ method: "POST", url: "/dev/session", payload: { persona: "buyer-hotel" } });
  buyerToken = buyer.json().accessToken;
  const operations = await server.inject({ method: "POST", url: "/dev/session", payload: { persona: "operations-demo" } });
  operationsToken = operations.json().accessToken;
});

afterAll(async () => server.close());

describe("Product API website vertical slice", () => {
  it("returns seeded supply and never exposes hidden truth", async () => {
    const response = await server.inject({ method: "GET", url: "/v1/crop-batches", headers: { authorization: `Bearer ${operationsToken}` } });
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(2);
    expect(response.body).not.toContain("actual crop condition");
    expect(response.body).not.toContain("true weather damage");
  });

  it("replays an idempotent order response and rejects a changed body", async () => {
    const key = `test-order-${Date.now()}`;
    const payload = { cropType: "CUCUMBER", requestedQuantity: { value: 20, unit: "kg" }, neededBy: "2026-09-05T15:00:00Z", deliveryLocation: { latitude: 14.0101, longitude: -60.9875 }, listingIds: ["16161616-1616-4616-8616-161616161616", "16161616-1616-4616-8616-161616161617"] };
    const first = await server.inject({ method: "POST", url: "/v1/orders", headers: { authorization: `Bearer ${buyerToken}`, "idempotency-key": key }, payload });
    const replay = await server.inject({ method: "POST", url: "/v1/orders", headers: { authorization: `Bearer ${buyerToken}`, "idempotency-key": key }, payload });
    expect(first.statusCode).toBe(201);
    expect(replay.json()).toEqual(first.json());
    const conflict = await server.inject({ method: "POST", url: "/v1/orders", headers: { authorization: `Bearer ${buyerToken}`, "idempotency-key": key }, payload: { ...payload, requestedQuantity: { value: 19, unit: "kg" } } });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("requires authentication for public operations", async () => {
    const response = await server.inject({ method: "GET", url: "/v1/operations/snapshot" });
    expect(response.statusCode).toBe(401);
  });
});
