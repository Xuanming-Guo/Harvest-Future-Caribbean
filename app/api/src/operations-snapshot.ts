import type { Prisma } from "@prisma/client";
import type {
  SimulationOperationsSnapshot,
  SimulationOrderOutcomes,
} from "@harvest/simulation";

import { prisma } from "./db.js";
import { derivePaymentStatus } from "./payments.js";

interface ObservableOrder {
  id: string;
  lifecycleStatus: string;
  neededBy: Date;
  outcomeCause: string | null;
}

/**
 * Every non-fulfilled order gets exactly one cause. The recorded cause wins;
 * when an order simply ran out of time in a state that never recorded one,
 * the state itself is the explanation.
 */
export function deriveOutcomeCause(
  order: Pick<ObservableOrder, "lifecycleStatus" | "outcomeCause">,
): string {
  if (order.outcomeCause) return order.outcomeCause;
  switch (order.lifecycleStatus) {
    case "PARTIALLY_FULFILLED":
    case "REJECTED":
      return "DELIVERY_REJECTED";
    case "CANCELLED":
      return "CANCELLED";
    case "AWAITING_APPROVAL":
      return "APPROVAL_TIMEOUT";
    case "COMMITTED":
    case "IN_DELIVERY":
      return "MISSION_LATE";
    default:
      return "NO_READY_SUPPLY";
  }
}

/**
 * Orders whose payment term has expired with nothing recorded as paid.
 *
 * The term only starts once produce is accepted, so an undelivered order is
 * never overdue however late it is. Uses the same derivation as the order
 * reads, which is why a coordinator's count and a farmer's dashboard cannot
 * disagree. Harvest tracks payment; it does not move money.
 */
export function countOverduePayments(
  orders: Array<{ id: string; lifecycleStatus: string; paymentTermsDays: number; paymentAmount: number | null; paidAt: Date | null }>,
  acceptedAtByOrder: Map<string, Date>,
  asOf: Date,
) {
  return orders.filter((order) =>
    order.paymentAmount !== null &&
    order.lifecycleStatus !== "CANCELLED" &&
    derivePaymentStatus(order, acceptedAtByOrder.get(order.id) ?? null, asOf) === "OVERDUE").length;
}

export interface OperationsSnapshotQuery {
  asOf: Date;
  /**
   * Instant the run's scenario horizon closes, when the projection is scoped to
   * a saved run. Orders whose deadline falls after it can never be observed
   * completing inside the run, so once the horizon passes they are reported as
   * truncated by the run window rather than as an operational failure.
   */
  horizonEndsAt?: Date;
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
  orders: Array<Pick<ObservableOrder, "lifecycleStatus" | "neededBy"> & Partial<Pick<ObservableOrder, "outcomeCause">>>,
  asOf: Date,
  horizonEndsAt?: Date,
): SimulationOrderOutcomes {
  const causes = new Map<string, number>();
  const outcomes: SimulationOrderOutcomes = {
    total: orders.length,
    fulfilled: 0,
    partiallyFulfilled: 0,
    unfulfilled: 0,
    pending: 0,
  };
  const countCause = (order: (typeof orders)[number], override?: string) => {
    const cause = override ?? deriveOutcomeCause({ lifecycleStatus: order.lifecycleStatus, outcomeCause: order.outcomeCause ?? null });
    causes.set(cause, (causes.get(cause) ?? 0) + 1);
  };
  // Only once the window has actually closed. Before that the order is still
  // live and may yet be delivered early, so calling it truncated would report a
  // failure that has not happened.
  const horizonClosed = horizonEndsAt !== undefined && asOf.getTime() >= horizonEndsAt.getTime();

  for (const order of orders) {
    const settled = ["REJECTED", "CANCELLED"].includes(order.lifecycleStatus);
    const pastHorizon = horizonClosed && !settled && order.neededBy.getTime() > horizonEndsAt!.getTime();
    if (order.lifecycleStatus === "FULFILLED") {
      outcomes.fulfilled += 1;
    } else if (order.lifecycleStatus === "PARTIALLY_FULFILLED") {
      outcomes.partiallyFulfilled += 1;
      countCause(order);
    } else if (pastHorizon) {
      outcomes.unfulfilled += 1;
      countCause(order, "HORIZON_TRUNCATED");
    } else if (
      settled ||
      order.neededBy.getTime() <= asOf.getTime()
    ) {
      outcomes.unfulfilled += 1;
      countCause(order);
    } else {
      outcomes.pending += 1;
    }
  }

  outcomes.causes = Object.fromEntries([...causes.entries()].sort(([left], [right]) => left.localeCompare(right)));
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
      select: { id: true, lifecycleStatus: true, neededBy: true, outcomeCause: true, paymentTermsDays: true, paymentAmount: true, paidAt: true },
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
  const [acceptedDelivery, approvedCommitmentCount, completedMissionCount, acceptances] = await Promise.all([
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
    prisma.deliveryAcceptance.findMany({
      where: relatedOrders,
      select: { orderId: true, acceptedAt: true },
    }),
  ]);

  const acceptedAtByOrder = new Map(acceptances.map((row) => [row.orderId, row.acceptedAt]));
  const paymentOverdueCount = countOverduePayments(orders, acceptedAtByOrder, query.asOf);

  const statusCounts = new Map<string, number>();
  for (const order of orders) {
    statusCounts.set(order.lifecycleStatus, (statusCounts.get(order.lifecycleStatus) ?? 0) + 1);
  }

  return {
    activeListings,
    openDemands,
    ordersByStatus: Object.fromEntries([...statusCounts.entries()].sort(([left], [right]) => left.localeCompare(right))),
    orderOutcomes: summarizeOrderOutcomes(orders, query.asOf, query.horizonEndsAt),
    deliveryAcceptedKg: Number((acceptedDelivery._sum.acceptedQuantity ?? 0).toFixed(2)),
    approvedCommitmentCount,
    completedMissionCount,
    paymentOverdueCount,
    activeMissionIds: activeMissions.map((mission) => mission.id),
    openExceptionIds: openExceptions.map((exception) => exception.id),
  };
}
