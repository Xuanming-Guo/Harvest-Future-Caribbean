import type { OperationalException } from "@prisma/client";

import type { AuthActor } from "./auth.js";
import { prisma } from "./db.js";

const unrestricted = (actor: AuthActor) => actor.role === "ADMIN" || actor.role === "OPERATIONS";
export const actorRunScope = (actor: AuthActor) => ({ simulationRunId: actor.simulationRunId });

export async function visibleFarmIds(actor: AuthActor) {
  if (unrestricted(actor)) return (await prisma.farm.findMany({ where: actorRunScope(actor), select: { id: true } })).map((row) => row.id);
  if (actor.role === "FARMER") return (await prisma.farm.findMany({ where: { farmerId: actor.id, ...actorRunScope(actor) }, select: { id: true } })).map((row) => row.id);
  if (actor.role === "COORDINATOR") return (await prisma.farmPermission.findMany({ where: { actorId: actor.id, ...actorRunScope(actor) }, select: { farmId: true } })).map((row) => row.farmId);
  return [];
}

export async function visibleBatchIds(actor: AuthActor) {
  const farmIds = await visibleFarmIds(actor);
  if (!farmIds.length) return [];
  return (await prisma.cropBatch.findMany({ where: { farmId: { in: farmIds }, ...actorRunScope(actor) }, select: { id: true } })).map((row) => row.id);
}

export async function visibleOrderIds(actor: AuthActor) {
  if (unrestricted(actor)) return (await prisma.order.findMany({ where: actorRunScope(actor), select: { id: true } })).map((row) => row.id);
  if (actor.role === "BUYER") return (await prisma.order.findMany({ where: { buyerId: actor.id, ...actorRunScope(actor) }, select: { id: true } })).map((row) => row.id);
  if (actor.role === "TRANSPORTER") return (await prisma.deliveryMission.findMany({ where: { transporterId: actor.id, ...actorRunScope(actor) }, select: { orderId: true } })).map((row) => row.orderId);
  if (actor.role === "FARMER" || actor.role === "COORDINATOR") {
    const batchIds = await visibleBatchIds(actor);
    if (!batchIds.length) return [];
    const allocationIds = (await prisma.allocationLine.findMany({ where: { cropBatchId: { in: batchIds }, ...actorRunScope(actor) }, select: { allocationId: true } })).map((row) => row.allocationId);
    const allocationOrderIds = allocationIds.length
      ? (await prisma.allocation.findMany({ where: { id: { in: allocationIds }, ...actorRunScope(actor) }, select: { orderId: true } })).map((row) => row.orderId)
      : [];
    // A cross-island order has no local allocation line, so the allocation
    // route above cannot see it. The grower whose crop it commits and the
    // coordinator who proposed it are exactly the people who must (#40).
    const visible = new Set(batchIds);
    const crossIslandOrderIds = (await prisma.interIslandCommitment.findMany({ where: actorRunScope(actor), select: { orderId: true, lines: true } }))
      .filter((row) => (row.lines as unknown as Array<{ cropBatchId?: unknown }>).some((line) => typeof line.cropBatchId === "string" && visible.has(line.cropBatchId)))
      .map((row) => row.orderId);
    return [...new Set([...allocationOrderIds, ...crossIslandOrderIds])];
  }
  return [];
}

export async function canAccessBatch(actor: AuthActor, cropBatchId: string) {
  return (await visibleBatchIds(actor)).includes(cropBatchId);
}

export async function canAccessOrder(actor: AuthActor, orderId: string) {
  return (await visibleOrderIds(actor)).includes(orderId);
}

export async function visibleExceptionRows(actor: AuthActor): Promise<OperationalException[]> {
  const rows = await prisma.operationalException.findMany({ where: actorRunScope(actor), orderBy: { reportedAt: "desc" } });
  if (unrestricted(actor)) return rows;
  const batchIds = await visibleBatchIds(actor);
  const orderIds = await visibleOrderIds(actor);
  const missionIds = (await prisma.deliveryMission.findMany({
    where: actor.role === "TRANSPORTER"
      ? { ...actorRunScope(actor), OR: [{ status: "AVAILABLE" }, { transporterId: actor.id }] }
      : { orderId: { in: orderIds }, ...actorRunScope(actor) },
    select: { id: true },
  })).map((row) => row.id);
  const visibleIds = new Set([...batchIds, ...orderIds, ...missionIds]);
  return rows.filter((row) => (row.affectedEntityIds as string[]).some((id) => visibleIds.has(id)));
}

/**
 * An order is "agreed" once a human has approved the proposed commitment, or
 * once its lifecycle has already moved past that gate. Before that point the
 * two sides of a match stay anonymous to each other: docs/product.md keeps
 * sensitive disclosures human-controlled, so a farmer browsing demand and a
 * buyer browsing supply see the produce, not the counterparty.
 */
const agreedLifecycleStatuses = ["COMMITTED", "IN_DELIVERY", "FULFILLED", "PARTIALLY_FULFILLED"];

export async function agreedOrderIds(actor: AuthActor, candidateIds?: string[]) {
  const candidates = candidateIds ?? (await visibleOrderIds(actor));
  if (!candidates.length) return [];
  const byLifecycle = (await prisma.order.findMany({
    where: { id: { in: candidates }, lifecycleStatus: { in: agreedLifecycleStatuses }, ...actorRunScope(actor) },
    select: { id: true },
  })).map((row) => row.id);
  const byApproval = (await prisma.allocation.findMany({
    where: { orderId: { in: candidates }, status: "APPROVED", ...actorRunScope(actor) },
    select: { orderId: true },
  })).map((row) => row.orderId);
  return [...new Set([...byLifecycle, ...byApproval])];
}

type StoredMissionStop = { kind: "PICKUP" | "DROPOFF"; farmId?: string };

/**
 * Which real names a caller has earned. Everything outside these sets is still
 * allowed to appear on a map or a route, but only as a zone-level marker.
 */
export type IdentityDisclosure = {
  /** Buyer actor IDs this caller may see by name. */
  buyers: Set<string>;
  /** Farm IDs this caller may see by name. */
  farms: Set<string>;
  /** Coordination and operations roles read the island by name. */
  unrestricted: boolean;
};

export const anonymousLocationName = (kind: "FARM" | "HOTEL", zone?: string | null) =>
  `${kind === "FARM" ? "A farm" : "A buyer"} in ${zone?.trim() || "Saint Lucia"}`;

export async function identityDisclosure(actor: AuthActor): Promise<IdentityDisclosure> {
  const buyers = new Set<string>();
  const farms = new Set<string>();
  if (unrestricted(actor) || actor.role === "COORDINATOR") return { buyers, farms, unrestricted: true };

  // A transporter is told exactly who is on the jobs it may work: the pickup
  // farms and the delivery buyer of its own and of open missions. Nothing else.
  if (actor.role === "TRANSPORTER") {
    const missions = await prisma.deliveryMission.findMany({
      where: { ...actorRunScope(actor), OR: [{ status: "AVAILABLE" }, { transporterId: actor.id }] },
      select: { orderId: true, stops: true },
    });
    for (const mission of missions) {
      for (const stop of mission.stops as unknown as StoredMissionStop[]) if (stop.farmId) farms.add(stop.farmId);
    }
    const orderIds = [...new Set(missions.map((mission) => mission.orderId))];
    if (orderIds.length) {
      for (const order of await prisma.order.findMany({ where: { id: { in: orderIds }, ...actorRunScope(actor) }, select: { buyerId: true } })) buyers.add(order.buyerId);
    }
    return { buyers, farms, unrestricted: false };
  }

  for (const farmId of await visibleFarmIds(actor)) farms.add(farmId);
  if (actor.role === "BUYER") buyers.add(actor.id);

  const agreed = await agreedOrderIds(actor);
  if (!agreed.length) return { buyers, farms, unrestricted: false };
  for (const order of await prisma.order.findMany({ where: { id: { in: agreed }, ...actorRunScope(actor) }, select: { buyerId: true } })) buyers.add(order.buyerId);

  const allocationIds = (await prisma.allocation.findMany({ where: { orderId: { in: agreed }, ...actorRunScope(actor) }, select: { id: true } })).map((row) => row.id);
  const batchIds = allocationIds.length
    ? [...new Set((await prisma.allocationLine.findMany({ where: { allocationId: { in: allocationIds }, ...actorRunScope(actor) }, select: { cropBatchId: true } })).map((row) => row.cropBatchId))]
    : [];
  if (batchIds.length) {
    for (const batch of await prisma.cropBatch.findMany({ where: { id: { in: batchIds }, ...actorRunScope(actor) }, select: { farmId: true } })) farms.add(batch.farmId);
  }
  return { buyers, farms, unrestricted: false };
}
