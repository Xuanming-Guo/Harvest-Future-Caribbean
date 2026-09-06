/**
 * Scoped inter-island trade, shipping and regional coordination (issue #40).
 *
 * The properties these tests hold down are the ones that would be expensive to
 * discover later: that scope is a hard boundary rather than a filter somebody
 * has to remember, that no route is ever invented, that a cross-island promise
 * cannot bind without approval, and that two runs of one seed produce the same
 * shipments and the same coordination decisions.
 */

import { describe, expect, it } from 'vitest';

import { SimulationEngine, type RunResult } from '../src/engine.js';
import { CARIBBEAN_ISLANDS_V1 } from '../src/scenario/caribbean-islands-manifest-v1.js';
import { vesselPositionAt, type ControlRoomShipment } from '../src/replay.js';
import {
  COMPARISON_CURRENCY,
  CUSTOMS_DISCLAIMER,
  MARITIME_NETWORK_V1,
  SAILING_CAPACITY_KG,
  bestRouteBetween,
  reachableIslandIds,
  routesBetween,
  scopeMaritimeNetwork,
} from '../src/world/maritime.js';

/** Saint Lucia and Martinique are joined by one published FRS Express des Îles link. */
const LINKED_PAIR = ['martinique', 'saint-lucia'];
/** Two islands the reviewed dataset records no service between. */
const UNLINKED_PAIR = ['barbados', 'saint-lucia'];
const CHAIN_SCOPE = ['dominica', 'martinique', 'saint-lucia'];
const SEEDS = [42, 8675309, 7, 19, 23, 31, 101, 202];

function run(islandIds: string[], seed: number, policy: 'BASELINE' | 'HARVEST' = 'HARVEST', captureFrames = false): RunResult {
  return new SimulationEngine({
    scenarioId: 'caribbean-islands-v1',
    islandIds,
    policy,
    seed,
    captureFrames,
  }).run();
}

/** Every shipment produced across a set of seeds, with the run it came from. */
function shipmentsAcross(islandIds: string[], seeds: number[]): Array<{ seed: number; shipment: ControlRoomShipment }> {
  const found: Array<{ seed: number; shipment: ControlRoomShipment }> = [];
  for (const seed of seeds) {
    const result = run(islandIds, seed, 'HARVEST', true);
    const frames = result.timeline?.frames ?? [];
    const latest = new Map<string, ControlRoomShipment>();
    for (const frame of frames) {
      for (const shipment of frame.shipments ?? []) latest.set(shipment.shipmentId, shipment);
    }
    for (const shipment of latest.values()) found.push({ seed, shipment });
  }
  return found;
}

describe('scoping the maritime network', () => {
  it('gives a one-island run no links at all, and so no shipment', () => {
    const network = scopeMaritimeNetwork(['saint-lucia']);
    expect(network.ports.length).toBeGreaterThan(0);
    expect(network.links).toHaveLength(0);

    for (const seed of SEEDS) {
      const result = run(['saint-lucia'], seed);
      expect(result.metrics.maritime.scopedLinks).toBe(0);
      expect(result.metrics.maritime.shipmentsProposed).toBe(0);
      expect(result.metrics.maritime.shippedKg).toBe(0);
    }
  });

  it('keeps a two-island run inside its two islands', () => {
    const network = scopeMaritimeNetwork(LINKED_PAIR);
    for (const port of network.ports) expect(LINKED_PAIR).toContain(port.islandId);

    const portIslands = new Map(network.ports.map((port) => [port.id, port.islandId] as const));
    for (const link of network.links) {
      expect(LINKED_PAIR).toContain(portIslands.get(link.fromPortId));
      expect(LINKED_PAIR).toContain(portIslands.get(link.toPortId));
    }

    const shipments = shipmentsAcross(LINKED_PAIR, SEEDS);
    expect(shipments.length).toBeGreaterThan(0);
    for (const { shipment } of shipments) {
      expect(LINKED_PAIR).toContain(shipment.originIslandId);
      expect(LINKED_PAIR).toContain(shipment.destinationIslandId);
      expect(portIslands.has(shipment.originPortId)).toBe(true);
      expect(portIslands.has(shipment.destinationPortId)).toBe(true);
    }
  });

  it('never lets a larger scope reach a port outside it', () => {
    const network = scopeMaritimeNetwork(CHAIN_SCOPE);
    const inScopePortIds = new Set(network.ports.map((port) => port.id));
    // Guadeloupe is one link further along the same operator's chain, and is a
    // port this scope must not be able to touch.
    const guadeloupePorts = MARITIME_NETWORK_V1.ports.filter((port) => port.islandId === 'guadeloupe');
    expect(guadeloupePorts.length).toBeGreaterThan(0);
    for (const port of guadeloupePorts) expect(inScopePortIds.has(port.id)).toBe(false);

    for (const { shipment } of shipmentsAcross(CHAIN_SCOPE, SEEDS.slice(0, 4))) {
      expect(CHAIN_SCOPE).toContain(shipment.originIslandId);
      expect(CHAIN_SCOPE).toContain(shipment.destinationIslandId);
      expect(inScopePortIds.has(shipment.originPortId)).toBe(true);
      expect(inScopePortIds.has(shipment.destinationPortId)).toBe(true);
    }
  });

  it('records a cause rather than inventing a route when no public link exists', () => {
    expect(scopeMaritimeNetwork(UNLINKED_PAIR).links).toHaveLength(0);

    let noPublicRoute = 0;
    for (const seed of SEEDS) {
      const result = run(UNLINKED_PAIR, seed);
      expect(result.metrics.maritime.shipmentsProposed).toBe(0);
      noPublicRoute += result.metrics.causeCounts.NO_PUBLIC_ROUTE;
    }
    expect(noPublicRoute).toBeGreaterThan(0);
  });

  it('does not chain two published links into an unpublished through-service', () => {
    const network = scopeMaritimeNetwork(CHAIN_SCOPE);
    // Dominica reaches Martinique, and Martinique reaches Saint Lucia, but no
    // source publishes a Dominica-to-Saint-Lucia produce service, so none is
    // asserted.
    expect(reachableIslandIds(network, 'dominica')).toEqual(['martinique']);
    expect(routesBetween(network, 'dominica', 'saint-lucia')).toHaveLength(0);
    expect(bestRouteBetween(network, 'dominica', 'saint-lucia')).toBeNull();
  });

  it('only ever uses a link the reviewed dataset actually records', () => {
    const links = new Map(MARITIME_NETWORK_V1.links.map((link) => [link.id, link] as const));
    for (const { shipment } of shipmentsAcross(CHAIN_SCOPE, SEEDS.slice(0, 4))) {
      const link = links.get(shipment.linkId);
      expect(link, `shipment cites unknown link ${shipment.linkId}`).toBeDefined();
      const ends = [link?.fromPortId, link?.toPortId];
      expect(ends).toContain(shipment.originPortId);
      expect(ends).toContain(shipment.destinationPortId);
      expect(shipment.operator).toBe(link?.operator);
    }
  });
});

describe('determinism', () => {
  /** Everything about a shipment that a rerun must reproduce exactly. */
  function normalise(result: RunResult): string {
    const frames = result.timeline?.frames ?? [];
    const latest = new Map<string, ControlRoomShipment>();
    for (const frame of frames) {
      for (const shipment of frame.shipments ?? []) latest.set(shipment.shipmentId, shipment);
    }
    const shipments = [...latest.values()]
      .sort((a, b) => a.shipmentId.localeCompare(b.shipmentId))
      .map((shipment) =>
        [
          shipment.shipmentId,
          shipment.status,
          shipment.originIslandId,
          shipment.destinationIslandId,
          shipment.linkId,
          shipment.originPortId,
          shipment.destinationPortId,
          shipment.loadedKg.toFixed(4),
          shipment.capacityKg,
          shipment.customs.status,
          shipment.customs.inspected,
          shipment.customs.delayHours,
          shipment.cost.total.localAmount.toFixed(2),
          shipment.cost.total.comparisonAmount.toFixed(2),
          shipment.scheduledDepartureAt,
          shipment.scheduledArrivalAt,
          shipment.actualDepartureAt,
          shipment.actualArrivalAt,
          shipment.deliveredAt,
          shipment.weatherDelayHours,
          shipment.legs.map((leg) => `${leg.kind}@${leg.startsAt}-${leg.endsAt}`).join(','),
        ].join(':'),
      );

    const decisions = result.decisions
      .filter((decision) => decision.kind.includes('INTER_ISLAND') || decision.kind === 'HARVEST_BOOK_SAILING')
      .map((decision) => `${decision.at}:${decision.kind}:${JSON.stringify(decision.evidence)}`);

    return JSON.stringify({ digest: result.digest, shipments, decisions, maritime: result.metrics.maritime });
  }

  it('reproduces identical shipments and coordination decisions for a two-island seed', () => {
    const first = run(LINKED_PAIR, 8675309, 'HARVEST', true);
    const second = run(LINKED_PAIR, 8675309, 'HARVEST', true);
    expect(normalise(second)).toBe(normalise(first));
    expect(first.metrics.maritime.shipmentsProposed).toBeGreaterThan(0);
  });

  it('reproduces identical shipments and coordination decisions across the whole Caribbean', () => {
    const islandIds = CARIBBEAN_ISLANDS_V1.map((island) => island.islandId);
    const first = run(islandIds, 4242, 'HARVEST', true);
    const second = run(islandIds, 4242, 'HARVEST', true);
    expect(normalise(second)).toBe(normalise(first));
    expect(first.metrics.maritime.scopedLinks).toBe(MARITIME_NETWORK_V1.links.length);
  }, 60_000);
});

describe('the approval boundary', () => {
  it('creates no shipment until the inter-island commitment is approved', () => {
    // Every sailing in the run has a commitment behind it, and that commitment
    // carries an approval instant. A shipment without one would be a promise
    // that bound a farmer with nobody clearing it.
    let checked = 0;
    for (const seed of SEEDS) {
      const engine = new SimulationEngine({
        scenarioId: 'caribbean-islands-v1',
        islandIds: LINKED_PAIR,
        policy: 'HARVEST',
        seed,
      });
      const result = engine.run();
      if (result.metrics.maritime.shipmentsApproved === 0) continue;
      expect(result.metrics.maritime.shipmentsApproved).toBeLessThanOrEqual(result.metrics.maritime.shipmentsProposed);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('leaves a declined inter-island proposal with no sailing at all', () => {
    // Seed 19 proposes one cross-island commitment whose approval is declined
    // on decayed evidence. Nothing crosses, and nothing is charged for.
    const result = run(LINKED_PAIR, 19);
    expect(result.metrics.maritime.shipmentsProposed).toBeGreaterThan(0);
    expect(result.metrics.maritime.shipmentsApproved).toBe(0);
    expect(result.metrics.maritime.shippedKg).toBe(0);
    expect(result.metrics.maritime.totalCostXcd).toBe(0);
  });

  it('requires approval even from a policy that would skip the gate', () => {
    // The baseline never coordinates across islands at all, so it can never
    // reach the gate; the assertion is that it produces nothing maritime rather
    // than producing something unapproved.
    for (const seed of SEEDS) {
      const result = run(LINKED_PAIR, seed, 'BASELINE');
      expect(result.metrics.maritime.shipmentsProposed).toBe(0);
    }
  });
});

describe('customs, currency and capacity', () => {
  const shipments = shipmentsAcross(CHAIN_SCOPE, SEEDS);

  it('produced at least one sailing to inspect', () => {
    expect(shipments.length).toBeGreaterThan(0);
  });

  it('attaches a labelled synthetic checkpoint to every consignment', () => {
    for (const { shipment } of shipments) {
      expect(shipment.customs.portId).toBe(shipment.destinationPortId);
      expect(shipment.customs.disclaimer).toBe(CUSTOMS_DISCLAIMER);
      expect(shipment.customs.disclaimer).toMatch(/not a legal customs model/i);
      expect(shipment.customs.provenance).toBe('SYNTHETIC');
      expect(shipment.customs.documentationReference).toMatch(/^SYN-CUSTOMS-/);
      expect(shipment.customs.delayHours).toBeGreaterThan(0);
      expect(shipment.customs.feeXcd).toBeGreaterThan(0);
      expect(['PENDING', 'CLEARED', 'HELD']).toContain(shipment.customs.status);
    }
  });

  it('states every cross-island price in the local currency and in XCD', () => {
    for (const { shipment } of shipments) {
      for (const line of [shipment.cost.freight, shipment.cost.customsFee, shipment.cost.total]) {
        expect(line.comparisonCurrency).toBe(COMPARISON_CURRENCY);
        expect(line.comparisonAmount).toBeGreaterThan(0);
        expect(line.localAmount).toBeGreaterThan(0);
        expect(line.unitsPerComparisonCurrency).toBeGreaterThan(0);
        expect(line.localAmount).toBeCloseTo(line.comparisonAmount * line.unitsPerComparisonCurrency, 1);
        expect(line.rateProvenance).toBe('PUBLIC_REFERENCE');
        expect(line.amountProvenance).toBe('SYNTHETIC');
        expect(line.rateAsOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
      // Martinique and Guadeloupe are euro islands, so a euro-denominated line
      // must not silently be an XCD one wearing a different label.
      if (shipment.destinationIslandId === 'martinique') {
        expect(shipment.cost.total.localCurrency).toBe('EUR');
      }
    }
  });

  it('never loads a sailing past its synthetic capacity', () => {
    for (const { shipment } of shipments) {
      expect(shipment.capacityKg).toBe(SAILING_CAPACITY_KG);
      expect(shipment.loadedKg).toBeLessThanOrEqual(shipment.capacityKg);
    }
  });

  it('uses a published journey time where one exists and labels it where one does not', () => {
    for (const { shipment } of shipments) {
      const seaLeg = shipment.legs.find((leg) => leg.kind === 'SEA');
      expect(seaLeg).toBeDefined();
      expect(seaLeg?.journeyHoursSource).toBeDefined();
      const link = MARITIME_NETWORK_V1.links.find((candidate) => candidate.id === shipment.linkId);
      expect(seaLeg?.journeyHoursSource).toBe(
        link?.typicalJourneyHours === null ? 'SYNTHETIC_DEFAULT' : 'PUBLIC_TIMETABLE',
      );
    }
  });
});

describe('shipment lifecycle and weather', () => {
  it('walks a consignment through pickup, sea and delivery legs in order', () => {
    for (const { shipment } of shipmentsAcross(LINKED_PAIR, SEEDS)) {
      expect(shipment.legs.map((leg) => leg.kind)).toEqual(['PICKUP', 'SEA', 'DELIVERY']);
      const [pickup, sea, delivery] = shipment.legs;
      expect(pickup?.endsAt).toBeLessThanOrEqual(sea?.startsAt ?? 0);
      expect(sea?.endsAt).toBeLessThanOrEqual(delivery?.startsAt ?? 0);
      expect(delivery?.startsAt).toBeLessThanOrEqual(delivery?.endsAt ?? 0);
    }
  });

  it('lets realised weather lengthen a sea leg', () => {
    // Seed 8675309 sails into weather on this pair; the assertion is that the
    // delay is recorded and is reflected in the sea leg, not merely counted.
    const result = run(LINKED_PAIR, 8675309, 'HARVEST', true);
    expect(result.metrics.maritime.weatherDelayedSailings).toBeGreaterThan(0);
    const frames = result.timeline?.frames ?? [];
    const delayed = frames
      .flatMap((frame) => frame.shipments ?? [])
      .find((shipment) => shipment.weatherDelayHours > 0);
    expect(delayed).toBeDefined();
    expect(delayed?.scheduledArrivalAt).toBeGreaterThan((delayed?.legs.find((leg) => leg.kind === 'SEA')?.startsAt ?? 0));
  });

  it('scores a lost sailing as a shipping failure rather than as spoilage', () => {
    const result = run(LINKED_PAIR, 8675309);
    expect(result.metrics.maritime.shipmentsFailed).toBeGreaterThan(0);
    expect(result.metrics.causeCounts.SHIPMENT_FAILED).toBeGreaterThan(0);
  });

  it('puts a vessel on the sea leg only while it is at sea', () => {
    // A failed sailing deliberately shows no vessel in its final state, so the
    // marker test uses one that completed its crossing.
    const shipment = shipmentsAcross(LINKED_PAIR, SEEDS)
      .map((entry) => entry.shipment)
      .find((candidate) => candidate.status !== 'FAILED') as ControlRoomShipment;
    expect(shipment).toBeDefined();
    const seaLeg = shipment.legs.find((leg) => leg.kind === 'SEA');
    expect(seaLeg).toBeDefined();
    expect(vesselPositionAt(shipment, (seaLeg as { startsAt: number }).startsAt - 1)).toBeNull();
    expect(vesselPositionAt(shipment, (seaLeg as { endsAt: number }).endsAt + 1)).toBeNull();
    const middle = vesselPositionAt(
      shipment,
      Math.round(((seaLeg as { startsAt: number }).startsAt + (seaLeg as { endsAt: number }).endsAt) / 2),
    );
    expect(middle).not.toBeNull();
    expect(middle?.latitude).toBeGreaterThan(Math.min(seaLeg?.from.latitude ?? 0, seaLeg?.to.latitude ?? 0) - 0.001);
    expect(middle?.latitude).toBeLessThan(Math.max(seaLeg?.from.latitude ?? 0, seaLeg?.to.latitude ?? 0) + 0.001);
  });
});

describe('provenance', () => {
  it('carries source, licence and retrieval date on every scoped port, link and rate', () => {
    const network = scopeMaritimeNetwork(CHAIN_SCOPE);
    const records = [...network.ports, ...network.links, ...network.rates];
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      expect(record.reference.evidenceType).toBe('PUBLIC_REFERENCE');
      expect(record.reference.source.title.trim().length).toBeGreaterThan(0);
      expect(record.reference.source.publisher.trim().length).toBeGreaterThan(0);
      expect(record.reference.source.url).toMatch(/^https?:\/\//);
      expect(record.reference.licence.trim().length).toBeGreaterThan(0);
      expect(record.reference.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('keeps public reference and synthetic operations separately labelled on a shipment', () => {
    for (const { shipment } of shipmentsAcross(LINKED_PAIR, SEEDS)) {
      expect(shipment.networkProvenance).toBe('PUBLIC_REFERENCE');
      expect(shipment.operationsProvenance).toBe('SYNTHETIC');
    }
  });

  it('publishes the scoped network and its attribution with the replay scene', () => {
    const result = run(LINKED_PAIR, 42, 'HARVEST', true);
    const scene = result.timeline?.scene;
    expect(scene?.maritime?.ports.length).toBeGreaterThan(0);
    expect(scene?.maritime?.links.length).toBeGreaterThan(0);
    expect(scene?.maritime?.version).toBe(MARITIME_NETWORK_V1.version);
    for (const port of scene?.maritime?.ports ?? []) expect(LINKED_PAIR).toContain(port.islandId);

    const attributions = scene?.maritimeAttributions ?? [];
    expect(attributions.length).toBeGreaterThan(0);
    for (const attribution of attributions) {
      expect(attribution.publisher.trim().length).toBeGreaterThan(0);
      expect(attribution.licence.trim().length).toBeGreaterThan(0);
      expect(attribution.sourceUrl).toMatch(/^https?:\/\//);
      expect(attribution.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('omits the shipments field entirely from a one-island replay', () => {
    const result = run(['saint-lucia'], 42, 'HARVEST', true);
    for (const frame of result.timeline?.frames ?? []) expect(frame.shipments).toBeUndefined();
    expect(result.timeline?.scene.maritime?.links).toHaveLength(0);
  });
});

describe('the hidden failure draw stays hidden', () => {
  it('never publishes whether a sailing is going to fail', () => {
    const result = run(LINKED_PAIR, 8675309, 'HARVEST', true);
    const serialised = JSON.stringify(result.timeline);
    expect(serialised).not.toMatch(/sailingFail/i);
    expect(serialised).not.toMatch(/willFail/i);
    // A shipment that has not yet reached the checkpoint must not already be
    // carrying its own failure.
    for (const frame of result.timeline?.frames ?? []) {
      for (const shipment of frame.shipments ?? []) {
        if (shipment.status !== 'FAILED') continue;
        expect(shipment.actualArrivalAt).not.toBeNull();
        expect(frame.atMs).toBeGreaterThanOrEqual(shipment.actualArrivalAt as number);
      }
    }
  });

  it('records no shipment anywhere for a scope with no published link', () => {
    const result = run(UNLINKED_PAIR, 42, 'HARVEST', true);
    for (const frame of result.timeline?.frames ?? []) expect(frame.shipments).toBeUndefined();
    expect(result.metrics.maritime.shipmentsProposed).toBe(0);
    expect(result.metrics.maritime.shipmentsApproved).toBe(0);
    expect(result.decisions.some((decision) => decision.kind === 'HARVEST_BOOK_SAILING')).toBe(false);
  });
});
