import { describe, expect, it } from 'vitest';

import {
  CARIBBEAN_ISLANDS_V1,
  CARIBBEAN_REFERENCE_DATA_SOURCES_V1,
  CARIBBEAN_REFERENCE_PLACES_V1,
  runScenario,
} from '../src/index.js';

describe('licensed Caribbean reference places', () => {
  it('covers all 28 manifest areas with a useful, bounded catalogue', () => {
    const manifestIds = new Set(CARIBBEAN_ISLANDS_V1.map((island) => island.islandId));
    expect(new Set(CARIBBEAN_REFERENCE_PLACES_V1.map((place) => place.islandId))).toEqual(manifestIds);
    for (const islandId of manifestIds) {
      const count = CARIBBEAN_REFERENCE_PLACES_V1.filter((place) => place.islandId === islandId).length;
      expect(count, islandId).toBeGreaterThanOrEqual(8);
      expect(count, islandId).toBeLessThanOrEqual(20);
    }
  });

  it('contains only allow-listed public fields with complete source metadata', () => {
    const ids = CARIBBEAN_REFERENCE_PLACES_V1.map((place) => place.referencePlaceId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(CARIBBEAN_REFERENCE_DATA_SOURCES_V1).toHaveLength(1);
    expect(CARIBBEAN_REFERENCE_DATA_SOURCES_V1[0]).toMatchObject({
      sourceId: 'openstreetmap-v1',
      attribution: '© OpenStreetMap contributors',
      licenceName: 'Open Data Commons Open Database License 1.0',
    });

    for (const place of CARIBBEAN_REFERENCE_PLACES_V1) {
      expect(place.name.trim().length).toBeGreaterThan(1);
      expect(place.position.latitude).toBeGreaterThanOrEqual(-90);
      expect(place.position.latitude).toBeLessThanOrEqual(90);
      expect(place.position.longitude).toBeGreaterThanOrEqual(-180);
      expect(place.position.longitude).toBeLessThanOrEqual(180);
      expect(place.sourceUrl).toMatch(/^https:\/\/www\.openstreetmap\.org\/(node|way|relation)\/\d+$/);
      expect(place.sourceRevision).toMatch(/^nominatim-place-\d+@2026-08-24$/);
      expect(place.retrievedAt).toBe('2026-08-24');
      for (const forbidden of ['address', 'phone', 'email', 'contact', 'review']) {
        expect(Object.keys(place).map((key) => key.toLowerCase())).not.toContain(forbidden);
      }
    }
  });

  it('scopes references and synthetic actor anchors to selected areas', () => {
    const result = runScenario({
      scenarioId: 'caribbean-islands-v1',
      policy: 'HARVEST',
      seed: 42,
      captureFrames: true,
      islandIds: ['barbados', 'dominica'],
    });
    const scene = result.timeline?.scene;
    expect(scene).toBeDefined();
    if (!scene) return;

    expect(new Set(scene.referencePlaces.map((place) => place.islandId))).toEqual(new Set(['barbados', 'dominica']));
    expect(scene.referenceDataSources.map((source) => source.sourceId)).toEqual(['openstreetmap-v1']);
    const references = new Map(scene.referencePlaces.map((place) => [place.referencePlaceId, place]));
    for (const actor of [...scene.farms, ...scene.buyers, ...scene.transporters]) {
      expect(actor.name.toLowerCase()).toContain('synthetic');
      if (actor.referencePlaceId) {
        expect(references.get(actor.referencePlaceId)?.islandId).toBe(actor.islandId);
        expect(actor.name).not.toBe(references.get(actor.referencePlaceId)?.name);
      }
    }
  });

  it('uses identical public reference geography for paired policies', () => {
    const options = { scenarioId: 'caribbean-islands-v1', seed: 9, captureFrames: true, islandIds: ['saint-lucia'] } as const;
    const baseline = runScenario({ ...options, policy: 'BASELINE' });
    const harvest = runScenario({ ...options, policy: 'HARVEST' });
    expect(harvest.timeline?.scene.referencePlaces).toEqual(baseline.timeline?.scene.referencePlaces);
    expect(harvest.timeline?.scene.referenceDataSources).toEqual(baseline.timeline?.scene.referenceDataSources);
  });
});
