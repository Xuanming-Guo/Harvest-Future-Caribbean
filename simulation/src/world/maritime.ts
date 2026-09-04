/**
 * The maritime layer: ports, public-reference links, scoping, currency and the
 * synthetic assumptions a shipment needs on top of them.
 *
 * The organising rule of this file is the split between **public reference**
 * and **synthetic**. `simulation/data/caribbean-maritime-network.v1.json` is a
 * reviewed offline dataset in which every port, every link and every exchange
 * rate carries its own source, licence and retrieval date. That file is
 * evidence that a place and a scheduled service exist. It is not evidence that
 * a produce-trading service exists on that route, and it says nothing about
 * capacity, cost, customs or delay.
 *
 * Everything this module adds on top — capacity per sailing, freight price,
 * customs behaviour, failure probability, and any journey time the operator did
 * not publish — is SYNTHETIC, is declared as a named constant below with the
 * reasoning beside it, and is labelled as synthetic in every structure that
 * leaves this package. A consumer can therefore tell, field by field, which
 * half of a shipment it is looking at.
 *
 * Two rules the rest of the engine depends on:
 *
 *   1. **Scope is applied here, once.** `scopeMaritimeNetwork` keeps only ports
 *      on islands the run selected and only links whose *both* ends survive
 *      that filter. A one-island run therefore gets an empty network, and no
 *      code downstream has to remember to re-check the scope.
 *   2. **No link is ever invented.** If two in-scope islands have no published
 *      connection between them, there is no route, and a cross-island need that
 *      would have used one is recorded as `NO_PUBLIC_ROUTE` rather than served
 *      over a line this file made up.
 */

import type { GeoPoint } from './types.js';
import networkData from '../../data/caribbean-maritime-network.v1.json' with { type: 'json' };

// ---------------------------------------------------------------------------
// The reviewed dataset, as it is on disk.
// ---------------------------------------------------------------------------

/** Source, licence and retrieval metadata carried by every public reference. */
export interface MaritimeReference {
  source: { title: string; url: string; publisher: string };
  licence: string;
  /** ISO-8601 calendar date the record was retrieved or re-verified. */
  retrievedAt: string;
  geography: string;
  evidenceType: 'PUBLIC_REFERENCE';
}

export interface MaritimePort {
  id: string;
  name: string;
  islandId: string;
  latitude: number;
  longitude: number;
  portType: string;
  reference: MaritimeReference;
}

export interface MaritimeLink {
  id: string;
  fromPortId: string;
  toPortId: string;
  mode: string;
  operator: string;
  /**
   * Journey time in hours as the operator publishes it, or null where no
   * primary timetable could be retrieved. A null is a gap in the evidence, and
   * `seaLegHours` below substitutes a labelled synthetic default rather than
   * quietly inventing a published figure.
   */
  typicalJourneyHours: number | null;
  reference: MaritimeReference;
}

export interface MaritimeExchangeRate {
  currency: string;
  name: string;
  regime: string;
  islandIds: string[];
  unitsPerUSD: number;
  unitsPerXCD: number;
  reference: MaritimeReference;
}

export interface MaritimeNetworkFile {
  version: string;
  generatedAt: string;
  notes: string[];
  ports: MaritimePort[];
  links: MaritimeLink[];
  exchangeRates: { baseCurrencies: string[]; asOf: string; rates: MaritimeExchangeRate[] };
}

/** The whole reviewed dataset, before any run scope is applied. */
export const MARITIME_NETWORK_V1 = networkData as unknown as MaritimeNetworkFile;

/** The comparison currency every cross-island price is also expressed in. */
export const COMPARISON_CURRENCY = 'XCD';

// ---------------------------------------------------------------------------
// SYNTHETIC assumptions. None of these is in the dataset, and none of them is
// evidence of anything. Each is a demonstration figure with its reasoning.
// ---------------------------------------------------------------------------

/**
 * How much produce one sailing will carry for Harvest.
 *
 * SYNTHETIC. No operator publishes a produce allocation per sailing, and a
 * passenger ferry's deck cargo allowance is not a public figure. A few pallets'
 * worth is the order of magnitude a smallholder consolidation would plausibly
 * get on a scheduled boat, and it is small enough that capacity actually binds
 * on a large order rather than being decorative.
 */
export const SAILING_CAPACITY_KG = 900;

/**
 * Sea-leg duration used when the operator published none.
 *
 * SYNTHETIC. Every link in the dataset that carries a published figure uses it;
 * this only ever stands in for a `typicalJourneyHours: null`, and the leg says
 * so in `journeyHoursSource` so a reader can tell the two apart.
 */
export const SYNTHETIC_SEA_LEG_HOURS = 3;

/** Loading and unloading at each port, per call. SYNTHETIC. */
export const PORT_HANDLING_HOURS = 0.75;

/**
 * Chance a scheduled sailing does not deliver its cargo at all.
 *
 * SYNTHETIC. Stands for the whole family of reasons a small consignment misses
 * a boat or is landed unusable: it was bumped for passenger baggage, the vessel
 * was withdrawn, the cold chain broke on deck. Deliberately non-trivial, so a
 * run that leans on shipping pays for the risk it is taking.
 */
export const SAILING_FAILURE_PROBABILITY = 0.08;

/**
 * The synthetic customs checkpoint.
 *
 * **This is not a legal customs model.** It is a documentation check with a
 * seeded inspection delay and a fixed cost line, present so that a cross-island
 * delivery is visibly slower and dearer than a local one and so the interface
 * has somewhere honest to say "cleared" or "still at the border". It encodes no
 * real tariff schedule, no phytosanitary rule, no CARICOM instrument, and no
 * territory's actual procedure.
 */
export const CUSTOMS_BASE_DELAY_HOURS = 2;
export const CUSTOMS_INSPECTION_PROBABILITY = 0.3;
export const CUSTOMS_INSPECTION_EXTRA_HOURS = 6;
/** Fixed per-shipment clearance cost, in XCD. SYNTHETIC. */
export const CUSTOMS_FIXED_FEE_XCD = 75;
/** Freight charged per kilogram carried, in XCD. SYNTHETIC. */
export const FREIGHT_PER_KG_XCD = 1.8;

export const CUSTOMS_DISCLAIMER =
  'Synthetic checkpoint, not a legal customs model. Documentation, inspection, delay and cost are ' +
  'demonstration assumptions and encode no real tariff, phytosanitary rule or territory procedure.';

export const MARITIME_SYNTHETIC_DISCLAIMER =
  'Ports, links and exchange rates are public references with sources and licences. Schedules, ' +
  'capacities, prices, customs behaviour, failure and every operational outcome are SYNTHETIC.';

// ---------------------------------------------------------------------------
// Scoping
// ---------------------------------------------------------------------------

/**
 * The maritime network a run may actually use.
 *
 * Built once per run from the island scope. Empty `links` is the normal and
 * correct answer for a one-island run, and for any scope whose islands the
 * dataset records no published connection between.
 */
export interface ScopedMaritimeNetwork {
  /** Dataset version, so a replay can say which revision it was built from. */
  version: string;
  generatedAt: string;
  islandIds: readonly string[];
  ports: readonly MaritimePort[];
  /** Links whose both ends are in scope. Never inferred, never invented. */
  links: readonly MaritimeLink[];
  /** Rates for the currencies the in-scope islands use, plus the comparison currency. */
  rates: readonly MaritimeExchangeRate[];
  ratesAsOf: string;
}

/**
 * Restricts the reviewed dataset to one run's island scope.
 *
 * A link survives only when both of its ports survive, which is what makes "a
 * two-island run never routes through a third island" a property of the data
 * the engine is handed rather than a check the engine has to remember.
 */
export function scopeMaritimeNetwork(
  islandIds: readonly string[],
  file: MaritimeNetworkFile = MARITIME_NETWORK_V1,
): ScopedMaritimeNetwork {
  const inScope = new Set(islandIds);
  const ports = file.ports.filter((port) => inScope.has(port.islandId)).sort((a, b) => a.id.localeCompare(b.id));
  const portIds = new Set(ports.map((port) => port.id));
  const links = file.links
    .filter((link) => portIds.has(link.fromPortId) && portIds.has(link.toPortId))
    .sort((a, b) => a.id.localeCompare(b.id));
  const rates = file.exchangeRates.rates
    .filter((rate) => rate.currency === COMPARISON_CURRENCY || rate.islandIds.some((islandId) => inScope.has(islandId)))
    .sort((a, b) => a.currency.localeCompare(b.currency));

  return {
    version: file.version,
    generatedAt: file.generatedAt,
    islandIds: [...islandIds].sort(),
    ports,
    links,
    rates,
    ratesAsOf: file.exchangeRates.asOf,
  };
}

/** Every port on one island, in a stable order. */
export function portsForIsland(network: ScopedMaritimeNetwork, islandId: string): MaritimePort[] {
  return network.ports.filter((port) => port.islandId === islandId);
}

export function findPort(network: ScopedMaritimeNetwork, portId: string): MaritimePort | null {
  return network.ports.find((port) => port.id === portId) ?? null;
}

/** One usable sailing between two islands: a link plus the direction it is taken in. */
export interface MaritimeRoute {
  linkId: string;
  originPortId: string;
  destinationPortId: string;
  originIslandId: string;
  destinationIslandId: string;
  operator: string;
  mode: string;
  /** Hours used for the sea leg, published or synthetic. */
  seaLegHours: number;
  journeyHoursSource: 'PUBLIC_TIMETABLE' | 'SYNTHETIC_DEFAULT';
  reference: MaritimeReference;
}

/** Hours to use for a link's sea leg, and whether that figure was published. */
export function seaLegHours(link: MaritimeLink): { hours: number; source: MaritimeRoute['journeyHoursSource'] } {
  return link.typicalJourneyHours === null
    ? { hours: SYNTHETIC_SEA_LEG_HOURS, source: 'SYNTHETIC_DEFAULT' }
    : { hours: link.typicalJourneyHours, source: 'PUBLIC_TIMETABLE' };
}

/**
 * Every published sailing from one island to another, in a stable order.
 *
 * Direct links only. The dataset's links are undirected scheduled services, so
 * each is offered in both directions, but nothing here chains two links into a
 * transhipment: a two-hop itinerary is a produce service claim that no source
 * supports, and the issue is explicit that route existence proves nothing about
 * a produce service. Returns an empty array when no link connects the pair,
 * which is the answer that produces `NO_PUBLIC_ROUTE`.
 */
export function routesBetween(
  network: ScopedMaritimeNetwork,
  originIslandId: string,
  destinationIslandId: string,
): MaritimeRoute[] {
  if (originIslandId === destinationIslandId) return [];
  const portIsland = new Map(network.ports.map((port) => [port.id, port.islandId] as const));
  const routes: MaritimeRoute[] = [];

  for (const link of network.links) {
    const fromIsland = portIsland.get(link.fromPortId);
    const toIsland = portIsland.get(link.toPortId);
    if (fromIsland === undefined || toIsland === undefined) continue;
    const { hours, source } = seaLegHours(link);

    if (fromIsland === originIslandId && toIsland === destinationIslandId) {
      routes.push({
        linkId: link.id,
        originPortId: link.fromPortId,
        destinationPortId: link.toPortId,
        originIslandId: fromIsland,
        destinationIslandId: toIsland,
        operator: link.operator,
        mode: link.mode,
        seaLegHours: hours,
        journeyHoursSource: source,
        reference: link.reference,
      });
    } else if (toIsland === originIslandId && fromIsland === destinationIslandId) {
      routes.push({
        linkId: link.id,
        originPortId: link.toPortId,
        destinationPortId: link.fromPortId,
        originIslandId: toIsland,
        destinationIslandId: fromIsland,
        operator: link.operator,
        mode: link.mode,
        seaLegHours: hours,
        journeyHoursSource: source,
        reference: link.reference,
      });
    }
  }

  return routes.sort((a, b) => a.seaLegHours - b.seaLegHours || a.linkId.localeCompare(b.linkId) || a.originPortId.localeCompare(b.originPortId));
}

/** The shortest published sailing between two islands, or null if there is none. */
export function bestRouteBetween(
  network: ScopedMaritimeNetwork,
  originIslandId: string,
  destinationIslandId: string,
): MaritimeRoute | null {
  return routesBetween(network, originIslandId, destinationIslandId)[0] ?? null;
}

/** Islands reachable from one island by a single published sailing, in scope. */
export function reachableIslandIds(network: ScopedMaritimeNetwork, islandId: string): string[] {
  const portIsland = new Map(network.ports.map((port) => [port.id, port.islandId] as const));
  const reachable = new Set<string>();
  for (const link of network.links) {
    const fromIsland = portIsland.get(link.fromPortId);
    const toIsland = portIsland.get(link.toPortId);
    if (fromIsland === undefined || toIsland === undefined || fromIsland === toIsland) continue;
    if (fromIsland === islandId) reachable.add(toIsland);
    if (toIsland === islandId) reachable.add(fromIsland);
  }
  reachable.delete(islandId);
  return [...reachable].sort();
}

export function portPosition(port: MaritimePort): GeoPoint {
  return { latitude: port.latitude, longitude: port.longitude };
}

// ---------------------------------------------------------------------------
// Currency
// ---------------------------------------------------------------------------

/**
 * One money value stated twice: in the local currency and in the comparison
 * currency, with the rate that connects them and where that rate came from.
 *
 * Both halves are carried rather than one converted on demand, because the
 * conversion is a claim about a specific published rate on a specific date, and
 * a consumer that only receives a number cannot say which rate produced it.
 */
export interface DualCurrencyAmount {
  /** Value in the island's own currency. */
  localAmount: number;
  localCurrency: string;
  /** The same value in XCD. */
  comparisonAmount: number;
  comparisonCurrency: string;
  /** Units of the local currency per one XCD, from the dataset. */
  unitsPerComparisonCurrency: number;
  /** The published rate is a public reference; the amount it converts is synthetic. */
  rateProvenance: 'PUBLIC_REFERENCE';
  amountProvenance: 'SYNTHETIC';
  rateAsOf: string;
  rateSource: MaritimeReference;
}

export function findRate(network: ScopedMaritimeNetwork, currency: string): MaritimeExchangeRate | null {
  return network.rates.find((rate) => rate.currency === currency) ?? null;
}

/**
 * Expresses an XCD amount in one island's currency as well.
 *
 * Every synthetic price in this package is authored in XCD, because XCD is the
 * comparison currency the dataset is built around and because authoring in one
 * currency keeps the conversion in exactly one direction. Returns null when the
 * scope carries no rate for that currency, which a caller must handle rather
 * than defaulting to parity.
 */
export function toDualCurrency(
  network: ScopedMaritimeNetwork,
  amountXcd: number,
  localCurrency: string,
): DualCurrencyAmount | null {
  const rate = findRate(network, localCurrency);
  if (!rate) return null;
  return {
    localAmount: Number((amountXcd * rate.unitsPerXCD).toFixed(2)),
    localCurrency,
    comparisonAmount: Number(amountXcd.toFixed(2)),
    comparisonCurrency: COMPARISON_CURRENCY,
    unitsPerComparisonCurrency: rate.unitsPerXCD,
    rateProvenance: 'PUBLIC_REFERENCE',
    amountProvenance: 'SYNTHETIC',
    rateAsOf: network.ratesAsOf,
    rateSource: rate.reference,
  };
}

// ---------------------------------------------------------------------------
// Shipment cost
// ---------------------------------------------------------------------------

/** The synthetic cost of moving one consignment, itemised. */
export interface ShipmentCostLines {
  freightXcd: number;
  customsFeeXcd: number;
  totalXcd: number;
}

export function shipmentCostXcd(quantityKg: number): ShipmentCostLines {
  const freightXcd = Number((quantityKg * FREIGHT_PER_KG_XCD).toFixed(2));
  const customsFeeXcd = CUSTOMS_FIXED_FEE_XCD;
  return { freightXcd, customsFeeXcd, totalXcd: Number((freightXcd + customsFeeXcd).toFixed(2)) };
}

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

/** One source line for the reference attribution an interface has to show. */
export interface MaritimeAttribution {
  label: string;
  sourceUrl: string;
  publisher: string;
  licence: string;
  retrievedAt: string;
}

/**
 * Distinct source lines for everything in a scoped network.
 *
 * Deduplicated on publisher and licence rather than on individual record, so a
 * whole-Caribbean scope produces a handful of lines rather than sixty.
 */
export function maritimeAttributions(network: ScopedMaritimeNetwork): MaritimeAttribution[] {
  const byKey = new Map<string, MaritimeAttribution>();
  const add = (reference: MaritimeReference, label: string): void => {
    const key = `${reference.source.publisher}|${reference.licence}`;
    if (byKey.has(key)) return;
    byKey.set(key, {
      label,
      sourceUrl: reference.source.url,
      publisher: reference.source.publisher,
      licence: reference.licence,
      retrievedAt: reference.retrievedAt,
    });
  };
  for (const port of network.ports) add(port.reference, 'Ports');
  for (const link of network.links) add(link.reference, 'Ferry and cargo links');
  for (const rate of network.rates) add(rate.reference, 'Exchange rates');
  return [...byKey.values()].sort((a, b) => a.publisher.localeCompare(b.publisher));
}
