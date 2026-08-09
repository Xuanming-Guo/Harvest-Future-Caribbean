"use client";

/**
 * Event injection.
 *
 * Issue #5 asks for "event injection" alongside the transport controls. Because
 * the control room replays a recorded timeline rather than driving a live
 * engine, injecting an event does not poke a running simulation — it re-runs
 * the scenario with the disruption added and swaps in the new timeline.
 *
 * That is a better fit than live poking, and not only because it is simpler.
 * The re-run is deterministic, so an injected world can be reproduced exactly
 * from its seed plus its injections, and the whole timeline (including the
 * minutes before the disruption) stays scrubbable. Poking a live engine would
 * give an unreproducible one-off that could never be replayed for a judge.
 *
 * Severity is deliberately not offered. It is hidden truth, and letting whoever
 * is driving the demo choose how bad a storm is would let them dial the
 * outcome. The engine draws it from a seeded stream instead.
 */

import { useState } from "react";
import type { ControlRoomScene, InjectedDisruption } from "@harvest/simulation";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

interface InjectionOption {
  id: string;
  label: string;
  description: string;
  type: InjectedDisruption["type"];
  durationMs: number;
  /** Which scene collection supplies the affected entity ids. */
  target: "roads" | "transporters" | "farms" | "none";
}

/**
 * A short menu of plausible disruptions rather than a free-form builder.
 *
 * A demo needs one click to a legible outcome. An arbitrary-entity form would
 * be more flexible and would mostly produce injections whose effects nobody
 * watching could interpret.
 */
const OPTIONS: InjectionOption[] = [
  {
    id: "road",
    label: "Close a valley road",
    description: "Heavy rain makes an interior road impassable to loaded vehicles.",
    type: "ROAD",
    durationMs: 30 * HOUR_MS,
    target: "roads",
  },
  {
    id: "vehicle",
    label: "Break down a vehicle",
    description: "A transporter goes off the road with a mechanical fault.",
    type: "VEHICLE",
    durationMs: 14 * HOUR_MS,
    target: "transporters",
  },
  {
    id: "weather",
    label: "Bring in a storm",
    description: "A weather front crosses the island and slows everything down.",
    type: "WEATHER",
    durationMs: 2 * DAY_MS,
    target: "none",
  },
  {
    id: "crop",
    label: "Damage a crop",
    description: "Disease is found in a field that buyers were counting on.",
    type: "CROP",
    durationMs: 5 * DAY_MS,
    target: "farms",
  },
];

export interface InjectionPanelProps {
  scene: ControlRoomScene;
  injections: InjectedDisruption[];
  onChange: (injections: InjectedDisruption[]) => void;
  /** Where the playhead currently sits, used as the default injection time. */
  atMs: number;
  startMs: number;
}

export default function InjectionPanel({ scene, injections, onChange, atMs, startMs }: InjectionPanelProps) {
  const [pending, setPending] = useState<string>(OPTIONS[0]?.id ?? "road");

  // Default to the moment the viewer is looking at, so "inject now" means what
  // it looks like it means. Nudged an hour forward because a disruption
  // scheduled exactly at the playhead would already have been recorded as
  // starting before the viewer could see it happen.
  const offsetMs = Math.max(HOUR_MS, atMs - startMs + HOUR_MS);

  function affectedIdsFor(option: InjectionOption): string[] {
    switch (option.target) {
      case "roads":
        return scene.roads.slice(0, 1).map((road) => road.roadSegmentId);
      case "transporters":
        return scene.transporters.slice(0, 1).map((transporter) => transporter.transporterId);
      case "farms":
        return scene.farms.slice(0, 1).map((farm) => farm.farmId);
      case "none":
        // A whole-island weather front is not scoped to one entity, but the
        // engine requires at least one id, so the run stands in for it.
        return [scene.runId];
    }
  }

  function inject() {
    const option = OPTIONS.find((candidate) => candidate.id === pending);
    if (!option) return;

    onChange([
      ...injections,
      {
        type: option.type,
        offsetMs,
        durationMs: option.durationMs,
        affectedEntityIds: affectedIdsFor(option),
        publicDescription: option.description,
      },
    ]);
  }

  const dayNumber = Math.floor(offsetMs / DAY_MS) + 1;

  return (
    <section className="panel">
      <header className="panel-header">
        <span className="panel-title">Inject an event</span>
        {injections.length > 0 && (
          <button
            type="button"
            className="pill"
            onClick={() => onChange([])}
            aria-label="Remove all injected events and re-run the scenario"
          >
            Clear {injections.length}
          </button>
        )}
      </header>
      <div className="panel-body">
        <label className="metric-label" htmlFor="injection-kind">
          What happens
        </label>
        <select
          id="injection-kind"
          className="speed-select"
          style={{ width: "100%", marginTop: 6 }}
          value={pending}
          onChange={(event) => setPending(event.target.value)}
        >
          {OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>

        <p style={{ margin: "10px 0 12px", fontSize: 12, lineHeight: 1.5, color: "var(--text-muted)" }}>
          {OPTIONS.find((option) => option.id === pending)?.description}
        </p>

        <button
          type="button"
          className="transport-button is-primary"
          style={{ width: "100%", height: 34 }}
          onClick={inject}
          aria-label={`Inject this event on day ${dayNumber} and re-run the scenario`}
        >
          Inject on day {dayNumber}
        </button>

        <p style={{ margin: "10px 0 0", fontSize: 11, lineHeight: 1.5, color: "var(--text-dim)" }}>
          Injecting re-runs the scenario from the same seed with this event added, so the
          result stays reproducible and the whole timeline remains scrubbable.
        </p>
      </div>
    </section>
  );
}
