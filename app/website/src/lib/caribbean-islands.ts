// Public geography from the repository's reviewed Caribbean reference catalogue.
// This file contains no participant locations or simulation runtime dependency.
export interface WorldIsland {
  id: string; name: string; code: string; latitude: number; longitude: number; currency: string; zoom: number;
}
export const WORLD_ISLANDS: readonly WorldIsland[] = [
  {
    "id": "anguilla",
    "name": "Anguilla",
    "code": "AI",
    "latitude": 18.2206,
    "longitude": -63.0686,
    "currency": "XCD",
    "zoom": 10
  },
  {
    "id": "antigua-barbuda",
    "name": "Antigua and Barbuda",
    "code": "AG",
    "latitude": 17.1274,
    "longitude": -61.8468,
    "currency": "XCD",
    "zoom": 10
  },
  {
    "id": "aruba",
    "name": "Aruba",
    "code": "AW",
    "latitude": 12.5092,
    "longitude": -70.0086,
    "currency": "AWG",
    "zoom": 10
  },
  {
    "id": "bahamas",
    "name": "Bahamas",
    "code": "BS",
    "latitude": 25.0478,
    "longitude": -77.3554,
    "currency": "BSD",
    "zoom": 7
  },
  {
    "id": "barbados",
    "name": "Barbados",
    "code": "BB",
    "latitude": 13.0975,
    "longitude": -59.6145,
    "currency": "BBD",
    "zoom": 10
  },
  {
    "id": "bonaire-sint-eustatius-saba",
    "name": "Bonaire, Sint Eustatius and Saba",
    "code": "BQ",
    "latitude": 12.1442,
    "longitude": -68.2667,
    "currency": "USD",
    "zoom": 10
  },
  {
    "id": "british-virgin-islands",
    "name": "British Virgin Islands",
    "code": "VG",
    "latitude": 18.4285,
    "longitude": -64.6185,
    "currency": "USD",
    "zoom": 10
  },
  {
    "id": "cayman-islands",
    "name": "Cayman Islands",
    "code": "KY",
    "latitude": 19.2866,
    "longitude": -81.3744,
    "currency": "KYD",
    "zoom": 10
  },
  {
    "id": "cuba",
    "name": "Cuba",
    "code": "CU",
    "latitude": 23.1136,
    "longitude": -82.3666,
    "currency": "CUP",
    "zoom": 7
  },
  {
    "id": "curacao",
    "name": "Curaçao",
    "code": "CW",
    "latitude": 12.1091,
    "longitude": -68.9315,
    "currency": "ANG",
    "zoom": 10
  },
  {
    "id": "dominica",
    "name": "Dominica",
    "code": "DM",
    "latitude": 15.3017,
    "longitude": -61.3881,
    "currency": "XCD",
    "zoom": 10
  },
  {
    "id": "dominican-republic",
    "name": "Dominican Republic",
    "code": "DO",
    "latitude": 18.4861,
    "longitude": -69.9312,
    "currency": "DOP",
    "zoom": 8
  },
  {
    "id": "grenada",
    "name": "Grenada",
    "code": "GD",
    "latitude": 12.0561,
    "longitude": -61.7488,
    "currency": "XCD",
    "zoom": 10
  },
  {
    "id": "guadeloupe",
    "name": "Guadeloupe",
    "code": "GP",
    "latitude": 16.241,
    "longitude": -61.5331,
    "currency": "EUR",
    "zoom": 10
  },
  {
    "id": "haiti",
    "name": "Haiti",
    "code": "HT",
    "latitude": 18.5944,
    "longitude": -72.3074,
    "currency": "HTG",
    "zoom": 8
  },
  {
    "id": "jamaica",
    "name": "Jamaica",
    "code": "JM",
    "latitude": 18.0179,
    "longitude": -76.8099,
    "currency": "JMD",
    "zoom": 8
  },
  {
    "id": "martinique",
    "name": "Martinique",
    "code": "MQ",
    "latitude": 14.6037,
    "longitude": -61.0742,
    "currency": "EUR",
    "zoom": 10
  },
  {
    "id": "montserrat",
    "name": "Montserrat",
    "code": "MS",
    "latitude": 16.7425,
    "longitude": -62.1874,
    "currency": "XCD",
    "zoom": 10
  },
  {
    "id": "puerto-rico",
    "name": "Puerto Rico",
    "code": "PR",
    "latitude": 18.4655,
    "longitude": -66.1057,
    "currency": "USD",
    "zoom": 9
  },
  {
    "id": "saint-barthelemy",
    "name": "Saint Barthélemy",
    "code": "BL",
    "latitude": 17.8964,
    "longitude": -62.8498,
    "currency": "EUR",
    "zoom": 10
  },
  {
    "id": "saint-kitts-nevis",
    "name": "Saint Kitts and Nevis",
    "code": "KN",
    "latitude": 17.3026,
    "longitude": -62.7177,
    "currency": "XCD",
    "zoom": 10
  },
  {
    "id": "saint-lucia",
    "name": "Saint Lucia",
    "code": "LC",
    "latitude": 13.9094,
    "longitude": -60.9789,
    "currency": "XCD",
    "zoom": 10
  },
  {
    "id": "saint-martin-french-part",
    "name": "Saint Martin (French part)",
    "code": "MF",
    "latitude": 18.0708,
    "longitude": -63.0501,
    "currency": "EUR",
    "zoom": 10
  },
  {
    "id": "saint-vincent-grenadines",
    "name": "Saint Vincent and the Grenadines",
    "code": "VC",
    "latitude": 13.1579,
    "longitude": -61.2248,
    "currency": "XCD",
    "zoom": 10
  },
  {
    "id": "sint-maarten-dutch-part",
    "name": "Sint Maarten (Dutch part)",
    "code": "SX",
    "latitude": 18.0425,
    "longitude": -63.0548,
    "currency": "ANG",
    "zoom": 10
  },
  {
    "id": "trinidad-tobago",
    "name": "Trinidad and Tobago",
    "code": "TT",
    "latitude": 10.6596,
    "longitude": -61.5074,
    "currency": "TTD",
    "zoom": 9
  },
  {
    "id": "turks-caicos-islands",
    "name": "Turks and Caicos Islands",
    "code": "TC",
    "latitude": 21.4612,
    "longitude": -71.1419,
    "currency": "USD",
    "zoom": 10
  },
  {
    "id": "united-states-virgin-islands",
    "name": "United States Virgin Islands",
    "code": "VI",
    "latitude": 18.3419,
    "longitude": -64.9307,
    "currency": "USD",
    "zoom": 10
  }
];

export function workspaceIsland(region: string): WorldIsland | undefined {
  const key = region.trim().toLowerCase().replaceAll("-", " ");
  return WORLD_ISLANDS.find(island => island.name.toLowerCase() === key || island.id.replaceAll("-", " ") === key);
}
