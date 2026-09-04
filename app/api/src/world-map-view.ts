import type { BuyerDemand, CropBatch, Listing } from "@prisma/client";

import { actorRunScope, visibleBatchIds, visibleFarmIds, visibleOrderIds } from "./access.js";
import type { AuthActor } from "./auth.js";
import { prisma } from "./db.js";
import { quantity } from "./serializers.js";

type StoredStop = { kind: "PICKUP" | "DROPOFF"; farmId?: string };

function unique(values: string[]) {
  return [...new Set(values)];
}

function mapOpportunity(row: BuyerDemand) {
  return {
    opportunityId: row.id,
    cropType: row.cropType,
    quantity: quantity(row.quantity),
    neededBy: row.neededBy.toISOString(),
    status: row.status as "OPEN" | "MATCHING",
    ...(row.maxUnitPrice !== null ? { maxUnitPrice: { amount: row.maxUnitPrice, currency: row.currency ?? "XCD" } } : {}),
  };
}

export async function worldMapView(actor: AuthActor) {
  const scope = actorRunScope(actor);
  const directFarmIds = actor.role === "ADMIN" || actor.role === "OPERATIONS"
    ? (await prisma.farm.findMany({ where: scope, select: { id: true } })).map((farm) => farm.id)
    : await visibleFarmIds(actor);
  const directBatchIds = actor.role === "ADMIN" || actor.role === "OPERATIONS"
    ? (await prisma.cropBatch.findMany({ where: scope, select: { id: true } })).map((batch) => batch.id)
    : await visibleBatchIds(actor);
  const directBatches = directBatchIds.length
    ? await prisma.cropBatch.findMany({ where: { ...scope, id: { in: directBatchIds } } })
    : [];
  const directCropTypes = unique(directBatches.map((batch) => batch.cropType));

  const visibleOrders = actor.role === "ADMIN" || actor.role === "OPERATIONS"
    ? await prisma.order.findMany({ where: scope, select: { id: true, buyerId: true } })
    : await prisma.order.findMany({ where: { ...scope, id: { in: await visibleOrderIds(actor) } }, select: { id: true, buyerId: true } });
  const missionWhere = actor.role === "TRANSPORTER"
    ? { OR: [{ status: "AVAILABLE" }, { transporterId: actor.id }] }
    : actor.role === "ADMIN" || actor.role === "OPERATIONS"
      ? {}
      : { orderId: { in: visibleOrders.map((order) => order.id) } };
  const missions = await prisma.deliveryMission.findMany({ where: { ...scope, ...missionWhere }, select: { orderId: true, stops: true } });
  const missionFarmIds = unique(missions.flatMap((mission) => (mission.stops as unknown as StoredStop[]).flatMap((stop) => stop.kind === "PICKUP" && stop.farmId ? [stop.farmId] : [])));
  const missionOrderIds = unique(missions.map((mission) => mission.orderId));
  const missionOrders = missionOrderIds.length
    ? await prisma.order.findMany({ where: { ...scope, id: { in: missionOrderIds } }, select: { buyerId: true } })
    : [];

  const publicListings = actor.role === "BUYER"
    ? await prisma.listing.findMany({ where: { ...scope, status: "ACTIVE" } })
    : [];
  const publicBatchIds = unique(publicListings.map((listing) => listing.cropBatchId));
  const publicBatches = publicBatchIds.length
    ? await prisma.cropBatch.findMany({ where: { ...scope, id: { in: publicBatchIds } }, select: { id: true, farmId: true } })
    : [];
  const publicFarmByBatch = new Map(publicBatches.map((batch) => [batch.id, batch.farmId]));
  const publicFarmIds = unique(publicBatches.map((batch) => batch.farmId));
  const farmIds = unique([...directFarmIds, ...missionFarmIds, ...publicFarmIds]);
  const farms = farmIds.length ? await prisma.farm.findMany({ where: { ...scope, id: { in: farmIds } } }) : [];

  const matchingDemands = actor.role === "FARMER" || actor.role === "COORDINATOR"
    ? directCropTypes.length
      ? await prisma.buyerDemand.findMany({ where: { ...scope, status: { in: ["OPEN", "MATCHING"] }, cropType: { in: directCropTypes } }, orderBy: { neededBy: "asc" } })
      : []
    : actor.role === "BUYER"
      ? await prisma.buyerDemand.findMany({ where: { ...scope, buyerId: actor.id, status: { in: ["OPEN", "MATCHING"] } }, orderBy: { neededBy: "asc" } })
      : actor.role === "ADMIN" || actor.role === "OPERATIONS"
        ? await prisma.buyerDemand.findMany({ where: { ...scope, status: { in: ["OPEN", "MATCHING"] } }, orderBy: { neededBy: "asc" } })
        : [];
  const hotelIds = unique([
    ...matchingDemands.map((demand) => demand.buyerId),
    ...visibleOrders.map((order) => order.buyerId),
    ...missionOrders.map((order) => order.buyerId),
    ...(actor.role === "BUYER" ? [actor.id] : []),
  ]);
  const hotels = hotelIds.length ? await prisma.actor.findMany({ where: { ...scope, id: { in: hotelIds }, role: "BUYER" } }) : [];

  const directBatchesByFarm = new Map<string, CropBatch[]>();
  for (const batch of directBatches) directBatchesByFarm.set(batch.farmId, [...(directBatchesByFarm.get(batch.farmId) ?? []), batch]);
  const listingsByFarm = new Map<string, Listing[]>();
  for (const listing of publicListings) {
    const farmId = publicFarmByBatch.get(listing.cropBatchId);
    if (farmId) listingsByFarm.set(farmId, [...(listingsByFarm.get(farmId) ?? []), listing]);
  }
  const demandsByBuyer = new Map<string, BuyerDemand[]>();
  for (const demand of matchingDemands) demandsByBuyer.set(demand.buyerId, [...(demandsByBuyer.get(demand.buyerId) ?? []), demand]);

  const farmLocations = farms.map((farm) => {
    const canSeeProgress = directFarmIds.includes(farm.id);
    const listings = listingsByFarm.get(farm.id) ?? [];
    return {
      locationId: farm.id,
      kind: "FARM" as const,
      displayName: farm.name,
      serviceZone: farm.productionZone,
      access: canSeeProgress ? "CROP_PROGRESS" as const : listings.length ? "PUBLIC_SUPPLY" as const : "LOGISTICS" as const,
      crops: canSeeProgress
        ? (directBatchesByFarm.get(farm.id) ?? []).map((batch) => ({ cropBatchId: batch.id, cropType: batch.cropType, status: batch.status, quantity: quantity(batch.availableToPromise) }))
        : listings.map((listing) => ({ cropBatchId: listing.cropBatchId, cropType: listing.cropType, quantity: quantity(listing.quantity) })),
      opportunities: [],
    };
  });

  const hotelLocations = hotels.map((hotel) => ({
    locationId: hotel.id,
    kind: "HOTEL" as const,
    displayName: hotel.name,
    serviceZone: hotel.serviceZone ?? "Saint Lucia",
    access: actor.role === "BUYER" && hotel.id === actor.id
      ? "OWN_ORDERS" as const
      : (demandsByBuyer.get(hotel.id)?.length ?? 0) > 0
        ? "BUYER_DEMAND" as const
        : "LOGISTICS" as const,
    crops: [],
    opportunities: (demandsByBuyer.get(hotel.id) ?? []).map(mapOpportunity),
  }));

  return {
    region: "Saint Lucia",
    locations: [...farmLocations, ...hotelLocations].sort((left, right) => left.displayName.localeCompare(right.displayName)),
  };
}
