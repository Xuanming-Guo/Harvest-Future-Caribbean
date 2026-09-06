/**
 * `GET /v1/weather` (#37).
 *
 * The property this file exists to hold: **the endpoint cannot return weather
 * for a day that has not happened**, because no such day is ever written. That
 * is checked here by asking for one, several ways, and getting the present back
 * rather than the future.
 *
 * Run scoping and the read_weather agent tool are exercised against a real
 * connected run in `api.integration.test.ts`, where a run already exists.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "../src/db.js";
import { buildServer } from "../src/server.js";

const server = await buildServer();
const tokens: Record<string, string> = {};

const auth = (persona: string) => ({ authorization: `Bearer ${tokens[persona]}` });

const PRODUCT_PERSONAS = ["farmer-ana", "buyer-hotel", "transporter-daniel", "coordinator-maya", "operations-demo"];

beforeAll(async () => {
  for (const persona of PRODUCT_PERSONAS) {
    const response = await server.inject({ method: "POST", url: "/dev/session", payload: { persona } });
    expect(response.statusCode).toBe(200);
    tokens[persona] = response.json().accessToken;
  }
});

afterAll(async () => server.close());

describe("island weather", () => {
  it("gives every product role the same answer", async () => {
    const answers = await Promise.all(
      PRODUCT_PERSONAS.map(async (persona) => {
        const response = await server.inject({ method: "GET", url: "/v1/weather", headers: auth(persona) });
        expect(response.statusCode).toBe(200);
        return response.json();
      }),
    );
    for (const answer of answers) expect(answer).toEqual(answers[0]);
  });

  it("labels a recorded day and a forecast day as different kinds of claim", async () => {
    const response = await server.inject({ method: "GET", url: "/v1/weather?islandId=saint-lucia", headers: auth("farmer-ana") });
    const body = response.json();

    expect(body.islandId).toBe("saint-lucia");
    expect(body.current.provenance).toBe("SYNTHETIC");
    expect(body.current.date).toBe(body.asOf);
    expect(["CLEAR", "CLOUD", "RAIN", "STORM"]).toContain(body.current.condition);
    expect(body.forecast.length).toBeGreaterThan(0);
    for (const day of body.forecast) {
      expect(day.provenance).toBe("MODEL_PREDICTED");
      expect(day.date > body.asOf).toBe(true);
      expect(day.leadDays).toBeGreaterThanOrEqual(1);
      expect(day.confidence).toBeGreaterThan(0);
      expect(day.confidence).toBeLessThanOrEqual(1);
    }
    // Confidence decays with lead time, so an outlook cannot pretend to certainty.
    const [first] = body.forecast;
    const last = body.forecast.at(-1);
    expect(last.confidence).toBeLessThanOrEqual(first.confidence);
  });

  it("cannot be pushed past the last recorded day", async () => {
    const latest = await server.inject({ method: "GET", url: "/v1/weather", headers: auth("farmer-ana") });
    const future = await server.inject({ method: "GET", url: "/v1/weather?asOf=2099-01-01", headers: auth("farmer-ana") });

    expect(future.statusCode).toBe(200);
    expect(future.json().asOf).toBe(latest.json().asOf);
    expect(future.json().current).toEqual(latest.json().current);
    // And nothing later than that day exists to be found by any other route.
    const stored = await prisma.weatherObservation.findMany({ where: { simulationRunId: null }, orderBy: { observedOn: "desc" } });
    expect(stored[0]?.observedOn.toISOString().slice(0, 10)).toBe(latest.json().asOf);
  });

  it("reads an earlier day as it was, without the days after it", async () => {
    const latest = await server.inject({ method: "GET", url: "/v1/weather", headers: auth("farmer-ana") });
    const earlier = await server.inject({ method: "GET", url: "/v1/weather?asOf=2026-09-01", headers: auth("farmer-ana") });

    expect(earlier.statusCode).toBe(200);
    expect(earlier.json().asOf).toBe("2026-09-01");
    expect(earlier.json().asOf < latest.json().asOf).toBe(true);
    for (const day of earlier.json().forecast) expect(day.date > "2026-09-01").toBe(true);
  });

  it("answers for an island it has never heard of without inventing weather", async () => {
    const response = await server.inject({ method: "GET", url: "/v1/weather?islandId=atlantis", headers: auth("coordinator-maya") });
    expect(response.statusCode).toBe(200);
    expect(response.json().current).toBeUndefined();
    expect(response.json().forecast).toEqual([]);
  });

  it("rejects a malformed date rather than guessing at one", async () => {
    const response = await server.inject({ method: "GET", url: "/v1/weather?asOf=next-tuesday", headers: auth("farmer-ana") });
    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe("INVALID_WEATHER_DATE");
  });

  it("requires authentication like every other product read", async () => {
    const response = await server.inject({ method: "GET", url: "/v1/weather" });
    expect(response.statusCode).toBe(401);
  });

  it("lets only an operator name a simulation run", async () => {
    const runId = "00000000-0000-4000-8000-0000000000aa";
    const farmer = await server.inject({ method: "GET", url: `/v1/weather?simulationRunId=${runId}`, headers: auth("farmer-ana") });
    expect(farmer.statusCode).toBe(403);
    expect(farmer.json().code).toBe("RUN_SCOPE_FORBIDDEN");

    const operations = await server.inject({ method: "GET", url: `/v1/weather?simulationRunId=${runId}`, headers: auth("operations-demo") });
    expect(operations.statusCode).toBe(200);
    expect(operations.json().current).toBeUndefined();
  });
});
