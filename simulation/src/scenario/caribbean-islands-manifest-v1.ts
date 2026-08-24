/**
 * Offline, reviewed reference manifest for the regional generator.
 *
 * Coordinates are real settlement reference points; businesses, quantities,
 * weather values and transport assumptions generated from them are synthetic.
 * Sources: UN M49 Caribbean grouping (country/territory identity), IANA tzdb
 * zone1970.tab (timezone identifiers), and ISO 4217/Unicode CLDR (currency and
 * locale). See docs/caribbean-scenario-data.md for retrieval date and limits.
 */

export interface CaribbeanIslandManifest {
  islandId: string;
  name: string;
  countryOrTerritory: string;
  countryCode: string;
  bounds: { west: number; south: number; east: number; north: number };
  camera: { latitude: number; longitude: number; heightKm: number };
  settlements: readonly { name: string; latitude: number; longitude: number }[];
  timeZone: string;
  currency: string;
  locale: string;
  crops: readonly string[];
  weatherProfile: 'WET_TROPICAL' | 'SEASONAL_TROPICAL';
  roadWindingFactor: number;
  provenance: 'REFERENCE_GEOGRAPHY_WITH_SYNTHETIC_OPERATIONS';
  warnings: readonly string[];
}

const reference = 'REFERENCE_GEOGRAPHY_WITH_SYNTHETIC_OPERATIONS' as const;
const island = (islandId: string, name: string, countryOrTerritory: string, countryCode: string, latitude: number, longitude: number, timeZone: string, currency: string, locale: string, crops: readonly string[]): CaribbeanIslandManifest => ({
  islandId, name, countryOrTerritory, countryCode,
  bounds: { west: longitude - 0.42, south: latitude - 0.26, east: longitude + 0.42, north: latitude + 0.26 },
  camera: { latitude, longitude, heightKm: 180 },
  settlements: [{ name: `${name} main settlement`, latitude, longitude }, { name: `${name} rural market`, latitude: latitude - 0.055, longitude: longitude + 0.07 }],
  timeZone, currency, locale, crops, weatherProfile: 'WET_TROPICAL', roadWindingFactor: 1.35,
  provenance: reference,
  warnings: ['Settlement coordinates are reference points; synthetic actors are deliberately not real businesses.', 'Weather, yields, prices, speeds and disruptions are synthetic demonstration assumptions.'],
});

export const CARIBBEAN_ISLANDS_V1: readonly CaribbeanIslandManifest[] = [
  island('anguilla', 'Anguilla', 'Anguilla', 'AI', 18.2206, -63.0686, 'America/Anguilla', 'XCD', 'en-AI', ['cucumber', 'okra']),
  island('antigua-barbuda', 'Antigua and Barbuda', 'Antigua and Barbuda', 'AG', 17.1274, -61.8468, 'America/Antigua', 'XCD', 'en-AG', ['cucumber', 'tomato']),
  island('barbados', 'Barbados', 'Barbados', 'BB', 13.0975, -59.6145, 'America/Barbados', 'BBD', 'en-BB', ['cucumber', 'sweet-potato']),
  island('dominica', 'Dominica', 'Dominica', 'DM', 15.3017, -61.3881, 'America/Dominica', 'XCD', 'en-DM', ['cucumber', 'dasheen']),
  island('grenada', 'Grenada', 'Grenada', 'GD', 12.0561, -61.7488, 'America/Grenada', 'XCD', 'en-GD', ['cucumber', 'tomato']),
  island('jamaica', 'Jamaica', 'Jamaica', 'JM', 18.0179, -76.8099, 'America/Jamaica', 'JMD', 'en-JM', ['cucumber', 'yam']),
  island('martinique', 'Martinique', 'Martinique', 'MQ', 14.6037, -61.0742, 'America/Martinique', 'EUR', 'fr-MQ', ['cucumber', 'dasheen']),
  island('montserrat', 'Montserrat', 'Montserrat', 'MS', 16.7425, -62.1874, 'America/Montserrat', 'XCD', 'en-MS', ['cucumber', 'okra']),
  island('saint-lucia', 'Saint Lucia', 'Saint Lucia', 'LC', 13.9094, -60.9789, 'America/St_Lucia', 'XCD', 'en-LC', ['cucumber', 'dasheen']),
  island('saint-kitts-nevis', 'Saint Kitts and Nevis', 'Saint Kitts and Nevis', 'KN', 17.3026, -62.7177, 'America/St_Kitts', 'XCD', 'en-KN', ['cucumber', 'sweet-potato']),
  island('saint-vincent-grenadines', 'Saint Vincent and the Grenadines', 'Saint Vincent and the Grenadines', 'VC', 13.1579, -61.2248, 'America/St_Vincent', 'XCD', 'en-VC', ['cucumber', 'dasheen']),
  island('trinidad-tobago', 'Trinidad and Tobago', 'Trinidad and Tobago', 'TT', 10.6596, -61.5074, 'America/Port_of_Spain', 'TTD', 'en-TT', ['cucumber', 'tomato']),
];

export const CARIBBEAN_ISLAND_IDS = new Set(CARIBBEAN_ISLANDS_V1.map((island) => island.islandId));
export function requireCaribbeanIsland(islandId: string): CaribbeanIslandManifest {
  const island = CARIBBEAN_ISLANDS_V1.find((candidate) => candidate.islandId === islandId);
  if (!island) throw new Error(`Unknown Caribbean island '${islandId}'.`);
  return island;
}
