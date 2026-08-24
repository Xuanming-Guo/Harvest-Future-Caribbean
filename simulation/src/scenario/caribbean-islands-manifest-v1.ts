/**
 * Offline, reviewed reference manifest for the regional generator.
 *
 * Coordinates are real settlement reference points; businesses, quantities,
 * weather values and transport assumptions generated from them are synthetic.
 * Sources: UN M49 Caribbean grouping (country/territory identity), IANA tzdb
 * zone1970.tab (timezone identifiers), and ISO 4217/Unicode CLDR (currency and
 * locale). It deliberately contains every current M49 Caribbean country or
 * area, not only the initial Eastern Caribbean demo set. See
 * docs/caribbean-scenario-data.md for retrieval date and limits.
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
  island('aruba', 'Aruba', 'Aruba', 'AW', 12.5092, -70.0086, 'America/Aruba', 'AWG', 'nl-AW', ['cucumber', 'tomato']),
  island('bahamas', 'Bahamas', 'Bahamas', 'BS', 25.0478, -77.3554, 'America/Nassau', 'BSD', 'en-BS', ['cucumber', 'sweet-potato']),
  island('barbados', 'Barbados', 'Barbados', 'BB', 13.0975, -59.6145, 'America/Barbados', 'BBD', 'en-BB', ['cucumber', 'sweet-potato']),
  island('bonaire-sint-eustatius-saba', 'Bonaire, Sint Eustatius and Saba', 'Bonaire, Sint Eustatius and Saba', 'BQ', 12.1442, -68.2667, 'America/Kralendijk', 'USD', 'nl-BQ', ['cucumber', 'okra']),
  island('british-virgin-islands', 'British Virgin Islands', 'British Virgin Islands', 'VG', 18.4285, -64.6185, 'America/Tortola', 'USD', 'en-VG', ['cucumber', 'tomato']),
  island('cayman-islands', 'Cayman Islands', 'Cayman Islands', 'KY', 19.2866, -81.3744, 'America/Cayman', 'KYD', 'en-KY', ['cucumber', 'sweet-potato']),
  island('cuba', 'Cuba', 'Cuba', 'CU', 23.1136, -82.3666, 'America/Havana', 'CUP', 'es-CU', ['cucumber', 'plantain']),
  island('curacao', 'Curaçao', 'Curaçao', 'CW', 12.1091, -68.9315, 'America/Curacao', 'ANG', 'nl-CW', ['cucumber', 'tomato']),
  island('dominica', 'Dominica', 'Dominica', 'DM', 15.3017, -61.3881, 'America/Dominica', 'XCD', 'en-DM', ['cucumber', 'dasheen']),
  island('dominican-republic', 'Dominican Republic', 'Dominican Republic', 'DO', 18.4861, -69.9312, 'America/Santo_Domingo', 'DOP', 'es-DO', ['cucumber', 'plantain']),
  island('grenada', 'Grenada', 'Grenada', 'GD', 12.0561, -61.7488, 'America/Grenada', 'XCD', 'en-GD', ['cucumber', 'tomato']),
  island('guadeloupe', 'Guadeloupe', 'Guadeloupe', 'GP', 16.2410, -61.5331, 'America/Guadeloupe', 'EUR', 'fr-GP', ['cucumber', 'dasheen']),
  island('haiti', 'Haiti', 'Haiti', 'HT', 18.5944, -72.3074, 'America/Port-au-Prince', 'HTG', 'fr-HT', ['cucumber', 'plantain']),
  island('jamaica', 'Jamaica', 'Jamaica', 'JM', 18.0179, -76.8099, 'America/Jamaica', 'JMD', 'en-JM', ['cucumber', 'yam']),
  island('martinique', 'Martinique', 'Martinique', 'MQ', 14.6037, -61.0742, 'America/Martinique', 'EUR', 'fr-MQ', ['cucumber', 'dasheen']),
  island('montserrat', 'Montserrat', 'Montserrat', 'MS', 16.7425, -62.1874, 'America/Montserrat', 'XCD', 'en-MS', ['cucumber', 'okra']),
  island('puerto-rico', 'Puerto Rico', 'Puerto Rico', 'PR', 18.4655, -66.1057, 'America/Puerto_Rico', 'USD', 'es-PR', ['cucumber', 'plantain']),
  island('saint-barthelemy', 'Saint Barthélemy', 'Saint Barthélemy', 'BL', 17.8964, -62.8498, 'America/St_Barthelemy', 'EUR', 'fr-BL', ['cucumber', 'tomato']),
  island('saint-kitts-nevis', 'Saint Kitts and Nevis', 'Saint Kitts and Nevis', 'KN', 17.3026, -62.7177, 'America/St_Kitts', 'XCD', 'en-KN', ['cucumber', 'sweet-potato']),
  island('saint-lucia', 'Saint Lucia', 'Saint Lucia', 'LC', 13.9094, -60.9789, 'America/St_Lucia', 'XCD', 'en-LC', ['cucumber', 'dasheen']),
  island('saint-martin-french-part', 'Saint Martin (French part)', 'Saint Martin (French part)', 'MF', 18.0708, -63.0501, 'America/Marigot', 'EUR', 'fr-MF', ['cucumber', 'tomato']),
  island('saint-vincent-grenadines', 'Saint Vincent and the Grenadines', 'Saint Vincent and the Grenadines', 'VC', 13.1579, -61.2248, 'America/St_Vincent', 'XCD', 'en-VC', ['cucumber', 'dasheen']),
  island('sint-maarten-dutch-part', 'Sint Maarten (Dutch part)', 'Sint Maarten (Dutch part)', 'SX', 18.0425, -63.0548, 'America/Lower_Princes', 'ANG', 'nl-SX', ['cucumber', 'tomato']),
  island('trinidad-tobago', 'Trinidad and Tobago', 'Trinidad and Tobago', 'TT', 10.6596, -61.5074, 'America/Port_of_Spain', 'TTD', 'en-TT', ['cucumber', 'tomato']),
  island('turks-caicos-islands', 'Turks and Caicos Islands', 'Turks and Caicos Islands', 'TC', 21.4612, -71.1419, 'America/Grand_Turk', 'USD', 'en-TC', ['cucumber', 'sweet-potato']),
  island('united-states-virgin-islands', 'United States Virgin Islands', 'United States Virgin Islands', 'VI', 18.3419, -64.9307, 'America/St_Thomas', 'USD', 'en-VI', ['cucumber', 'tomato']),
];

export const CARIBBEAN_ISLAND_IDS = new Set(CARIBBEAN_ISLANDS_V1.map((island) => island.islandId));
export function requireCaribbeanIsland(islandId: string): CaribbeanIslandManifest {
  const island = CARIBBEAN_ISLANDS_V1.find((candidate) => candidate.islandId === islandId);
  if (!island) throw new Error(`Unknown Caribbean island '${islandId}'.`);
  return island;
}
