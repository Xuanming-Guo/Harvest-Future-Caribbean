"use client";

/**
 * The timeline transport: play/pause/step, a scrubber doubling as a
 * disruption summary, and a speed selector.
 *
 * All icons are inline SVG because `lucide-react` is not a dependency of this
 * package — pulling it in here would be a silent new dependency for a
 * component that only needs four simple glyphs.
 */

import { useCallback, useEffect, useMemo } from "react";
import { DAY_MS } from "@harvest/simulation";
import { SPEED_OPTIONS, msToProgress, type PlaybackControlsApi, type PlaybackSpeed, type PlaybackState } from "@/lib/playback";

export interface PlaybackControlsProps {
  state: PlaybackState;
  controls: PlaybackControlsApi;
  /** Simulation instants, drawn as ticks on the scrub track. */
  disruptionMarkers?: number[];
  /**
   * When buyers stopped ordering, if the run has a settlement window after it.
   * The days past it are real run time in which deliveries land and orders
   * settle, and the label says so rather than leaving them looking like days
   * on which nothing happened.
   */
  demandEndsAtMs?: number;
}

const CLOCK_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** Skip-to-start: a double chevron, distinct from the single-step "previous frame" glyph. */
function IconReset() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="12 4 12 20 3 12 12 4" />
      <polygon points="20 4 20 20 11 12 20 4" />
      <line x1="2" y1="4" x2="2" y2="20" />
    </svg>
  );
}

function IconStepBack() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="19 4 9 12 19 20 19 4" />
      <line x1="5" y1="5" x2="5" y2="19" />
    </svg>
  );
}

function IconStepForward() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="5 4 15 12 5 20 5 4" />
      <line x1="19" y1="5" x2="19" y2="19" />
    </svg>
  );
}

function IconPlay() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <polygon points="6 4 20 12 6 20 6 4" />
    </svg>
  );
}

function IconPause() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="4" width="4" height="16" />
      <rect x="14" y="4" width="4" height="16" />
    </svg>
  );
}

/** True while focus sits inside a form control, so global shortcuts don't hijack typing. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || target.isContentEditable;
}

export default function PlaybackControls(props: PlaybackControlsProps): React.JSX.Element {
  const { state, controls, disruptionMarkers = [], demandEndsAtMs } = props;
  const { atMs, isPlaying, speed, progress, startMs, endMs } = state;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(event.target)) return;
      if (event.code === "Space") {
        event.preventDefault();
        controls.toggle();
      } else if (event.code === "ArrowLeft") {
        event.preventDefault();
        controls.stepFrame(-1);
      } else if (event.code === "ArrowRight") {
        event.preventDefault();
        controls.stepFrame(1);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [controls]);

  const handleScrub = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      controls.seekToProgress(Number(event.target.value) / 1000);
    },
    [controls],
  );

  const handleSpeedChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      controls.setSpeed(Number(event.target.value) as PlaybackSpeed);
    },
    [controls],
  );

  const clockText = useMemo(() => CLOCK_FORMAT.format(new Date(atMs)), [atMs]);

  const totalDays = useMemo(() => Math.max(1, Math.round((endMs - startMs) / DAY_MS)), [startMs, endMs]);
  const dayNumber = useMemo(() => {
    if (endMs <= startMs) return 1;
    const elapsedDays = Math.floor((atMs - startMs) / DAY_MS);
    return Math.min(totalDays, elapsedDays + 1);
  }, [atMs, startMs, endMs, totalDays]);

  const orderingDays = useMemo(() => {
    if (demandEndsAtMs === undefined || demandEndsAtMs >= endMs) return null;
    return Math.max(1, Math.round((demandEndsAtMs - startMs) / DAY_MS));
  }, [demandEndsAtMs, startMs, endMs]);
  const orderingNote = orderingDays === null ? "" : ` (orders until day ${orderingDays})`;

  const timeValueText = useMemo(
    () => `${clockText}, day ${dayNumber} of ${totalDays}${orderingNote}`,
    [clockText, dayNumber, totalDays, orderingNote],
  );

  // The range input carries progress at millipercent precision (0..1000) so
  // scrubbing feels continuous even on a long timeline, while still reporting
  // whole-number steps a browser is happy to clamp and step through.
  const sliderValue = Math.round(clamp01(progress) * 1000);

  return (
    <div className="transport">
      <div className="transport-buttons">
        <button type="button" className="transport-button" aria-label="Restart from the beginning" onClick={controls.reset}>
          <IconReset />
        </button>
        <button type="button" className="transport-button" aria-label="Step back one frame" onClick={() => controls.stepFrame(-1)}>
          <IconStepBack />
        </button>
        <button
          type="button"
          className="transport-button is-primary"
          aria-label={isPlaying ? "Pause playback" : "Play"}
          onClick={controls.toggle}
        >
          {isPlaying ? <IconPause /> : <IconPlay />}
        </button>
        <button type="button" className="transport-button" aria-label="Step forward one frame" onClick={() => controls.stepFrame(1)}>
          <IconStepForward />
        </button>
      </div>

      <div className="transport-clock">
        {clockText}
        <small>
          Day {dayNumber} of {totalDays}{orderingNote}
        </small>
      </div>

      <div className="scrubber">
        <div className="scrubber-track">
          <div className="scrubber-fill" style={{ width: `${clamp01(progress) * 100}%` }} />
          {disruptionMarkers.map((instant) => (
            <div
              key={instant}
              className="scrubber-marker"
              style={{ left: `${msToProgress(instant, startMs, endMs) * 100}%` }}
            />
          ))}
        </div>
        <input
          className="scrubber-input"
          type="range"
          min={0}
          max={1000}
          step={1}
          value={sliderValue}
          onChange={handleScrub}
          aria-label="Timeline scrubber"
          aria-valuetext={timeValueText}
        />
      </div>

      <select className="speed-select" value={speed} onChange={handleSpeedChange} aria-label="Playback speed">
        {SPEED_OPTIONS.map((option) => (
          <option key={option} value={option}>
            {option}×
          </option>
        ))}
      </select>
    </div>
  );
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
