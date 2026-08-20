import { cleanup, render, screen } from "@testing-library/react";
import type { ControlRoomFrame, ControlRoomScene, SimulationAgentAction } from "@harvest/simulation";
import { afterEach, describe, expect, it, vi } from "vitest";

import Inspector from "@/components/panels/Inspector";

afterEach(cleanup);

const scene = {
  participants: [{
    simulationActorId: "10000000-0000-4000-8000-000000000001",
    productActorId: "20000000-0000-4000-8000-000000000001",
    role: "FARMER",
    displayName: "Mabouya Valley smallholding",
    islandId: "saint-lucia",
  }],
  farms: [], buyers: [], transporters: [], roads: [],
} as unknown as ControlRoomScene;

const frame = { batches: [], demands: [], missions: [], disruptions: [] } as unknown as ControlRoomFrame;
const action: SimulationAgentAction = {
  actionId: "30000000-0000-4000-8000-000000000001",
  at: "2026-09-03T06:00:00.000Z",
  simulationActorId: "10000000-0000-4000-8000-000000000001",
  productActorId: "20000000-0000-4000-8000-000000000001",
  role: "FARMER",
  toolName: "decide_approval",
  status: "SUCCEEDED",
  summary: "Approved the allocation proposal.",
  traceId: "40000000-0000-4000-8000-000000000001",
  entityId: "50000000-0000-4000-8000-000000000001",
  eventIds: ["60000000-0000-4000-8000-000000000001"],
  adapter: "deterministic",
  approval: "SYNTHETIC_PARTICIPANT",
};

describe("agent-action inspector", () => {
  it("shows bounded action, approval and safe references", () => {
    render(<Inspector scene={scene} frame={frame} selectedId={null} selectedAction={action} onClose={vi.fn()} />);

    expect(screen.getByText(/Mabouya Valley smallholding/)).toBeInTheDocument();
    expect(screen.getByText("decide approval")).toBeInTheDocument();
    expect(screen.getByText("synthetic participant decision")).toBeInTheDocument();
    expect(screen.getByText("40000000")).toBeInTheDocument();
    expect(screen.getByText("60000000")).toBeInTheDocument();
    expect(screen.queryByText(/chain-of-thought/i)).not.toBeInTheDocument();
  });
});
