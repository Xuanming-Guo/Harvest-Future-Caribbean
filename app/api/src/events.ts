import { randomUUID } from "node:crypto";

import type { Prisma, Provenance } from "@prisma/client";

export interface EventInput {
  eventType: string;
  actorId: string;
  entityId: string;
  traceId: string;
  correlationId?: string;
  causationId?: string | null;
  simulationRunId?: string | null;
  simulationTime?: Date | null;
  provenance: Provenance;
  payload: Prisma.InputJsonValue;
}

export async function recordEvent(client: Prisma.TransactionClient, input: EventInput) {
  return client.domainEvent.create({
    data: {
      id: randomUUID(),
      eventType: input.eventType,
      occurredAt: new Date(),
      simulationTime: input.simulationTime ?? null,
      simulationRunId: input.simulationRunId ?? null,
      actorId: input.actorId,
      entityId: input.entityId,
      traceId: input.traceId,
      correlationId: input.correlationId ?? randomUUID(),
      causationId: input.causationId ?? null,
      schemaVersion: "1.0",
      provenance: input.provenance,
      payload: input.payload,
    },
  });
}

export function eventDto(row: {
  id: string;
  eventType: string;
  occurredAt: Date;
  simulationTime: Date | null;
  simulationRunId: string | null;
  actorId: string;
  entityId: string;
  traceId: string;
  correlationId: string;
  causationId: string | null;
  schemaVersion: string;
  provenance: Provenance;
  payload: unknown;
}) {
  return {
    eventId: row.id,
    eventType: row.eventType,
    occurredAt: row.occurredAt.toISOString(),
    ...(row.simulationTime ? { simulationTime: row.simulationTime.toISOString() } : {}),
    simulationRunId: row.simulationRunId,
    actorId: row.actorId,
    entityId: row.entityId,
    traceId: row.traceId,
    correlationId: row.correlationId,
    causationId: row.causationId,
    schemaVersion: row.schemaVersion,
    provenance: row.provenance,
    payload: row.payload,
  };
}
