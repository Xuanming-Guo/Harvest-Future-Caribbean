import type { DeliveryMission } from "@prisma/client";

import { anonymousLocationName, identityDisclosure, visibleFarmIds } from "./access.js";
import type { AuthActor } from "./auth.js";
import { prisma } from "./db.js";
import { missionDto, quantity } from "./serializers.js";

type StoredStop = {
  sequence: number;
  kind: "PICKUP" | "DROPOFF";
  farmId?: string;
  cropBatchIds?: string[];
  quantity?: { value: number; unit: "kg" };
  location: { latitude: number; longitude: number };
};

const sameRun = (left: string | null, right: string | null) => left === right;

/**
 * Roughly a kilometre of resolution: enough to draw a believable island route,
 * far too little to find a gate. Used for a stop whose owner the viewer has not
 * earned the name of.
 */
const coarsePoint = (point: { latitude: number; longitude: number }) => ({
  latitude: Math.round(point.latitude * 100) / 100,
  longitude: Math.round(point.longitude * 100) / 100,
});

export async function deliveryMissionViews(rows: DeliveryMission[], viewer: AuthActor) {
  if (!rows.length) return [];

  const disclosure = await identityDisclosure(viewer);
  // A farmer follows the truck through its own gate only. Another grower's
  // pickup on the same run stays an unnamed stop on the road.
  const ownFarmIds = viewer.role === "FARMER" ? new Set(await visibleFarmIds(viewer)) : null;
  const mayIdentifyFarm = (farmId: string) => disclosure.unrestricted || disclosure.farms.has(farmId);
  const mayIdentifyBuyer = (buyerId: string) => disclosure.unrestricted || disclosure.buyers.has(buyerId);

  const orderIds = [...new Set(rows.map((row) => row.orderId))];
  const orders = await prisma.order.findMany({ where: { id: { in: orderIds } } });
  const orderById = new Map(orders.map((order) => [order.id, order]));
  const buyerIds = [...new Set(orders.map((order) => order.buyerId))];
  const buyers = buyerIds.length ? await prisma.actor.findMany({ where: { id: { in: buyerIds } } }) : [];
  const buyerById = new Map(buyers.map((buyer) => [buyer.id, buyer]));

  const allocations = await prisma.allocation.findMany({
    where: { orderId: { in: orderIds } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  const allocationByOrder = new Map<string, (typeof allocations)[number]>();
  for (const allocation of allocations) {
    if (!allocationByOrder.has(allocation.orderId)) allocationByOrder.set(allocation.orderId, allocation);
  }
  const allocationIds = [...allocationByOrder.values()].map((allocation) => allocation.id);
  const lines = allocationIds.length
    ? await prisma.allocationLine.findMany({ orderBy: { creationOrder: "asc" }, where: { allocationId: { in: allocationIds } } })
    : [];
  const linesByAllocation = new Map<string, typeof lines>();
  for (const line of lines) {
    const grouped = linesByAllocation.get(line.allocationId) ?? [];
    grouped.push(line);
    linesByAllocation.set(line.allocationId, grouped);
  }

  const batchIds = [...new Set(lines.map((line) => line.cropBatchId))];
  const batches = batchIds.length ? await prisma.cropBatch.findMany({ where: { id: { in: batchIds } } }) : [];
  const batchById = new Map(batches.map((batch) => [batch.id, batch]));
  const farmIds = [...new Set(batches.map((batch) => batch.farmId))];
  const farms = farmIds.length ? await prisma.farm.findMany({ where: { id: { in: farmIds } } }) : [];
  const farmById = new Map(farms.map((farm) => [farm.id, farm]));

  return rows.map((row) => {
    const candidateOrder = orderById.get(row.orderId);
    const order = candidateOrder && sameRun(candidateOrder.simulationRunId, row.simulationRunId) ? candidateOrder : undefined;
    const candidateBuyer = order ? buyerById.get(order.buyerId) : undefined;
    const buyer = candidateBuyer && sameRun(candidateBuyer.simulationRunId, row.simulationRunId) ? candidateBuyer : undefined;
    const buyerIdentified = Boolean(buyer && mayIdentifyBuyer(buyer.id));
    const buyerLabel = buyer
      ? buyerIdentified ? buyer.name : anonymousLocationName("HOTEL", buyer.serviceZone)
      : "Buyer destination";
    const candidateAllocation = allocationByOrder.get(row.orderId);
    const allocation = candidateAllocation && sameRun(candidateAllocation.simulationRunId, row.simulationRunId) ? candidateAllocation : undefined;
    const includeCropStatus = viewer.role !== "TRANSPORTER" || row.transporterId === viewer.id;
    const quantityByBatch = new Map<string, number>();

    for (const line of allocation ? linesByAllocation.get(allocation.id) ?? [] : []) {
      if (!sameRun(line.simulationRunId, row.simulationRunId)) continue;
      quantityByBatch.set(line.cropBatchId, (quantityByBatch.get(line.cropBatchId) ?? 0) + line.quantity);
    }

    const cargo = [...quantityByBatch].flatMap(([cropBatchId, value]) => {
      const batch = batchById.get(cropBatchId);
      const farm = batch ? farmById.get(batch.farmId) : undefined;
      if (!batch || !farm || !sameRun(batch.simulationRunId, row.simulationRunId) || !sameRun(farm.simulationRunId, row.simulationRunId)) return [];
      if (ownFarmIds && !ownFarmIds.has(farm.id)) return [];
      return [{
        cropBatchId,
        farmId: farm.id,
        farmName: mayIdentifyFarm(farm.id) ? farm.name : anonymousLocationName("FARM", farm.productionZone),
        cropType: batch.cropType,
        ...(includeCropStatus ? { cropStatus: batch.status } : {}),
        quantity: quantity(value),
      }];
    }).sort((left, right) => left.farmName.localeCompare(right.farmName) || left.cropBatchId.localeCompare(right.cropBatchId));

    const stops = (row.stops as unknown as StoredStop[]).map((stop) => {
      const candidateFarm = stop.farmId ? farmById.get(stop.farmId) : undefined;
      const farm = candidateFarm && sameRun(candidateFarm.simulationRunId, row.simulationRunId) ? candidateFarm : undefined;
      const farmIdentified = Boolean(farm && mayIdentifyFarm(farm.id));
      const identified = stop.kind === "PICKUP" ? farmIdentified : buyerIdentified;
      const displayName = stop.kind === "PICKUP"
        ? farm
          ? farmIdentified ? farm.name : anonymousLocationName("FARM", farm.productionZone)
          : `Pickup ${stop.sequence}`
        : buyer
          ? buyerLabel
          : `Delivery ${stop.sequence}`;
      // The address itself is part of the identity. A stop the viewer may not
      // name is drawn at zone resolution and carries no crop-batch references.
      if (identified) return { ...stop, displayName };
      return {
        sequence: stop.sequence,
        kind: stop.kind,
        ...(stop.quantity ? { quantity: stop.quantity } : {}),
        location: coarsePoint(stop.location),
        displayName,
      };
    });

    return {
      ...missionDto(row),
      stops,
      routeRegion: "Saint Lucia",
      buyerName: buyerLabel,
      cropType: order?.cropType ?? cargo[0]?.cropType ?? "Produce",
      atRisk: order?.atRisk ?? false,
      cargo,
    };
  });
}

export async function deliveryMissionView(row: DeliveryMission, viewer: AuthActor) {
  const [view] = await deliveryMissionViews([row], viewer);
  return view!;
}
