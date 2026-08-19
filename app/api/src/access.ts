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
    if (!allocationIds.length) return [];
    return (await prisma.allocation.findMany({ where: { id: { in: allocationIds }, ...actorRunScope(actor) }, select: { orderId: true } })).map((row) => row.orderId);
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
