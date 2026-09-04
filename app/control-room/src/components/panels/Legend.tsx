"use client";

/**
 * The crop-stage colour ramp and marker vocabulary used across the globe and
 * the panels, plus the weather overlay's own key, control and current reading.
 * Renders only its inner content — `page.tsx` supplies the surrounding panel
 * chrome (see the "Map key" section), which also hosts the "view island"
 * button that belongs to the page, not this component.
 *
 * Crop colours are read off `globals.css`'s status ramp rather than hard-coded
 * here a second time; the `status-*` classes are the single source of truth,
 * so a palette change there does not require finding this file too. Weather
 * swatches are the exception: they are drawn with the same numbers the Cesium
 * layer uses (`weather-overlay.ts`), because a key that disagrees with the map
 * is worse than no key.
 */

import type { ControlRoomFrame, WeatherLegend } from "@harvest/simulation";

import { weatherDetailRows, weatherLegendRows } from "@/lib/weather-overlay";

const ENTRIES: Array<{ className: string; label: string }> = [
  { className: "status-growing", label: "Growing" },
  { className: "status-maturing", label: "Maturing" },
  { className: "status-ready", label: "Ready to harvest" },
  { className: "status-harvested", label: "Harvested" },
  { className: "status-spoiled", label: "Spoiled" },
  { className: "status-delayed", label: "Delayed" },
  { className: "reference-agriculture", label: "Reference agriculture" },
  { className: "reference-hotel", label: "Reference hotel" },
  { className: "reference-restaurant", label: "Reference restaurant" },
  { className: "reference-market", label: "Reference market" },
  { className: "reference-port", label: "Reference port" },
];

export interface LegendProps {
  /** The frame currently on screen. Its saved weather is what the readout describes. */
  frame?: ControlRoomFrame;
  /** Units, thresholds and provenance, published once with the scene by #37. */
  weatherLegend?: WeatherLegend;
  /** Omit both to render the crop key alone, as the launch screen does. */
  weatherEnabled?: boolean;
  onWeatherEnabledChange?: (next: boolean) => void;
}

/** A miniature of the wind arrow the globe draws, so the key names the same mark. */
function ArrowSwatch({ colour }: { colour: string }): React.JSX.Element {
  return (
    <svg className="legend-swatch-arrow" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M6 11V2M3 5l3-3 3 3" stroke={colour} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Legend(props: LegendProps = {}): React.JSX.Element {
  const { frame, weatherLegend, weatherEnabled, onWeatherEnabledChange } = props;
  const showWeatherSection = weatherEnabled !== undefined && onWeatherEnabledChange !== undefined;
  const detailRows = frame ? weatherDetailRows(frame, weatherLegend) : [];

  return (
    <>
      <ul className="legend" style={{ margin: 0, padding: 0, listStyle: "none" }}>
        {ENTRIES.map((entry) => (
          <li className="legend-item" key={entry.className}>
            <span className={`status-dot ${entry.className}`} aria-hidden="true" />
            {entry.label}
          </li>
        ))}
      </ul>

      {showWeatherSection && (
        <section className="weather-key">
          <div className="weather-key-header">
            <span className="weather-key-title">Weather</span>
            {/*
             * A switch built from a button, not a native checkbox: the
             * front-end design contract forbids shipping platform-default
             * control chrome as the product interface. `role="switch"` and
             * `aria-checked` keep the semantics a checkbox would have given.
             */}
            <button
              type="button"
              role="switch"
              aria-checked={weatherEnabled}
              className={weatherEnabled ? "weather-toggle is-on" : "weather-toggle"}
              onClick={() => onWeatherEnabledChange(!weatherEnabled)}
            >
              <span className="weather-toggle-track" aria-hidden="true">
                <span className="weather-toggle-knob" />
              </span>
              <span className="weather-toggle-text">{weatherEnabled ? "On" : "Off"}</span>
            </button>
          </div>

          <ul className="legend" style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {weatherLegendRows(weatherLegend).map((row) => (
              <li className="legend-item" key={row.key}>
                {row.kind === "ARROW" ? (
                  <ArrowSwatch colour={row.colour} />
                ) : (
                  <span
                    className={row.kind === "RING" ? "weather-swatch is-ring" : "weather-swatch"}
                    style={
                      row.kind === "RING"
                        ? { borderColor: row.colour }
                        : { background: row.colour, opacity: Math.max(row.alpha, 0.18) }
                    }
                    aria-hidden="true"
                  />
                )}
                {row.label}
              </li>
            ))}
          </ul>

          {detailRows.length > 0 && (
            <div className="weather-now">
              <span className="weather-now-title">Weather now</span>
              <ul className="weather-now-list">
                {detailRows.map((row) => (
                  <li key={row.islandId} className="weather-now-item">
                    <span className="weather-now-island">
                      {row.islandName} · {row.date}
                    </span>
                    <span className="weather-now-reading">
                      {row.conditionLabel} · {row.rainText} · {row.windText} · {row.tempText}
                    </span>
                    {row.forecastText && <span className="weather-now-forecast">{row.forecastText}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/*
           * Never dropped, and never behind a hover: realised weather is a
           * synthetic record and a forecast is a model prediction, which are
           * two different claims. The repository's evidence policy turns on
           * saying so wherever the numbers appear.
           */}
          <p className="panel-help weather-provenance">
            {weatherLegend?.realisedProvenance ?? "SYNTHETIC"} realised weather ·{" "}
            {weatherLegend?.forecastProvenance ?? "MODEL_PREDICTED"} forecast.{" "}
            {/* The published note opens by restating the provenance label, which
                the line above has already said. */}
            {(weatherLegend?.note ?? "Realised weather is generated from the run seed. No live weather service is used anywhere in this system.")
              .replace(/^SYNTHETIC\.\s*/, "")}
          </p>
        </section>
      )}
    </>
  );
}
