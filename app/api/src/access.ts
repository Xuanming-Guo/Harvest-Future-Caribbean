import type { OperationalException } from "@prisma/client";

import type { AuthActor } from "./auth.js";
import { prisma } from "./db.js";

const unrestricted = (actor: AuthActor) => actor.role === "ADMIN" || actor.role === "OPERATIONS";

export async function visibleFarmIds(actor: AuthActor) {
  if (unrestricted(actor)) return (await prisma.farm.findMany({ select: { id: true } })).map((row) => row.id);
  if (actor.role === "FARMER") return (await prisma.farm.findMany({ where: { farmerId: actor.id }, select: { id: true } })).map((row) => row.id);
  if (actor.role === "COORDINATOR") return (await prisma.farmPermission.findMany({ where: { actorId: actor.id }, select: { farmId: true } })).map((row) => row.farmId);
  return [];
}

export async function visibleBatchIds(actor: AuthActor) {
  const farmIds = await visibleFarmIds(actor);
  if (!farmIds.length) return [];
  return (await prisma.cropBatch.findMany({ where: { farmId: { in: farmIds } }, select: { id: true } })).map((row) => row.id);
}

export async function visibleOrderIds(actor: AuthActor) {
  if (unrestricted(actor)) return (await prisma.order.findMany({ select: { id: true } })).map((row) => row.id);
  if (actor.role === "BUYER") return (await prisma.order.findMany({ where: { buyerId: actor.id }, select: { id: true } })).map((row) => row.id);
  if (actor.role === "TRANSPORTER") return (await prisma.deliveryMission.findMany({ where: { transporterId: actor.id }, select: { orderId: true } })).map((row) => row.orderId);
  if (actor.role === "FARMER" || actor.role === "COORDINATOR") {
    const batchIds = await visibleBatchIds(actor);
    if (!batchIds.length) return [];
    const allocationIds = (await prisma.allocationLine.findMany({ where: { cropBatchId: { in: batchIds } }, select: { allocationId: true } })).map((row) => row.allocationId);
    if (!allocationIds.length) return [];
    return (await prisma.allocation.findMany({ where: { id: { in: allocationIds } }, select: { orderId: true } })).map((row) => row.orderId);
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
  const rows = await prisma.operationalException.findMany({ orderBy: { reportedAt: "desc" } });
  if (unrestricted(actor)) return rows;
  const batchIds = await visibleBatchIds(actor);
  const orderIds = await visibleOrderIds(actor);
  const missionIds = (await prisma.deliveryMission.findMany({
    where: actor.role === "TRANSPORTER" ? { OR: [{ status: "AVAILABLE" }, { transporterId: actor.id }] } : { orderId: { in: orderIds } },
    select: { id: true },
  })).map((row) => row.id);
  const visibleIds = new Set([...batchIds, ...orderIds, ...missionIds]);
  return rows.filter((row) => (row.affectedEntityIds as string[]).some((id) => visibleIds.has(id)));
}
