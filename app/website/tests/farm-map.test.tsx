import type { ApiSchema } from "@harvest/shared";
import { cleanup, render } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { FarmMap } from "@/components/farm-map";

afterEach(() => cleanup());

type CropBatch = ApiSchema<"CropBatch">;
type MarketOpportunity = ApiSchema<"MarketOpportunity">;
type DeliveryMission = ApiSchema<"DeliveryMission">;

const batches: CropBatch[] = [
  {
    cropBatchId: "batch-growing",
    farmId: "farm-1",
    cropType: "Cucumber",
    status: "GROWING",
    availableToPromise: { value: 40, unit: "kg" },
    provenance: "OBSERVED",
  },
  {
    cropBatchId: "batch-ready",
    farmId: "farm-1",
    cropType: "Tomato",
    status: "HARVEST_READY",
    availableToPromise: { value: 120, unit: "kg" },
    provenance: "OBSERVED",
  },
  {
    cropBatchId: "batch-closed",
    farmId: "farm-1",
    cropType: "Okra",
    status: "CLOSED",
    availableToPromise: { value: 0, unit: "kg" },
    provenance: "OBSERVED",
  },
];

const opportunities: MarketOpportunity[] = [
  {
    opportunityId: "opportunity-1",
    cropType: "Tomato",
    quantity: { value: 80, unit: "kg" },
    neededBy: "2026-09-10T15:00:00.000Z",
    deliveryZone: "Castries",
    createdAt: "2026-09-01T09:00:00.000Z",
  },
];

const activeMissions: DeliveryMission[] = [
  {
    missionId: "mission-1",
    orderId: "order-1",
    status: "IN_TRANSIT",
    quantity: { value: 80, unit: "kg" },
    deadline: "2026-09-10T15:00:00.000Z",
    stops: [],
    currentStopSequence: 0,
  },
];

describe("FarmMap", () => {
  it("renders one link per crop batch with the correct crop detail href", () => {
    const { container } = render(<FarmMap batches={batches} opportunities={opportunities} missions={activeMissions} />);
    const links = container.querySelectorAll("a.farm-plot");
    expect(links).toHaveLength(3);
    expect(container.querySelector('a[href="/crops/batch-growing"]')).not.toBeNull();
    expect(container.querySelector('a[href="/crops/batch-ready"]')).not.toBeNull();
    expect(container.querySelector('a[href="/crops/batch-closed"]')).not.toBeNull();
  });

  it("marks the harvest-ready plot with its status class and an accessible label", () => {
    const { container } = render(<FarmMap batches={batches} opportunities={[]} missions={[]} />);
    const readyPlot = container.querySelector('a[href="/crops/batch-ready"]');
    expect(readyPlot).not.toBeNull();
    expect(readyPlot?.className).toContain("farm-plot-harvest-ready");
    expect(readyPlot?.getAttribute("aria-label")).toBe("Tomato batch, harvest ready, 120 kg available");
  });

  it("shows the buyer-demand badge only on the plot whose crop matches an open opportunity", () => {
    const { container } = render(<FarmMap batches={batches} opportunities={opportunities} missions={[]} />);
    const readyPlot = container.querySelector('a[href="/crops/batch-ready"]');
    const growingPlot = container.querySelector('a[href="/crops/batch-growing"]');
    const closedPlot = container.querySelector('a[href="/crops/batch-closed"]');

    expect(readyPlot?.querySelector(".farm-badge")).not.toBeNull();
    expect(growingPlot?.querySelector(".farm-badge")).toBeNull();
    expect(closedPlot?.querySelector(".farm-badge")).toBeNull();
  });

  it("renders the delivery truck only when a mission is active", () => {
    const { container: withMission } = render(<FarmMap batches={batches} opportunities={[]} missions={activeMissions} />);
    expect(withMission.querySelector(".farm-truck")).not.toBeNull();

    const { container: withoutMission } = render(<FarmMap batches={batches} opportunities={[]} missions={[]} />);
    expect(withoutMission.querySelector(".farm-truck")).toBeNull();

    const deliveredOnly: DeliveryMission[] = [{ ...activeMissions[0], status: "DELIVERED" }];
    const { container: withDeliveredOnly } = render(<FarmMap batches={batches} opportunities={[]} missions={deliveredOnly} />);
    expect(withDeliveredOnly.querySelector(".farm-truck")).toBeNull();
  });
});
