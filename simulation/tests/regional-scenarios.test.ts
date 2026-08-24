import { describe, expect, it } from 'vitest';

import { CARIBBEAN_ISLANDS_V1, SCENARIOS, caribbeanIslandScenarios, compactReplayTimeline, runScenario, type ControlRoomFrame } from '../src/index.js';

const M49_CARIBBEAN_ISLAND_IDS = [
  'anguilla', 'antigua-barbuda', 'aruba', 'bahamas', 'barbados',
  'bonaire-sint-eustatius-saba', 'british-virgin-islands', 'cayman-islands',
  'cuba', 'curacao', 'dominica', 'dominican-republic', 'grenada',
  'guadeloupe', 'haiti', 'jamaica', 'martinique', 'montserrat', 'puerto-rico',
  'saint-barthelemy', 'saint-kitts-nevis', 'saint-lucia',
  'saint-martin-french-part', 'saint-vincent-grenadines',
  'sint-maarten-dutch-part', 'trinidad-tobago', 'turks-caicos-islands',
  'united-states-virgin-islands',
];

describe('manifest-generated Caribbean scenarios', () => {
  it('covers every current UN M49 Caribbean country or area', () => {
    expect(CARIBBEAN_ISLANDS_V1.map((island) => island.islandId)).toEqual(M49_CARIBBEAN_ISLAND_IDS);
  });

  it('makes every manifest island a focused runnable scenario', () => {
    expect(caribbeanIslandScenarios.map((scenario) => scenario.availableIslandIds)).toEqual(
      CARIBBEAN_ISLANDS_V1.map((island) => [island.islandId]),
    );
    for (const scenario of caribbeanIslandScenarios) {
      expect(SCENARIOS[scenario.scenarioId]).toBe(scenario);
      const result = runScenario({ scenarioId: scenario.scenarioId, policy: 'HARVEST', seed: 7, captureFrames: true });
      expect(new Set(result.timeline!.scene.participants.map((participant) => participant.islandId))).toEqual(new Set(scenario.availableIslandIds));
    }
  });

  it('compacts large regional replay snapshots without losing decisions or critical frames', () => {
    const frame = (atMs: number, eventType: string, decisions: string[] = [], agentAction = false) => ({
      atMs, at: new Date(atMs).toISOString(), eventType, newDecisions: decisions.map((summary) => ({ summary })),
      agentActions: agentAction ? [{ actionId: eventType }] : undefined,
    }) as unknown as ControlRoomFrame;
    const compacted = compactReplayTimeline({ scene: {} as never, frames: [
      frame(0, 'RUN_STARTED'), frame(1_000, 'FARMER_OBSERVATION', ['reported']),
      frame(2_000, 'BUYER_DEMAND', ['requested']), frame(3_000, 'PRODUCT_AGENT_CYCLE', [], true),
      frame(4_000, 'DISRUPTION_START'), frame(10_000, 'RUN_SETTLED'),
    ] }, 5_000);

    expect(compacted.frames.map((item) => item.eventType)).toEqual(['RUN_STARTED', 'PRODUCT_AGENT_CYCLE', 'DISRUPTION_START', 'RUN_SETTLED']);
    expect(compacted.frames[1]!.newDecisions.map((item) => item.summary)).toEqual(['reported', 'requested']);
  });

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
