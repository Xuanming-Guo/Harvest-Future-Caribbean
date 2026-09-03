# Caribbean maritime network — public reference data

`caribbean-maritime-network.v1.json` is a reviewed, versioned, **offline**
input for issue #40 (scoped inter-island trade, shipping and regional
coordination). It is data only — this change adds no application code. It
records three things, each independently sourced and dated:

1. `ports[]` — one or more real ports keyed to the island ids used by
   `simulation/src/scenario/caribbean-islands-v1.ts` (via
   `caribbean-islands-manifest-v1.ts`).
2. `links[]` — real, publicly scheduled ferry connections between those
   ports.
3. `exchangeRates` — fixed/reference conversion rates for every currency
   used by a manifest island, against both XCD and USD.

**A listed port or link is evidence that public transport infrastructure or
a scheduled passenger service exists. It is never proof that a produce
trading service exists on that route.** Capacity, cost, cargo-specific
schedules, customs behaviour, weather delay and every operational outcome
are left to the simulation to synthesise, as `notes` in the JSON file states
explicitly.

## How this was built

Every record carries its own `reference` block (`source.title`,
`source.url`, `source.publisher`, `licence`, `retrievedAt`, `geography`,
`evidenceType: "PUBLIC_REFERENCE"`), mirroring the fields the repository's
existing `caribbean-reference-places-v1.data.ts` snapshot uses (source,
licence, retrieval date, geography, evidence type). Two retrieval dates
appear:

- **2026-08-24** — records reused verbatim from the repository's existing,
  already-reviewed OpenStreetMap snapshot
  (`simulation/src/scenario/caribbean-reference-places-v1.data.ts`). These
  were re-verified to still resolve on 2026-09-03 via the public OSM API
  (`api.openstreetmap.org/api/0.6/<type>/<id>.json`) before being cited here.
- **2026-09-03** — records retrieved fresh for this dataset (islands with no
  usable `PORT_FERRY_TERMINAL` entry in the existing snapshot, plus every
  ferry link and every exchange rate).

Every URL cited below was fetched in this session. Where a fetch failed
(HTTP error or TLS certificate error), that is stated next to the source and
the record was either dropped, replaced with a working alternative source,
or — for numeric fields only — recorded as `null` rather than filled from an
unverified figure.

### Ports (34 records, all 28 manifest islands covered)

Primary source: **OpenStreetMap**, Open Data Commons Open Database License
1.0 (ODbL) — https://opendatacommons.org/licenses/odbl/1-0/ — attribution
`© OpenStreetMap contributors`. Coordinates and names come from the cited
`node`/`way` feature (via the public Nominatim search API,
`nominatim.openstreetmap.org/search`, and confirmed via the OSM element
API). 18 ports reuse a `PORT_FERRY_TERMINAL` entry already in the
repository's reviewed snapshot; 16 ports were freshly resolved this session
for islands the existing snapshot did not cover, or where its only entry was
a private tourist dock rather than a genuine port (Antigua & Barbuda, Aruba,
Barbados, the Bonaire/Saba/St Eustatius trio, British Virgin Islands,
Dominican Republic, Martinique, Montserrat, Saint Lucia, Saint Martin
(French part), St Kitts' Port Zante, Scarborough (Tobago), and St
Thomas/Charlotte Amalie (USVI)).

**One exception:** Haiti. No Nominatim query (tried under several names —
the port authority, "Terminal Varreux", "Port de Port-au-Prince", a bounded
search for "port" near the harbour) returned a cleanly tagged port/harbour
feature, and UN/LOCODE's page (`service.unece.org/trade/locode/ht.htm`)
returned **HTTP 403** to automated fetches. The Haiti port record instead
cites Wikipedia's dedicated article, **"Port international de
Port-au-Prince"**
(https://en.wikipedia.org/wiki/Port_international_de_Port-au-Prince),
licensed CC BY-SA 4.0, which states coordinates of 18°33′N 72°21′W — lower
precision than every OSM-sourced port in this file, and flagged as such in
its `reference.geography` field.

A few reused/new OSM features carry a tag that does not exactly match
"port" (e.g. Bonaire's Town Pier is `highway=service`; Saba's Fort Bay
Harbour is `natural=water`; St Eustatius's Gallows Bay is `natural=bay`;
several are port-authority office buildings, `office=government`). Each
such case is called out individually in that port's own
`reference.geography` field rather than silently treated as a precise
point-feature citation.

### Links (13 records)

- **FRS Express des Îles** (formerly branded L'Express des Îles) —
  https://www.frs-express.com/ — the operator named in the issue. Its own
  timetable pages give explicit non-stop leg durations: Guadeloupe–Dominica
  2h30, Dominica–Martinique 2h15, Martinique–Saint Lucia 1h30. The network
  is a chain (Guadeloupe–Dominica–Martinique–Saint Lucia), not a complete
  graph — the only published Guadeloupe–Martinique figure bundles a Dominica
  stopover, so no direct Guadeloupe–Martinique link is asserted.
- **Makana Ferry Service** — https://makanaferryservice.com/ — connects
  Sint Maarten (Philipsburg), Saba (Fort Bay), St Eustatius (Gallows Bay)
  and St Kitts (Port Zante), with all six pairwise journey times stated on
  the operator's own site. This is the strongest-sourced cluster in the
  file.
- **Anguilla ↔ Saint Martin (French part)** — confirmed by the Anguilla Air
  & Sea Ports Authority's own page (https://anguillaports.com/bpft/) and
  frequency by the Anguilla Tourist Board
  (https://ivisitanguilla.com/getting-to-anguilla/); no source stated a
  crossing duration, so `typicalJourneyHours` is `null` (an informal ~20
  minutes appears on travel-aggregator sites only, and was not used). The
  same government source also describes an Anguilla–Sint Maarten (Dutch
  side, Simpson Bay) charter link, but no distinct, cleanly identifiable
  Simpson Bay port feature could be resolved in this session, so that link
  was not added rather than pointing it at the wrong dock.
- **British Virgin Islands ↔ United States Virgin Islands** — daily service
  and operators confirmed via the BVI Tourist Board
  (https://www.bvitourism.com/ferry-schedules); the ~30-minute crossing time
  comes from a dedicated schedule-aggregation site (viferries.com), not one
  operator's own page — a slightly lower confidence tier, noted in the
  record.
- **Trinidad ↔ Tobago** (intra-territory) and **St Kitts ↔ Nevis**
  (intra-territory) — both real, both government/multi-operator scheduled
  services, included because they are genuine public infrastructure, but
  both ends share one manifest island id, so they are not "inter-island" in
  the scope-gating sense issue #40 cares about. `ttitferry.com` and
  `patnt.com` both returned **TLS certificate errors** to automated fetch;
  secondary sources agree on an approximate range (~2.5–3.5h fast ferry,
  ~6–7h cargo vessel) but `typicalJourneyHours` is left `null` because no
  primary timetable page was successfully retrieved. St Kitts–Nevis's
  15-minute figure (Sea Bridge car ferry) is corroborated by NASPA/Nevis
  Tourism Authority pages but not a single canonical timetable, so it is
  used but flagged at a lower confidence tier.

**Islands with no outgoing public-reference link found (16 of 28):** Antigua
and Barbuda, Aruba, the Bahamas, Barbados, the Cayman Islands, Cuba,
Curaçao, the Dominican Republic, Grenada, Haiti, Jamaica, Montserrat, Puerto
Rico, Saint Barthélemy, Saint Vincent and the Grenadines, and the Turks and
Caicos Islands. This reflects what a public search could verify in this
session — not proof that no real service exists. In particular,
container/feeder-line cargo operators
(Tropical Shipping, Crowley, Seaboard Marine and similar) plainly move
freight throughout the region, but none publishes a point-to-point,
island-to-island timetable in a form that could be verified here, so no
cargo link is asserted anywhere in this file. Per the issue's own
instruction, no route is invented to fill these gaps.

### Exchange rates (13 currencies)

Two reference currencies, as the issue requires: **XCD** (Eastern Caribbean
dollar, pegged EC$2.70 = US$1.00 since 1976 by the Eastern Caribbean Central
Bank) and **USD**. Every other currency used by a manifest island is
expressed both as `unitsPerUSD` and derived `unitsPerXCD`.

| Currency | Regime | Rate | As of | Source |
|---|---|---|---|---|
| XCD | Fixed peg | 2.70 / USD | standing since 1976 | Eastern Caribbean Central Bank |
| USD | Base | 1.00 | — | — |
| AWG | Fixed peg | 1.79 / USD | standing since 1986 | Centrale Bank van Aruba |
| BSD | Fixed peg | 1.00 / USD | standing since 1973 | Central Bank of The Bahamas |
| BBD | Fixed peg | 2.00 / USD | standing since 1975 | Central Bank of Barbados |
| KYD | Fixed peg | 0.8333 / USD (CI$1=US$1.20) | standing since 1974 | Cayman Islands Monetary Authority |
| ANG | Fixed peg | 1.79 / USD | see note below | Centrale Bank van Curaçao en Sint Maarten |
| CUP | Official, multi-rate | 638.00 / USD | retrieved 2026-09-03 | Banco Central de Cuba |
| DOP | Managed float | 58.735 / USD (midpoint) | 2026-09-02 | Banco Central de la República Dominicana |
| HTG | Floating | 130.5204 / USD | 2026-09-02 | Banque de la République d'Haïti |
| JMD | Floating | 158.325 / USD (midpoint) | 2026-09-01 | Bank of Jamaica |
| TTD | Managed float | 6.7122 / USD (midpoint) | 2026-09-02 | Central Bank of Trinidad and Tobago |
| EUR | Floating | 0.8637 / USD (derived) | 2026-09-02 | European Central Bank |

Direct fetches of `eccb-centralbank.org` (both the general and
`/exchange-rates` pages) returned **HTTP 403**; the EC$2.70 peg is instead
corroborated by multiple independent central-bank and IMF sources — it is
one of the most widely documented facts in Caribbean monetary policy, so
this file still treats it as solid despite the failed direct fetch.

**Notable finding — the ANG entry is stale in a way worth flagging.** Since
31 March 2025, the Centrale Bank van Curaçao en Sint Maarten has been
replacing the Netherlands Antillean guilder (ANG) with the **Caribbean
guilder** at 1:1 parity. The manifest
(`caribbean-islands-manifest-v1.ts`) still records `currency: 'ANG'` for
`curacao` and `sint-maarten-dutch-part`. The peg value used here (1.79 per
USD) is correct under either name, so this file is not wrong, but a future
revision of the manifest may want to update the currency code.

**Cuba is a genuinely hard case, not a simplification.** Cuba floated its
official CUP/USD rate in December 2025 after decades of fixed/multiple
rates; the rate has moved quickly since (roughly 500–630+ CUP/USD across
2026) and separate fixed state-sector rates (24 and 120 CUP/USD) and a
higher informal-market rate still coexist. The 638.00 figure is what
`bc.gob.cu/tasas-de-cambio` displayed at retrieval time; treat it as
volatile and re-verify before relying on it for anything beyond this
offline demo.

DOP, HTG, JMD, TTD and EUR are not pegs — each is a **point-in-time
snapshot** of a floating or managed rate on the stated date, not a standing
rate like XCD/AWG/BSD/BBD/KYD/ANG. A future refresh should re-fetch these
five (plus CUP) and bump `version`; the fixed pegs should not need to
change.

## Refreshing this file

There is no automated refresh script for this dataset (unlike
`refresh:reference-places`, which is a maintainer command for the separate
OSM places snapshot). Re-verify sources and re-run the equivalent lookups by
hand, bump `version` and `generatedAt`, and update this README's source
table before committing a refresh — a refresh may change deterministic
replay values for any feature built on top of this file.
