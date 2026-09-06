import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ControlRoomScene, InjectedDisruption } from "@harvest/simulation";
import { afterEach, describe, expect, it, vi } from "vitest";

import InjectionPanel from "@/components/InjectionPanel";

afterEach(cleanup);

const HOUR_MS = 3_600_000;
const startMs = Date.parse("2026-09-01T06:00:00.000Z");
const endMs = Date.parse("2026-09-22T06:00:00.000Z");
const scene = {
  runId: "10000000-0000-4000-8000-000000000001",
  scenarioId: "saint-lucia-demo-v1",
  policy: "HARVEST",
  seed: 8675309,
  startsAt: new Date(startMs).toISOString(),
  endsAt: new Date(endMs).toISOString(),
  farms: [{ farmId: "farm-1", islandId: "saint-lucia", name: "Mabouya Valley smallholding", position: { latitude: 13.9, longitude: -60.9 } }],
  buyers: [],
  transporters: [{ transporterId: "vehicle-1", islandId: "saint-lucia", name: "Castries light truck", homePosition: { latitude: 14, longitude: -61 }, capacityKg: 500 }],
  roads: [{ roadSegmentId: "road-1", islandId: "saint-lucia", name: "Mabouya valley road", from: { latitude: 13.9, longitude: -60.9 }, to: { latitude: 14, longitude: -61 }, distanceKm: 12 }],
  referencePlaces: [],
  referenceDataSources: [],
  participants: [],
  evidenceLabel: "SYNTHETIC SIMULATION",
} satisfies ControlRoomScene;

function renderPanel(atMs: number, comparison: { sourceRunId: string; changes: string[] } | null = null) {
  const onChange = vi.fn<(injections: InjectedDisruption[]) => void>();
  render(
    <InjectionPanel
      scene={scene}
      injections={comparison ? [{ type: "ROAD", offsetMs: HOUR_MS, durationMs: HOUR_MS, affectedEntityIds: ["road-1"], publicDescription: "Road closed." }] : []}
      comparison={comparison}
      onChange={onChange}
      atMs={atMs}
      startMs={startMs}
    />,
  );
  return onChange;
}

describe("control-room event injection", () => {
  it("disables injection when the one-hour offset reaches the horizon", () => {
    renderPanel(endMs - HOUR_MS);

    expect(screen.getByRole("button", { name: /rewind before the final frame/i })).toBeDisabled();
    expect(screen.getByText("Rewind to inject an event")).toBeInTheDocument();
    expect(screen.queryByText("Inject on day 22")).not.toBeInTheDocument();
  });

  it("shows the concrete target and submits an in-horizon event", () => {
    const onChange = renderPanel(endMs - 2 * HOUR_MS);

    expect(screen.getByText(/Mabouya valley road/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /inject this event on day 21/i }));
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ type: "ROAD", affectedEntityIds: ["road-1"] }),
    ]);
  });

  it("shows a no-change comparison", () => {
    renderPanel(startMs, { sourceRunId: "source-run", changes: [] });

    expect(screen.getByText(/No change in final totals/i)).toBeInTheDocument();
  });

  it("lists final totals that changed", () => {
    renderPanel(startMs, { sourceRunId: "source-run", changes: ["Physical waste: 100 kg -> 125 kg"] });

    expect(screen.getByText("Physical waste: 100 kg -> 125 kg")).toBeInTheDocument();
  });
});
