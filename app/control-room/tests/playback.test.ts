/**
 * Unit tests for the pure helpers in `src/lib/playback.ts`.
 *
 * These are plain index/interpolation maths with no React or rAF involved, so
 * they are tested directly rather than through the hook — exercising the hook
 * would mean faking `requestAnimationFrame` to verify arithmetic that does not
 * depend on it.
 */

import { describe, expect, it } from "vitest";
import type { ControlRoomFrame } from "@harvest/simulation";
import {
  clampFrameIndex,
  frameIndexAt,
  msToProgress,
  progressToMs,
  stepFrameIndex,
} from "@/lib/playback";

/** Minimal stand-in for a recorded frame: frameIndexAt only ever reads `atMs`. */
function frameAt(atMs: number): ControlRoomFrame {
  return { atMs } as unknown as ControlRoomFrame;
}

const START = 1_000;
const END = 5_000;

describe("progressToMs / msToProgress", () => {
  it("maps progress 0 and 1 to the exact endpoints", () => {
    expect(progressToMs(0, START, END)).toBe(START);
    expect(progressToMs(1, START, END)).toBe(END);
  });

  it("round-trips an arbitrary mid-timeline instant", () => {
    const atMs = 3_250;
    const progress = msToProgress(atMs, START, END);
    expect(progressToMs(progress, START, END)).toBeCloseTo(atMs, 9);
  });

  it("round-trips an arbitrary progress value", () => {
    const progress = 0.37;
    const atMs = progressToMs(progress, START, END);
    expect(msToProgress(atMs, START, END)).toBeCloseTo(progress, 9);
  });

  it("clamps progress beyond either end rather than extrapolating", () => {
    expect(progressToMs(-5, START, END)).toBe(START);
    expect(progressToMs(5, START, END)).toBe(END);
  });

  it("clamps an out-of-range instant into 0..1 rather than overflowing", () => {
    expect(msToProgress(START - 10_000, START, END)).toBe(0);
    expect(msToProgress(END + 10_000, START, END)).toBe(1);
  });

  it("treats a zero-length timeline as fully played, without dividing by zero", () => {
    const result = msToProgress(START, START, START);
    expect(result).toBe(1);
    expect(Number.isFinite(result)).toBe(true);
  });
});

describe("stepFrameIndex / clampFrameIndex", () => {
  it("stays at 0 when stepping backwards from the first frame", () => {
    expect(stepFrameIndex(0, -1, 10)).toBe(0);
  });

  it("stays at the last index when stepping forwards from the last frame", () => {
    const length = 10;
    expect(stepFrameIndex(length - 1, 1, length)).toBe(length - 1);
  });

  it("steps normally within bounds", () => {
    expect(stepFrameIndex(4, 1, 10)).toBe(5);
    expect(stepFrameIndex(4, -1, 10)).toBe(3);
  });

  it("clampFrameIndex handles an empty timeline without going negative", () => {
    expect(clampFrameIndex(3, 0)).toBe(0);
  });
});

describe("frameIndexAt", () => {
  const frames = [frameAt(0), frameAt(1_000), frameAt(2_000), frameAt(3_000)];

  it("returns the first frame for an instant before the timeline starts", () => {
    expect(frameIndexAt(frames, -500)).toBe(0);
  });

  it("returns the last frame for an instant after the timeline ends", () => {
    expect(frameIndexAt(frames, 10_000)).toBe(frames.length - 1);
  });

  it("returns the frame at or immediately before the given instant", () => {
    expect(frameIndexAt(frames, 1_500)).toBe(1); // between frame 1 and 2 -> frame 1
    expect(frameIndexAt(frames, 2_000)).toBe(2); // exact match -> that frame, not the next
  });

  it("handles an empty frame list without throwing", () => {
    expect(frameIndexAt([], 1_000)).toBe(0);
  });
});
