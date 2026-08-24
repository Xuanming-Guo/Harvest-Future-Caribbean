# Caribbean scenario manifest data

`simulation/src/scenario/caribbean-islands-manifest-v1.ts` is the reviewed,
versioned, offline input to `caribbean-islands-v1`. It covers every current
country or area in the UN M49 Caribbean subregion (28 entries as reviewed on
24 August 2026). The demo never queries a third-party geography, weather,
currency, or timezone service at runtime.

## Reference inputs

- **Identity and territory names:** UN Statistics Division M49 Caribbean grouping.
- **Timezone identifiers:** IANA Time Zone Database `zone1970.tab`.
- **Currencies and locales:** ISO 4217/Unicode CLDR reference data.
- **Settlement coordinates:** reviewed geographic reference points for each island's principal settlement and local-market anchor.
- **Crop and climate context:** FAO Caribbean SIDS and horticulture material.

These references were normalised into the manifest on 24 August 2026. Settlement coordinates are not farm, buyer, or private-address coordinates, and crop/climate references support broad categories only—not a production dataset.

## Synthetic boundary and fallbacks

Every business, field, quantity, yield, price, road speed, weather amount,
disruption, and result generated from this manifest is synthetic. It is labelled
as such in the scenario, run result, and control room. Local road distance uses
the manifest winding factor over settlement reference points; it is not a road
network. Missing detailed local data remains a visible warning in the manifest
rather than being represented as measured precision.

Saint Lucia's `saint-lucia-demo-v1` remains the hand-tuned benchmark anchor.
The control room opens the broader regional scenario by default, while keeping
that detailed Saint Lucia recipe selectable. The regional generator treats
M49 areas as independent local systems: no inter-island orders, shipping,
ports, customs, currency conversion, or regional optimisation is simulated.
