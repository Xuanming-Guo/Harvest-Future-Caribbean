/**
 * The farmer and coordinator weather views (#37).
 *
 * Two things are worth defending here. The crop-risk note has to say the most
 * consequential true thing rather than the first thing it matches, and both
 * views have to keep the forecast visibly labelled as a prediction, because a
 * forecast presented as a fact is worse than no forecast.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import { FarmWeather, IslandWeatherTable } from "@/components/weather";
import { conditionLabel, cropRiskNote, nextStorm, type IslandWeather, type WeatherForecastDay } from "@/lib/weather";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const forecastDay = (over: Partial<WeatherForecastDay> & { date: string; leadDays: number }): WeatherForecastDay => ({
  condition: "CLOUD",
  rainMm: 4,
  windKph: 15,
  windFromDegrees: 80,
  cloudCoverFraction: 0.2,
  tempBand: "WARM",
  confidence: 0.6,
  provenance: "MODEL_PREDICTED",
  ...over,
});

const weather = (over: Partial<IslandWeather> = {}): IslandWeather => ({
  islandId: "saint-lucia",
  asOf: "2026-09-04",
  current: {
    date: "2026-09-04",
    condition: "CLOUD",
    rainMm: 6.2,
    windKph: 18,
    windFromDegrees: 84,
    cloudCoverFraction: 0.3,
    tempBand: "WARM",
    provenance: "SYNTHETIC",
  },
  forecast: [forecastDay({ date: "2026-09-05", leadDays: 1 })],
  ...over,
});

function renderWithQuery(node: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

describe("crop risk note", () => {
  it("leads with a forecast storm rather than with today", () => {
    const note = cropRiskNote(
      weather({
        current: { ...weather().current!, condition: "RAIN" },
        forecast: [
          forecastDay({ date: "2026-09-05", leadDays: 1 }),
          forecastDay({ date: "2026-09-06", leadDays: 2, condition: "STORM", rainMm: 61 }),
        ],
      }),
    );
    expect(note).toContain("Storm forecast in 2 days");
    expect(note).toContain("bring collection forward");
  });

  it("names tomorrow as tomorrow", () => {
    const note = cropRiskNote(
      weather({ forecast: [forecastDay({ date: "2026-09-05", leadDays: 1, condition: "STORM", rainMm: 55 })] }),
    );
    expect(note).toContain("tomorrow");
  });

  it("warns about heavy rain that is not yet a storm", () => {
    const note = cropRiskNote(
      weather({ forecast: [forecastDay({ date: "2026-09-05", leadDays: 1, condition: "RAIN", rainMm: 31 })] }),
    );
    expect(note).toContain("Heavy rain forecast tomorrow");
  });

  it("explains dehydration risk on a hot dry day", () => {
    const note = cropRiskNote(weather({ current: { ...weather().current!, condition: "CLEAR", rainMm: 0, tempBand: "HOT" } }));
    expect(note).toContain("dehydrates");
  });

  it("says so plainly when nothing in the outlook threatens the crop", () => {
    expect(cropRiskNote(weather())).toContain("Nothing in the outlook");
  });

  it("does not invent a note when no day has been recorded", () => {
    expect(cropRiskNote(undefined)).toContain("No conditions recorded");
    expect(cropRiskNote(weather({ current: undefined }))).toContain("No conditions recorded");
  });

  it("finds the first storm in an outlook and no other", () => {
    expect(nextStorm([])).toBeUndefined();
    const forecast = [
      forecastDay({ date: "2026-09-05", leadDays: 1 }),
      forecastDay({ date: "2026-09-06", leadDays: 2, condition: "STORM" }),
      forecastDay({ date: "2026-09-07", leadDays: 3, condition: "STORM" }),
    ];
    expect(nextStorm(forecast)?.date).toBe("2026-09-06");
  });

  it("labels every condition the contract can send", () => {
    expect(conditionLabel("CLEAR")).toBe("Clear");
    expect(conditionLabel("CLOUD")).toBe("Cloudy");
    expect(conditionLabel("RAIN")).toBe("Rain");
    expect(conditionLabel("STORM")).toBe("Storm");
  });
});

describe("farmer weather panel", () => {
  it("shows today, at most three forecast days, and the risk note", async () => {
    vi.spyOn(api, "weather").mockResolvedValue(
      weather({
        current: { ...weather().current!, condition: "RAIN", rainMm: 21.1 },
        forecast: [
          forecastDay({ date: "2026-09-05", leadDays: 1 }),
          forecastDay({ date: "2026-09-06", leadDays: 2 }),
          forecastDay({ date: "2026-09-07", leadDays: 3, condition: "STORM", rainMm: 58 }),
          forecastDay({ date: "2026-09-08", leadDays: 4 }),
          forecastDay({ date: "2026-09-09", leadDays: 5 }),
        ],
      }) as never,
    );
    renderWithQuery(<FarmWeather />);

    await waitFor(() => expect(screen.getByText(/21.1 mm rain/)).toBeInTheDocument());
    const panel = screen.getByTestId("farm-weather");
    expect(panel.querySelectorAll(".weather-forecast li")).toHaveLength(3);
    expect(screen.getByText(/Storm forecast in 3 days/)).toBeInTheDocument();
    expect(screen.getByText(/deliberately imperfect forecast/)).toBeInTheDocument();
  });

  it("says nothing has been recorded rather than showing an empty reading", async () => {
    vi.spyOn(api, "weather").mockResolvedValue(weather({ current: undefined, forecast: [] }) as never);
    renderWithQuery(<FarmWeather />);
    await waitFor(() => expect(screen.getByText("No conditions recorded yet")).toBeInTheDocument());
  });
});

describe("coordinator island table", () => {
  it("puts each island's conditions and next storm in one row", async () => {
    vi.spyOn(api, "weather").mockResolvedValue(
      weather({
        current: { ...weather().current!, condition: "RAIN", rainMm: 21.1, windKph: 18 },
        forecast: [
          forecastDay({ date: "2026-09-05", leadDays: 1 }),
          forecastDay({ date: "2026-09-06", leadDays: 2, condition: "STORM", rainMm: 61, confidence: 0.61 }),
        ],
      }) as never,
    );
    renderWithQuery(<IslandWeatherTable />);

    await waitFor(() => expect(screen.getByText("saint-lucia")).toBeInTheDocument());
    const table = screen.getByTestId("island-weather-table");
    expect(table.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(screen.getByText("21.1 mm")).toBeInTheDocument();
    expect(screen.getByText("18 km/h")).toBeInTheDocument();
    expect(screen.getByText(/61% confidence/)).toBeInTheDocument();
  });

  it("says an island has no storm coming instead of leaving the cell blank", async () => {
    vi.spyOn(api, "weather").mockResolvedValue(weather() as never);
    renderWithQuery(<IslandWeatherTable />);
    await waitFor(() => expect(screen.getByText("None in the outlook")).toBeInTheDocument());
  });
});
