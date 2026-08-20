import type { Prisma } from "@prisma/client";
import type {
  SimulationOperationsSnapshot,
  SimulationOrderOutcomes,
} from "@harvest/simulation";

import { prisma } from "./db.js";

interface ObservableOrder {
  id: string;
  lifecycleStatus: string;
  neededBy: Date;
}

export interface OperationsSnapshotQuery {
  asOf: Date;
  listingWhere: Prisma.ListingWhereInput;
  demandWhere: Prisma.BuyerDemandWhereInput;
  orderWhere: Prisma.OrderWhereInput;
  activeMissionWhere: Prisma.DeliveryMissionWhereInput;
  openExceptionWhere: Prisma.OperationalExceptionWhereInput;
}

/**
 * Classify each order exactly once using only its observable Product API state.
 * An incomplete order becomes unfulfilled when its deadline is reached; before
 * then it remains pending rather than being reported as a failure early.
 */
export function summarizeOrderOutcomes(
  orders: Array<Pick<ObservableOrder, "lifecycleStatus" | "neededBy">>,
  asOf: Date,
): SimulationOrderOutcomes {
  const outcomes: SimulationOrderOutcomes = {
    total: orders.length,
    fulfilled: 0,
    partiallyFulfilled: 0,
    unfulfilled: 0,
    pending: 0,
  };

  for (const order of orders) {
    if (order.lifecycleStatus === "FULFILLED") {
      outcomes.fulfilled += 1;
    } else if (order.lifecycleStatus === "PARTIALLY_FULFILLED") {
      outcomes.partiallyFulfilled += 1;
    } else if (
      order.lifecycleStatus === "REJECTED" ||
      order.lifecycleStatus === "CANCELLED" ||
      order.neededBy.getTime() <= asOf.getTime()
    ) {
      outcomes.unfulfilled += 1;
    } else {
      outcomes.pending += 1;
    }
  }

  return outcomes;
}

/** Build the role/run-filtered Product API projection used by API and replay. */
export async function buildOperationsSnapshot(
  query: OperationsSnapshotQuery,
): Promise<SimulationOperationsSnapshot> {
  const [activeListings, openDemands, orders, activeMissions, openExceptions] = await Promise.all([
    prisma.listing.count({ where: query.listingWhere }),
    prisma.buyerDemand.count({ where: query.demandWhere }),
    prisma.order.findMany({
      where: query.orderWhere,
      select: { id: true, lifecycleStatus: true, neededBy: true },
      orderBy: { id: "asc" },
    }),
    prisma.deliveryMission.findMany({
      where: query.activeMissionWhere,
      select: { id: true },
      orderBy: { id: "asc" },
    }),
    prisma.operationalException.findMany({
      where: query.openExceptionWhere,
      select: { id: true },
      orderBy: { id: "asc" },
    }),
  ]);

  const orderIds = orders.map((order) => order.id);
  const relatedOrders = { orderId: { in: orderIds } };
  const [acceptedDelivery, approvedCommitmentCount, completedMissionCount] = await Promise.all([
    prisma.deliveryAcceptance.aggregate({
      where: relatedOrders,
      _sum: { acceptedQuantity: true },
    }),
    prisma.allocation.count({
      where: { ...relatedOrders, status: "APPROVED" },
    }),
    prisma.deliveryMission.count({
      where: { ...relatedOrders, status: { in: ["DELIVERED", "COMPLETED"] } },
    }),
  ]);

  const statusCounts = new Map<string, number>();
  for (const order of orders) {
    statusCounts.set(order.lifecycleStatus, (statusCounts.get(order.lifecycleStatus) ?? 0) + 1);
  }

  return {
    activeListings,
    openDemands,
    ordersByStatus: Object.fromEntries([...statusCounts.entries()].sort(([left], [right]) => left.localeCompare(right))),
    orderOutcomes: summarizeOrderOutcomes(orders, query.asOf),
    deliveryAcceptedKg: Number((acceptedDelivery._sum.acceptedQuantity ?? 0).toFixed(2)),
    approvedCommitmentCount,
    completedMissionCount,
    activeMissionIds: activeMissions.map((mission) => mission.id),
    openExceptionIds: openExceptions.map((exception) => exception.id),
  };
}
