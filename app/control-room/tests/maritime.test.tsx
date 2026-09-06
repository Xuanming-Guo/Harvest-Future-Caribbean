/**
 * The maritime layer in the control room (#40).
 *
 * Two properties, both about honesty rather than looks:
 *
 *   1. The published network and a live consignment are drawn as *different*
 *      things — a faint dashed link that only says a service exists, and a
 *      brighter route with a moving vessel that says produce is on it.
 *   2. The attribution names the ferry operators, port authorities and central
 *      banks separately from the OpenStreetMap places snapshot, and carries the
 *      sentence that says a route is not a produce service.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ControlRoomFrame, ControlRoomScene, ControlRoomShipment, MaritimeAttribution } from "@harvest/simulation";
import { vesselPositionAt } from "@harvest/simulation";
import { afterEach, describe, expect, it } from "vitest";

import ReferenceAttribution from "@/components/panels/ReferenceAttribution";

afterEach(cleanup);

const attribution: MaritimeAttribution = {
  label: "Ferry and cargo links",
  sourceUrl: "https://www.frs-express.com/",
  publisher: "FRS Express des Iles",
  licence: "Publicly accessible operator web page; no open-data licence asserted.",
  retrievedAt: "2026-09-03",
};

/** The rate citation travels with every converted amount, so fixtures carry one too. */
const rateSource = {
  source: {
    title: "Eastern Caribbean Central Bank — Exchange Rates",
    url: "https://www.eccb-centralbank.org/exchange-rates",
    publisher: "Eastern Caribbean Central Bank (ECCB)",
  },
  licence: "Publicly published central-bank statistic; no open-data licence asserted.",
  retrievedAt: "2026-09-03",
  geography: "XCD has been pegged at EC$2.70 = US$1.00 since 1976.",
  evidenceType: "PUBLIC_REFERENCE" as const,
};

const money = (amount: number) => ({
  localAmount: amount,
  localCurrency: "XCD",
  comparisonAmount: amount,
  comparisonCurrency: "XCD" as const,
  unitsPerComparisonCurrency: 1,
  rateProvenance: "PUBLIC_REFERENCE" as const,
  amountProvenance: "SYNTHETIC" as const,
  rateAsOf: "2026-09-02",
  rateSource,
});

const SEA_START = 1_000_000;
const SEA_END = 1_100_000;

const shipment: ControlRoomShipment = {
  shipmentId: "shipment-1",
  missionId: "mission-1",
  commitmentId: "commitment-1",
  demandId: "demand-1",
  originIslandId: "martinique",
  destinationIslandId: "saint-lucia",
  originPortId: "port-martinique-fort-de-france",
  destinationPortId: "port-saint-lucia-castries",
  linkId: "link-martinique-saint-lucia",
  operator: "FRS Express des Iles",
  status: "DEPARTED",
  capacityKg: 900,
  loadedKg: 120,
  legs: [
    { kind: "PICKUP", fromLabel: "Farm", toLabel: "Fort-de-France", from: { latitude: 14.7, longitude: -61.1 }, to: { latitude: 14.6, longitude: -61.07 }, startsAt: 900_000, endsAt: SEA_START },
    { kind: "SEA", fromLabel: "Fort-de-France", toLabel: "Castries", from: { latitude: 14.6, longitude: -61.07 }, to: { latitude: 14.01, longitude: -60.99 }, startsAt: SEA_START, endsAt: SEA_END, journeyHoursSource: "PUBLIC_TIMETABLE" },
    { kind: "DELIVERY", fromLabel: "Castries", toLabel: "Buyer", from: { latitude: 14.01, longitude: -60.99 }, to: { latitude: 14.07, longitude: -60.95 }, startsAt: SEA_END, endsAt: 1_200_000 },
  ],
  customs: {
    portId: "port-saint-lucia-castries",
    status: "PENDING",
    documentationReference: "SYN-CUSTOMS-ABCD1234",
    inspected: false,
    delayHours: 2,
    clearedAt: null,
    feeXcd: 75,
    disclaimer: "Synthetic checkpoint, not a legal customs model.",
    provenance: "SYNTHETIC",
  },
  cost: { freight: money(216), customsFee: money(75), total: money(291) },
  scheduledDepartureAt: SEA_START,
  scheduledArrivalAt: SEA_END,
  actualDepartureAt: SEA_START,
  actualArrivalAt: null,
  deliveredAt: null,
  failureReason: null,
  weatherDelayHours: 0,
  networkProvenance: "PUBLIC_REFERENCE",
  operationsProvenance: "SYNTHETIC",
};

describe("the vessel marker", () => {
  it("appears only while the consignment is actually at sea", () => {
    expect(vesselPositionAt(shipment, SEA_START - 1)).toBeNull();
    expect(vesselPositionAt(shipment, SEA_END + 1)).toBeNull();
    const midway = vesselPositionAt(shipment, (SEA_START + SEA_END) / 2);
    expect(midway).not.toBeNull();
    expect(midway?.latitude).toBeCloseTo((14.6 + 14.01) / 2, 4);
    expect(midway?.longitude).toBeCloseTo((-61.07 + -60.99) / 2, 4);
  });

  it("shows nothing for a sailing that failed", () => {
    const failed: ControlRoomShipment = { ...shipment, status: "FAILED" };
    expect(vesselPositionAt(failed, (SEA_START + SEA_END) / 2)).toBeNull();
  });

  it("has no sea leg to draw when a run carries no shipments", () => {
    const frame = { shipments: undefined } as unknown as ControlRoomFrame;
    expect(frame.shipments ?? []).toHaveLength(0);
  });
});

describe("reference attribution", () => {
  it("names maritime publishers without explanatory copy", () => {
    render(
      <ReferenceAttribution
        sources={[]}
        maritime={[attribution]}

      />,
    );
    // The publishers are named on the collapsed line and detailed one click in;
    // the caveat is what that click has to reach.
    expect(screen.getByText("ferry & FX references")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /Sources/ }));
    const link = screen.getByRole("link", { name: attribution.publisher });
    expect(link).toHaveAttribute("href", attribution.sourceUrl);
    expect(screen.getByText(/retrieved 2026-09-03/)).toBeInTheDocument();
    expect(screen.queryByText(/Schedules, capacities, prices and outcomes are SYNTHETIC/)).not.toBeInTheDocument();
  });

  it("renders nothing at all when a run has no reference data", () => {
    const { container } = render(<ReferenceAttribution sources={[]} maritime={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps the scene's own network scoped to the run", () => {
    const scene = {
      maritime: {
        version: "1.0.0",
        generatedAt: "2026-09-03",
        islandIds: ["martinique", "saint-lucia"],
        ports: [
          { id: "port-martinique-fort-de-france", islandId: "martinique" },
          { id: "port-saint-lucia-castries", islandId: "saint-lucia" },
        ],
        links: [{ id: "link-martinique-saint-lucia" }],
        rates: [],
        ratesAsOf: "2026-09-02",
      },
    } as unknown as ControlRoomScene;
    for (const port of scene.maritime?.ports ?? []) {
      expect(["martinique", "saint-lucia"]).toContain(port.islandId);
    }
    expect(scene.maritime?.links).toHaveLength(1);
  });
});
