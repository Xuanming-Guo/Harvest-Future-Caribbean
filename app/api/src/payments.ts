/**
 * Deterministic pricing for payment tracking (#74).
 *
 * Harvest never moves money. It records what the produce a buyer committed to
 * was worth at the price the farmer published, so a farmer can see the size of
 * the gap between delivery and payment. Every number here comes from the
 * allocation lines and their listings; nothing is estimated or predicted.
 */

export interface PricedAllocationLine {
  cropBatchId: string;
  listingId: string;
  quantity: number;
}

export interface PricedListing {
  id: string;
  unitPrice: number;
  currency: string;
}

export interface OrderValue {
  amount: number;
  currency: string;
}

/** Two decimal places, because `Money.amount` is a currency amount, not a ratio. */
const round = (value: number) => Number(value.toFixed(2));

function currencyOf(lines: PricedAllocationLine[], listingById: Map<string, PricedListing>) {
  for (const line of lines) {
    const currency = listingById.get(line.listingId)?.currency;
    if (currency) return currency;
  }
  return "XCD";
}

/** Committed line quantity multiplied by that line's listing price. */
export function commitmentValue(lines: PricedAllocationLine[], listings: PricedListing[]): OrderValue {
  const listingById = new Map(listings.map((listing) => [listing.id, listing]));
  const amount = lines.reduce((sum, line) => sum + line.quantity * (listingById.get(line.listingId)?.unitPrice ?? 0), 0);
  return { amount: round(amount), currency: currencyOf(lines, listingById) };
}

/**
 * The same arithmetic on the quantities the buyer actually accepted. A crop
 * batch can be committed across more than one listing, so its accepted
 * quantity is priced at the quantity-weighted price of its own committed
 * lines rather than at whichever listing happened to be read first.
 */
export function acceptedValue(
  lines: PricedAllocationLine[],
  listings: PricedListing[],
  acceptedByBatch: Map<string, number>,
): OrderValue {
  const listingById = new Map(listings.map((listing) => [listing.id, listing]));
  const committedByBatch = new Map<string, { quantity: number; value: number }>();
  for (const line of lines) {
    const entry = committedByBatch.get(line.cropBatchId) ?? { quantity: 0, value: 0 };
    entry.quantity += line.quantity;
    entry.value += line.quantity * (listingById.get(line.listingId)?.unitPrice ?? 0);
    committedByBatch.set(line.cropBatchId, entry);
  }
  let amount = 0;
  for (const [cropBatchId, accepted] of acceptedByBatch) {
    const committed = committedByBatch.get(cropBatchId);
    if (!committed || committed.quantity <= 0) continue;
    amount += accepted * (committed.value / committed.quantity);
  }
  return { amount: round(amount), currency: currencyOf(lines, listingById) };
}

export const PAYMENT_DAY_MS = 24 * 60 * 60 * 1_000;

export type PaymentStatus = "NOT_DUE" | "DUE" | "OVERDUE" | "PAID";

/**
 * One derivation shared by order reads and the operations snapshot, so a
 * farmer's dashboard and a coordinator's overdue count can never disagree.
 * `NOT_DUE` also covers an order that has not been delivered yet: the term
 * only starts once produce is accepted.
 */
export function derivePaymentStatus(
  order: { paymentTermsDays: number; paidAt: Date | null },
  acceptedAt: Date | null,
  now: Date,
): PaymentStatus {
  if (order.paidAt) return "PAID";
  if (!acceptedAt) return "NOT_DUE";
  const dueAt = acceptedAt.getTime() + order.paymentTermsDays * PAYMENT_DAY_MS;
  if (now.getTime() < dueAt) return "NOT_DUE";
  return now.getTime() < dueAt + PAYMENT_DAY_MS ? "DUE" : "OVERDUE";
}
