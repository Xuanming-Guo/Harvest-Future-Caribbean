"use client";

/**
 * The control room.
 *
 * Composition only: this file owns layout and the small amount of state that
 * genuinely spans panels (which run is loaded, what is selected, where the
 * camera is pointed). Rendering and behaviour live in the components.
 *
 * The whole surface is a client component because the simulation runs in the
 * browser — see `src/lib/run.ts` for why that is the right call for a recorded
 * timeline rather than a compromise.
 */

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { InjectedDisruption } from "@harvest/simulation";

import Masthead from "@/components/panels/Masthead";
import MetricsPanel from "@/components/panels/MetricsPanel";
import EventFeed from "@/components/panels/EventFeed";
import Inspector from "@/components/panels/Inspector";
import Legend from "@/components/panels/Legend";
import PlaybackControls from "@/components/transport/PlaybackControls";
import InjectionPanel from "@/components/InjectionPanel";
import { usePlayback } from "@/lib/playback";
import { DEFAULT_SEED, buildTimeline, type PolicyName } from "@/lib/run";

/**
 * Cesium touches `window` and WebGL at import time, so it cannot be rendered on
 * the server. `ssr: false` keeps it out of the server bundle entirely rather
 * than failing at runtime.
 */
const CesiumGlobe = dynamic(() => import("@/components/globe/CesiumGlobe"), {
  ssr: false,
  loading: () => <div className="globe-loading">Preparing the globe…</div>,
});

export default function ControlRoomPage() {
  const [policy, setPolicy] = useState<PolicyName>("HARVEST");
  const [seed, setSeed] = useState(DEFAULT_SEED);
  const [injections, setInjections] = useState<InjectedDisruption[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusRegion, setFocusRegion] = useState<string | null>(null);

  /**
   * Building the timeline is a full simulation run. It is only a few
   * milliseconds, but it must not happen on every render — the frame data is
   * referentially compared all the way down, and a new array each render would
   * re-run the globe's entity diffing sixty times a second.
   */
  const built = useMemo(() => {
    try {
      return { data: buildTimeline({ policy, seed, injectedDisruptions: injections }), error: null };
    } catch (error) {
      return { data: null, error: error instanceof Error ? error.message : String(error) };
    }
  }, [policy, seed, injections]);

  const timeline = built.data?.timeline ?? null;
  const playback = usePlayback(timeline);
  const { controls, ...state } = playback;

  // Selecting an entity points the camera at it. This is the region-to-region
  // transition: the globe zooms out, turns, and comes back down somewhere else.
  const handleSelect = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) setFocusRegion(id);
  }, []);

  const showIsland = useCallback(() => {
    setSelectedId(null);
    setFocusRegion(null);
  }, []);

  // A new run invalidates any selection: the ids are freshly minted, so a held
  // id would point at nothing and the inspector would sit empty for no visible
  // reason.
  useEffect(() => {
    setSelectedId(null);
    setFocusRegion(null);
  }, [policy, seed, injections]);

  /** Frames up to the playhead, so the feed cannot show the future. */
  const framesSoFar = useMemo(() => {
    if (!timeline) return [];
    return timeline.frames.slice(0, state.frameIndex + 1);
  }, [timeline, state.frameIndex]);

  /** Disruption instants, drawn on the scrub track as red ticks. */
  const disruptionMarkers = useMemo(() => {
    if (!timeline) return [];
    const seen = new Set<string>();
    const marks: number[] = [];
    for (const frame of timeline.frames) {
      for (const disruption of frame.disruptions) {
        if (seen.has(disruption.eventId)) continue;
        seen.add(disruption.eventId);
        marks.push(Date.parse(disruption.observedAt));
      }
    }
    return marks;
  }, [timeline]);

  // `state.frame` is nullable until a run exists, so this guard is what makes
  // it safe to hand a frame to every panel below without each one re-checking.
  // Bound to a local *before* the guard. Narrowing `state.frame` in place does
  // not survive the object spread below: the spread reads the declared property
  // type rather than the narrowed one, so `frame` would come back nullable. A
  // plain const narrows reliably and keeps the spread honest.
  const frame = state.frame;

  if (built.error || !timeline || !built.data || frame === null) {
    // Fail visibly. A control room that renders a plausible-looking but empty
    // world is worse than one that says it could not build the run.
    return (
      <main className="control-room">
        <div className="globe-loading" role="alert">
          Could not build the scenario: {built.error ?? "the engine returned no timeline."}
        </div>
      </main>
    );
  }

  const { scene } = timeline;
  // Re-formed with the narrowed frame so the transport bar receives the
  // non-nullable PlaybackState its props declare.
  const playbackState = { ...state, frame };

  return (
    <main className="control-room">
      <div className="globe-layer">
        <CesiumGlobe
          scene={scene}
          frame={frame}
          atMs={state.atMs}
          selectedId={selectedId}
          onSelect={handleSelect}
          focusRegion={focusRegion}
        />
      </div>

      <div className="chrome">
        <div className="chrome-header">
          <Masthead
            scene={scene}
            policy={policy}
            onPolicyChange={setPolicy}
            seed={seed}
            onSeedChange={setSeed}
          />
        </div>

        <div className="chrome-left" style={{ display: "grid", gridTemplateRows: "auto auto 1fr", gap: 16, minHeight: 0 }}>
          <MetricsPanel frame={frame} policy={policy} />
          <InjectionPanel
            scene={scene}
            injections={injections}
            onChange={setInjections}
            atMs={state.atMs}
            startMs={state.startMs}
          />
          <section className="panel">
            <header className="panel-header">
              <span className="panel-title">Map key</span>
              {focusRegion && (
                <button type="button" className="pill" onClick={showIsland} aria-label="Return the camera to the island overview">
                  View island
                </button>
              )}
            </header>
            <div className="panel-body">
              <Legend />
            </div>
          </section>
        </div>

        <div className="chrome-right" style={{ display: "grid", gridTemplateRows: "1fr 1fr", gap: 16, minHeight: 0 }}>
          <Inspector scene={scene} frame={frame} selectedId={selectedId} onClose={() => setSelectedId(null)} />
          <section className="panel">
            <header className="panel-header">
              <span className="panel-title">What is happening</span>
            </header>
            <div className="panel-body">
              <EventFeed scene={scene} frames={framesSoFar} onSelect={handleSelect} />
            </div>
          </section>
        </div>

        <div className="chrome-footer">
          <PlaybackControls state={playbackState} controls={controls} disruptionMarkers={disruptionMarkers} />
        </div>
      </div>
    </main>
  );
}
