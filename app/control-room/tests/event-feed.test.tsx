import { cleanup, render, screen } from "@testing-library/react";
import { runScenario } from "@harvest/simulation";
import { afterEach, expect, it, vi } from "vitest";
import EventFeed from "@/components/panels/EventFeed";

afterEach(cleanup);

it("retains simultaneous events without duplicate React keys", () => {
  const timeline = runScenario({ scenarioId: "saint-lucia-demo-v1", policy: "HARVEST", seed: 42, captureFrames: true }).timeline!;
  const frame = timeline.frames.find((item) => item.eventType === "BUYER_DEMAND")!;
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    render(<EventFeed scene={timeline.scene} frames={[frame, { ...frame }]} onSelect={vi.fn()} onSelectAction={vi.fn()} />);
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(error.mock.calls.some((call) => call.join(" ").includes("same key"))).toBe(false);
  } finally { error.mockRestore(); }
});
