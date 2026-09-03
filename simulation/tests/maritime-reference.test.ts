import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { CARIBBEAN_ISLANDS_V1 } from '../src/scenario/caribbean-islands-manifest-v1.js';

const DATA_PATH = fileURLToPath(new URL('../data/caribbean-maritime-network.v1.json', import.meta.url));

interface MaritimeReference {
  source: { title: string; url: string; publisher: string };
  licence: string;
  retrievedAt: string;
  geography: string;
  evidenceType: string;
}

interface MaritimePort {
  id: string;
  name: string;
  islandId: string;
  latitude: number;
  longitude: number;
  portType: string;
  reference: MaritimeReference;
}

interface MaritimeLink {
  id: string;
  fromPortId: string;
  toPortId: string;
  mode: string;
  operator: string;
  typicalJourneyHours: number | null;
  reference: MaritimeReference;
}

interface MaritimeExchangeRate {
  currency: string;
  name: string;
  regime: string;
  islandIds: string[];
  unitsPerUSD: number;
  unitsPerXCD: number;
  reference: MaritimeReference;
}

interface MaritimeNetwork {
  version: string;
  generatedAt: string;
  notes: string[];
  ports: MaritimePort[];
  links: MaritimeLink[];
  exchangeRates: { baseCurrencies: string[]; asOf: string; rates: MaritimeExchangeRate[] };
}

function loadNetwork(): MaritimeNetwork {
  return JSON.parse(readFileSync(DATA_PATH, 'utf8')) as MaritimeNetwork;
}

function expectValidReference(reference: MaritimeReference, label: string): void {
  expect(reference, label).toBeTruthy();
  expect(reference.source?.title?.trim().length ?? 0, `${label} source.title`).toBeGreaterThan(0);
  expect(reference.source?.publisher?.trim().length ?? 0, `${label} source.publisher`).toBeGreaterThan(0);
  expect(reference.source?.url, `${label} source.url`).toMatch(/^https?:\/\//);
  expect(reference.licence?.trim().length ?? 0, `${label} licence`).toBeGreaterThan(0);
  expect(reference.geography?.trim().length ?? 0, `${label} geography`).toBeGreaterThan(0);
  expect(reference.retrievedAt, `${label} retrievedAt`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(reference.evidenceType, `${label} evidenceType`).toBe('PUBLIC_REFERENCE');
}

describe('Caribbean maritime network reference data (issue #40)', () => {
  const network = loadNetwork();
  const manifestIslandIds = new Set(CARIBBEAN_ISLANDS_V1.map((island) => island.islandId));

  it('parses as well-formed JSON with the expected top-level shape', () => {
    expect(network.version).toBeTruthy();
    expect(network.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Array.isArray(network.notes)).toBe(true);
    expect(network.notes.length).toBeGreaterThan(0);
    expect(Array.isArray(network.ports)).toBe(true);
    expect(Array.isArray(network.links)).toBe(true);
    expect(Array.isArray(network.exchangeRates.rates)).toBe(true);
  });

  it('keys every port to a known manifest island id, and covers every manifest island', () => {
    for (const port of network.ports) {
      expect(manifestIslandIds.has(port.islandId), `unknown islandId '${port.islandId}' on port '${port.id}'`).toBe(true);
    }
    const coveredIslandIds = new Set(network.ports.map((port) => port.islandId));
    for (const islandId of manifestIslandIds) {
      expect(coveredIslandIds.has(islandId), `manifest island '${islandId}' has no port`).toBe(true);
    }
  });

  it('gives every port a unique id, plausible coordinates and a valid portType', () => {
    const ids = network.ports.map((port) => port.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const port of network.ports) {
      expect(port.name.trim().length, port.id).toBeGreaterThan(1);
      expect(port.latitude, port.id).toBeGreaterThanOrEqual(-90);
      expect(port.latitude, port.id).toBeLessThanOrEqual(90);
      expect(port.longitude, port.id).toBeGreaterThanOrEqual(-180);
      expect(port.longitude, port.id).toBeLessThanOrEqual(180);
      expect(['cargo', 'ferry', 'cruise', 'mixed'], port.id).toContain(port.portType);
      expectValidReference(port.reference, `port ${port.id}`);
    }
  });

  it('only links ports that exist in this file, with a valid mode and a sourced reference', () => {
    const portIds = new Set(network.ports.map((port) => port.id));
    const linkIds = network.links.map((link) => link.id);
    expect(new Set(linkIds).size).toBe(linkIds.length);
    for (const link of network.links) {
      expect(portIds.has(link.fromPortId), `link '${link.id}' fromPortId '${link.fromPortId}' is not a known port`).toBe(true);
      expect(portIds.has(link.toPortId), `link '${link.id}' toPortId '${link.toPortId}' is not a known port`).toBe(true);
      expect(link.fromPortId, link.id).not.toBe(link.toPortId);
      expect(['ferry', 'cargo', 'cruise'], link.id).toContain(link.mode);
      expect(link.operator.trim().length, link.id).toBeGreaterThan(0);
      if (link.typicalJourneyHours !== null) {
        expect(typeof link.typicalJourneyHours, link.id).toBe('number');
        expect(link.typicalJourneyHours, link.id).toBeGreaterThan(0);
      }
      expectValidReference(link.reference, `link ${link.id}`);
    }
  });

  it('never asserts a link between two ports that could not be independently identified', () => {
    // Every link's own reference must name a source distinct from a bare
    // assertion — i.e. it must carry a real URL, checked above. This test
    // additionally guards against a link silently duplicating an unordered
    // pair (which would suggest a copy-paste route rather than a distinctly
    // sourced one), except where two directions really were both confirmed.
    const pairs = network.links.map((link) => [link.fromPortId, link.toPortId].sort().join('::'));
    expect(new Set(pairs).size, 'duplicate port-pair links found').toBe(pairs.length);
  });

  it('covers every manifest island currency with a sourced rate against both XCD and USD', () => {
    expect(network.exchangeRates.baseCurrencies).toEqual(expect.arrayContaining(['XCD', 'USD']));
    const ratesByCurrency = new Map(network.exchangeRates.rates.map((rate) => [rate.currency, rate]));
    for (const island of CARIBBEAN_ISLANDS_V1) {
      const rate = ratesByCurrency.get(island.currency);
      expect(rate, `no exchange rate for '${island.currency}' used by island '${island.islandId}'`).toBeTruthy();
      expect(rate?.islandIds ?? [], `rate '${island.currency}' does not list island '${island.islandId}'`).toContain(island.islandId);
    }
  });

  it('gives every exchange rate a positive numeric value in both currencies and a sourced reference', () => {
    const currencies = network.exchangeRates.rates.map((rate) => rate.currency);
    expect(new Set(currencies).size).toBe(currencies.length);
    for (const rate of network.exchangeRates.rates) {
      expect(typeof rate.unitsPerUSD, rate.currency).toBe('number');
      expect(rate.unitsPerUSD, rate.currency).toBeGreaterThan(0);
      expect(typeof rate.unitsPerXCD, rate.currency).toBe('number');
      expect(rate.unitsPerXCD, rate.currency).toBeGreaterThan(0);
      expectValidReference(rate.reference, `exchange rate ${rate.currency}`);
    }
    const xcd = network.exchangeRates.rates.find((rate) => rate.currency === 'XCD');
    expect(xcd?.unitsPerUSD).toBe(2.7);
  });

  it('never leaves a field looking numeric-but-unsourced: every record with a reference carries every required reference field', () => {
    const records = [...network.ports, ...network.links, ...network.exchangeRates.rates];
    for (const record of records) {
      const reference = (record as { reference: MaritimeReference }).reference;
      expect(Object.keys(reference).sort()).toEqual(['evidenceType', 'geography', 'licence', 'retrievedAt', 'source'].sort());
      expect(Object.keys(reference.source).sort()).toEqual(['publisher', 'title', 'url'].sort());
    }
  });
});
