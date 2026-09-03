"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { InjectedDisruption, ReplayTimeline, SimulationAgentAction } from "@harvest/simulation";

import InjectionPanel from "@/components/InjectionPanel";
import IslandScopeControls from "@/components/IslandScopeControls";
import EventFeed from "@/components/panels/EventFeed";
import Inspector from "@/components/panels/Inspector";
import ReferenceAttribution from "@/components/panels/ReferenceAttribution";
import Legend from "@/components/panels/Legend";
import Masthead from "@/components/panels/Masthead";
import MetricsPanel from "@/components/panels/MetricsPanel";
import PlaybackControls from "@/components/transport/PlaybackControls";
import { usePlayback } from "@/lib/playback";
import {
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
  const [scenarioId, setScenarioId] = useState(DEFAULT_SCENARIO);
  const [scenarios, setScenarios] = useState<SimulationScenario[]>([]);
  const [policy, setPolicy] = useState<PolicyName>("HARVEST");
  const [seedInput, setSeedInput] = useState(String(DEFAULT_SEED));
  const [decisionMode, setDecisionMode] = useState<DecisionMode>("DETERMINISTIC");
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
  const [focusRegion, setFocusRegion] = useState<string | null>(null);
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
      setCurrentRun(run);
      setScenarioId(run.scenarioId);
      setPolicy(run.policy);
      setSeedInput(String(run.seed));
      setDecisionMode(run.decisionMode);
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
      const created = await createSavedRun({ scenarioId, policy, seed, decisionMode, disruptions: injections, scope: scopeMode === "ALL" ? { mode: "ALL" } : { mode: "SELECTED", islandIds } });
      const run = await refreshRuns(created.runId) ?? created;
      await loadRun(run);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setLoading(false);
    }
  }, [decisionMode, injections, islandIds, loadRun, policy, refreshRuns, scenarioId, scopeMode, seedInput]);

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

  const handleSelect = useCallback((id: string | null) => {
    setSelectedAction(null);
    setSelectedId(id);
    if (id) setFocusRegion(id);
    const mapped = timeline?.scene.participants.find((item) => item.simulationActorId === id);
    if (mapped?.productActorId) setParticipantId(mapped.productActorId);
  }, [timeline]);

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

  const framesSoFar = useMemo(
    () => timeline ? timeline.frames.slice(0, state.frameIndex + 1) : [],
    [timeline, state.frameIndex],
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
        <select value={scenarioId} onChange={(event) => { const next = event.target.value; setScenarioId(next); const scenario = scenarios.find((item) => item.scenarioId === next); if (scenario?.islands[0]) setIslandIds([scenario.islands[0].islandId]); }}>
          {scenarios.length === 0 && <option value={DEFAULT_SCENARIO}>Saint Lucia demo</option>}
          {scenarios.map((scenario) => (
            <option key={scenario.scenarioId} value={scenario.scenarioId}>{scenario.description}</option>
          ))}
        </select>
      </label>
      <label>Policy
        <select value={policy} onChange={(event) => setPolicy(event.target.value as PolicyName)}>
          <option value="HARVEST">Harvest</option>
          <option value="BASELINE">Baseline</option>
        </select>
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
      <label>Decision mode
        <select value={decisionMode} onChange={(event) => setDecisionMode(event.target.value as DecisionMode)}>
          <option value="DETERMINISTIC">Deterministic</option>
          <option value="LLM_ASSISTED">LLM assisted</option>
        </select>
      </label>
      <button type="button" className="run-button" onClick={() => void runSimulation()} disabled={loading}>
        {loading ? "Generating…" : "Run simulation"}
      </button>
      <label>Saved run
        <select value={currentRun?.runId ?? ""} onChange={(event) => {
          const run = savedRuns.find((item) => item.runId === event.target.value);
          if (run) void loadRun(run);
        }}>
          <option value="" disabled>Select a run</option>
          {savedRuns.filter((run) => run.status === "COMPLETED").map((run) => (
            <option key={run.runId} value={run.runId}>{run.policy} · seed {run.seed} · {run.runId.slice(0, 8)}</option>
          ))}
        </select>
      </label>
    </div>
  );

  const frame = state.frame;
  if (!timeline || frame === null) {
    return (
      <main className="control-room launch-screen">
        <section className="launch-card">
          <span className="masthead-mark">H</span>
          <div><h1>Harvest control room</h1><p>Create or load a saved synthetic simulation run.</p></div>
          {setup}
          {error && <p className="run-error" role="alert">{error}</p>}
          <p className="launch-note">Runs are synthetic evidence. Harvest-mode agents use the Product API; baseline runs remain isolated.</p>
        </section>
      </main>
    );
  }

  const { scene } = timeline;
  const selectedParticipant = scene.participants.find((item) => item.productActorId === participantId);
  return (
    <main className="control-room">
      <div className="globe-layer">
        <CesiumGlobe scene={scene} frame={frame} atMs={state.atMs} selectedId={selectedId} onSelect={handleSelect} focusRegion={focusRegion} />
      </div>
      <ReferenceAttribution sources={scene.referenceDataSources} />
      <div className="chrome">
        <div className="chrome-header">
          <Masthead scene={scene} frame={frame} />
          {setup}
          {error && <p className="run-error" role="alert">{error}</p>}
        </div>
        <div className="chrome-left" style={{ display: "grid", gridTemplateRows: "auto auto 1fr", gap: 16, minHeight: 0 }}>
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
              <select className="speed-select" style={{ width: "100%" }} value={participantId} onChange={(event) => setParticipantId(event.target.value)}>
                {scene.participants.filter((item) => item.productActorId).map((participant) => (
                  <option key={participant.simulationActorId} value={participant.productActorId ?? ""}>{participant.displayName} · {participant.role.toLowerCase()}</option>
                ))}
              </select>
              <button type="button" className="run-button participant-button" disabled={!selectedParticipant || policy !== "HARVEST"} onClick={() => void openParticipant()}>
                Open participant website
              </button>
              <p className="panel-help">Opens the participant’s normal workspace in read-only replay mode.</p>
              <Legend />
            </div>
          </section>
        </div>
        <div className="chrome-right" style={{ display: "grid", gridTemplateRows: "1fr 1fr", gap: 16, minHeight: 0 }}>
          <Inspector scene={scene} frame={frame} selectedId={selectedId} selectedAction={selectedAction} onClose={clearSelection} />
          <section className="panel"><header className="panel-header"><span className="panel-title">What is happening</span></header><div className="panel-body"><EventFeed scene={scene} frames={framesSoFar} onSelect={handleSelect} onSelectAction={handleSelectAction} /></div></section>
        </div>
        <div className="chrome-footer"><PlaybackControls state={{ ...state, frame }} controls={controls} disruptionMarkers={disruptionMarkers} /></div>
      </div>
      {loading && <div className="run-loading" role="status">Generating and saving the simulation…</div>}
    </main>
  );
}
