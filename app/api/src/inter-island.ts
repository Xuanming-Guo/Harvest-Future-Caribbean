/**
 * Cross-island commitments, sailings and the approval boundary between them
 * (issue #40).
 *
 * Two rules shape everything here.
 *
 * **A commitment is not a shipment.** `InterIslandCommitment` is a promise, and
 * `AGENTS.md` lists inter-island commitments among the decisions that require
 * human approval. `MaritimeShipment` is the movement. The API refuses to create
 * the second from a commitment whose approvals are not all granted, so "cannot
 * bind without approval" is a missing row rather than a flag somebody could
 * forget to check.
 *
 * **A route is never created here.** Ports, links and exchange rates come from
 * the reviewed offline dataset that `@harvest/simulation` scopes, and a request
 * naming a link the dataset does not record — or one whose ports fall outside
 * the islands asked for — is rejected. Public route existence is evidence that
 * infrastructure exists; it is not evidence of a produce service, a timetable,
 * a capacity or a price, and none of those is read from it.
 */

import { randomUUID } from "node:crypto";

import { Prisma, Provenance, type InterIslandCommitment, type MaritimeShipment } from "@prisma/client";
import {
  CUSTOMS_DISCLAIMER,
  MARITIME_SYNTHETIC_DISCLAIMER,
  SAILING_CAPACITY_KG,
  routesBetween,
  scopeMaritimeNetwork,
  shipmentCostXcd,
  toDualCurrency,
  CARIBBEAN_ISLANDS_V1,
  COMPARISON_CURRENCY,
  type MaritimeReference,
  type MaritimeRoute,
  type ScopedMaritimeNetwork,
} from "@harvest/simulation";

import { operationNow } from "./clock.js";
import { prisma } from "./db.js";
import { recordEvent } from "./events.js";
import { httpError, readQuantity } from "./http.js";
import { quantity } from "./serializers.js";

type JsonObject = Record<string, unknown>;

export interface CommitmentLine {
  cropBatchId: string;
  quantity: number;
}

/**
 * The set of commitment statuses this workflow moves through.
 *
 * `PROPOSED` binds nobody. `APPROVED` is the only status a shipment may be
 * created from. `SHIPPED` records that one has been.
 */
export type InterIslandStatus = "PROPOSED" | "APPROVED" | "REJECTED" | "SHIPPED" | "CANCELLED";

const citation = (reference: MaritimeReference) => ({
  sourceTitle: reference.source.title,
  sourceUrl: reference.source.url,
  publisher: reference.source.publisher,
  licence: reference.licence,
  retrievedAt: reference.retrievedAt,
  geography: reference.geography,
  evidenceType: "PUBLIC_REFERENCE" as const,
});

function islandCurrency(islandId: string): string {
  return CARIBBEAN_ISLANDS_V1.find((island) => island.islandId === islandId)?.currency ?? COMPARISON_CURRENCY;
}

/**
 * The network for one scope, built from the reviewed dataset on every call.
 *
 * Cheap — the dataset is a few dozen records held in memory — and rebuilt
 * rather than cached so that a scope can never be answered from a wider one
 * somebody looked up earlier.
 */
export function networkForScope(islandIds: readonly string[]): ScopedMaritimeNetwork {
  return scopeMaritimeNetwork(islandIds);
}

/** Public-reference network for a scope, in the shape `MaritimeNetwork` publishes. */
export function maritimeNetworkDto(islandIds: readonly string[]): JsonObject {
  const network = networkForScope(islandIds);
  return {
    version: network.version,
    generatedAt: network.generatedAt,
    islandIds: [...network.islandIds],
    ports: network.ports.map((port) => ({
      portId: port.id,
      name: port.name,
      islandId: port.islandId,
      position: { latitude: port.latitude, longitude: port.longitude },
      portType: port.portType,
      reference: citation(port.reference),
    })),
    links: network.links.map((link) => ({
      linkId: link.id,
      fromPortId: link.fromPortId,
      toPortId: link.toPortId,
      mode: link.mode,
      operator: link.operator,
      typicalJourneyHours: link.typicalJourneyHours,
      reference: citation(link.reference),
    })),
    rates: network.rates.map((rate) => ({
      currency: rate.currency,
      name: rate.name,
      regime: rate.regime,
      islandIds: [...rate.islandIds],
      unitsPerUSD: rate.unitsPerUSD,
      unitsPerXCD: rate.unitsPerXCD,
      reference: citation(rate.reference),
    })),
    ratesAsOf: network.ratesAsOf,
    disclaimer: MARITIME_SYNTHETIC_DISCLAIMER,
  };
}

/**
 * Resolves a requested origin island and link into a route the dataset records.
 *
 * Rejects rather than repairs. A link that does not exist, or one that does not
 * join these two islands in this direction, is a claim about a service nobody
 * published, and the issue is explicit that a missing connection must not be
 * invented.
 */
export function resolveRoute(
  network: ScopedMaritimeNetwork,
  originIslandId: string,
  destinationIslandId: string,
  linkId: string,
): MaritimeRoute {
  if (originIslandId === destinationIslandId) {
    throw httpError(422, "INTER_ISLAND_SAME_ISLAND", "An inter-island commitment needs two different islands.");
  }
  const options = routesBetween(network, originIslandId, destinationIslandId);
  if (options.length === 0) {
    throw httpError(
      422,
      "NO_PUBLIC_ROUTE",
      `The reviewed maritime network records no published connection from '${originIslandId}' to '${destinationIslandId}'. No route is invented to fill the gap.`,
    );
  }
  const route = options.find((option) => option.linkId === linkId);
  if (!route) {
    throw httpError(
      422,
      "UNKNOWN_MARITIME_ROUTE",
      `Link '${linkId}' is not a published connection between '${originIslandId}' and '${destinationIslandId}' in this scope.`,
    );
  }
  return route;
}

/** Freight plus clearance for one consignment, in XCD and the buyer's currency. */
export function commitmentCost(network: ScopedMaritimeNetwork, quantityKg: number, destinationIslandId: string) {
  const lines = shipmentCostXcd(quantityKg);
  const localCurrency = islandCurrency(destinationIslandId);
  const dual =
    toDualCurrency(network, lines.totalXcd, localCurrency) ?? toDualCurrency(network, lines.totalXcd, COMPARISON_CURRENCY);
  if (!dual) {
    throw httpError(422, "NO_EXCHANGE_RATE", "The reviewed dataset carries no exchange rate for this scope.");
  }
  return { lines, dual };
}

export function interIslandCommitmentDto(
  row: InterIslandCommitment,
  approvalSummary: JsonObject,
  shipmentId?: string | null,
): JsonObject {
  const references = row.networkReferences as unknown as Array<Record<string, unknown>>;
  return {
    commitmentId: row.id,
    orderId: row.orderId,
    status: row.status,
    originIslandId: row.originIslandId,
    destinationIslandId: row.destinationIslandId,
    route: {
      linkId: row.linkId,
      originPortId: row.originPortId,
      destinationPortId: row.destinationPortId,
      operator: row.operator,
      seaLegHours: row.seaLegHours,
      journeyHoursSource: row.journeyHoursSource,
      references,
    },
    quantity: quantity(Number(row.quantity.toFixed(2))),
    cost: {
      localAmount: Number(row.localCostAmount.toFixed(2)),
      localCurrency: row.localCurrency,
      comparisonAmount: Number(row.costXcd.toFixed(2)),
      comparisonCurrency: COMPARISON_CURRENCY,
      unitsPerComparisonCurrency: row.unitsPerXcd,
      rateProvenance: "PUBLIC_REFERENCE",
      amountProvenance: "SYNTHETIC",
      rateAsOf: row.rateAsOf,
    },
    lines: (row.lines as unknown as CommitmentLine[]).map((line) => ({
      cropBatchId: line.cropBatchId,
      quantity: quantity(Number(line.quantity.toFixed(2))),
    })),
    approvalSummary,
    boundAt: row.boundAt ? row.boundAt.toISOString() : null,
    shipmentId: shipmentId ?? null,
    provenanceNote: MARITIME_SYNTHETIC_DISCLAIMER,
    createdAt: row.createdAt.toISOString(),
  };
}

export function maritimeShipmentDto(row: MaritimeShipment, commitment: InterIslandCommitment): JsonObject {
  const references = commitment.networkReferences as unknown as Array<Record<string, unknown>>;
  return {
    shipmentId: row.id,
    commitmentId: row.commitmentId,
    orderId: row.orderId,
    status: row.status,
    originIslandId: commitment.originIslandId,
    destinationIslandId: commitment.destinationIslandId,
    route: {
      linkId: commitment.linkId,
      originPortId: commitment.originPortId,
      destinationPortId: commitment.destinationPortId,
      operator: commitment.operator,
      seaLegHours: commitment.seaLegHours,
      journeyHoursSource: commitment.journeyHoursSource,
      references,
    },
    capacityKg: row.capacityKg,
    loadedKg: Number(row.loadedKg.toFixed(2)),
    legs: row.legs,
    customs: row.customs,
    cost: {
      localAmount: Number(commitment.localCostAmount.toFixed(2)),
      localCurrency: commitment.localCurrency,
      comparisonAmount: Number(commitment.costXcd.toFixed(2)),
      comparisonCurrency: COMPARISON_CURRENCY,
      unitsPerComparisonCurrency: commitment.unitsPerXcd,
      rateProvenance: "PUBLIC_REFERENCE",
      amountProvenance: "SYNTHETIC",
      rateAsOf: commitment.rateAsOf,
    },
    scheduledDepartureAt: row.scheduledDepartureAt.toISOString(),
    scheduledArrivalAt: row.scheduledArrivalAt.toISOString(),
    actualDepartureAt: row.actualDepartureAt ? row.actualDepartureAt.toISOString() : null,
    actualArrivalAt: row.actualArrivalAt ? row.actualArrivalAt.toISOString() : null,
    deliveredAt: row.deliveredAt ? row.deliveredAt.toISOString() : null,
    failureReason: row.failureReason,
    weatherDelayHours: row.weatherDelayHours,
    simulationShipmentId: row.simulationShipmentId,
    // Two labels, because a shipment mixes two kinds of claim and one label
    // would let a reader take the synthetic half for cited evidence.
    networkProvenance: "PUBLIC_REFERENCE",
    operationsProvenance: "SYNTHETIC",
    createdAt: row.createdAt.toISOString(),
  };
}

export function readCommitmentLines(value: unknown): CommitmentLine[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw httpError(400, "VALIDATION_FAILED", "lines must be a non-empty array.");
  }
  return value.map((entry, index) => {
    const line = entry as JsonObject;
    const cropBatchId = line.cropBatchId;
    if (typeof cropBatchId !== "string" || !cropBatchId.trim()) {
      throw httpError(400, "VALIDATION_FAILED", `lines[${index}].cropBatchId must be a non-empty string.`);
    }
    return { cropBatchId: cropBatchId.trim(), quantity: readQuantity(line.quantity, `lines[${index}].quantity`) };
  });
}

/**
 * Proposes a cross-island fill and opens its approval gate.
 *
 * The islands in scope are the order's own island plus the requested origin.
 * Deriving the scope from the request rather than from a stored run keeps this
 * honest for a standalone Product API too: whatever the caller may see, it may
 * only ever name a link the dataset records between those two islands.
 */
export async function proposeInterIslandCommitment(input: {
  orderId: string;
  originIslandId: string;
  destinationIslandId: string;
  linkId: string;
  lines: CommitmentLine[];
  actorId: string;
  approverActorIds: string[];
  simulationRunId: string | null;
  simulationShipmentId?: string;
}): Promise<InterIslandCommitment> {
  const network = networkForScope([input.originIslandId, input.destinationIslandId]);
  const route = resolveRoute(network, input.originIslandId, input.destinationIslandId, input.linkId);

  const totalKg = input.lines.reduce((total, line) => total + line.quantity, 0);
  if (totalKg <= 0) throw httpError(422, "INVALID_QUANTITY", "An inter-island commitment must move a positive quantity.");
  if (totalKg > SAILING_CAPACITY_KG) {
    throw httpError(
      422,
      "SAILING_CAPACITY_EXCEEDED",
      `One sailing carries at most ${SAILING_CAPACITY_KG} kg under this simulation's synthetic allowance.`,
    );
  }

  const { dual } = commitmentCost(network, totalKg, input.destinationIslandId);
  const originPort = network.ports.find((port) => port.id === route.originPortId);
  const destinationPort = network.ports.find((port) => port.id === route.destinationPortId);
  const references = [
    ...(originPort ? [citation(originPort.reference)] : []),
    ...(destinationPort ? [citation(destinationPort.reference)] : []),
    citation(route.reference),
    ...(dual.rateSource ? [citation(dual.rateSource)] : []),
  ];

  const commitmentId = randomUUID();
  const approverIds = [...new Set(input.approverActorIds)].sort();
  if (approverIds.length === 0) {
    throw httpError(422, "NO_APPROVERS", "An inter-island commitment needs at least one human approver.");
  }

  return prisma.$transaction(async (tx) => {
    const created = await tx.interIslandCommitment.create({
      data: {
        id: commitmentId,
        orderId: input.orderId,
        status: "PROPOSED",
        originIslandId: input.originIslandId,
        destinationIslandId: input.destinationIslandId,
        linkId: route.linkId,
        originPortId: route.originPortId,
        destinationPortId: route.destinationPortId,
        operator: route.operator,
        seaLegHours: route.seaLegHours,
        journeyHoursSource: route.journeyHoursSource,
        quantity: Number(totalKg.toFixed(2)),
        costXcd: dual.comparisonAmount,
        localCurrency: dual.localCurrency,
        localCostAmount: dual.localAmount,
        unitsPerXcd: dual.unitsPerComparisonCurrency,
        rateAsOf: dual.rateAsOf,
        lines: input.lines as unknown as Prisma.InputJsonValue,
        networkReferences: references as unknown as Prisma.InputJsonValue,
        boundAt: null,
        simulationRunId: input.simulationRunId,
      },
    });

    await tx.approval.createMany({
      data: approverIds.map((requestedFromActorId) => ({
        id: randomUUID(),
        subjectType: "INTER_ISLAND_COMMITMENT",
        subjectId: commitmentId,
        requestedFromActorId,
        status: "PENDING",
        requestedAt: operationNow(),
        simulationRunId: input.simulationRunId,
      })),
    });

    await recordEvent(tx, {
      eventType: "INTER_ISLAND_COMMITMENT_PROPOSED",
      actorId: input.actorId,
      entityId: commitmentId,
      traceId: randomUUID(),
      provenance: Provenance.INFERRED,
      simulationRunId: input.simulationRunId,
      payload: {
        commitmentId,
        orderId: input.orderId,
        originIslandId: input.originIslandId,
        destinationIslandId: input.destinationIslandId,
        linkId: route.linkId,
        originPortId: route.originPortId,
        destinationPortId: route.destinationPortId,
        operator: route.operator,
        seaLegHours: route.seaLegHours,
        journeyHoursSource: route.journeyHoursSource,
        quantity: { value: Number(totalKg.toFixed(2)), unit: "kg" },
        costXcd: dual.comparisonAmount,
        localCurrency: dual.localCurrency,
        localCostAmount: dual.localAmount,
        approversRequired: approverIds.length,
        note: MARITIME_SYNTHETIC_DISCLAIMER,
      },
    });

    return created;
  });
}

/**
 * Applies one approval decision to a cross-island commitment.
 *
 * The commitment only becomes binding when the *last* pending approval is
 * granted, so a single participant clicking approve does not commit the others.
 */
export async function decideInterIslandApproval(
  tx: Prisma.TransactionClient,
  approval: { id: string; subjectId: string; simulationRunId: string | null },
  actorId: string,
  decision: "APPROVE" | "REJECT",
  reason: string | undefined,
  reasonColumns: Record<string, unknown>,
) {
  const commitment = await tx.interIslandCommitment.findUnique({ where: { id: approval.subjectId } });
  if (!commitment) throw httpError(409, "SUBJECT_NOT_FOUND", "The inter-island commitment no longer exists.");
  if (commitment.status !== "PROPOSED") {
    throw httpError(409, "STALE_APPROVAL", "This inter-island commitment is no longer awaiting approval.");
  }

  const decidedAt = operationNow();
  await tx.approval.update({
    where: { id: approval.id },
    data: { status: decision === "APPROVE" ? "APPROVED" : "REJECTED", decidedBy: actorId, decidedAt, reason, ...reasonColumns },
  });

  if (decision === "REJECT") {
    await tx.interIslandCommitment.update({ where: { id: commitment.id }, data: { status: "REJECTED" } });
    await tx.approval.updateMany({
      where: { subjectType: "INTER_ISLAND_COMMITMENT", subjectId: commitment.id, status: "PENDING" },
      data: { status: "CANCELLED", decidedAt, reason: "Cancelled after another participant rejected the inter-island commitment." },
    });
  } else {
    const stillPending = await tx.approval.count({
      where: { subjectType: "INTER_ISLAND_COMMITMENT", subjectId: commitment.id, status: "PENDING" },
    });
    if (stillPending === 0) {
      await tx.interIslandCommitment.update({
        where: { id: commitment.id },
        data: { status: "APPROVED", boundAt: decidedAt },
      });
      await recordEvent(tx, {
        eventType: "INTER_ISLAND_COMMITMENT_APPROVED",
        actorId,
        entityId: commitment.id,
        traceId: commitment.traceId ?? randomUUID(),
        provenance: Provenance.OBSERVED,
        simulationRunId: approval.simulationRunId,
        payload: { commitmentId: commitment.id, orderId: commitment.orderId, boundAt: decidedAt.toISOString() },
      });
    }
  }

  await recordEvent(tx, {
    eventType: "APPROVAL_DECIDED",
    actorId,
    entityId: approval.id,
    traceId: commitment.traceId ?? randomUUID(),
    provenance: Provenance.OBSERVED,
    simulationRunId: approval.simulationRunId,
    payload: {
      approvalId: approval.id,
      subjectType: "INTER_ISLAND_COMMITMENT",
      subjectId: commitment.id,
      decision,
    },
  });

  return tx.approval.findUniqueOrThrow({ where: { id: approval.id } });
}

/**
 * Books an approved commitment onto its sailing.
 *
 * The `boundAt` check is the enforcement point for "an inter-island commitment
 * cannot bypass required human approval". It is a `409` rather than a silent
 * no-op so a caller that skipped the gate learns that it did.
 */
export async function createMaritimeShipment(input: {
  commitmentId: string;
  actorId: string;
  legs: unknown;
  customs: unknown;
  scheduledDepartureAt: Date;
  scheduledArrivalAt: Date;
  capacityKg: number;
  loadedKg: number;
  simulationShipmentId?: string;
}): Promise<{ shipment: MaritimeShipment; commitment: InterIslandCommitment }> {
  const commitment = await prisma.interIslandCommitment.findUnique({ where: { id: input.commitmentId } });
  if (!commitment) throw httpError(404, "INTER_ISLAND_COMMITMENT_NOT_FOUND", "The inter-island commitment was not found.");
  if (commitment.status !== "APPROVED" || commitment.boundAt === null) {
    throw httpError(
      409,
      "INTER_ISLAND_APPROVAL_REQUIRED",
      "This inter-island commitment has not cleared human approval, so nothing may be shipped against it.",
    );
  }
  const existing = await prisma.maritimeShipment.findFirst({ where: { commitmentId: commitment.id } });
  if (existing) throw httpError(409, "SHIPMENT_ALREADY_BOOKED", "This commitment is already booked onto a sailing.");

  const shipmentId = randomUUID();
  const shipment = await prisma.$transaction(async (tx) => {
    const created = await tx.maritimeShipment.create({
      data: {
        id: shipmentId,
        commitmentId: commitment.id,
        orderId: commitment.orderId,
        status: "SCHEDULED",
        capacityKg: input.capacityKg,
        loadedKg: input.loadedKg,
        legs: input.legs as Prisma.InputJsonValue,
        customs: input.customs as Prisma.InputJsonValue,
        scheduledDepartureAt: input.scheduledDepartureAt,
        scheduledArrivalAt: input.scheduledArrivalAt,
        simulationShipmentId: input.simulationShipmentId ?? null,
        simulationRunId: commitment.simulationRunId,
      },
    });
    await tx.interIslandCommitment.update({ where: { id: commitment.id }, data: { status: "SHIPPED" } });
    await recordEvent(tx, {
      eventType: "MARITIME_SHIPMENT_SCHEDULED",
      actorId: input.actorId,
      entityId: shipmentId,
      traceId: commitment.traceId ?? randomUUID(),
      provenance: Provenance.SYNTHETIC,
      simulationRunId: commitment.simulationRunId,
      payload: {
        shipmentId,
        commitmentId: commitment.id,
        orderId: commitment.orderId,
        linkId: commitment.linkId,
        originPortId: commitment.originPortId,
        destinationPortId: commitment.destinationPortId,
        capacityKg: input.capacityKg,
        loadedKg: input.loadedKg,
        customsDisclaimer: CUSTOMS_DISCLAIMER,
        note: MARITIME_SYNTHETIC_DISCLAIMER,
      },
    });
    return created;
  });

  return { shipment, commitment: { ...commitment, status: "SHIPPED" } };
}

/**
 * Order in which a consignment may move.
 *
 * A status may only go forward, and `FAILED` is terminal, so a late or
 * duplicated update cannot resurrect a lost sailing or rewind a delivered one.
 */
const SHIPMENT_STATUS_ORDER = ["SCHEDULED", "DEPARTED", "DELAYED", "ARRIVED", "DELIVERED", "FAILED"] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUS_ORDER)[number];

/** DELAYED sits beside DEPARTED rather than after it: it is still at sea. */
const SHIPMENT_STAGE: Record<ShipmentStatus, number> = {
  SCHEDULED: 0,
  DEPARTED: 1,
  DELAYED: 1,
  ARRIVED: 2,
  DELIVERED: 3,
  FAILED: 3,
};

export function isShipmentStatus(value: unknown): value is ShipmentStatus {
  return typeof value === "string" && (SHIPMENT_STATUS_ORDER as readonly string[]).includes(value);
}

/**
 * Records what actually happened to a consignment.
 *
 * Everything written here is SYNTHETIC and comes from the physical simulation.
 * There is no vessel tracker behind it, and the endpoint over it says so.
 */
export async function updateMaritimeShipment(input: {
  shipmentId: string;
  actorId: string;
  status: ShipmentStatus;
  loadedKg?: number;
  actualDepartureAt?: Date;
  actualArrivalAt?: Date;
  deliveredAt?: Date;
  failureReason?: string;
  weatherDelayHours?: number;
  customs?: unknown;
}): Promise<{ shipment: MaritimeShipment; commitment: InterIslandCommitment }> {
  const existing = await prisma.maritimeShipment.findUnique({ where: { id: input.shipmentId } });
  if (!existing) throw httpError(404, "MARITIME_SHIPMENT_NOT_FOUND", "The shipment was not found.");
  if (existing.status === "FAILED") {
    throw httpError(409, "SHIPMENT_TERMINAL", "A failed sailing cannot be updated further.");
  }
  const current = isShipmentStatus(existing.status) ? existing.status : "SCHEDULED";
  if (SHIPMENT_STAGE[input.status] < SHIPMENT_STAGE[current]) {
    throw httpError(409, "SHIPMENT_STATUS_REGRESSION", `A shipment cannot move from ${current} back to ${input.status}.`);
  }

  const commitment = await prisma.interIslandCommitment.findUniqueOrThrow({ where: { id: existing.commitmentId } });
  const shipment = await prisma.maritimeShipment.update({
    where: { id: input.shipmentId },
    data: {
      status: input.status,
      ...(input.loadedKg === undefined ? {} : { loadedKg: input.loadedKg }),
      ...(input.actualDepartureAt ? { actualDepartureAt: input.actualDepartureAt } : {}),
      ...(input.actualArrivalAt ? { actualArrivalAt: input.actualArrivalAt } : {}),
      ...(input.deliveredAt ? { deliveredAt: input.deliveredAt } : {}),
      ...(input.failureReason ? { failureReason: input.failureReason } : {}),
      ...(input.weatherDelayHours === undefined ? {} : { weatherDelayHours: input.weatherDelayHours }),
      ...(input.customs === undefined ? {} : { customs: input.customs as Prisma.InputJsonValue }),
    },
  });
  return { shipment, commitment };
}
