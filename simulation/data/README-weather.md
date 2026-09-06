# Saint Lucia recorded weather — public reference data

`saint-lucia-weather-reference.v1.json` is a reviewed, versioned, **offline**
snapshot of *recorded* daily weather for Saint Lucia. It is the reference series
the `saint-lucia-demo-v1` scenario replays instead of inventing its own
conditions (issue #90, stacked on the realised-weather engine from #37).

**Attribution, which the licence requires:** weather data by
[Open-Meteo.com](https://open-meteo.com/), licensed
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Generated using
Copernicus Climate Change Service information. Citation: Zippenfenig, P. (2023).
*Open-Meteo.com Weather API* [Computer software]. Zenodo.
<https://doi.org/10.5281/ZENODO.7970649>.

## What this data is, and what it is not

The weather in the demo is now real. **Nothing else about the demo became real.**

A record here is evidence that conditions of roughly this kind occurred over a
patch of Saint Lucia on a stated date. It is not evidence that a farm reported a
crop, that an order was raised, that a delivery ran late, or that any Harvest
outcome happened at all. Every actor, yield, price, road speed, demand and
spoilage figure in the scenario remains invented, and the run report still
carries the synthetic-counterfactual label. This is the same arrangement the
repository already uses for licensed place references, which give the demo real
coordinates without making its farms real.

Two further limits are worth stating plainly, because both are easy to overstate
in the other direction:

- **These are grid-cell daily aggregates, not instrument readings.** The API
  answers from the nearest cell of a numerical weather model, whose centre is
  recorded per station-year in the `grid` field alongside the coordinates that
  were actually requested. An afternoon squall over one valley is smoothed into
  a modest island-scale daily figure.
- **A value here is a reanalysis product, not a gauge.** It is the best public
  estimate of what happened, produced by assimilating observations into a model.
  It is far better than a random draw and it is not a measurement.

## What was retrieved

Source: the **Open-Meteo Historical Weather API**
(`https://archive-api.open-meteo.com/v1/archive`),
[docs](https://open-meteo.com/en/docs/historical-weather-api). Free, no API key.
Retrieved **2026-09-04**; every one of the six requests returned HTTP 200 with a
complete series and no null in any field, and each record stores the exact URL
that produced it.

Coverage is the original scenario calendar window — `START_ISO` is
`2026-09-01` and `DURATION_DAYS` is 21, so the run touches 1–22 September —
taken across the most recent complete year available and the two before it.
The seven-day settlement window added in #91 extends beyond this dataset.
Days 23�29 September use the seeded synthetic generator and are labelled
`SYNTHETIC`, with no recorded date; they are not presented as recorded weather.

| Station | Role | Requested | Model grid cell | Years |
| --- | --- | --- | --- | --- |
| Hewanorra International Airport, Vieux Fort | `PRIMARY` | 13.73, −60.95 | 13.8137, −60.9651 at 4 m | 2023, 2024, 2025 |
| Castries | `CORROBORATING` | 14.01, −60.99 | 14.0246, −60.9677 at 4 m | 2023, 2024, 2025 |

Six station-years, 22 days each, **132 daily records**. Fields per day:
`precipitationMm`, `windSpeedMaxKph`, `windFromDegrees` (dominant, blowing
*from*, clockwise from true north), `cloudCoverMeanPercent`, `temperatureMaxC`,
`temperatureMinC`. Days are local calendar days in `America/St_Lucia`.

**Hewanorra is primary** because it is Saint Lucia's WMO synoptic reporting site
and therefore the standard answer to "what was the weather in Saint Lucia".
Castries is carried, and tested for completeness, so that a single grid cell is
never mistaken for island-wide truth — and it earns its place, because the two
cells disagree materially. Only the primary station drives the simulation.

### Licence, verified rather than assumed

<https://open-meteo.com/en/licence> was fetched on 2026-09-04 and states that
API data are offered under Attribution 4.0 International (CC BY 4.0), that
appropriate credit and a link to the licence must be given, and that a link to
Open-Meteo must appear next to any location its data are displayed. The same
page lists the upstream sources; reanalysis for this endpoint comes from the
Copernicus Climate Change Service (C3S), which carries its own licence.
Open-Meteo's free API tier is offered for non-commercial use. This dataset is a
committed offline snapshot and **the simulation contacts no weather service at
runtime**, so a run makes no API call at all.

### One provenance weakness, stated rather than hidden

The `models` parameter was left at its default, `best_match`. Open-Meteo
documents Best Match on the archive endpoint as a combination of IFS HRES, ERA5
and ERA5-Land, and it may change what that resolves to. **A refresh is therefore
not guaranteed to reproduce these values byte for byte.**

Pinning `models=era5` gives a stable, citable, but coarser (0.25°) alternative,
and it genuinely disagrees: for 2025-09-01 at the primary station it reports
2.1 mm where the committed value is 1.0 mm. `models=era5_land` was also tried
and returns `null` for every day at both points, because both fall on coastal or
ocean cells — so no ERA5-Land-only variant of this file is possible. Both
alternatives were checked in the same session as the retrieval; the finer
default was kept because it resolves the two stations to distinct cells, and the
caveat is recorded here instead.

## What the record actually says

Under the mapping below, per station-year:

| Station | Year | Rain total | Wettest day | Windiest day | CLEAR | CLOUD | RAIN | STORM |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Hewanorra | 2023 | 51.1 mm | 17.1 mm | 22.3 kph | 12 | 7 | 3 | 0 |
| Hewanorra | 2024 | 110.1 mm | 31.3 mm | 22.0 kph | 6 | 9 | 6 | 1 |
| Hewanorra | 2025 | 42.8 mm | 8.8 mm | 22.5 kph | 11 | 7 | 4 | 0 |
| Castries | 2023 | 35.1 mm | 12.1 mm | 23.7 kph | 15 | 5 | 2 | 0 |
| Castries | 2024 | 72.3 mm | 18.7 mm | 24.6 kph | 8 | 10 | 4 | 0 |
| Castries | 2025 | 23.5 mm | 3.1 mm | 23.9 kph | 13 | 9 | 0 | 0 |

**The single most important finding in this file: the record is far milder than
the generator it replaces.** Across all six station-years the highest daily
maximum 10 m wind is **24.6 kph** and exactly **one day** exceeds 20 mm of rain
(2 September 2024, 31.3 mm at Hewanorra). The synthetic generator drew wet spells
around 60 mm a day and produced 3.8 storm days per run.

That is not evidence that Saint Lucian Septembers are calm. September is peak
Atlantic hurricane season, and the honest reading is narrower: none of these
three 22-day windows contained a hurricane strike on Saint Lucia, and a daily
mean over an ~11 km cell cannot represent a squall the way an hourly gauge in a
valley would. The demo is now milder because the record is milder, and that is
reported in `benchmarks/README.md` rather than corrected for.

The three years are also not interchangeable, which is what makes the seeded
year choice worth having: 2024 is roughly twice as wet as 2023 and carries the
only storm; 2023 is markedly hotter (19 of 22 days above 31 °C at Hewanorra
against 3 in 2024); 2025 at Castries has no qualifying rain day at all.

## How a record becomes engine weather

`src/world/weather-reference.ts` maps a record onto the engine's
`{condition, rainMm, windKph, windFromDegrees, cloudCoverFraction, tempBand}`
shape. Every threshold is a modelling choice, documented here and in that file,
and set once from the physical meaning of the numbers rather than from what it
did to the benchmark.

| Condition | Rule |
| --- | --- |
| `STORM` | `precipitationMm ≥ 20` **or** `windSpeedMaxKph ≥ 45` |
| `RAIN` | `precipitationMm ≥ 5` |
| `CLOUD` | `cloudCoverMeanPercent ≥ 60` |
| `CLEAR` | otherwise |

| Band | Rule |
| --- | --- |
| `HOT` | `temperatureMaxC ≥ 31` |
| `COOL` | `temperatureMaxC < 28` |
| `WARM` | otherwise |

`cloudCoverFraction` is the recorded mean cover over 100. `windFromDegrees` is
the recorded dominant direction, normalised into `[0, 360)`.

**These are not the thresholds `classifyCondition` uses on synthetic days**
(storm at 45 mm or 55 kph, rain at 12 mm, cloud at 2 mm), and the difference is
deliberate. A grid-cell daily aggregate and a draw from the synthetic generator
are not the same kind of number. Applying the synthetic lines to recorded values
would classify almost the whole window as `CLEAR` and silently delete the
weather physics the scenario exists to exercise — not because there was no
weather, but because the two series are scaled differently. The recorded path
also gains a cloud limb the synthetic path cannot have: the generator derives
cloud from rain, whereas the record measures it independently.

The storm rule is an **or**, matching `classifyCondition`. A squall that drops
30 mm without a gale is a storm to a grower with produce standing in a field,
and so is a dry gale. It also matters empirically: under an **and** rule no day
in any of the six station-years qualifies, because daily-maximum wind never
reaches 45 kph at this resolution, and the scenario would lose its storm physics
entirely without anything failing.

## How the scenario uses it

- A scenario opts in by declaring `weatherReference` (`scenario/types.ts`). A
  scenario that does not keeps the synthetic generator unchanged, which is why
  the twenty-eight regional island scenarios and their digests are untouched.
- The recorded **year** is drawn from a dedicated seeded stream,
  `scenario:weather:reference`, so the choice cannot perturb a farm, crop or
  disruption draw. Days match on month-and-day, never on year: a 2026 run
  replays a recorded September.
- Realised weather for a covered day carries `evidenceType: 'PUBLIC_REFERENCE'`
  and `recordedDate`, the real date the value came from. A generated day carries
  `'SYNTHETIC'`. The label is **per day**, so a partly covered run can never be
  rounded up to "this run used real weather".
- `world.truth.rainfallMmByDate` is overwritten from the record for covered
  dates, so the world cannot hold two disagreeing accounts of the same day.
- The scheduled road flood moves to the wettest recorded day in the window,
  because anchoring it to a synthetic wet spell that no longer exists would put
  "heavy rain has made the road impassable" on a day the record calls dry. This
  is a lookup, not a draw: the disruption's offset, duration and severity consume
  the same stream values either way.
- **Forecasts are unchanged and remain `MODEL_PREDICTED`.** They are still
  synthetic noise over the realised series, whatever that series is made of, and
  a future day is still unreadable — `realisedUpTo` refuses it exactly as before.

`evidenceType` is deliberately a **separate field** from `Provenance` in
`contracts/common.schema.json`, which this change does not touch. The run is a
synthetic simulation whatever its weather is made of, so `provenance` stays
`SYNTHETIC`; `evidenceType` answers the different question of where the physical
inputs came from. This mirrors how the maritime and reference-place datasets
already carry `evidenceType: "PUBLIC_REFERENCE"` inside otherwise synthetic
scenarios, and it avoids widening a shared enum that a Postgres column and an
OpenAPI schema both depend on.

## Refreshing this file

There is no automated refresh script, deliberately: a refresh changes
deterministic replay values for every run built on it. Re-run the six requests
recorded in the file, verify the licence page still says what is quoted above,
bump `version` and `generatedAt`, update the tables here, and re-run the ten
benchmark seeds and record the result as a new column. Note that
`tests/weather-reference.test.ts` asserts the storm count and the wind ceiling,
so a refresh that brings in genuinely severe weather will fail the suite and
force the caveats above to be rewritten rather than left standing as stale
claims.
