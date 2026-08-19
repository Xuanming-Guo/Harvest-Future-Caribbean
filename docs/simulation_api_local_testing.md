# Saved simulation API: local testing guide

This guide verifies the saved simulation-run foundation provided by the
Fastify Product API. It is intended for teammates and coding agents testing
issue #29 or preparing the issue #30 control-room and simulated-agent
integration.

The current boundary is important:

- The Product API can create, persist, list and replay deterministic runs.
- The participant website on port `3000` does not contain a simulation page.
- The control room on port `3002` still runs its temporary browser-local
  simulation until issue #30 connects it to these endpoints.
- Saved replay data is synthetic counterfactual evidence, not measured impact.
- `LLM_ASSISTED` is reserved for issue #30 and does not silently fall back to
  deterministic execution.

## Prerequisites and local start

Requirements:

- Node.js 20 or later.
- Docker Desktop with Docker Compose running.

From the repository root:

```powershell
npm install
npm run dev
```

This starts:

- participant website: <http://localhost:3000>;
- Product API: <http://localhost:3001>;
- PostgreSQL 16 in Docker.

Check the API in a second PowerShell window:

```powershell
Invoke-RestMethod http://localhost:3001/health
```

Expected fields:

```text
status          : ok
service         : harvest-product-api
contractVersion : 0.5.0
```

If the API reports `EADDRINUSE` for port `3001`, another API process is already
listening there. Stop the older development terminal or process, then run
`npm run dev` again. Do not start `npm run dev:api` while the root development
command is already running.

## 1. Sign in as the operations user

Run the remaining commands in the second PowerShell window:

```powershell
$base = "http://localhost:3001"

$session = Invoke-RestMethod `
  -Method Post `
  -Uri "$base/dev/session" `
  -ContentType "application/json" `
  -Body '{"persona":"operations-demo"}'

$auth = @{
  Authorization = "Bearer $($session.accessToken)"
}
```

Saved-run administration is intentionally limited to operations and admin
roles. The development-only `operations-demo` persona provides the required
role without storing credentials in the repository.

## 2. Check the available scenarios

```powershell
$scenarios = Invoke-RestMethod `
  -Uri "$base/v1/simulation-scenarios" `
  -Headers $auth

$scenarios.items | Select-Object `
  scenarioId, durationDays, availablePolicies, availableDecisionModes, islands
```

Expected current catalogue:

- one scenario: `saint-lucia-demo-v1`;
- one island: `saint-lucia`;
- policies: `BASELINE` and `HARVEST`;
- available decision mode: `DETERMINISTIC`.

The scope contract is ready for multiple islands, but issue #31 owns generating
regional Caribbean scenarios. Supplying another island currently returns a
validation error rather than pretending that regional data exists.

## 3. Create and save a deterministic run

```powershell
$runHeaders = @{
  Authorization = "Bearer $($session.accessToken)"
  "Idempotency-Key" = "manual-run-seed-42-001"
}

$runRequest = @{
  scenarioId = "saint-lucia-demo-v1"
  policy = "HARVEST"
  seed = 42
  decisionMode = "DETERMINISTIC"
  scope = @{
    mode = "SELECTED"
    islandIds = @("saint-lucia")
  }
} | ConvertTo-Json -Depth 6

$run = Invoke-RestMethod `
  -Method Post `
  -Uri "$base/v1/simulation-runs" `
  -Headers $runHeaders `
  -ContentType "application/json" `
  -Body $runRequest

$run | Select-Object `
  runId, scenarioId, policy, seed, decisionMode, status, frameCount,
  decisionCount, evidenceLabel, metrics
```

For the current engine and seed `42`, the important expected values are:

```text
scenarioId             saint-lucia-demo-v1
policy                 HARVEST
seed                   42
decisionMode           DETERMINISTIC
status                 COMPLETED
frameCount             111
decisionCount          27
eventsProcessed        111
totalDemandedKg        2956
totalAcceptedKg        414.12
localProcurementRate   0.140095
wasteQuantity          2404.39 kg
```

`runId` is a new storage UUID and therefore varies. The response must carry the
synthetic-counterfactual evidence label. It must not claim that these values
were measured in a deployed system.

## 4. Inspect and replay the saved run

The metadata endpoint deliberately omits the large frame sequence:

```powershell
$runId = $run.runId

$details = Invoke-RestMethod `
  -Uri "$base/v1/simulation-runs/$runId" `
  -Headers $auth

$details | Select-Object `
  runId, status, frameCount, decisionCount, evidenceLabel, metrics
```

Load the complete immutable replay and one saved frame:

```powershell
$timeline = Invoke-RestMethod `
  -Uri "$base/v1/simulation-runs/$runId/timeline" `
  -Headers $auth

$firstFrame = Invoke-RestMethod `
  -Uri "$base/v1/simulation-runs/$runId/world?frameIndex=0" `
  -Headers $auth

[pscustomobject]@{
  Frames = $timeline.frames.Count
  Farms = $timeline.scene.farms.Count
  Buyers = $timeline.scene.buyers.Count
  Transporters = $timeline.scene.transporters.Count
  ActorsInFirstFrame = $firstFrame.frame.actors.Count
  FirstEvent = $firstFrame.frame.eventType
  FirstTimestamp = $firstFrame.frame.at
}
```

Expected:

```text
Frames              111
Farms               5
Buyers               3
Transporters        2
ActorsInFirstFrame  10
FirstEvent          WORLD_TICK
FirstTimestamp      2026-09-01T06:00:00.000Z
```

The valid frame indices are `0` through `110`. Requesting `frameIndex=111`
returns HTTP `422`. Replay reads do not re-run the simulation, call an LLM or
mutate the saved run.

## 5. Verify idempotency and deterministic storage

Repeating the same request with the same idempotency key returns the original
stored run:

```powershell
$repeat = Invoke-RestMethod `
  -Method Post `
  -Uri "$base/v1/simulation-runs" `
  -Headers $runHeaders `
  -ContentType "application/json" `
  -Body $runRequest

$repeat.runId -eq $run.runId
```

Expected: `True`.

Reusing that key with a different body returns HTTP `409`. Use a new key to
store a second run with the same simulation inputs:

```powershell
$secondHeaders = @{
  Authorization = "Bearer $($session.accessToken)"
  "Idempotency-Key" = "manual-run-seed-42-002"
}

$run2 = Invoke-RestMethod `
  -Method Post `
  -Uri "$base/v1/simulation-runs" `
  -Headers $secondHeaders `
  -ContentType "application/json" `
  -Body $runRequest

[pscustomobject]@{
  DifferentRunIds = $run.runId -ne $run2.runId
  SameMetrics = (
    ($run.metrics | ConvertTo-Json -Depth 8 -Compress) -eq
    ($run2.metrics | ConvertTo-Json -Depth 8 -Compress)
  )
  SameFrameCount = $run.frameCount -eq $run2.frameCount
}
```

Expected: all three values are `True`. Storage IDs are unique, while scenario,
policy, seed, scope and disruptions determine the reproducible observable
result.

## 6. Create a disruption-derived run

A derived run inherits the source scenario, policy, seed, decision mode and
scope. The request contains only the source run and additional disruptions:

```powershell
$derivedHeaders = @{
  Authorization = "Bearer $($session.accessToken)"
  "Idempotency-Key" = "manual-derived-seed-42-001"
}

$derivedRequest = @{
  derivedFromRunId = $runId
  disruptions = @(
    @{
      type = "WEATHER"
      offsetMs = 86400000
      durationMs = 21600000
      affectedEntityIds = @($timeline.scene.farms[0].farmId)
      publicDescription = "Heavy rain around one farm for six simulated hours."
    }
  )
} | ConvertTo-Json -Depth 8

$derived = Invoke-RestMethod `
  -Method Post `
  -Uri "$base/v1/simulation-runs" `
  -Headers $derivedHeaders `
  -ContentType "application/json" `
  -Body $derivedRequest

$derived | Select-Object `
  runId, derivedFromRunId, scenarioId, policy, seed, status, frameCount,
  decisionCount, disruptions
```

Expected for this example:

- `status` is `COMPLETED`;
- `derivedFromRunId` equals the original `$runId`;
- scenario, policy and seed still equal the source run;
- the source run remains unchanged;
- the derived replay has `113` frames and `28` decisions.

The caller cannot set hidden severity. The engine derives severity from the
seed so the disruption remains deterministic and cannot be tuned to manufacture
a preferred outcome.

## 7. Create a paired baseline-versus-Harvest run

```powershell
$pairHeaders = @{
  Authorization = "Bearer $($session.accessToken)"
  "Idempotency-Key" = "manual-pair-seed-42-001"
}

$pairRequest = @{
  scenarioId = "saint-lucia-demo-v1"
  seed = 42
  decisionMode = "DETERMINISTIC"
  scope = @{
    mode = "SELECTED"
    islandIds = @("saint-lucia")
  }
} | ConvertTo-Json -Depth 6

$pair = Invoke-RestMethod `
  -Method Post `
  -Uri "$base/v1/paired-runs" `
  -Headers $pairHeaders `
  -ContentType "application/json" `
  -Body $pairRequest

$pair | Select-Object `
  pairId, status, baselineRunId, harvestRunId, result, evidenceLabel
```

Expected for seed `42`:

| Metric | Baseline | Harvest | Harvest minus baseline |
| --- | ---: | ---: | ---: |
| Local procurement rate | `0.142491` | `0.140095` | `-0.002396` |
| Fulfilment rate | `0.090909` | `0` | `-0.090909` |
| Waste | `2370.99 kg` | `2404.39 kg` | `+33.40 kg` |

Both run IDs must be present and different. Both runs use identical initial
inputs except for policy. The current seed does not show Harvest winning; that
result is retained honestly and remains synthetic.

## 8. Check the operational snapshot boundary

```powershell
$snapshot = Invoke-RestMethod `
  -Uri "$base/v1/operations/snapshot?simulationRunId=$runId" `
  -Headers $auth

$snapshot
```

For a run created by issue #29, expect the requested `simulationRunId` with
`activeListings` and `openDemands` both equal to `0`, empty mission and
exception ID arrays, and no simulated orders. The saved replay exists, but
issue #30 has not yet made simulated participants call the Product API to
create operational records.

An unscoped snapshot reads normal seeded product data instead. Real records,
one simulation run and another simulation run must never be combined.

## 9. Confirm that LLM mode fails explicitly

```powershell
$llmHeaders = @{
  Authorization = "Bearer $($session.accessToken)"
  "Idempotency-Key" = "manual-llm-seed-42-001"
}

$llmRequest = @{
  scenarioId = "saint-lucia-demo-v1"
  policy = "HARVEST"
  seed = 42
  decisionMode = "LLM_ASSISTED"
  scope = @{ mode = "ALL" }
} | ConvertTo-Json -Depth 6

try {
  Invoke-RestMethod `
    -Method Post `
    -Uri "$base/v1/simulation-runs" `
    -Headers $llmHeaders `
    -ContentType "application/json" `
    -Body $llmRequest
} catch {
  $_.ErrorDetails.Message
}
```

With no provider configured, expect HTTP `409` and:

```text
LLM_PROVIDER_NOT_CONFIGURED
```

If a provider name is configured before issue #30 is implemented, the API
instead returns `LLM_ASSISTED_NOT_IMPLEMENTED`. Neither case creates a fake
LLM-assisted result.

## 10. Inspect the SSE event stream

```powershell
curl.exe -N `
  -H "Authorization: Bearer $($session.accessToken)" `
  "$base/v1/events/stream"
```

Expected event shape:

```text
id: <increasing decimal database cursor>
event: <event type>
data: {"eventId":"<UUID>", ...}
```

Press `Ctrl+C` to stop the stream. The SSE `id` is the monotonic cursor used in
`Last-Event-ID`; the UUID remains inside the event envelope. Consumers resume
strictly after the last cursor and deduplicate by cursor or UUID.

The unscoped stream contains the seeded product events. A stream selected for
the new `$runId` can connect but currently has no operational domain events,
because issue #30 owns simulated participant actions.

## Development-data lifetime

The root `npm run dev` command applies migrations and reseeds disposable local
development data before starting the servers. Reseeding clears saved runs, so
run and pair UUIDs from a previous root development session will no longer
exist. This reset is intentional for a reproducible hackathon environment and
does not change the API's PostgreSQL persistence while that database state is
retained.

After the first setup, developers who deliberately want to restart processes
without reseeding can start `npm run dev:api` and `npm run dev:web` separately.
Do this only when PostgreSQL is already running and migrations have already
been applied.

## Source of truth

- [`api_info.md`](api_info.md) defines endpoint consumers, effects and safety
  boundaries.
- [`../contracts/openapi.yaml`](../contracts/openapi.yaml) is the canonical
  wire contract.
- [`architecture.md`](architecture.md) defines Product API, simulation and
  control-room ownership.
- [`../simulation/README.md`](../simulation/README.md) documents engine
  determinism and hidden truth.
