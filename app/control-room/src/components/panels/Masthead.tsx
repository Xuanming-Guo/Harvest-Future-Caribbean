"use client";

/**
 * The control room's masthead: wordmark, policy toggle, seed control, and the
 * mandatory evidence badge.
 *
 * The evidence badge sits in the same visual unit as the title deliberately —
 * see globals.css's note on `.evidence-badge`. A screenshot cropped to "look
 * impressive" cannot separate the claim from its caveat if the caveat lives
 * right next to the claim.
 */

import type { ControlRoomFrame, ControlRoomScene } from "@harvest/simulation";

import { weatherHeadline } from "@/lib/run";

export interface MastheadProps {
  scene: ControlRoomScene;
  frame?: ControlRoomFrame;
}

export default function Masthead({ scene, frame }: MastheadProps): React.JSX.Element {
  // Weather comes off the saved frame rather than from a request, so scrubbing
  // backwards shows the sky as it was, never as it is now. Absent on replays
  // saved before issue #37, in which case the pill simply is not there.
  const weather = frame ? weatherHeadline(frame) : null;
  return (
    <div className="masthead">
      <span className="masthead-mark" aria-hidden="true">
        H
      </span>

      <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <span className="masthead-title">Harvest control room</span>
        <span className="masthead-sub">{scene.scenarioId}</span>
      </div>

      <span className="pill">{scene.policy.toLowerCase()}</span>
      <span className="pill">seed {scene.seed}</span>
      {weather && (
        <span className="pill" title="Synthetic realised weather; forecasts are model predictions and can be wrong.">
          {weather}
        </span>
      )}

      {/*
       * Mandatory, never dismissible: this run is entirely synthetic and must
       * never be read as measured real-world impact. `title` carries the fuller
       * provenance note for anyone who hovers.
       */}
      <span className="evidence-badge" title={scene.evidenceLabel} style={{ marginLeft: "auto" }}>
        Synthetic simulation
      </span>
    </div>
  );
}
