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

## Licensed public place snapshot

`simulation/src/scenario/caribbean-reference-places-v1.data.ts` is a second,
versioned offline input. It contains 381 named public OpenStreetMap features
across all 28 manifest areas, with 8 to 20 references per area. It covers five
context categories where the source has suitable named features:

- agricultural areas;
- hotels and resorts;
- restaurants;
- supermarkets and public markets;
- ports and ferry terminals.

The snapshot was retrieved through the public Nominatim search interface on
24 August 2026 and is provided under the Open Data Commons Open Database
License 1.0. The control room always displays `© OpenStreetMap contributors`
with links to the source and licence. Every record carries its source feature
link, retrieval date, indexed place ID and evidence type. It contains no phone
numbers, emails, contact names, reviews, opening hours or scraped Google data.

These places provide map context only. They are not claimed to be customers,
participants, verified trading partners or endorsers of Harvest. Coverage and
tagging are uneven, and a missing category does not mean that an island lacks
that kind of real-world place.

### Refreshing the snapshot

The application never calls OpenStreetMap or Nominatim at runtime. A maintainer
may deliberately rebuild the offline file from the repository root:

```powershell
npm --workspace @harvest/simulation run refresh:reference-places
```

The refresh script rate-limits requests, searches within area boundaries,
keeps only allowlisted categories and safe fields, and writes its disposable
candidate cache to the operating-system temporary directory. Review the
generated diff for names, positions, category quality, duplicates, attribution
and area counts before committing it. A refresh changes the versioned scenario
input and may therefore change deterministic replay values.

## Synthetic boundary and fallbacks

Every business, field, quantity, yield, price, road speed, weather amount,
disruption, and result generated from this manifest is synthetic. It is labelled
as such in the scenario, run result, and control room. Local road distance uses
the manifest winding factor between public reference points or synthetic
fallback points; it is not a road network. Synthetic actors may be positioned
near a compatible public reference and carry its `referencePlaceId`, but retain
generic synthetic names. If an area lacks the required category, placement
falls back to the existing synthetic recipe and the run continues. Missing
detailed local data is never represented as measured precision.

Saint Lucia's `saint-lucia-demo-v1` remains the hand-tuned benchmark anchor.
The control room opens the broader regional scenario by default, while keeping
that detailed Saint Lucia recipe selectable. The regional generator treats
M49 areas as independent local systems: no inter-island orders, shipping,
ports, customs, currency conversion, or regional optimisation is simulated.
