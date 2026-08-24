/**
 * Refresh the reviewed, offline Caribbean reference-place snapshot.
 *
 * This is a maintainer command, never a runtime dependency. It resolves each
 * manifest area's public boundary and named features through OpenStreetMap's
 * Nominatim service, removes neighbouring-area results with the returned
 * boundary geometry, and writes only the allow-listed fields used by the
 * simulation. Review the generated diff before committing it.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARIBBEAN_ISLANDS_V1 } from '../src/scenario/caribbean-islands-manifest-v1.js';

const USER_AGENT = 'Harvest-Hackathon/1.0 (offline reference-data refresh; https://github.com/Xuanming-Guo/Harvest-Future-Caribbean)';
const RETRIEVED_AT = '2026-08-24';
const OUTPUT = fileURLToPath(new URL('../src/scenario/caribbean-reference-places-v1.data.ts', import.meta.url));
const CACHE = join(tmpdir(), `harvest-reference-places-${RETRIEVED_AT}.json`);
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const BOUNDARY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  'bonaire-sint-eustatius-saba': ['Bonaire', 'Sint Eustatius', 'Saba'],
  'saint-martin-french-part': ['Collectivité de Saint-Martin'],
  'sint-maarten-dutch-part': ['Sint Maarten'],
};
const SEARCH_FALLBACKS: Readonly<Record<string, readonly string[]>> = {
  'british-virgin-islands': ['Road Town, British Virgin Islands'],
  'cayman-islands': ['George Town, Cayman Islands'],
  cuba: ['Havana, Cuba'],
  curacao: ['Willemstad, Curaçao'],
  dominica: ['Roseau, Dominica'],
  'dominican-republic': ['Santo Domingo, Dominican Republic'],
  grenada: ["St. George's, Grenada"],
  guadeloupe: ['Pointe-à-Pitre, Guadeloupe'],
  haiti: ['Port-au-Prince, Haiti'],
  jamaica: ['Kingston, Jamaica'],
  martinique: ['Fort-de-France, Martinique'],
  montserrat: ['Brades, Montserrat'],
  'puerto-rico': ['San Juan, Puerto Rico'],
  'saint-barthelemy': ['Gustavia, Saint Barthélemy'],
  'saint-kitts-nevis': ['Basseterre, Saint Kitts and Nevis'],
  'saint-lucia': ['Castries, Saint Lucia'],
  'saint-martin-french-part': ['Marigot, Saint Martin'],
  'saint-vincent-grenadines': ['Kingstown, Saint Vincent and the Grenadines'],
  'sint-maarten-dutch-part': ['Philipsburg, Sint Maarten'],
  'trinidad-tobago': ['Port of Spain, Trinidad and Tobago'],
  'turks-caicos-islands': ['Providenciales, Turks and Caicos Islands'],
  'united-states-virgin-islands': ['Charlotte Amalie, United States Virgin Islands'],
};

type Category = 'AGRICULTURAL_AREA' | 'HOTEL_RESORT' | 'RESTAURANT' | 'SUPERMARKET_MARKET' | 'PORT_FERRY_TERMINAL';
type EvidenceType = 'PUBLIC_REFERENCE_POINT' | 'PUBLIC_FEATURE_CENTROID' | 'APPROXIMATE_PUBLIC_AREA_CENTROID';
type Position = { latitude: number; longitude: number };
type Ring = number[][];
type Geometry = { type: 'Polygon'; coordinates: Ring[] } | { type: 'MultiPolygon'; coordinates: Ring[][] };

interface NominatimResult {
  place_id: number;
  osm_type: string;
  osm_id: number;
  addresstype: string;
  name: string;
  display_name: string;
  category: string;
  type: string;
  lat: string;
  lon: string;
  boundingbox: [string, string, string, string];
  geojson?: Geometry;
}

interface Candidate {
  islandId: string;
  referencePlaceId: string;
  name: string;
  category: Category;
  position: Position;
  sourceId: 'openstreetmap-v1';
  sourceFeatureId: string;
  sourceUrl: string;
  sourceRevision: string;
  retrievedAt: string;
  evidenceType: EvidenceType;
  warnings: string[];
}

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function fetchJson<T>(url: string, timeoutMs = 120_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: controller.signal });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.json() as T;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveBoundaries(islandId: string, name: string, countryCode: string): Promise<NominatimResult[]> {
  const boundaries: NominatimResult[] = [];
  for (const boundaryName of BOUNDARY_ALIASES[islandId] ?? [name]) {
    const parameters = new URLSearchParams({
      q: boundaryName,
      format: 'jsonv2',
      polygon_geojson: '1',
      limit: '10',
    });
    const results = await fetchJson<NominatimResult[]>(`${NOMINATIM}?${parameters}`);
    const administrative = results.filter((item) => item.osm_type === 'relation'
      && item.geojson
      && item.category === 'boundary'
      && item.type === 'administrative');
    const normalize = (value: string) => value.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase();
    const exact = administrative.filter((item) => normalize(item.name) === normalize(boundaryName));
    boundaries.push(...(exact.length ? exact : administrative));
    await sleep(1_100);
  }
  if (!boundaries.length) throw new Error(`No reusable OSM boundary resolved for ${name} (${countryCode}).`);
  return boundaries.filter((item, index, all) => all.findIndex((candidate) => candidate.osm_id === item.osm_id) === index);
}

function pointInRing(point: Position, ring: Ring): boolean {
  let inside = false;
  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current, current += 1) {
    const a = ring[current];
    const b = ring[previous];
    if (!a || !b) continue;
    const [ax, ay] = a;
    const [bx, by] = b;
    if (ax === undefined || ay === undefined || bx === undefined || by === undefined) continue;
    const intersects = (ay > point.latitude) !== (by > point.latitude)
      && point.longitude < ((bx - ax) * (point.latitude - ay)) / (by - ay) + ax;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInGeometry(point: Position, geometry: Geometry): boolean {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some((polygon) => {
    const outer = polygon[0];
    if (!outer || !pointInRing(point, outer)) return false;
    return !polygon.slice(1).some((hole) => pointInRing(point, hole));
  });
}

const SEARCHES: readonly { phrase: string; category: Category; matches: (item: NominatimResult) => boolean }[] = [
  { phrase: 'farm', category: 'AGRICULTURAL_AREA', matches: (item) => item.type === 'farm' || item.type === 'farmland' || item.type === 'farmyard' },
  { phrase: 'hotel', category: 'HOTEL_RESORT', matches: (item) => item.category === 'tourism' && item.type === 'hotel' },
  { phrase: 'resort', category: 'HOTEL_RESORT', matches: (item) => item.category === 'tourism' && item.type === 'resort' },
  { phrase: 'restaurant', category: 'RESTAURANT', matches: (item) => item.category === 'amenity' && item.type === 'restaurant' },
  { phrase: 'supermarket', category: 'SUPERMARKET_MARKET', matches: (item) => item.category === 'shop' && item.type === 'supermarket' },
  { phrase: 'marketplace', category: 'SUPERMARKET_MARKET', matches: (item) => item.category === 'amenity' && item.type === 'marketplace' },
  { phrase: 'ferry terminal', category: 'PORT_FERRY_TERMINAL', matches: (item) => item.category === 'amenity' && item.type === 'ferry_terminal' },
  { phrase: 'port', category: 'PORT_FERRY_TERMINAL', matches: (item) => item.type === 'port' || item.type === 'harbour' },
];

function referencePlaceIdFor(islandId: string, sourceFeatureId: string): string {
  return `osm-${islandId}-${sourceFeatureId.replace('/', '-')}`;
}

function candidateFrom(islandId: string, category: Category, element: NominatimResult): Candidate | null {
  const latitude = Number(element.lat);
  const longitude = Number(element.lon);
  const name = element.name?.trim();
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !name || name.length < 2) return null;
  const sourceFeatureId = `${element.osm_type}/${element.osm_id}`;
  const isAgriculture = category === 'AGRICULTURAL_AREA';
  return {
    islandId,
    referencePlaceId: referencePlaceIdFor(islandId, sourceFeatureId),
    name,
    category,
    position: { latitude: Number(latitude.toFixed(7)), longitude: Number(longitude.toFixed(7)) },
    sourceId: 'openstreetmap-v1',
    sourceFeatureId,
    sourceUrl: `https://www.openstreetmap.org/${sourceFeatureId}`,
    sourceRevision: `nominatim-place-${element.place_id}@${RETRIEVED_AT}`,
    retrievedAt: RETRIEVED_AT,
    evidenceType: isAgriculture
      ? 'APPROXIMATE_PUBLIC_AREA_CENTROID'
      : element.osm_type === 'node' ? 'PUBLIC_REFERENCE_POINT' : 'PUBLIC_FEATURE_CENTROID',
    warnings: [isAgriculture
      ? 'Approximate centroid of a public agricultural feature; not a private farm address.'
      : 'Public reference location; no Harvest participation or endorsement is implied.'],
  };
}

async function fetchCandidates(islandId: string, names: readonly string[], countryCode: string, boundaries: NominatimResult[]): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  for (const name of names) {
    for (const search of SEARCHES) {
      const parameters = new URLSearchParams({
        q: `${search.phrase} in ${name}`,
        countrycodes: countryCode.toLowerCase(),
        format: 'jsonv2',
        limit: '20',
      });
      let results = await fetchJson<NominatimResult[]>(`${NOMINATIM}?${parameters}`);
      await sleep(1_100);
      // A few Caribbean territory codes are not indexed as Nominatim country
      // codes. Exact boundary filtering below remains authoritative for those.
      if (!results.length) {
        parameters.delete('countrycodes');
        results = await fetchJson<NominatimResult[]>(`${NOMINATIM}?${parameters}`);
        await sleep(1_100);
      }
      for (const result of results) {
        if (!search.matches(result)) continue;
        const candidate = candidateFrom(islandId, search.category, result);
        if (candidate && boundaries.some((boundary) => boundary.geojson && pointInGeometry(candidate.position, boundary.geojson))) candidates.push(candidate);
      }
    }
  }
  return candidates;
}

function distanceSquared(a: Position, b: Position): number {
  const latitudeScale = Math.cos(((a.latitude + b.latitude) / 2) * Math.PI / 180);
  return (a.latitude - b.latitude) ** 2 + ((a.longitude - b.longitude) * latitudeScale) ** 2;
}

function chooseFarthest(candidates: Candidate[], selected: Candidate[]): Candidate | undefined {
  if (!candidates.length) return undefined;
  if (!selected.length) return [...candidates].sort((a, b) => a.referencePlaceId.localeCompare(b.referencePlaceId))[0];
  return [...candidates].sort((a, b) => {
    const aDistance = Math.min(...selected.map((item) => distanceSquared(a.position, item.position)));
    const bDistance = Math.min(...selected.map((item) => distanceSquared(b.position, item.position)));
    return bDistance - aDistance || a.referencePlaceId.localeCompare(b.referencePlaceId);
  })[0];
}

function selectPlaces(candidates: Candidate[]): Candidate[] {
  const categoryCaps: Record<Category, number> = {
    AGRICULTURAL_AREA: 5,
    HOTEL_RESORT: 5,
    RESTAURANT: 4,
    SUPERMARKET_MARKET: 4,
    PORT_FERRY_TERMINAL: 2,
  };
  const categories = Object.keys(categoryCaps) as Category[];
  const unique = candidates.filter((candidate, index, all) => {
    const normalized = candidate.name.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase();
    return all.findIndex((other) => other.category === candidate.category
      && other.name.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase() === normalized) === index;
  });
  const remaining = new Map(categories.map((category) => [category, unique.filter((item) => item.category === category)]));
  const selected: Candidate[] = [];

  while (selected.length < 20) {
    let added = false;
    for (const category of categories) {
      if (selected.length >= 20 || selected.filter((item) => item.category === category).length >= categoryCaps[category]) continue;
      const pool = remaining.get(category) ?? [];
      const next = chooseFarthest(pool, selected);
      if (!next) continue;
      selected.push(next);
      remaining.set(category, pool.filter((item) => item.referencePlaceId !== next.referencePlaceId));
      added = true;
    }
    if (!added) break;
  }
  return selected.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name) || a.referencePlaceId.localeCompare(b.referencePlaceId));
}

function render(catalogue: Candidate[]): string {
  const json = JSON.stringify(catalogue, null, 2);
  return `/**\n * Generated by scripts/refresh-reference-places.ts from the reviewed\n * OpenStreetMap snapshot retrieved ${RETRIEVED_AT}. Review every refresh diff.\n */\n\nimport type { ReferencePlace } from '../world/types.js';\n\nexport const CARIBBEAN_REFERENCE_PLACES_V1 = ${json} as const satisfies readonly ReferencePlace[];\n`;
}

const catalogue: Candidate[] = [];
let cached: Record<string, Candidate[]> = {};
try {
  cached = JSON.parse(await readFile(CACHE, 'utf8')) as Record<string, Candidate[]>;
} catch {
  // First refresh on this machine. The cache is disposable and never committed.
}
for (const [index, island] of CARIBBEAN_ISLANDS_V1.entries()) {
  console.log(`[${index + 1}/${CARIBBEAN_ISLANDS_V1.length}] ${island.name}`);
  if (cached[island.islandId]?.length) {
    const normalized = (cached[island.islandId] as Candidate[]).map((candidate) => ({
      ...candidate,
      referencePlaceId: referencePlaceIdFor(island.islandId, candidate.sourceFeatureId),
    }));
    catalogue.push(...normalized);
    cached[island.islandId] = normalized;
    console.log(`  reused ${cached[island.islandId]?.length} validated places from the local refresh cache`);
    continue;
  }
  const boundaries = await resolveBoundaries(island.islandId, island.name, island.countryCode);
  const searchNames = BOUNDARY_ALIASES[island.islandId] ?? [boundaries[0]?.name ?? island.name];
  let candidates = await fetchCandidates(island.islandId, searchNames, island.countryCode, boundaries);
  let selected = selectPlaces(candidates);
  if (selected.length < 8 && SEARCH_FALLBACKS[island.islandId]) {
    candidates = [...candidates, ...await fetchCandidates(island.islandId, SEARCH_FALLBACKS[island.islandId] as readonly string[], island.countryCode, boundaries)];
    selected = selectPlaces(candidates);
  }
  if (selected.length < 8) throw new Error(`${island.name} produced only ${selected.length} valid reference places; do not fabricate the remainder.`);
  catalogue.push(...selected);
  cached[island.islandId] = selected;
  await writeFile(CACHE, JSON.stringify(cached), 'utf8');
  console.log(`  selected ${selected.length} from ${candidates.length} in-boundary candidates`);
  await sleep(2_500);
}

await writeFile(OUTPUT, render(catalogue), 'utf8');
console.log(`Wrote ${catalogue.length} reviewed fields to ${OUTPUT}`);
