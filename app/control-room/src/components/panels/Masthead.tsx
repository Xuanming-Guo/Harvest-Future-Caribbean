"use client";

/** Run title, settings, and weather. */

import type { ControlRoomFrame, ControlRoomScene } from "@harvest/simulation";

import HarvestMark from "@/components/HarvestMark";
import { weatherHeadline } from "@/lib/run";

import type { EstimationMode } from "@/lib/run";

export interface MastheadProps {
  scene: ControlRoomScene;
  /** Estimation method of the loaded run; absent until a run is loaded. */
  estimationMode?: EstimationMode;
  /** Baseline runs record the choice but never request a harvest estimate. */
  estimationModeUsed?: boolean;
  frame?: ControlRoomFrame;
}

const ESTIMATION_LABELS: Record<EstimationMode, string> = {
  LEARNED_MODEL: "learned model",
  DETERMINISTIC_FALLBACK: "deterministic fallback",
};

export default function Masthead({ scene, frame, estimationMode, estimationModeUsed = true }: MastheadProps): React.JSX.Element {
  // Weather comes off the saved frame rather than from a request, so scrubbing
  // backwards shows the sky as it was, never as it is now. Absent on replays
  // saved before issue #37, in which case the pill simply is not there.
  const weather = frame ? weatherHeadline(frame) : null;
  return (
    <div className="masthead">
      <HarvestMark />

      <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <span className="masthead-title">Harvest control room</span>
        <span className="masthead-sub">{scene.scenarioId === "caribbean-islands-v1" ? "Caribbean food network" : scene.scenarioId === "saint-lucia-demo-v1" ? "Saint Lucia benchmark" : scene.scenarioId.replace(/^caribbean-/, "").replace(/-v1$/, "").replaceAll("-", " ")}</span>
      </div>

      <span className="pill">{scene.policy.toLowerCase()}</span>
      <span className="pill">seed {scene.seed}</span>
      {weather && (
        <span className="pill">
          {weather}
        </span>
      )}

      {/*
       * The estimation method belongs beside the run's other immutable inputs.
       * A screenshot of a fallback run must not be mistakable for a run of the
       * learned model, so the badge states the method rather than hiding it in
       * the inspector.
       */}
      {estimationMode && (
        <span className="pill">
          {estimationModeUsed
            ? `estimate: ${ESTIMATION_LABELS[estimationMode]}`
            : `estimate: ${ESTIMATION_LABELS[estimationMode]} (unused)`}
        </span>
      )}
    </div>
  );
}
