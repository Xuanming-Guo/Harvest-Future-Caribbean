import { describe, expect, it } from 'vitest';

import { CARIBBEAN_ISLANDS_V1, runScenario } from '../src/index.js';

describe('manifest-generated Caribbean scenarios', () => {
  it('generates deterministic independent systems for a selected island set', () => {
    const options = { scenarioId: 'caribbean-islands-v1', policy: 'HARVEST' as const, seed: 42, captureFrames: true, islandIds: ['barbados', 'dominica'] };
    const first = runScenario(options);
    const second = runScenario(options);
    expect(first.status).toBe('COMPLETED');
    expect(first.digest).toBe(second.digest);
    expect(new Set(first.timeline!.scene.participants.map((participant) => participant.islandId))).toEqual(new Set(['barbados', 'dominica']));
    for (const farm of first.timeline!.scene.farms) expect(['barbados', 'dominica']).toContain(farm.islandId);
  });

  it('runs every manifest island under both policies without island-specific recipes', () => {
    for (const island of CARIBBEAN_ISLANDS_V1) {
      for (const policy of ['BASELINE', 'HARVEST'] as const) {
        const result = runScenario({ scenarioId: 'caribbean-islands-v1', policy, seed: 7, islandIds: [island.islandId] });
        expect(result.status, `${island.islandId}/${policy}`).toBe('COMPLETED');
      }
    }
  });

  it('uses all manifest islands when no selected scope is supplied', () => {
    const result = runScenario({ scenarioId: 'caribbean-islands-v1', policy: 'BASELINE', seed: 9, captureFrames: true });
    expect(new Set(result.timeline!.scene.participants.map((participant) => participant.islandId))).toEqual(new Set(CARIBBEAN_ISLANDS_V1.map((island) => island.islandId)));
  });
});
