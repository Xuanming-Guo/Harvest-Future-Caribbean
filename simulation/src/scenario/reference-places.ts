import { CARIBBEAN_REFERENCE_PLACES_V1 } from './caribbean-reference-places-v1.data.js';
import type { ReferenceDataSource, ReferencePlace, ReferencePlaceCategory } from '../world/types.js';

export const CARIBBEAN_REFERENCE_DATA_SOURCES_V1: readonly ReferenceDataSource[] = [{
  sourceId: 'openstreetmap-v1',
  title: 'OpenStreetMap Caribbean reference places snapshot',
  publisher: 'OpenStreetMap contributors',
  sourceUrl: 'https://www.openstreetmap.org/copyright',
  licenceName: 'Open Data Commons Open Database License 1.0',
  licenceUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
  attribution: '© OpenStreetMap contributors',
  retrievedAt: '2026-08-24',
  revision: 'Country-scoped Nominatim snapshot; each place records its indexed place ID and retrieval date.',
  limitations: [
    'Public reference geography can be incomplete, outdated or uneven between territories.',
    'A listed organisation is not a Harvest participant, customer or endorser.',
    'Operational quantities, behaviour and outcomes remain synthetic.',
  ],
}];

export function referencePlacesForIslands(islandIds: readonly string[]): ReferencePlace[] {
  const selected = new Set(islandIds);
  return CARIBBEAN_REFERENCE_PLACES_V1
    .filter((place) => selected.has(place.islandId))
    .map((place) => ({ ...place, position: { ...place.position }, warnings: [...place.warnings] }));
}

export function referenceSourcesForPlaces(places: readonly ReferencePlace[]): ReferenceDataSource[] {
  const sourceIds = new Set(places.map((place) => place.sourceId));
  return CARIBBEAN_REFERENCE_DATA_SOURCES_V1
    .filter((source) => sourceIds.has(source.sourceId))
    .map((source) => ({ ...source, limitations: [...source.limitations] }));
}

export function referencePlacesByCategory(
  places: readonly ReferencePlace[],
  category: ReferencePlaceCategory | readonly ReferencePlaceCategory[],
): ReferencePlace[] {
  const categories = new Set(Array.isArray(category) ? category : [category]);
  return places.filter((place) => categories.has(place.category));
}

export { CARIBBEAN_REFERENCE_PLACES_V1 };
