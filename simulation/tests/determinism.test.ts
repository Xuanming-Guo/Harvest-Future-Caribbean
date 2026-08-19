/**
 * Determinism is issue #4's headline acceptance criterion: "resetting with the
 * same seed reproduces the same world and underlying outcomes".
 *
 * These tests compare whole-world digests rather than a handful of metrics.
 * Two runs could agree on every published number while their hidden truth had
 * diverged, and that divergence would poison the paired benchmark later without
 * ever failing a metrics-only assertion.
 */

import { describe, expect, it } from 'vitest';

import { runScenario } from '../src/engine.js';
import { RandomSource } from '../src/core/random.js';
import { IdFactory, UUID_V4_PATTERN } from '../src/core/ids.js';
import { saintLuciaDemoV1 } from '../src/scenario/saint-lucia-demo-v1.js';

describe('run reproducibility', () => {
  it('produces an identical world digest for the same scenario, policy and seed', () => {
    const first = runScenario({ scenarioId: saintLuciaDemoV1.scenarioId, policy: 'HARVEST', seed: 8675309 });
    const second = runScenario({ scenarioId: saintLuciaDemoV1.scenarioId, policy: 'HARVEST', seed: 8675309 });

    expect(second.digest).toBe(first.digest);
    expect(second.runId).toBe(first.runId);
    expect(second.metrics).toEqual(first.metrics);
  });

  it('produces an identical digest for the baseline policy too', () => {
    const first = runScenario({ scenarioId: saintLuciaDemoV1.scenarioId, policy: 'BASELINE', seed: 42 });
    const second = runScenario({ scenarioId: saintLuciaDemoV1.scenarioId, policy: 'BASELINE', seed: 42 });

    expect(second.digest).toBe(first.digest);
    expect(second.metrics).toEqual(first.metrics);
  });

  it('produces a different world for a different seed', () => {
    // Guards against the opposite failure: a "deterministic" engine that
    // ignores its seed would pass every test above.
    const a = runScenario({ scenarioId: saintLuciaDemoV1.scenarioId, policy: 'HARVEST', seed: 1 });
    const b = runScenario({ scenarioId: saintLuciaDemoV1.scenarioId, policy: 'HARVEST', seed: 2 });

    expect(b.digest).not.toBe(a.digest);
  });

  it('allows an API-owned run id without changing deterministic outcomes', () => {
    const first = runScenario({
      runId: '11111111-1111-4111-8111-111111111111',
      scenarioId: saintLuciaDemoV1.scenarioId,
      policy: 'HARVEST',
      seed: 8675309,
      captureFrames: true,
    });
    const second = runScenario({
      runId: '22222222-2222-4222-8222-222222222222',
      scenarioId: saintLuciaDemoV1.scenarioId,
      policy: 'HARVEST',
      seed: 8675309,
      captureFrames: true,
    });

    expect(first.runId).not.toBe(second.runId);
    expect(first.digest).toBe(second.digest);
    expect(first.metrics).toEqual(second.metrics);
    expect(first.timeline?.frames).toEqual(second.timeline?.frames);
  });

  it('gives the baseline and Harvest runs of one seed the same starting world', () => {
    // The paired benchmark depends on this. Both runs must be built from an
    // identical world; only the coordination policy may differ.
    const baseline = runScenario({ scenarioId: saintLuciaDemoV1.scenarioId, policy: 'BASELINE', seed: 777 });
    const harvest = runScenario({ scenarioId: saintLuciaDemoV1.scenarioId, policy: 'HARVEST', seed: 777 });

    // Same world construction means the same run id and the same scenario clock.
    expect(harvest.runId).toBe(baseline.runId);
    expect(harvest.startedAt).toBe(baseline.startedAt);
    // But the outcomes should diverge, or the policies are not doing anything.
    expect(harvest.digest).not.toBe(baseline.digest);
  });
});

describe('random streams', () => {
  it('is reproducible for a given seed and stream name', () => {
    const first = new RandomSource(99).stream('weather');
    const second = new RandomSource(99).stream('weather');

    const a = Array.from({ length: 20 }, () => first.next());
    const b = Array.from({ length: 20 }, () => second.next());

    expect(b).toEqual(a);
  });

  it('keeps named streams independent of one another', () => {
    // The property that matters: consuming from one stream must not shift
    // another. Without it, adding a draw in one subsystem silently changes
    // every other subsystem's sequence.
    const source = new RandomSource(1234);
    const weatherFirst = source.stream('weather');
    const expected = Array.from({ length: 5 }, () => weatherFirst.next());

    const other = new RandomSource(1234);
    const demand = other.stream('demand');
    for (let index = 0; index < 50; index += 1) demand.next();
    const weatherSecond = other.stream('weather');
    const actual = Array.from({ length: 5 }, () => weatherSecond.next());

    expect(actual).toEqual(expected);
  });

  it('returns the same generator when a stream is requested twice', () => {
    const source = new RandomSource(5);
    expect(source.stream('a')).toBe(source.stream('a'));
  });

  it('rejects a seed outside the range the contract allows', () => {
    expect(() => new RandomSource(-1)).toThrow(/Seed must be an integer/);
    expect(() => new RandomSource(4294967296)).toThrow(/Seed must be an integer/);
    expect(() => new RandomSource(1.5)).toThrow(/Seed must be an integer/);
  });

  it('keeps normal deviates within the documented clamp', () => {
    const stream = new RandomSource(7).stream('normal');
    for (let index = 0; index < 2000; index += 1) {
      const value = stream.normal(0, 1);
      expect(value).toBeGreaterThanOrEqual(-4);
      expect(value).toBeLessThanOrEqual(4);
    }
  });
});

describe('identifiers', () => {
  it('mints uuid-shaped, reproducible, unique identifiers', () => {
    const make = () => new IdFactory(new RandomSource(2026).stream('ids'));

    const first = Array.from({ length: 200 }, () => make().next());
    expect(new Set(first).size).toBe(1); // Same factory state each time: reproducible.

    const factory = make();
    const many = Array.from({ length: 500 }, () => factory.next());
    expect(new Set(many).size).toBe(500); // Unique within a run.
    for (const id of many) expect(id).toMatch(UUID_V4_PATTERN);
  });
});
