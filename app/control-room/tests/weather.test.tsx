/**
 * A saved replay has to explain its own weather (#37).
 *
 * Issue #39 draws the sky on the globe; what is guarded here is the thing #39
 * depends on and cannot fix later: that the frames and scene saved by a run
 * already carry everything a renderer needs, and that they carry nothing about
 * a day the replay has not reached.
 */

import { render, screen } from "@testing-library/react";
import { runScenario } from "@harvest/simulation";
import type { ControlRoomFrame, ControlRoomScene } from "@harvest/simulation";
import React from "react";
import { describe, expect, it } from "vitest";

import Masthead from "@/components/panels/Masthead";
import { islandWeatherAt, weatherHeadline } from "@/lib/run";

const timeline = runScenario({
  scenarioId: "saint-lucia-demo-v1",
  policy: "HARVEST",
  seed: 404,
  captureFrames: true,
}).timeline;

const scene = timeline?.scene as ControlRoomScene;
const frames = (timeline?.frames ?? []) as ControlRoomFrame[];

describe("weather evidence saved with a replay", () => {
  it("publishes the legend once on the scene rather than on every frame", () => {
    expect(scene.weatherLegend?.forecastHorizonDays).toBeGreaterThan(0);
    expect(scene.weatherLegend?.realisedProvenance).toBe("SYNTHETIC");
    expect(scene.weatherLegend?.forecastProvenance).toBe("MODEL_PREDICTED");
    expect(scene.weatherLegend?.conditions.map((entry) => entry.condition)).toEqual(["CLEAR", "CLOUD", "RAIN", "STORM"]);
  });

  it("carries a complete island reading on every frame", () => {
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) {
      for (const island of frame.weather ?? []) {
        expect(island.islandId).toBeTruthy();
        expect(Number.isFinite(island.rainMm)).toBe(true);
        expect(Number.isFinite(island.windKph)).toBe(true);
        expect(island.windFromDegrees).toBeGreaterThanOrEqual(0);
        expect(island.windFromDegrees).toBeLessThan(360);
        expect(island.cloudCoverFraction).toBeGreaterThanOrEqual(0);
        expect(island.cloudCoverFraction).toBeLessThanOrEqual(1);
        // Nothing later than the frame itself, so scrubbing cannot reveal the future.
        expect(island.date <= frame.at.slice(0, 10)).toBe(true);
      }
    }
  });

  it("finds one island's reading without a request", () => {
    const last = frames.at(-1) as ControlRoomFrame;
    expect(islandWeatherAt(last, "saint-lucia")?.islandId).toBe("saint-lucia");
    expect(islandWeatherAt(last, "no-such-island")).toBeNull();
  });

  it("summarises a frame in one line, and says nothing for a replay without weather", () => {
    const headline = weatherHeadline(frames.at(-1) as ControlRoomFrame);
    expect(headline).toMatch(/storm|rain|settled/);
    expect(weatherHeadline({ ...(frames[0] as ControlRoomFrame), weather: undefined })).toBeNull();
  });

  it("shows the weather beside the mandatory synthetic badge", () => {
    render(<Masthead scene={scene} frame={frames.at(-1) as ControlRoomFrame} />);
    expect(screen.getByText("Synthetic simulation")).toBeInTheDocument();
    expect(screen.getByText(/storm|rain|settled/)).toBeInTheDocument();
  });
});
