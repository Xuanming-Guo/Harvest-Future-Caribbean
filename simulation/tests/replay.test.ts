/**
 * The replay timeline is handed to a browser, so a hidden-truth leak here would
 * publish it to anyone with developer tools open. These tests treat the whole
 * recorded timeline as untrusted output and check it accordingly.
 */

import { describe, expect, it } from 'vitest';

import { runScenario } from '../src/engine.js';
import { assertNoTruthLeak } from '../src/world/observable.js';
import { frameAt, interpolateAlongPath, missionPositionAt, type ControlRoomMission } from '../src/replay.js';
import { saintLuciaDemoV1 } from '../src/scenario/saint-lucia-demo-v1.js';
import { DAY_MS } from '../src/core/time.js';

const SCENARIO = saintLuciaDemoV1.scenarioId;

describe('replay capture', () => {
  it('records nothing unless asked', () => {
    const result = runScenario({ scenarioId: SCENARIO, policy: 'HARVEST', seed: 8675309 });
    expect(result.timeline).toBeUndefined();
  });

  it('records a frame per event, in non-decreasing time order', () => {
    const result = runScenario({ scenarioId: SCENARIO, policy: 'HARVEST', seed: 8675309, captureFrames: true });
    const timeline = result.timeline;
    expect(timeline).toBeDefined();
    if (!timeline) return;

    expect(timeline.frames.length).toBe(result.metrics.eventsProcessed);
    expect(timeline.frames.length).toBeGreaterThan(20);

    for (let index = 1; index < timeline.frames.length; index += 1) {
      const previous = timeline.frames[index - 1];
      const current = timeline.frames[index];
      if (!previous || !current) continue;
      // Simulation time never runs backwards.
      expect(current.atMs).toBeGreaterThanOrEqual(previous.atMs);
    }
  });

  it('keeps hidden truth out of the entire timeline', () => {
    const result = runScenario({ scenarioId: SCENARIO, policy: 'HARVEST', seed: 4242, captureFrames: true });
    expect(() => assertNoTruthLeak(result.timeline, 'replay timeline')).not.toThrow();

    // Belt and braces: the serialised form must not mention a hidden field by
    // name anywhere, including inside a decision's free-text evidence.
    const serialised = JSON.stringify(result.timeline);
    for (const forbidden of ['potentialYieldKg', 'qualityFraction', 'dailySpoilageRate', 'severity']) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it('carries the evidence label into the scene', () => {
    // The control room must not be able to render without the label available.
    const result = runScenario({ scenarioId: SCENARIO, policy: 'HARVEST', seed: 7, captureFrames: true });
    expect(result.timeline?.scene.evidenceLabel).toMatch(/SYNTHETIC/);
  });

  it('describes the scene with every actor the globe needs to place', () => {
    const result = runScenario({ scenarioId: SCENARIO, policy: 'HARVEST', seed: 7, captureFrames: true });
    const scene = result.timeline?.scene;
    expect(scene).toBeDefined();
    if (!scene) return;

    expect(scene.farms.length).toBeGreaterThan(0);
    expect(scene.buyers.length).toBeGreaterThan(0);
    expect(scene.transporters.length).toBeGreaterThan(0);

    // Everything must sit on Saint Lucia, or the camera will fly somewhere odd.
    for (const farm of scene.farms) {
      expect(farm.position.latitude).toBeGreaterThan(13.5);
      expect(farm.position.latitude).toBeLessThan(14.3);
      expect(farm.position.longitude).toBeGreaterThan(-61.3);
      expect(farm.position.longitude).toBeLessThan(-60.7);
    }
  });

  it('stays reproducible with frame capture switched on', () => {
    const a = runScenario({ scenarioId: SCENARIO, policy: 'HARVEST', seed: 99, captureFrames: true });
    const b = runScenario({ scenarioId: SCENARIO, policy: 'HARVEST', seed: 99, captureFrames: true });

    expect(b.digest).toBe(a.digest);
    expect(b.timeline?.frames.length).toBe(a.timeline?.frames.length);
  });

  it('does not let capture change the simulation', () => {
    // Recording must be a pure observer. If capture perturbed the run, every
    // control-room demo would show a different world from the benchmark.
    const withCapture = runScenario({ scenarioId: SCENARIO, policy: 'HARVEST', seed: 123, captureFrames: true });
    const without = runScenario({ scenarioId: SCENARIO, policy: 'HARVEST', seed: 123 });

    expect(withCapture.digest).toBe(without.digest);
    expect(withCapture.metrics.eventsProcessed).toBe(without.metrics.eventsProcessed);
  });
});

describe('injected disruptions', () => {
  it('adds an injected disruption to the run', () => {
    const base = runScenario({ scenarioId: SCENARIO, policy: 'HARVEST', seed: 500 });
    const injected = runScenario({
      scenarioId: SCENARIO,
      policy: 'HARVEST',
      seed: 500,
      injectedDisruptions: [
        {
          type: 'WEATHER',
          offsetMs: 5 * DAY_MS,
          durationMs: 2 * DAY_MS,
          affectedEntityIds: ['everything'],
          publicDescription: 'Injected storm.',
        },
      ],
    });

    expect(injected.digest).not.toBe(base.digest);
  });

  it('keeps an injected run reproducible', () => {
    const injection = [
      {
        type: 'ROAD' as const,
        offsetMs: 3 * DAY_MS,
        durationMs: DAY_MS,
        affectedEntityIds: ['road'],
        publicDescription: 'Injected landslide.',
      },
    ];
    const a = runScenario({ scenarioId: SCENARIO, policy: 'HARVEST', seed: 61, injectedDisruptions: injection });
    const b = runScenario({ scenarioId: SCENARIO, policy: 'HARVEST', seed: 61, injectedDisruptions: injection });

    expect(b.digest).toBe(a.digest);
  });

  it('ignores an injection scheduled past the horizon', () => {
    const base = runScenario({ scenarioId: SCENARIO, policy: 'HARVEST', seed: 62 });
    const late = runScenario({
      scenarioId: SCENARIO,
      policy: 'HARVEST',
      seed: 62,
      injectedDisruptions: [
        {
          type: 'CROP',
          offsetMs: 500 * DAY_MS,
          durationMs: DAY_MS,
          affectedEntityIds: ['batch'],
          publicDescription: 'Far future, never happens.',
        },
      ],
    });

    expect(late.digest).toBe(base.digest);
  });
});

describe('playback helpers', () => {
  const mission: ControlRoomMission = {
    missionId: 'm1',
    commitmentId: 'c1',
    transporterId: 't1',
    status: 'ACTIVE',
    path: [
      { latitude: 0, longitude: 0 },
      { latitude: 10, longitude: 0 },
    ],
    plannedDepartureAt: 1_000,
    plannedArrivalAt: 2_000,
    actualArrivalAt: null,
    loadedKg: 100,
  };

  it('interpolates along a path', () => {
    const path = [
      { latitude: 0, longitude: 0 },
      { latitude: 10, longitude: 10 },
    ];
    expect(interpolateAlongPath(path, 0)).toEqual({ latitude: 0, longitude: 0 });
    expect(interpolateAlongPath(path, 0.5)).toEqual({ latitude: 5, longitude: 5 });
    expect(interpolateAlongPath(path, 1)).toEqual({ latitude: 10, longitude: 10 });
  });

  it('clamps progress outside [0, 1] instead of extrapolating off the map', () => {
    const path = [
      { latitude: 0, longitude: 0 },
      { latitude: 10, longitude: 0 },
    ];
    expect(interpolateAlongPath(path, -5)).toEqual({ latitude: 0, longitude: 0 });
    expect(interpolateAlongPath(path, 5)).toEqual({ latitude: 10, longitude: 0 });
  });

  it('handles degenerate paths', () => {
    expect(interpolateAlongPath([], 0.5)).toBeNull();
    expect(interpolateAlongPath([{ latitude: 3, longitude: 4 }], 0.5)).toEqual({ latitude: 3, longitude: 4 });
  });

  it('places a vehicle only while its mission is running', () => {
    expect(missionPositionAt(mission, 500)).toBeNull(); // Before departure.
    expect(missionPositionAt(mission, 1_500)?.latitude).toBeCloseTo(5, 6);
    expect(missionPositionAt(mission, 9_000)).toEqual({ latitude: 10, longitude: 0 });
    expect(missionPositionAt({ ...mission, status: 'CANCELLED' }, 1_500)).toBeNull();
  });

  it('does not divide by zero on an instantaneous mission', () => {
    const instant = { ...mission, plannedArrivalAt: mission.plannedDepartureAt };
    expect(missionPositionAt(instant, mission.plannedDepartureAt)).toEqual({ latitude: 10, longitude: 0 });
  });

  it('finds the frame at or before an instant', () => {
    const frames = [10, 20, 30, 40].map((atMs) => ({ atMs }) as never);
    expect(frameAt(frames, 5)).toBe(frames[0]);
    expect(frameAt(frames, 10)).toBe(frames[0]);
    expect(frameAt(frames, 25)).toBe(frames[1]);
    expect(frameAt(frames, 40)).toBe(frames[3]);
    expect(frameAt(frames, 999)).toBe(frames[3]);
    expect(frameAt([], 5)).toBeNull();
  });
});
