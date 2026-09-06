import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import {
  CropProgressPlot,
  DeliveryBoard,
  DeliveryJourney,
  type DeliveryMissionView,
  VehiclePicker,
} from "@/components/delivery-world";
import { buildIslandRoadNetwork, type IslandMarker } from "@/components/island-game-canvas";
import { layoutWorldLocations, OpenWorldMap, worldMarkerState, type WorldMapView } from "@/components/open-world-map";

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

const world: WorldMapView = {
  region: "Saint Lucia",
  locations: [
    {
      locationId: "14141414-1414-4414-8414-141414141414",
      kind: "FARM",
      displayName: "Roseau Valley Farm",
      identified: true,
      serviceZone: "Roseau Valley",
      access: "CROP_PROGRESS",
      crops: [{ cropBatchId: "11111111-1111-4111-8111-111111111111", cropType: "CUCUMBER", status: "HARVEST_READY", quantity: { value: 14, unit: "kg" } }],
      opportunities: [],
    },
    {
      locationId: "a0000000-0000-4000-8000-000000000002",
      kind: "HOTEL",
      displayName: "Bay Gardens Hotel",
      identified: true,
      serviceZone: "Castries",
      access: "BUYER_DEMAND",
      crops: [],
      opportunities: [{ opportunityId: "18181818-1818-4818-8818-181818181818", cropType: "CUCUMBER", quantity: { value: 20, unit: "kg" }, neededBy: "2026-09-05T15:00:00Z", status: "OPEN" }],
    },
  ],
};

describe("delivery world", () => {
  it("lays out new world locations from data and lets a farmer open a hotel order board", async () => {
    const newFarm: WorldMapView["locations"][number] = {
      ...world.locations[0]!,
      locationId: "99999999-9999-4999-8999-999999999999",
      displayName: "New Community Farm",
      serviceZone: "Canaries",
      crops: [{ ...world.locations[0]!.crops[0]!, cropBatchId: "99999999-9999-4999-8999-999999999998", status: "GROWING" }],
    };
    const growingWorld = { ...world, locations: [...world.locations, newFarm] };
    expect(layoutWorldLocations(growingWorld.locations).flatMap((node) => node.members).map((location) => location.displayName)).toContain("New Community Farm");

    const { container } = render(<OpenWorldMap world={growingWorld} role="FARMER" />);
    expect(screen.getByRole("button", { name: /1 open request across 1 hotel/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Hotel: Bay Gardens Hotel.*buyer request/i }));
    await act(async () => { fireEvent.load(container.querySelector(".hotel-scene-art")!); });
    expect(await screen.findByText("Produce wanted")).toBeInTheDocument();
    expect(screen.getByText("20 kg Cucumber")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "2 matching fields" }));
    expect(screen.getByRole("link", { name: /Open Cucumber at Roseau Valley Farm/i })).toHaveAttribute("href", "/crops/11111111-1111-4111-8111-111111111111");
    expect(screen.getByRole("link", { name: /Open Cucumber at New Community Farm/i })).toHaveAttribute("href", "/crops/99999999-9999-4999-8999-999999999998");
    fireEvent.click(screen.getByRole("button", { name: /Back to island/i }));
    expect(await screen.findByRole("button", { name: /Farm: Roseau Valley Farm.*crop progress/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /3 island places/i }));
    expect(screen.getByRole("region", { name: "Canaries places" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Castries places" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Roseau Valley places" })).toBeInTheDocument();
  });

  it("turns an owned farm into a crop-filled growth scene", async () => {
    const { container, unmount } = render(<OpenWorldMap world={world} role="FARMER" />);

    fireEvent.click(container.querySelector('button[aria-label="Farm: Roseau Valley Farm. Open crop progress"]')!);
    await waitFor(() => expect(container.querySelector(".world-place-header h2")).toHaveTextContent("Roseau Valley Farm"), { timeout: 2500 });
    expect(container.querySelectorAll(".field-crop-art")).toHaveLength(12);
    expect(container.querySelector(".crop-stage-art")).toHaveAttribute("src", expect.stringContaining("cucumber-game.webp"));
    unmount();
  });

  it("clusters dense world data by zone without losing places from the directory model", () => {
    const denseLocations = Array.from({ length: 24 }, (_, index) => ({
      ...world.locations[0]!,
      locationId: `${String(index).padStart(8, "0")}-1111-4111-8111-111111111111`,
      displayName: `Farm ${index + 1}`,
      serviceZone: index < 12 ? "Roseau Valley" : "Mabouya Valley",
    }));
    const nodes = layoutWorldLocations(denseLocations);

    expect(nodes).toHaveLength(2);
    expect(nodes.flatMap((node) => node.members)).toHaveLength(24);
    expect(nodes.every((node) => node.label.includes("12 farms"))).toBe(true);
  });

  it("grows one connected road network as live locations are added", () => {
    const markers: IslandMarker[] = layoutWorldLocations(world.locations).map((node, index) => ({
      kind: node.kind === "FARM" ? "PICKUP" : "DROPOFF",
      label: node.label,
      point: node.point,
      sequence: index,
      state: worldMarkerState(node),
      variant: index % 3,
    }));
    markers.push({ kind: "PICKUP", label: "New farm", point: { x: .48, y: .61 }, sequence: 3, state: "GROWING", variant: 2 });

    const network = buildIslandRoadNetwork(markers);
    expect(network).toHaveLength(markers.length - 1);
    expect(network.some((road) => road.start === markers[2]!.point || road.end === markers[2]!.point)).toBe(true);
  });

  it("keeps a populated island legible while revealing the focused place", () => {
    const populatedWorld = {
      ...world,
      locations: Array.from({ length: 9 }, (_, index) => ({
        ...world.locations[index % world.locations.length]!,
        locationId: `${String(index).padStart(8, "0")}-2222-4222-8222-222222222222`,
        displayName: `Island place ${index + 1}`,
      })),
    };
    const { container } = render(<OpenWorldMap world={populatedWorld} role="FARMER" />);

    expect(container.querySelector(".world-map-hint")).toBeNull();
    const firstPlace = screen.getByRole("button", { name: /Island place 1/ });
    fireEvent.focus(firstPlace);
    expect(firstPlace).toHaveClass("is-selected");
    fireEvent.blur(firstPlace);
    expect(firstPlace).not.toHaveClass("is-selected");
  });

  it("turns crop stages and buyer demand into scalable world signals", () => {
    const nodes = layoutWorldLocations(world.locations);
    expect(worldMarkerState(nodes.find((node) => node.kind === "FARM")!)).toBe("HARVEST_READY");
    expect(worldMarkerState(nodes.find((node) => node.kind === "HOTEL")!)).toBe("OPEN");

    const { container } = render(<OpenWorldMap world={world} role="FARMER" />);
    expect(container.querySelector(".island-landscape image")).toHaveAttribute("href", "/art/islands/saint-lucia-world-v3.webp");
    expect(container.querySelector(".world-place-name")).toBeVisible();
    expect(container.querySelector('[data-world-state="HARVEST_READY"]')).toBeInTheDocument();
    expect(container.querySelector('[data-world-state="OPEN"]')).toBeInTheDocument();
    expect(container.querySelector(".world-location-hit b")).not.toHaveTextContent("1");
  });

  it("waits for place artwork, crossfades without a pixelated deep zoom, and restores the island", async () => {
    vi.useFakeTimers();
    const bounds = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 900, 600));
    const { container, unmount } = render(<OpenWorldMap world={world} role="FARMER" />);
    try {
      fireEvent.click(container.querySelector('button[aria-label="Farm: Roseau Valley Farm. Open crop progress"]')!);
      expect(container.querySelector(".open-world-stage")).toHaveAttribute("data-camera-mode", "entering-place");
      expect(container.querySelector(".world-pan-layer")).toHaveAttribute("data-zoom", "1.0");
      expect(container.querySelector(".world-place-layer")).toHaveAttribute("aria-hidden", "true");
      act(() => vi.advanceTimersByTime(2000));
      expect(container.querySelector(".world-place-layer")).not.toHaveClass("is-visible");
      await act(async () => { fireEvent.load(container.querySelector(".farm-scene-art")!); });
      expect(container.querySelector(".world-place-layer")).toHaveClass("is-visible");
      expect(Number(container.querySelector(".world-pan-layer")?.getAttribute("data-zoom"))).toBeLessThan(1.3);
      act(() => vi.advanceTimersByTime(500));
      expect(container.querySelector(".world-place-header h2")).toHaveTextContent("Roseau Valley Farm");
      expect(container.querySelector(".world-back-button")).toHaveFocus();
      fireEvent.click(container.querySelector(".world-back-button")!);
      expect(container.querySelector(".world-place-layer")).not.toHaveClass("is-visible");
      act(() => vi.advanceTimersByTime(450));
      expect(container.querySelector(".world-place-layer")).not.toBeInTheDocument();
      expect(container.querySelector(".world-pan-layer")).toHaveAttribute("data-zoom", "1.0");
    } finally { unmount(); bounds.mockRestore(); vi.useRealTimers(); }
  });

  it("zooms the world with the mouse wheel", () => {
    const { container, unmount } = render(<OpenWorldMap world={world} role="FARMER" />);
    fireEvent.wheel(container.querySelector(".open-world-stage")!, { deltaY: -300, clientX: 300, clientY: 200 });
    expect(Number(container.querySelector(".world-pan-layer")?.getAttribute("data-zoom"))).toBeGreaterThan(1);
    unmount();
  });

  it("keeps delivery roads as an optional layer over the open world", () => {
    const { container, rerender } = render(<OpenWorldMap world={world} role="FARMER" />);
    expect(screen.queryByText("Route layer")).not.toBeInTheDocument();
    rerender(<OpenWorldMap world={world} mission={mission} role="FARMER" />);
    expect(screen.getByText("Route layer")).toBeInTheDocument();
    expect(screen.getByText(/20 kg Cucumber → Bay Gardens Hotel/)).toBeInTheDocument();
    expect(container.querySelector('button[aria-label^="Hotel: Bay Gardens Hotel"]')).toHaveAttribute("aria-current", "location");
  });

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

    expect(container.querySelector(".island-game-renderer")).toHaveAttribute("data-position", "mid-leg");
    expect(container.querySelector(".island-game-canvas")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Farm stop 1: Roseau Valley Farm/ }));
    expect(screen.getByText("Live farm view")).toBeInTheDocument();
    expect(screen.getByText("14 kg committed")).toBeInTheDocument();
    expect(screen.queryByText("6 kg committed")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Back to island/ }));
    expect(screen.queryByText("Illustrated route — not live GPS")).not.toBeInTheDocument();
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
    const bounds = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(0, 0, 900, 600));
    const { container, unmount } = render(<DeliveryJourney mission={mission} />);
    try {
      const stage = container.querySelector(".island-stage")!;
      const layer = container.querySelector(".world-pan-layer")!;

      fireEvent.click(container.querySelector('button[aria-label="Zoom in"]')!);
      expect(layer).toHaveAttribute("data-zoom", "1.2");
      fireEvent.keyDown(stage, { key: "ArrowRight" });
      expect(layer).toHaveStyle({ transform: "translate3d(-28px, 0px, 0) scale(1.2)" });
      fireEvent.click(container.querySelector('button[aria-label="Reset map view"]')!);
      expect(layer).toHaveAttribute("data-zoom", "1.0");
    } finally {
      unmount();
      bounds.mockRestore();
    }
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
    expect(container.querySelector(".island-game-renderer")).toHaveAttribute("data-position", "at-stop");

    rerender(<DeliveryJourney mission={{ ...mission, status: "DELIVERED", currentStopSequence: 3 }} />);
    expect(screen.getByText("Delivered")).toBeInTheDocument();
    expect(container.querySelector(".island-game-renderer")).toHaveAttribute("data-position", "at-stop");
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
    expect(container.querySelector('[data-crop="cucumber"][data-stage="harvest_ready"] img')).toHaveAttribute("src", expect.stringContaining("cucumber-game.webp"));
    expect(container.querySelector('[data-crop="dasheen"] img')).toHaveAttribute("src", expect.stringContaining("dasheen-game.webp"));
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
