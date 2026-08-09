/**
 * Timeline transport for the control room.
 *
 * The simulation is fully recorded before this hook ever runs (see
 * `simulation/src/replay.ts`), so "playback" is pure indexing into an array of
 * frames that already exist. That is what makes reverse scrubbing, instant
 * seeking and speed changes free: there is no live engine to keep in step,
 * only a playhead (`atMs`) walking over fixed data.
 *
 * The clock itself is driven by `requestAnimationFrame` rather than
 * `setInterval` so it tracks actual wall-clock delta (important when a tab is
 * throttled in the background or a frame is dropped) instead of assuming a
 * fixed tick length.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DAY_MS, type ControlRoomFrame, type ReplayTimeline } from '@harvest/simulation';

/** A shared empty array, so the no-timeline case keeps a stable identity. */
const EMPTY_FRAMES: ControlRoomFrame[] = [];

export const SPEED_OPTIONS = [1, 2, 5, 10, 30] as const;
export type PlaybackSpeed = (typeof SPEED_OPTIONS)[number];

/**
 * How much simulation time passes per real millisecond at speed 1.
 *
 * The demo scenario spans 21 simulated days. The brief for this control room
 * is that a full run at speed 1 should take roughly 90 real seconds, so an
 * operator can watch an entire fortnight-plus play out over a coffee-length
 * demo without it dragging. Solving for the constant:
 *
 *   simDurationMs / realDurationMs = 21 days / 90 s
 *                                  = (21 * 86_400_000 ms) / 90_000 ms
 *                                  = 1_814_400_000 / 90_000
 *                                  = 20_160
 *
 * At speed N, elapsed sim time is `deltaRealMs * N * SIM_MS_PER_REAL_MS`, so
 * higher speeds compress the same run into proportionally less real time.
 */
export const SIM_MS_PER_REAL_MS = (21 * DAY_MS) / 90_000;

export interface PlaybackState {
  atMs: number;
  frame: ControlRoomFrame;
  frameIndex: number;
  isPlaying: boolean;
  speed: PlaybackSpeed;
  progress: number;
  startMs: number;
  endMs: number;
}

export interface PlaybackControlsApi {
  play(): void;
  pause(): void;
  toggle(): void;
  reset(): void;
  setSpeed(speed: PlaybackSpeed): void;
  seekTo(atMs: number): void;
  seekToProgress(progress: number): void;
  stepFrame(delta: number): void;
}

// --------------------------------------------------------------------------
// Pure helpers. Kept free of React so they can be unit-tested directly rather
// than through rendered hook behaviour.
// --------------------------------------------------------------------------

export function clamp(value: number, min: number, max: number): number {
  if (min > max) return min; // degenerate range: nothing sensible to clamp to but min.
  return Math.min(max, Math.max(min, value));
}

/** Clamps a simulation instant to the timeline's span. */
export function clampMs(atMs: number, startMs: number, endMs: number): number {
  return clamp(atMs, startMs, endMs);
}

/**
 * Converts a 0..1 scrub position into a simulation instant.
 *
 * `progress` is clamped first so a caller passing an out-of-range value (a
 * pointer dragged past the edge of the track, say) lands on an endpoint
 * rather than extrapolating beyond the recorded run.
 */
export function progressToMs(progress: number, startMs: number, endMs: number): number {
  const clampedProgress = clamp(progress, 0, 1);
  return startMs + (endMs - startMs) * clampedProgress;
}

/**
 * Converts a simulation instant into 0..1 progress through the run.
 *
 * Guards the zero-length case (a single-frame or instantaneous timeline)
 * explicitly: dividing by `endMs - startMs` there would be a division by
 * zero, and a run with no duration is unambiguously "fully played".
 */
export function msToProgress(atMs: number, startMs: number, endMs: number): number {
  const span = endMs - startMs;
  if (span <= 0) return 1;
  return clamp((atMs - startMs) / span, 0, 1);
}

/** Clamps a frame index into the valid range for an array of the given length. */
export function clampFrameIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return clamp(index, 0, length - 1);
}

/** Steps a frame index by `delta`, clamping at either boundary rather than wrapping. */
export function stepFrameIndex(index: number, delta: number, length: number): number {
  return clampFrameIndex(index + delta, length);
}

/**
 * Binary search for the index of the frame at or immediately before `atMs`.
 *
 * Equivalent in result to `@harvest/simulation`'s `frameAt`, but returns the
 * index rather than the frame itself: `PlaybackState.frameIndex` needs the
 * position (for step-by-frame and progress maths), and re-deriving it from a
 * frame reference elsewhere would mean a second search.
 */
export function frameIndexAt(frames: ControlRoomFrame[], atMs: number): number {
  if (frames.length === 0) return 0;
  if (atMs <= (frames[0] as ControlRoomFrame).atMs) return 0;

  let low = 0;
  let high = frames.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((frames[middle] as ControlRoomFrame).atMs <= atMs) low = middle;
    else high = middle - 1;
  }
  return low;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The state before any run exists.
 *
 * `Omit<PlaybackState, 'frame'>` rather than intersecting `PlaybackState`
 * directly: `PlaybackState & { frame: null }` resolves `frame` to
 * `ControlRoomFrame & null`, which is `never`, and a `never` member makes
 * TypeScript reject every other property in the literal with a misleading
 * error. Omitting the field first and re-adding it is the intersection that
 * was actually meant.
 */
function zeroState(): Omit<PlaybackState, 'frame'> & { frame: null } {
  return {
    atMs: 0,
    frame: null,
    frameIndex: 0,
    isPlaying: false,
    speed: 1,
    progress: 0,
    startMs: 0,
    endMs: 0,
  };
}

const noopControls: PlaybackControlsApi = {
  play() {},
  pause() {},
  toggle() {},
  reset() {},
  setSpeed() {},
  seekTo() {},
  seekToProgress() {},
  stepFrame() {},
};

/**
 * What `usePlayback` returns.
 *
 * `frame` is nullable here even though `PlaybackState.frame` is not, because
 * the hook has to be callable before a run exists. Making that explicit forces
 * the caller to handle the empty case; the previous version asserted the null
 * away with a cast, which moved a real possibility out of the type system and
 * into a runtime crash waiting for the first render.
 */
export type PlaybackHook = Omit<PlaybackState, 'frame'> & {
  frame: ControlRoomFrame | null;
  controls: PlaybackControlsApi;
};

/**
 * Turns a recorded timeline into a playhead: play/pause/speed/reset/scrub.
 *
 * `timeline === null` (data not built yet) is handled by returning a safe
 * zeroed, paused state and no-op controls, so consumers can call the hook
 * unconditionally before a run exists rather than guarding every call site.
 */
export function usePlayback(timeline: ReplayTimeline | null): PlaybackHook {
  // Memoised because `?? []` allocates a fresh array whenever `timeline` is
  // null, and `frames` is a dependency of the seek and step callbacks below.
  // Without this every render would produce new callback identities, which the
  // transport bar would then see as changed props on every animation frame.
  const frames = useMemo(() => timeline?.frames ?? EMPTY_FRAMES, [timeline]);
  const startMs = frames.length > 0 ? (frames[0] as ControlRoomFrame).atMs : 0;
  const endMs = frames.length > 0 ? (frames[frames.length - 1] as ControlRoomFrame).atMs : 0;

  const [atMs, setAtMs] = useState(startMs);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeedState] = useState<PlaybackSpeed>(1);

  // Tracks wall-clock time between rAF callbacks. A ref, not state: updating
  // it must never itself trigger a re-render, or the render would race the
  // next callback's delta computation.
  const lastTimestampRef = useRef<number | null>(null);
  const rafIdRef = useRef<number | null>(null);

  // Identity of the timeline last seen, so a genuinely new run (new seed,
  // policy or injected disruption) resets the playhead even if the new run's
  // startMs happens to equal the old one's.
  const timelineRef = useRef<ReplayTimeline | null>(null);

  useEffect(() => {
    if (timelineRef.current !== timeline) {
      timelineRef.current = timeline;
      setAtMs(startMs);
      setIsPlaying(false);
    }
    // startMs is derived from `timeline`, so keying on `timeline` alone is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline]);

  const stopLoop = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    lastTimestampRef.current = null;
  }, []);

  // The rAF loop itself. Runs only while isPlaying is true and there is more
  // than one frame to play through; cancelled on every dependency change and
  // on unmount so no loop is ever left running against an unmounted hook.
  useEffect(() => {
    if (!isPlaying || frames.length <= 1) return undefined;

    const tick = (timestamp: number) => {
      const last = lastTimestampRef.current;
      lastTimestampRef.current = timestamp;

      if (last !== null) {
        const deltaRealMs = timestamp - last;
        setAtMs((previous) => {
          const next = previous + deltaRealMs * speed * SIM_MS_PER_REAL_MS;
          if (next >= endMs) {
            // Reached the end: stop cleanly rather than looping or overshooting.
            setIsPlaying(false);
            return endMs;
          }
          return next;
        });
      }

      rafIdRef.current = requestAnimationFrame(tick);
    };

    rafIdRef.current = requestAnimationFrame(tick);
    return stopLoop;
  }, [isPlaying, speed, endMs, frames.length, stopLoop]);

  const play = useCallback(() => {
    if (frames.length <= 1) return; // nothing to animate through.
    setIsPlaying((wasPlaying) => {
      // Restarting from the end should replay from the start, not sit at endMs.
      if (!wasPlaying) {
        setAtMs((current) => (current >= endMs ? startMs : current));
      }
      return true;
    });
  }, [frames.length, endMs, startMs]);

  const pause = useCallback(() => setIsPlaying(false), []);

  const toggle = useCallback(() => {
    setIsPlaying((wasPlaying) => {
      if (wasPlaying) return false;
      if (frames.length <= 1) return false;
      setAtMs((current) => (current >= endMs ? startMs : current));
      return true;
    });
  }, [frames.length, endMs, startMs]);

  const reset = useCallback(() => {
    setIsPlaying(false);
    setAtMs(startMs);
  }, [startMs]);

  const setSpeed = useCallback((next: PlaybackSpeed) => setSpeedState(next), []);

  const seekTo = useCallback(
    (target: number) => setAtMs(clampMs(target, startMs, endMs)),
    [startMs, endMs],
  );

  const seekToProgress = useCallback(
    (progress: number) => setAtMs(progressToMs(progress, startMs, endMs)),
    [startMs, endMs],
  );

  const stepFrame = useCallback(
    (delta: number) => {
      if (frames.length === 0) return;
      setAtMs((current) => {
        const currentIndex = frameIndexAt(frames, current);
        const nextIndex = stepFrameIndex(currentIndex, delta, frames.length);
        return (frames[nextIndex] as ControlRoomFrame).atMs;
      });
    },
    [frames],
  );

  const controls = useMemo<PlaybackControlsApi>(
    () => ({ play, pause, toggle, reset, setSpeed, seekTo, seekToProgress, stepFrame }),
    [play, pause, toggle, reset, setSpeed, seekTo, seekToProgress, stepFrame],
  );

  if (!timeline || frames.length === 0) {
    return { ...zeroState(), controls: noopControls };
  }

  const frameIndex = frameIndexAt(frames, atMs);

  return {
    atMs,
    frame: frames[frameIndex] as ControlRoomFrame,
    frameIndex,
    isPlaying,
    speed,
    progress: msToProgress(atMs, startMs, endMs),
    startMs,
    endMs,
    controls,
  };
}

// Auto-play is intentionally never triggered by this module: `prefersReducedMotion`
// is exposed so a consumer (e.g. the page assembling the control room) can decide
// whether to call `controls.play()` on mount, honouring the user's OS-level motion
// preference without this hook silently overriding it either way.
export { prefersReducedMotion };
