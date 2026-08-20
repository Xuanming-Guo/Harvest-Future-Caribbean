import { AsyncLocalStorage } from "node:async_hooks";

import type { FastifyInstance } from "fastify";

const effectiveTime = new AsyncLocalStorage<Date>();

export function registerOperationClock(server: FastifyInstance) {
  server.addHook("onRequest", (request, _reply, done) => {
    const header = request.headers["x-harvest-simulation-time"];
    if (typeof header !== "string") return done();
    const parsed = new Date(header);
    if (Number.isNaN(parsed.valueOf())) return done(new Error("x-harvest-simulation-time must be an ISO-8601 date-time."));
    effectiveTime.run(parsed, done);
  });
}

export function operationNow() {
  return new Date(effectiveTime.getStore()?.getTime() ?? Date.now());
}

export function currentSimulationTime() {
  const value = effectiveTime.getStore();
  return value ? new Date(value.getTime()) : null;
}
