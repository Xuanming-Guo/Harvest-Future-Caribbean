import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import EstimationModeControl from "@/components/EstimationModeControl";
import Masthead from "@/components/panels/Masthead";

afterEach(cleanup);

const scene = {
  runId: "11111111-1111-4111-8111-111111111111",
  scenarioId: "saint-lucia-demo-v1",
  policy: "HARVEST",
  seed: 42,
  evidenceLabel: "SYNTHETIC simulation output",
} as unknown as Parameters<typeof Masthead>[0]["scene"];

describe("EstimationModeControl", () => {
  it("offers both methods as a custom radio group rather than a native select", () => {
    render(<EstimationModeControl value="DETERMINISTIC_FALLBACK" onChange={vi.fn()} />);

    const group = screen.getByRole("radiogroup", { name: /harvest estimation/i });
    expect(group).toBeInTheDocument();
    expect(group.querySelector("select")).toBeNull();
    expect(screen.getByRole("radio", { name: "Harvest estimation model" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Deterministic fallback" })).toBeChecked();
  });

  it("reports the chosen method so the run can carry it", () => {
    const onChange = vi.fn();
    render(<EstimationModeControl value="DETERMINISTIC_FALLBACK" onChange={onChange} />);

    fireEvent.click(screen.getByRole("radio", { name: "Harvest estimation model" }));

    expect(onChange).toHaveBeenCalledWith("LEARNED_MODEL");
  });

  it("disables the choice for Baseline, which never requests a harvest estimate", () => {
    render(<EstimationModeControl value="DETERMINISTIC_FALLBACK" onChange={vi.fn()} disabled />);

    expect(screen.getByRole("radio", { name: "Harvest estimation model" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Deterministic fallback" })).toBeDisabled();
  });
});

describe("Masthead estimation badge", () => {
  it("states the method of the loaded run", () => {
    render(<Masthead scene={scene} estimationMode="DETERMINISTIC_FALLBACK" />);

    expect(screen.getByText("estimate: deterministic fallback")).toBeInTheDocument();
  });

  it("marks the recorded method as unused on a Baseline run", () => {
    render(<Masthead scene={scene} estimationMode="LEARNED_MODEL" estimationModeUsed={false} />);

    expect(screen.getByText("estimate: learned model (unused)")).toBeInTheDocument();
  });

  it("omits the badge until a run is loaded", () => {
    render(<Masthead scene={scene} />);

    expect(screen.queryByText(/^estimate:/)).toBeNull();
  });
});
