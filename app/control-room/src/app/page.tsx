"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ActionPreviewMessage } from "@harvest/shared";
import type { InjectedDisruption, ReplayTimeline, SimulationAgentAction } from "@harvest/simulation";

import SelectControl from "@/components/SelectControl";
import HarvestMark from "@/components/HarvestMark";
import MapExplorer from "@/components/MapExplorer";
import { mapStops, shortestMapRoute } from "@/lib/map-route";
import EstimationModeControl from "@/components/EstimationModeControl";
import InjectionPanel from "@/components/InjectionPanel";
import IslandScopeControls from "@/components/IslandScopeControls";
import ActionPreview from "@/components/panels/ActionPreview";
import EventFeed from "@/components/panels/EventFeed";
import Inspector from "@/components/panels/Inspector";
import ReferenceAttribution from "@/components/panels/ReferenceAttribution";
import Legend from "@/components/panels/Legend";
import Masthead from "@/components/panels/Masthead";
import MetricsPanel from "@/components/panels/MetricsPanel";
import PlaybackControls from "@/components/transport/PlaybackControls";
import { actionPreviewFrameUrl, toActionPreviewMessage } from "@/lib/action-preview";
import { usePlayback } from "@/lib/playback";
import {
  DEFAULT_ESTIMATION_MODE,
  DEFAULT_SEED,
  DEFAULT_SCENARIO,
  PARTICIPANT_WEBSITE_URL,
  compareRunOutcomes,
  createDerivedRun,
  createParticipantSession,
  createSavedRun,
  listSavedRuns,
  listScenarios,
  loadSavedRun,
  loadTimeline,
  loadWorldFrame,
  type DecisionMode,
  type EstimationMode,
  type PolicyName,
  type RunOutcomeComparison,
  type SavedRun,
  type SimulationScenario,
} from "@/lib/run";

const CesiumGlobe = dynamic(() => import("@/components/globe/CesiumGlobe"), {
  ssr: false,
  loading: () => <div className="globe-loading">Preparing the globe…</div>,
});

export default function ControlRoomPage() {
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [setupOpen, setSetupOpen] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [activeIsland, setActiveIsland] = useState<string | null>(null);
  const [routeMode, setRouteMode] = useState(false);
  const [routeFrom, setRouteFrom] = useState("");
  const [routeTo, setRouteTo] = useState("");
  const [scenarioId, setScenarioId] = useState(DEFAULT_SCENARIO);
  const [scenarios, setScenarios] = useState<SimulationScenario[]>([]);
  const [policy, setPolicy] = useState<PolicyName>("HARVEST");
  const [seedInput, setSeedInput] = useState(String(DEFAULT_SEED));
  const [decisionMode, setDecisionMode] = useState<DecisionMode>("DETERMINISTIC");
  const [estimationMode, setEstimationMode] = useState<EstimationMode>(DEFAULT_ESTIMATION_MODE);
  const [scopeMode, setScopeMode] = useState<"SELECTED" | "ALL">("ALL");
  const [islandIds, setIslandIds] = useState<string[]>(["saint-lucia"]);
  const [injections, setInjections] = useState<InjectedDisruption[]>([]);
  const [timeline, setTimeline] = useState<ReplayTimeline | null>(null);
  const [currentRun, setCurrentRun] = useState<SavedRun | null>(null);
  const [injectionComparison, setInjectionComparison] = useState<RunOutcomeComparison | null>(null);
  const [savedRuns, setSavedRuns] = useState<SavedRun[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedAction, setSelectedAction] = useState<SimulationAgentAction | null>(null);
  const [participantId, setParticipantId] = useState("");
  const [preview, setPreview] = useState<{ message: ActionPreviewMessage; frameUrl: string | null; error: string | null } | null>(null);
  const [focusRegion, setFocusRegion] = useState<string | null>(null);
  // The weather overlay is on by default: weather is what the saved run says
  // happened, and hiding it by default would make the physical world the
  // simulation models invisible until someone went looking for a switch.
  const [weatherEnabled, setWeatherEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const playback = usePlayback(timeline);
  const { controls, ...state } = playback;

  const loadRun = useCallback(async (run: SavedRun) => {
    setLoading(true);
    setError(null);
    setInjectionComparison(null);
    try {
      const loaded = await loadTimeline(run.runId);
      setTimeline(loaded);
      setRouteFrom(""); setRouteTo(""); setActiveIsland(null); setSetupOpen(false);
      setCurrentRun(run);
      setScenarioId(run.scenarioId);
      setPolicy(run.policy);
      setSeedInput(String(run.seed));
      setDecisionMode(run.decisionMode);
      setEstimationMode(run.estimationMode);
      setInjections(run.disruptions as InjectedDisruption[]);
      const firstMapped = loaded.scene.participants.find((item) => item.productActorId);
      setParticipantId(firstMapped?.productActorId ?? "");
      setSelectedId(null);
      setSelectedAction(null);
      setFocusRegion(null);
      if (run.derivedFromRunId) {
        try {
          const sourceRun = await loadSavedRun(run.derivedFromRunId);
          if (sourceRun.status === "COMPLETED" && sourceRun.frameCount > 0) {
            const sourceFrame = await loadWorldFrame(sourceRun.runId, sourceRun.frameCount - 1);
            const currentFrame = loaded.frames.at(-1);
            if (currentFrame) {
              setInjectionComparison(compareRunOutcomes(run.policy, sourceRun, sourceFrame, run, currentFrame));
            }
          }
        } catch {
          // A comparison is explanatory, not required to replay a valid run.
          // Older/removed source data therefore must not make the child unloadable.
          setInjectionComparison(null);
        }
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshRuns = useCallback(async (preferredRunId?: string) => {
    const runs = await listSavedRuns();
    setSavedRuns(runs);
    const preferred = runs.find((run) => run.runId === preferredRunId);
    return preferred ?? runs.find((run) => run.status === "COMPLETED") ?? null;
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        setScenarios(await listScenarios());
        await refreshRuns();
        // A saved replay is optional. Opening the control room should preserve
        // the Caribbean launch defaults instead of silently replacing them
        // with whichever historical run happens to be newest.
        setLoading(false);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        setLoading(false);
      }
    })();
  }, [loadRun, refreshRuns]);

  const runSimulation = useCallback(async () => {
    if (!/^\d+$/.test(seedInput)) {
      setError("Seed must contain whole digits only.");
      return;
    }
    const seed = Number(seedInput);
    if (!Number.isSafeInteger(seed) || seed > 4_294_967_295) {
      setError("Seed must be an integer between 0 and 4294967295.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const created = await createSavedRun({ scenarioId, policy, seed, decisionMode, estimationMode, disruptions: injections, scope: scopeMode === "ALL" ? { mode: "ALL" } : { mode: "SELECTED", islandIds } });
      const run = await refreshRuns(created.runId) ?? created;
      await loadRun(run);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setLoading(false);
    }
  }, [decisionMode, estimationMode, injections, islandIds, loadRun, policy, refreshRuns, scenarioId, scopeMode, seedInput]);

  const changeInjections = useCallback(async (next: InjectedDisruption[]) => {
    const additions = next.slice(injections.length);
    setInjections(next);
    if (!currentRun || additions.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const created = await createDerivedRun(currentRun.runId, additions);
      const run = await refreshRuns(created.runId) ?? created;
      await loadRun(run);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setLoading(false);
    }
  }, [currentRun, injections.length, loadRun, refreshRuns]);

  const openParticipant = useCallback(async () => {
    if (!currentRun || !participantId) return;
    setError(null);
    try {
      const session = await createParticipantSession(currentRun.runId, participantId);
      window.open(`${PARTICIPANT_WEBSITE_URL}/#harvest_access_token=${encodeURIComponent(session.accessToken)}`, "_blank", "noopener,noreferrer");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [currentRun, participantId]);

  /**
   * Opens the embedded reenactment. It mints its own read-only participant
   * session rather than reusing one, because the token is short-lived and the
   * preview has to work whether or not anyone opened the website first.
   * Playback is deliberately untouched: the timeline keeps running or stays
   * paused exactly as it was.
   */
  const previewAction = useCallback(async (action: SimulationAgentAction) => {
    if (!currentRun) return;
    const participant = timeline?.scene.participants.find((item) => item.simulationActorId === action.simulationActorId);
    const message = toActionPreviewMessage(action, participant);
    setPreview({ message, frameUrl: null, error: null });
    try {
      const session = await createParticipantSession(currentRun.runId, action.productActorId);
      setPreview((current) => (current && current.message.actionId === action.actionId
        ? { ...current, frameUrl: actionPreviewFrameUrl(session.accessToken, action.actionId) }
        : current));
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : String(caught);
      setPreview((current) => (current && current.message.actionId === action.actionId
        ? { ...current, error: detail }
        : current));
    }
  }, [currentRun, timeline]);

  const stops = useMemo(() => timeline ? mapStops(timeline.scene) : [], [timeline]);
  const routeEndpoints = useMemo(() => [routeFrom, routeTo].flatMap((id) => stops.filter((stop) => stop.id === id)), [stops, routeFrom, routeTo]);
  const route = useMemo(() => {
    const from = stops.find((stop) => stop.id === routeFrom), to = stops.find((stop) => stop.id === routeTo);
    return timeline && from && to ? shortestMapRoute(timeline.scene, from, to) : null;
  }, [timeline, stops, routeFrom, routeTo]);
  const catalogue = scenarios.find((scenario) => scenario.scenarioId === DEFAULT_SCENARIO)?.islands ?? [];
  const island = catalogue.find((item) => item.islandId === activeIsland);
  const mapTarget = useMemo(() => island
    ? { ...island.camera, heightM: island.camera.heightKm * 1200, key: island.islandId }
    : { latitude: 18.8, longitude: -72.5, heightM: 3_900_000, key: "caribbean" }, [island]);
  const handleSelect = useCallback((id: string | null) => {
    if (routeMode && id && stops.some((stop) => stop.id === id)) {
      if (!routeFrom || routeTo) { setRouteFrom(id); setRouteTo(""); }
      else setRouteTo(id);
      return;
    }
    setSelectedAction(null); setSelectedId(id);
    const mapped = timeline?.scene.participants.find((item) => item.simulationActorId === id);
    if (mapped?.productActorId) setParticipantId(mapped.productActorId);
  }, [timeline, routeMode, stops, routeFrom, routeTo]);

  const handleSelectAction = useCallback((action: SimulationAgentAction) => {
    setSelectedId(null);
    setSelectedAction(action);
    setFocusRegion(action.simulationActorId);
    setParticipantId(action.productActorId);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedId(null);
    setSelectedAction(null);
  }, []);

  // A preview belongs to one action in one run. Loading another run would leave
  // a frame open on a session that no longer matches what is on the globe.
  useEffect(() => {
    setPreview(null);
  }, [currentRun?.runId]);

  const framesSoFar = useMemo(
    () => timeline ? timeline.frames.slice(0, state.frameIndex + 1) : [],
    [timeline, state.frameIndex],
  );
  /*
   * Whether this run ever drew a recorded weather day, computed over the whole
   * saved timeline rather than the frame on screen: the attribution line names
   * the datasets a run *uses*, and a line that appeared and vanished as
   * playback crossed a generated day would be noise, not provenance.
   */
  const recordedWeather = useMemo(
    () => (timeline?.frames ?? []).some((item) => (item.weather ?? []).some((reading) => reading.evidenceType === "PUBLIC_REFERENCE")),
    [timeline],
  );
  const disruptionMarkers = useMemo(() => {
    if (!timeline) return [];
    const seen = new Set<number>();
    return timeline.frames.flatMap((frame) => frame.disruptions.flatMap((disruption) => {
      const observedAt = Date.parse(disruption.observedAt);
      if (seen.has(observedAt)) return [];
      seen.add(observedAt);
      return [observedAt];
    }));
  }, [timeline]);

  const setup = (
    <div className="run-toolbar">
      <label>Scenario
        <SelectControl aria-label="Scenario" value={scenarioId} onValueChange={(value) => { const next = value; setScenarioId(next); const scenario = scenarios.find((item) => item.scenarioId === next); if (scenario?.islands[0]) setIslandIds([scenario.islands[0].islandId]); }}>
          {scenarios.length === 0 && <option value={DEFAULT_SCENARIO}>Saint Lucia demo</option>}
          {scenarios.map((scenario) => (
            <option key={scenario.scenarioId} value={scenario.scenarioId}>{scenario.scenarioId === "saint-lucia-demo-v1" ? "Saint Lucia · detailed benchmark" : scenario.scenarioId === DEFAULT_SCENARIO ? "Whole Caribbean · regional network" : `${scenario.islands[0]?.name ?? scenario.scenarioId} · island study`}</option>
          ))}
        </SelectControl>
      </label>
      <label>Policy
        <SelectControl aria-label="Policy" value={policy} onValueChange={(value) => setPolicy(value as PolicyName)}>
          <option value="HARVEST">Harvest</option>
          <option value="BASELINE">Baseline</option>
        </SelectControl>
      </label>
      <IslandScopeControls
        islands={scenarios.find((scenario) => scenario.scenarioId === scenarioId)?.islands ?? []}
        mode={scopeMode}
        selectedIslandIds={islandIds}
        onModeChange={setScopeMode}
        onSelectedIslandIdsChange={setIslandIds}
      />
      <label>Seed
        <input inputMode="numeric" pattern="[0-9]*" autoComplete="off" spellCheck={false} value={seedInput} onChange={(event) => {
          const next = event.target.value;
          if (/^\d*$/.test(next)) setSeedInput(next);
        }} />
      </label>
      {/*
        * Baseline participants never call the Product API, so the control is
        * disabled rather than hidden: the run still records a value, and
        * hiding it would make the stored field look like a bug.
        */}
      <EstimationModeControl value={estimationMode} onChange={setEstimationMode} disabled={policy === "BASELINE"} />
      <label>Decision mode
        <SelectControl aria-label="Decision mode" value={decisionMode} onValueChange={(value) => setDecisionMode(value as DecisionMode)}>
          <option value="DETERMINISTIC">Deterministic</option>
          <option value="LLM_ASSISTED">LLM assisted</option>
        </SelectControl>
      </label>
      <button type="button" className="run-button" onClick={() => void runSimulation()} disabled={loading}>
        {loading ? "Loading…" : "Run simulation"}
      </button>
      <label>Saved run
        <SelectControl aria-label="Saved run" value={currentRun?.runId ?? ""} onValueChange={(value) => {
          const run = savedRuns.find((item) => item.runId === value);
          if (run) void loadRun(run);
        }}>
          <option value="" disabled>Select a run</option>
          {savedRuns.filter((run) => run.status === "COMPLETED").map((run) => (
            <option key={run.runId} value={run.runId}>{run.policy} · seed {run.seed} · {run.runId.slice(0, 8)}</option>
          ))}
        </SelectControl>
      </label>
    </div>
  );

  const frame = state.frame;
  if (!timeline || frame === null) {
    return (
      <main className="control-room launch-screen">
        <section className="launch-card">
          <HarvestMark />
          <h1>Harvest control room</h1>
          {setup}
          {error && <p className="run-error" role="alert">{error}</p>}
        </section>
      </main>
    );
  }

  const { scene } = timeline;
  const selectedParticipant = scene.participants.find((item) => item.productActorId === participantId);
  return (
    <main className="control-room">
      <div className="globe-layer">
        <CesiumGlobe scene={scene} frame={frame} atMs={state.atMs} selectedId={selectedId} onSelect={handleSelect} focusRegion={focusRegion} showWeather={weatherEnabled} mapTarget={mapTarget} route={route} routeEndpoints={routeEndpoints} />
      </div>
      <ReferenceAttribution sources={scene.referenceDataSources} maritime={scene.maritimeAttributions ?? []} recordedWeather={recordedWeather} />
      <div className="chrome">
        <div className="chrome-header">
          <Masthead scene={scene} frame={frame} estimationMode={currentRun?.estimationMode} estimationModeUsed={currentRun?.policy !== "BASELINE"} />
          <div className="workspace-actions">
            <span className="workspace-location">{island?.name ?? "Caribbean overview"}</span>
            <button type="button" aria-expanded={explorerOpen} onClick={() => setExplorerOpen(!explorerOpen)}>Explore</button>
            <button type="button" aria-expanded={setupOpen} onClick={() => setSetupOpen(!setupOpen)}>Run setup</button>
            <button type="button" aria-pressed={showActivity} onClick={() => setShowActivity(!showActivity)}>Activity</button>
            <a href={PARTICIPANT_WEBSITE_URL} target="_blank" rel="noreferrer">Participant workspace ↗</a>
          </div>
          {setupOpen && setup}
          {error && <p className="run-error" role="alert">{error}</p>}
        </div>
        {/*
          * Content-sized rows with the column itself scrolling. A `1fr` last
          * row gave the final panel whatever the two above it left over, which
          * at 1080p was nothing: the map key — and with it the weather switch
          * and reading — sat under the transport bar, unreachable. `max-content`
          * rather than `auto` because an over-full grid shrinks `auto` rows back
          * down to their min-content, which clipped the metric tiles instead.
          */}
        <div className="chrome-left" hidden={!explorerOpen} style={{ display: "grid", gridTemplateRows: "repeat(4, max-content)", alignContent: "start", gap: 16, minHeight: 0 }}>
          <MapExplorer islands={catalogue} scene={scene} frame={frame} activeIsland={activeIsland}
            onIsland={(id) => { setActiveIsland(id); setFocusRegion(null); setSelectedId(null); }}
            routeMode={routeMode} onRouteMode={setRouteMode} fromId={routeFrom} toId={routeTo}
            onFrom={setRouteFrom} onTo={setRouteTo} stops={stops} route={route} />
          <details className="workspace-details"><summary>Outcomes & scenario tools</summary>
          <MetricsPanel frame={frame} policy={policy} />
          <InjectionPanel
            scene={scene}
            injections={injections}
            comparison={injectionComparison}
            onChange={(next) => void changeInjections(next)}
            atMs={state.atMs}
            startMs={state.startMs}
          />
          <section className="panel">
            <header className="panel-header"><span className="panel-title">Participants</span></header>
            <div className="panel-body">
              <SelectControl aria-label="Participant" className="speed-select" style={{ width: "100%" }} value={participantId} onValueChange={(value) => setParticipantId(value)}>
                {scene.participants.filter((item) => item.productActorId).map((participant) => (
                  <option key={participant.simulationActorId} value={participant.productActorId ?? ""}>{participant.displayName} · {participant.role.toLowerCase()}</option>
                ))}
              </SelectControl>
              <button type="button" className="run-button participant-button" disabled={!selectedParticipant || policy !== "HARVEST"} onClick={() => void openParticipant()}>
                Open participant website
              </button>
            </div>
          </section>
          <section className="panel">
            <header className="panel-header"><span className="panel-title">Map key</span></header>
            <div className="panel-body">
              <Legend
                frame={frame}
                weatherLegend={scene.weatherLegend}
                weatherEnabled={weatherEnabled}
                onWeatherEnabledChange={setWeatherEnabled}
              />
            </div>
          </section>
          </details>
        </div>
        <div className="chrome-right" style={{ display: selectedId || selectedAction || showActivity ? "grid" : "none", gridTemplateRows: "1fr 1fr", gap: 16, minHeight: 0 }}>
          <Inspector
            scene={scene}
            frame={frame}
            selectedId={selectedId}
            selectedAction={selectedAction}
            onClose={clearSelection}
            onPreviewAction={policy === "HARVEST" ? (action) => void previewAction(action) : undefined}
          />
          <section className="panel"><header className="panel-header"><span className="panel-title">What is happening</span></header><div className="panel-body"><EventFeed scene={scene} frames={framesSoFar} onSelect={handleSelect} onSelectAction={handleSelectAction} /></div></section>
        </div>
        <div className="chrome-footer"><PlaybackControls state={{ ...state, frame }} controls={controls} disruptionMarkers={disruptionMarkers} demandEndsAtMs={scene.demandEndsAt ? Date.parse(scene.demandEndsAt) : undefined} /></div>
      </div>
      {preview && (
        <ActionPreview
          message={preview.message}
          frameUrl={preview.frameUrl}
          error={preview.error}
          onClose={() => setPreview(null)}
        />
      )}
      {loading && <div className="run-loading" role="status">Generating and saving the simulation…</div>}
    </main>
  );
}
