/**
 * The cross-island section of a buyer's order page (#40).
 *
 * The property this file defends: a buyer looking at a cross-island order can
 * see the three legs, whether it has cleared the border, what it costs in their
 * own currency *and* in the comparison currency, and — before anything sails —
 * that nothing binds until every approval is granted. And that an ordinary
 * local order shows none of it.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import OrderDetailPage from "@/app/orders/[orderId]/page";
import { api } from "@/lib/api";

vi.mock("next/navigation", () => ({ useParams: () => ({ orderId: "order-1" }) }));
vi.mock("@/components/providers", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/components/providers");
  return { ...actual, useSession: () => ({ actor: { role: "BUYER", actorId: "buyer-1" } }) };
});
vi.mock("@/components/approval-list", () => ({ ApprovalList: () => null }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const money = (amount: number, currency: string, comparison: number) => ({
  localAmount: amount,
  localCurrency: currency,
  comparisonAmount: comparison,
  comparisonCurrency: "XCD",
  unitsPerComparisonCurrency: Number((amount / comparison).toFixed(6)),
  rateProvenance: "PUBLIC_REFERENCE",
  amountProvenance: "SYNTHETIC",
  rateAsOf: "2026-09-02",
});

const commitment = (over: Record<string, unknown> = {}) => ({
  commitmentId: "commitment-1",
  orderId: "order-1",
  status: "APPROVED",
  originIslandId: "saint-lucia",
  destinationIslandId: "martinique",
  route: {
    linkId: "link-martinique-saint-lucia",
    originPortId: "port-saint-lucia-castries",
    destinationPortId: "port-martinique-fort-de-france",
    operator: "FRS Express des Iles",
    seaLegHours: 1.5,
    journeyHoursSource: "PUBLIC_TIMETABLE",
    references: [],
  },
  quantity: { value: 120, unit: "kg" },
  cost: money(251.36, "EUR", 291),
  lines: [{ cropBatchId: "batch-1", quantity: { value: 120, unit: "kg" } }],
  approvalSummary: { required: 2, approved: 2, pending: 0, rejected: 0 },
  boundAt: "2026-09-08T10:00:00Z",
  shipmentId: "shipment-1",
  provenanceNote: "SYNTHETIC operations on public-reference geography.",
  createdAt: "2026-09-08T08:00:00Z",
  ...over,
});

const shipment = (over: Record<string, unknown> = {}) => ({
  shipmentId: "shipment-1",
  commitmentId: "commitment-1",
  orderId: "order-1",
  status: "ARRIVED",
  capacityKg: 900,
  loadedKg: 118.4,
  legs: [
    { kind: "PICKUP", fromLabel: "Roseau valley plot", toLabel: "Castries", from: { latitude: 14, longitude: -61 }, to: { latitude: 14.01, longitude: -60.99 }, startsAt: "2026-09-09T06:00:00Z", endsAt: "2026-09-09T07:30:00Z" },
    { kind: "SEA", fromLabel: "Castries", toLabel: "Fort-de-France", from: { latitude: 14.01, longitude: -60.99 }, to: { latitude: 14.6, longitude: -61.07 }, startsAt: "2026-09-09T07:30:00Z", endsAt: "2026-09-09T09:00:00Z", journeyHoursSource: "PUBLIC_TIMETABLE" },
    { kind: "DELIVERY", fromLabel: "Fort-de-France", toLabel: "Martinique synthetic buyer 1", from: { latitude: 14.6, longitude: -61.07 }, to: { latitude: 14.61, longitude: -61.05 }, startsAt: "2026-09-09T11:45:00Z", endsAt: "2026-09-09T12:20:00Z" },
  ],
  customs: {
    portId: "port-martinique-fort-de-france",
    status: "CLEARED",
    documentationReference: "SYN-CUSTOMS-9F31A0C2",
    inspected: true,
    delayHours: 8,
    clearedAt: "2026-09-09T11:45:00Z",
    feeXcd: 75,
    disclaimer: "Synthetic checkpoint, not a legal customs model. Documentation, inspection, delay and cost are demonstration assumptions.",
    provenance: "SYNTHETIC",
  },
  cost: money(251.36, "EUR", 291),
  route: commitment().route,
  scheduledDepartureAt: "2026-09-09T07:30:00Z",
  scheduledArrivalAt: "2026-09-09T09:00:00Z",
  actualDepartureAt: "2026-09-09T07:30:00Z",
  actualArrivalAt: "2026-09-09T09:00:00Z",
  deliveredAt: null,
  failureReason: null,
  weatherDelayHours: 1.25,
  simulationShipmentId: "sim-shipment-1",
  networkProvenance: "PUBLIC_REFERENCE",
  operationsProvenance: "SYNTHETIC",
  createdAt: "2026-09-08T10:05:00Z",
  ...over,
});

const order = (over: Record<string, unknown> = {}) => ({
  orderId: "order-1",
  buyerId: "buyer-1",
  cropType: "cucumber",
  requestedQuantity: { value: 200, unit: "kg" },
  committedQuantity: { value: 120, unit: "kg" },
  acceptedQuantity: { value: 0, unit: "kg" },
  minimumAcceptableFraction: 0.5,
  paymentTermsDays: 14,
  neededBy: "2026-09-10T14:00:00Z",
  lifecycleStatus: "IN_DELIVERY",
  atRisk: false,
  approvalSummary: { required: 2, approved: 2, pending: 0, rejected: 0 },
  createdAt: "2026-09-08T07:00:00Z",
  updatedAt: "2026-09-09T09:00:00Z",
  ...over,
});

function renderOrder() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OrderDetailPage />
    </QueryClientProvider>,
  );
}

describe("a cross-island order", () => {
  it("shows the legs, the checkpoint and both currencies", async () => {
    vi.spyOn(api, "order").mockResolvedValue(
      order({ interIslandCommitment: commitment(), maritimeShipment: shipment() }) as never,
    );
    renderOrder();

    await waitFor(() => expect(screen.getByText("Cross-island supply")).toBeInTheDocument());
    expect(screen.getByText("FRS Express des Iles")).toBeInTheDocument();
    expect(screen.getByText("1.5 h (published)")).toBeInTheDocument();

    // The three legs, named for what a buyer would call them.
    expect(screen.getByText(/Farm to port/)).toBeInTheDocument();
    expect(screen.getByText(/Sea crossing/)).toBeInTheDocument();
    expect(screen.getByText(/Port to you/)).toBeInTheDocument();

    // The border check, with the sentence that says what it is not.
    expect(screen.getByText(/Customs: Cleared/)).toBeInTheDocument();
    expect(screen.getByText(/SYN-CUSTOMS-9F31A0C2/)).toBeInTheDocument();
    expect(screen.getByText(/not a legal customs model/i)).toBeInTheDocument();

    // Local value and the XCD comparison, and the rate that connects them.
    expect(screen.getByText(/EUR 251\.36 · XCD 291\.00/)).toBeInTheDocument();
    expect(screen.getByText(/EUR per XCD, as of 2026-09-02/)).toBeInTheDocument();

    expect(screen.getByText(/Weather delayed the crossing by 1\.25 h/)).toBeInTheDocument();
  });

  it("says plainly that nothing ships before every approval lands", async () => {
    vi.spyOn(api, "order").mockResolvedValue(
      order({
        lifecycleStatus: "AWAITING_APPROVAL",
        interIslandCommitment: commitment({
          status: "PROPOSED",
          boundAt: null,
          shipmentId: null,
          approvalSummary: { required: 2, approved: 1, pending: 1, rejected: 0 },
        }),
      }) as never,
    );
    renderOrder();

    await waitFor(() => expect(screen.getByText("Cross-island supply")).toBeInTheDocument());
    expect(screen.getByText("1 of 2 approved")).toBeInTheDocument();
    expect(screen.getByText(/Not yet — nothing ships until every approval is granted/)).toBeInTheDocument();
    expect(screen.queryByText("Shipment legs")).not.toBeInTheDocument();
  });

  it("reports a lost consignment rather than quietly dropping it", async () => {
    vi.spyOn(api, "order").mockResolvedValue(
      order({
        interIslandCommitment: commitment(),
        maritimeShipment: shipment({
          status: "FAILED",
          failureReason: "The consignment did not come off the vessel in a saleable state. SYNTHETIC outcome, not a recorded incident.",
          customs: { ...shipment().customs, status: "HELD" },
        }),
      }) as never,
    );
    renderOrder();

    await waitFor(() => expect(screen.getByText("This consignment did not arrive")).toBeInTheDocument());
    expect(screen.getByText(/SYNTHETIC outcome, not a recorded incident/)).toBeInTheDocument();
    expect(screen.getByText(/Customs: Held at the border/)).toBeInTheDocument();
  });
});

describe("an ordinary local order", () => {
  it("shows no cross-island section at all", async () => {
    vi.spyOn(api, "order").mockResolvedValue(order() as never);
    renderOrder();

    await waitFor(() => expect(screen.getByText("Order progress")).toBeInTheDocument());
    expect(screen.queryByText("Cross-island supply")).not.toBeInTheDocument();
    expect(screen.queryByText("Shipment legs")).not.toBeInTheDocument();
  });
});
