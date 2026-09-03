import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import {
  CropProgressPlot,
  DeliveryBoard,
  DeliveryJourney,
  type DeliveryMissionView,
  VehiclePicker,
} from "@/components/delivery-world";

const mission: DeliveryMissionView = {
  missionId: "23232323-2323-4323-8323-232323232323",
  orderId: "20202020-2020-4020-8020-202020202020",
  status: "IN_TRANSIT",
  transporterId: "24242424-2424-4424-8424-242424242424",
  vehicleId: "25252525-2525-4525-8525-252525252525",
  quantity: { value: 20, unit: "kg" },
  deadline: "2026-09-05T15:00:00Z",
  estimatedArrival: "2026-09-05T14:30:00Z",
  estimatedDistanceKm: 18.4,
  estimatedDurationMinutes: 67,
  currentStopSequence: 1,
  routeRegion: "Saint Lucia",
  buyerName: "Bay Gardens Hotel",
  cropType: "CUCUMBER",
  atRisk: false,
  stops: [
    {
      sequence: 1,
      kind: "PICKUP",
      displayName: "Roseau Valley Farm",
      farmId: "14141414-1414-4414-8414-141414141414",
      cropBatchIds: ["11111111-1111-4111-8111-111111111111"],
      quantity: { value: 14, unit: "kg" },
      location: { latitude: 13.953, longitude: -61.005 },
    },
    {
      sequence: 2,
      kind: "PICKUP",
      displayName: "Mabouya Growers",
      farmId: "14141414-1414-4414-8414-141414141415",
      cropBatchIds: ["11111111-1111-4111-8111-111111111112"],
      quantity: { value: 6, unit: "kg" },
      location: { latitude: 13.941, longitude: -60.918 },
    },
    {
      sequence: 3,
      kind: "DROPOFF",
      displayName: "Bay Gardens Hotel",
      quantity: { value: 20, unit: "kg" },
      location: { latitude: 14.0101, longitude: -60.9875 },
    },
  ],
  cargo: [
    {
      cropBatchId: "11111111-1111-4111-8111-111111111111",
      farmId: "14141414-1414-4414-8414-141414141414",
      farmName: "Roseau Valley Farm",
      cropType: "CUCUMBER",
      cropStatus: "HARVEST_READY",
      quantity: { value: 14, unit: "kg" },
    },
    {
      cropBatchId: "11111111-1111-4111-8111-111111111112",
      farmId: "14141414-1414-4414-8414-141414141415",
      farmName: "Mabouya Growers",
      cropType: "DASHEEN",
      cropStatus: "GROWING",
      quantity: { value: 6, unit: "kg" },
    },
  ],
};

describe("delivery world", () => {
  it("selects tactile delivery tickets from the board", () => {
    const onSelect = vi.fn();
    render(<DeliveryBoard missions={[mission, { ...mission, missionId: "33333333-3333-4333-8333-333333333333", status: "AVAILABLE" }]} selectedMissionId={mission.missionId} onSelect={onSelect} />);

    const tickets = screen.getAllByRole("button", { name: /20 kg Cucumber/i });
    expect(tickets[1]).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(tickets[0]!);
    expect(onSelect).toHaveBeenCalledWith("33333333-3333-4333-8333-333333333333");
  });

  it("updates the island route when a different ticket is selected", () => {
    const secondMission = {
      ...mission,
      missionId: "33333333-3333-4333-8333-333333333333",
      buyerName: "Jade Mountain Hotel",
      cropType: "DASHEEN",
      stops: mission.stops.map((stop) => stop.kind === "DROPOFF" ? { ...stop, displayName: "Jade Mountain Hotel" } : stop),
    };
    function Harness() {
      const [selected, setSelected] = React.useState(mission);
      return (
        <>
          <DeliveryBoard missions={[mission, secondMission]} selectedMissionId={selected.missionId} onSelect={(missionId) => setSelected(missionId === secondMission.missionId ? secondMission : mission)} />
          <DeliveryJourney mission={selected} />
        </>
      );
    }

    const { unmount } = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /20 kg Dasheen/i }));
    expect(screen.getByRole("button", { name: /Hotel stop 3: Jade Mountain Hotel/ })).toBeInTheDocument();
    unmount();
  });

  it("shows state-driven truck motion and opens only order-linked farm progress", () => {
    const { container } = render(<DeliveryJourney mission={mission} />);

    expect(container.querySelector(".journey-truck")).toHaveClass("is-moving");
    expect(container.querySelector(".journey-truck")).toHaveAttribute("data-position", "mid-leg");
    expect(container.querySelector(".journey-truck")).toHaveStyle({ "--truck-x": "28.31521739130435%" });
    fireEvent.click(screen.getByRole("button", { name: /Farm stop 1: Roseau Valley Farm/ }));
    expect(screen.getByText("Live farm view")).toBeInTheDocument();
    expect(screen.getByText("14 kg committed")).toBeInTheDocument();
    expect(screen.queryByText("6 kg committed")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Back to island/ }));
    expect(screen.getByText("Illustrated route — not live GPS")).toBeInTheDocument();
  });

  it("does not expose crop progress on an available transporter job", () => {
    const available = {
      ...mission,
      status: "AVAILABLE" as const,
      transporterId: undefined,
      vehicleId: undefined,
      currentStopSequence: 0,
      cargo: mission.cargo.map((cargo) => ({ ...cargo, cropStatus: undefined })),
    };
    render(<DeliveryJourney mission={available} />);

    fireEvent.click(screen.getByRole("button", { name: "Farm stop 1: Roseau Valley Farm" }));
    expect(screen.queryByText("Live farm view")).not.toBeInTheDocument();
  });

  it("supports button and keyboard map navigation", () => {
    const { container } = render(<DeliveryJourney mission={mission} />);
    const stage = container.querySelector(".island-stage")!;
    const layer = container.querySelector(".world-pan-layer")!;

    fireEvent.click(container.querySelector('button[aria-label="Zoom in"]')!);
    expect(layer).toHaveAttribute("data-zoom", "1.2");
    fireEvent.keyDown(stage, { key: "ArrowRight" });
    expect(layer).toHaveStyle({ transform: "translate3d(-28px, 0px, 0) scale(1.2)" });
    fireEvent.click(container.querySelector('button[aria-label="Reset map view"]')!);
    expect(layer).toHaveAttribute("data-zoom", "1.0");
  });

  it("renders empty, delayed, cancelled, and delivered route states", () => {
    const { rerender, container } = render(<DeliveryBoard missions={[]} onSelect={vi.fn()} />);
    expect(screen.getByText("No delivery tickets yet")).toBeInTheDocument();

    rerender(<DeliveryJourney mission={mission} updates={[{
      updateId: "34343434-3434-4434-8434-343434343434",
      missionId: mission.missionId,
      updateType: "DELAYED",
      recordedAt: "2026-09-05T13:00:00Z",
      note: "Road closure near Castries.",
    }]} />);
    expect(screen.getByText("Delay reported")).toBeInTheDocument();
    expect(screen.getByText("Road closure near Castries.")).toBeInTheDocument();

    rerender(<DeliveryJourney mission={{ ...mission, status: "CANCELLED" }} />);
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
    expect(container.querySelector(".journey-truck")).not.toHaveClass("is-moving");

    rerender(<DeliveryJourney mission={{ ...mission, status: "DELIVERED", currentStopSequence: 3 }} />);
    expect(screen.getByText("Delivered")).toBeInTheDocument();
    expect(container.querySelector(".journey-truck")).not.toHaveClass("is-moving");
  });

  it("renders crop-specific art for every supported progress state and a generic crop", () => {
    const statuses = ["PLANNED", "GROWING", "HARVEST_READY", "HARVESTED", "CLOSED"] as const;
    const { container } = render(
      <>
        {statuses.map((status) => <CropProgressPlot cargo={{ ...mission.cargo[0]!, cropBatchId: status, cropStatus: status }} key={status} />)}
        <CropProgressPlot cargo={mission.cargo[1]!} />
        <CropProgressPlot cargo={{ ...mission.cargo[1]!, cropBatchId: "generic", cropType: "PAPAYA" }} />
      </>,
    );

    for (const status of statuses) expect(container.querySelector('[data-stage="' + status.toLowerCase() + '"]')).toBeInTheDocument();
    expect(container.querySelector('[data-crop="cucumber"] .cucumber-leaf')).toBeInTheDocument();
    expect(container.querySelector('[data-crop="dasheen"] .dasheen-leaf')).toBeInTheDocument();
    expect(container.querySelector('[data-crop="papaya"] .generic-leaf')).toBeInTheDocument();
  });

  it("uses a custom keyboard-dismissable vehicle picker", () => {
    const onChange = vi.fn();
    const { container } = render(
      <VehiclePicker
        vehicles={[{
          vehicleId: "25252525-2525-4525-8525-252525252525",
          label: "Daniel’s refrigerated van",
          status: "AVAILABLE",
          capacity: { value: 350, unit: "kg" },
        }]}
        value=""
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Choose a vehicle/ }));
    fireEvent.click(screen.getByRole("option", { name: /Daniel’s refrigerated van/ }));
    expect(onChange).toHaveBeenCalledWith("25252525-2525-4525-8525-252525252525");
    fireEvent.click(screen.getByRole("button", { name: /Choose a vehicle/ }));
    fireEvent.keyDown(container.querySelector(".vehicle-picker")!, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
