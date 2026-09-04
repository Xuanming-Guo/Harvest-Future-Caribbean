import type { ApiSchema } from "@harvest/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ForecastMethod } from "@/components/forecast-method";
import { estimationMethodLabel } from "@/lib/format";

afterEach(cleanup);

function prediction(overrides: Partial<ApiSchema<"YieldPredictionEvidence">>): ApiSchema<"YieldPredictionEvidence"> {
  return {
    predictionId: "44444444-4444-4444-8444-444444444444",
    requestId: "33333333-3333-4333-8333-333333333333",
    cropBatchId: "11111111-1111-4111-8111-111111111111",
    modelVersion: "fixture-yield-v0.1.0",
    estimationMode: "DETERMINISTIC_FALLBACK",
    q10MarketableYield: { value: 14, unit: "kg" },
    q50MarketableYield: { value: 17, unit: "kg" },
    q90MarketableYield: { value: 22, unit: "kg" },
    harvestWindow: { start: "2026-09-04", end: "2026-09-07" },
    readiness: 0.8,
    confidence: 0.76,
    warnings: ["Deterministic fallback estimate, not a learned-model prediction"],
    featureSnapshot: {},
    provenance: "MODEL_PREDICTED",
    generatedAt: "2026-09-03T10:00:00Z",
    ...overrides,
  } satisfies ApiSchema<"YieldPredictionEvidence">;
}

describe("forecast method label (#51)", () => {
  it("names the deterministic fallback and its version", () => {
    render(<ForecastMethod prediction={prediction({})} />);

    expect(screen.getByText("Estimated by")).toBeInTheDocument();
    expect(screen.getByText("deterministic fallback (fixture-yield-v0.1.0)")).toBeInTheDocument();
  });

  it("names the learned model and its version", () => {
    render(<ForecastMethod prediction={prediction({ estimationMode: "LEARNED_MODEL", modelVersion: "yield-qgb-synthetic-v0.1.0" })} />);

    expect(screen.getByText("learned model (yield-qgb-synthetic-v0.1.0)")).toBeInTheDocument();
  });

  it("keeps fallback output distinguishable even though provenance is MODEL_PREDICTED for both", () => {
    const fallback = prediction({});
    const learned = prediction({ estimationMode: "LEARNED_MODEL" });

    expect(fallback.provenance).toBe(learned.provenance);
    expect(estimationMethodLabel(fallback.estimationMode)).not.toBe(estimationMethodLabel(learned.estimationMode));
  });

  it("shows the method as a read-only row with no control a participant could change", () => {
    const { container } = render(<ForecastMethod prediction={prediction({})} />);

    expect(container.querySelector("select")).toBeNull();
    expect(container.querySelector("input")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
  });
});
