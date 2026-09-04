import type { ApiSchema } from "@harvest/shared";

export type OrderPayment = ApiSchema<"OrderPayment">;

/** Anything a workspace list shows that may carry a payment record. */
export interface PayableOrder {
  orderId: string;
  payment?: OrderPayment;
}

export interface MoneyOwedSummary {
  /** Total still owed for produce the buyer already accepted. */
  amount: number;
  currency: string;
  /** Orders making up that total. */
  count: number;
  /** Longest wait among them, in whole days since delivery. */
  oldestDaysOutstanding: number;
  /** How many of those orders are past their agreed term. */
  overdueCount: number;
}

export const PAYMENT_STATUS_LABELS: Record<OrderPayment["status"], string> = {
  NOT_DUE: "Within terms",
  DUE: "Due today",
  OVERDUE: "Overdue",
  PAID: "Paid",
};

/** `true` once produce has been accepted and the buyer has not recorded paying. */
export function isAwaitingPayment(payment: OrderPayment | undefined): payment is OrderPayment {
  return Boolean(payment && payment.status !== "PAID" && payment.dueAt);
}

/**
 * What hotels still owe this farmer for produce they have already taken.
 * Harvest tracks the amount and the wait; it never moves money, so this is a
 * view of recorded obligations, not of a balance Harvest holds.
 */
export function summarizeMoneyOwed(orders: PayableOrder[]): MoneyOwedSummary {
  const owed = orders.filter((order) => isAwaitingPayment(order.payment));
  return {
    amount: Number(owed.reduce((sum, order) => sum + (order.payment?.amount?.amount ?? 0), 0).toFixed(2)),
    currency: owed.find((order) => order.payment?.amount)?.payment?.amount?.currency ?? "XCD",
    count: owed.length,
    oldestDaysOutstanding: owed.reduce((longest, order) => Math.max(longest, order.payment?.daysOutstanding ?? 0), 0),
    overdueCount: owed.filter((order) => order.payment?.status === "OVERDUE").length,
  };
}

export function formatMoney(amount: number, currency: string) {
  return `${currency} ${amount.toLocaleString("en-LC", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
