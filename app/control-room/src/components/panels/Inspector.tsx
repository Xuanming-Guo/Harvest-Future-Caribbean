"use client";

/**
 * Detail view for whatever is currently selected on the globe or in the feed.
 *
 * `selectedId` is untyped by design (it comes from map clicks and feed items
 * alike), so this resolves it against every collection the scene and frame
 * offer and renders whichever one matches. Owns its own `panel` wrapper,
 * unlike EventFeed and Legend, because it needs a close button in its header.
 */

import type { ControlRoomBatch, ControlRoomDemand, ControlRoomFrame, ControlRoomMission, ControlRoomScene, CropStage, ReferenceDataSource, ReferencePlace, ReferencePlaceCategory, SimulationAgentAction } from "@harvest/simulation";

export interface InspectorProps {
  scene: ControlRoomScene;
  frame: ControlRoomFrame;
  selectedId: string | null;
  selectedAction: SimulationAgentAction | null;
  onClose: () => void;
  /** Opens the embedded read-only reenactment. Absent when it is unavailable. */
  onPreviewAction?: (action: SimulationAgentAction) => void;
}

const STAGE_CLASS: Record<CropStage, string> = {
  PLANTED: "status-growing", // No separate marker for the earliest stage; it reads as early growth.
  GROWING: "status-growing",
  MATURING: "status-maturing",
  READY: "status-ready",
  HARVESTED: "status-harvested",
  SPOILED: "status-spoiled",
};

const STAGE_WORDS: Record<CropStage, string> = {
  PLANTED: "planted",
  GROWING: "growing",
  MATURING: "maturing",
  READY: "ready to harvest",
  HARVESTED: "harvested",
  SPOILED: "spoiled",
};

const DEMAND_PILL: Record<ControlRoomDemand["status"], string> = {
  PENDING: "pill-warn",
  COMMITTED: "pill-warn",
  FULFILLED: "pill-good",
  PARTIALLY_FULFILLED: "pill-warn",
  UNMET: "pill-bad",
};

const DEMAND_WORDS: Record<ControlRoomDemand["status"], string> = {
  PENDING: "awaiting a match",
  COMMITTED: "matched to supply",
  FULFILLED: "fulfilled",
  PARTIALLY_FULFILLED: "partially fulfilled",
  UNMET: "unmet",
};

const MISSION_PILL: Record<ControlRoomMission["status"], string> = {
  PLANNED: "pill-warn",
  ACTIVE: "pill-warn",
  DELAYED: "pill-bad",
  COMPLETED: "pill-good",
  CANCELLED: "pill-bad",
};

const REFERENCE_CATEGORY: Record<ReferencePlaceCategory, string> = {
  AGRICULTURAL_AREA: "Agricultural area",
  HOTEL_RESORT: "Hotel or resort",
  RESTAURANT: "Restaurant",
  SUPERMARKET_MARKET: "Supermarket or public market",
  PORT_FERRY_TERMINAL: "Port or ferry terminal",
};

function formatKg(kg: number): string {
  return `${Math.round(kg).toLocaleString("en-US")} kg`;
}

function formatWhen(ms: number | null): string {
  if (ms == null) return "not yet";
  return new Date(ms).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function Row({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <div className="inspector-row">
      <span className="inspector-key">{label}</span>
      <span className="inspector-value">{value}</span>
    </div>
  );
}

function BatchRow({ batch }: { batch: ControlRoomBatch }): React.JSX.Element {
  return (
    <div className="inspector-row">
      <span className="inspector-key" style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span className={`status-dot ${STAGE_CLASS[batch.lastReportedStage]}`} aria-hidden="true" />
        {batch.crop} — {STAGE_WORDS[batch.lastReportedStage]}
      </span>
      <span className="inspector-value">
        {/* A grower's estimate is a report, never a confirmed fact — the
            simulation deliberately withholds true yield, and the label must
            not imply the interface knows better. */}
        {batch.latestEstimateKg == null ? "no estimate yet" : `${formatKg(batch.latestEstimateKg)} (grower's estimate)`}
      </span>
    </div>
  );
}

function FarmView({ farm, batches, reference, onClose }: { farm: ControlRoomScene["farms"][number]; batches: ControlRoomBatch[]; reference: ReferencePlace | undefined; onClose: () => void }): React.JSX.Element {
  const latestObservedAt = batches.reduce<number | null>((latest, batch) => {
    if (batch.lastObservedAt == null) return latest;
    return latest == null ? batch.lastObservedAt : Math.max(latest, batch.lastObservedAt);
  }, null);

  return (
    <>
      <Header title={farm.name} subtitle="Farm" onClose={onClose} />
      <div className="panel-body">
        <LinkedReference reference={reference} />
        <Row label="Last check-in" value={formatWhen(latestObservedAt)} />
        {batches.length === 0 ? (
          <p className="empty-state">No crop batches reported yet.</p>
        ) : (
          batches.map((batch) => <BatchRow key={batch.batchId} batch={batch} />)
        )}
      </div>
    </>
  );
}

function BuyerView({ buyer, demands, reference, onClose }: { buyer: ControlRoomScene["buyers"][number]; demands: ControlRoomDemand[]; reference: ReferencePlace | undefined; onClose: () => void }): React.JSX.Element {
  return (
    <>
      <Header title={buyer.name} subtitle="Buyer" onClose={onClose} />
      <div className="panel-body">
        <LinkedReference reference={reference} />
        {demands.length === 0 ? (
          <p className="empty-state">No orders placed yet.</p>
        ) : (
          demands.map((demand) => (
            <div className="inspector-row" key={demand.demandId}>
              <span className="inspector-key">
                {formatKg(demand.quantityKg)} of {demand.crop}
              </span>
              <span className="inspector-value">
                <span className={`pill ${DEMAND_PILL[demand.status]}`}>{DEMAND_WORDS[demand.status]}</span>
              </span>
            </div>
          ))
        )}
      </div>
    </>
  );
}

function TransporterView({
  transporter,
  missions,
  reference,
  onClose,
}: {
  transporter: ControlRoomScene["transporters"][number];
  missions: ControlRoomMission[];
  reference: ReferencePlace | undefined;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <>
      <Header title={transporter.name} subtitle="Transporter" onClose={onClose} />
      <div className="panel-body">
        <LinkedReference reference={reference} />
        <Row label="Capacity" value={formatKg(transporter.capacityKg)} />
        {missions.length === 0 ? (
          <p className="empty-state">No missions assigned yet.</p>
        ) : (
          missions.map((mission) => (
            <div className="inspector-row" key={mission.missionId}>
              <span className="inspector-key">{formatKg(mission.loadedKg)} load</span>
              <span className="inspector-value">
                <span className={`pill ${MISSION_PILL[mission.status]}`}>{mission.status.toLowerCase()}</span>
              </span>
            </div>
          ))
        )}
      </div>
    </>
  );
}

function MissionView({ mission, onClose }: { mission: ControlRoomMission; onClose: () => void }): React.JSX.Element {
  const late = mission.actualArrivalAt != null && mission.actualArrivalAt > mission.plannedArrivalAt;

  return (
    <>
      <Header title="Delivery mission" subtitle="Mission" onClose={onClose} />
      <div className="panel-body">
        <Row label="Status" value={<span className={`pill ${MISSION_PILL[mission.status]}`}>{mission.status.toLowerCase()}</span>} />
        <Row label="Load" value={formatKg(mission.loadedKg)} />
        <Row label="Planned arrival" value={formatWhen(mission.plannedArrivalAt)} />
        <Row label="Actual arrival" value={mission.actualArrivalAt == null ? "not yet arrived" : formatWhen(mission.actualArrivalAt)} />
        <Row label="Running late" value={late ? "yes" : "no"} />
      </div>
    </>
  );
}

function DisruptionView({ disruption, onClose }: { disruption: ControlRoomFrame["disruptions"][number]; onClose: () => void }): React.JSX.Element {
  return (
    <>
      <Header title="Disruption" subtitle={disruption.type.toLowerCase()} onClose={onClose} />
      <div className="panel-body">
        <Row label="Description" value={disruption.description} />
        <Row label="Became visible" value={formatWhen(Date.parse(disruption.observedAt))} />
      </div>
    </>
  );
}

function LinkedReference({ reference }: { reference: ReferencePlace | undefined }): React.JSX.Element | null {
  if (!reference) return null;
  return (
    <div className="reference-notice">
      <strong>Nearby public reference</strong>
      <span>{reference.name} · {REFERENCE_CATEGORY[reference.category]}</span>
    </div>
  );
}

function ReferencePlaceView({ place, source, onClose }: { place: ReferencePlace; source: ReferenceDataSource | undefined; onClose: () => void }): React.JSX.Element {
  return (
    <>
      <Header title={place.name} subtitle="Reference location" onClose={onClose} />
      <div className="panel-body">
        <Row label="Category" value={REFERENCE_CATEGORY[place.category]} />
        <Row label="Evidence" value={place.evidenceType.replaceAll("_", " ").toLowerCase()} />
        <Row label="Retrieved" value={place.retrievedAt} />
        <Row label="Source" value={<a href={place.sourceUrl} target="_blank" rel="noreferrer">{source?.publisher ?? place.sourceId}</a>} />
        <Row label="Licence" value={source ? <a href={source.licenceUrl} target="_blank" rel="noreferrer">{source.licenceName}</a> : "not recorded"} />
        {place.warnings.map((warning) => <p className="panel-help" key={warning}>{warning}</p>)}
      </div>
    </>
  );
}

function safeReference(value: string | undefined) {
  return value ? value.slice(0, 8) : "not recorded";
}

function AgentActionView({ action, scene, onClose, onPreview }: { action: SimulationAgentAction; scene: ControlRoomScene; onClose: () => void; onPreview?: (action: SimulationAgentAction) => void }): React.JSX.Element {
  const participant = scene.participants.find((item) => item.simulationActorId === action.simulationActorId);
  return (
    <>
      <Header title={participant?.displayName ?? action.role.toLowerCase()} subtitle="Agent action" onClose={onClose} />
      <div className="panel-body">
        {/* Above the rows, not after them: the Inspector is a short panel and a
            preview offered below its fold is a preview nobody finds. */}
        {onPreview && (
          <>
            <button type="button" className="run-button participant-button preview-button" onClick={() => onPreview(action)}>
              Preview in Harvest
            </button>
          </>
        )}
        <Row label="Role" value={action.role.toLowerCase()} />
        <Row label="Tool" value={action.toolName.replaceAll("_", " ")} />
        <Row label="Status" value={<span className={`pill ${action.status === "SUCCEEDED" ? "pill-good" : "pill-bad"}`}>{action.status.toLowerCase()}</span>} />
        <Row label="Decision adapter" value={action.adapter} />
        {/* Only forecast-producing tools carry a method, so its absence is meaningful. */}
        {action.estimationMode && (
          <Row label="Harvest estimation" value={action.estimationMode === "LEARNED_MODEL" ? "learned model" : "deterministic fallback"} />
        )}
        <Row label="Simulation time" value={formatWhen(Date.parse(action.at))} />
        <Row label="Approval" value={action.approval === "SYNTHETIC_PARTICIPANT" ? "Participant decision" : "Not required"} />
        <Row label="Summary" value={action.summary} />
        <Row label="Trace" value={safeReference(action.traceId)} />
        <Row label="Entity" value={safeReference(action.entityId)} />
        <Row label="Events" value={action.eventIds.length ? action.eventIds.map((id) => id.slice(0, 8)).join(", ") : "none"} />
        {action.correlationId && <Row label="Correlation" value={safeReference(action.correlationId)} />}
        {action.causationId && <Row label="Causation" value={safeReference(action.causationId)} />}
      </div>
    </>
  );
}

function Header({ title, subtitle, onClose }: { title: string; subtitle: string; onClose: () => void }): React.JSX.Element {
  return (
    <header className="panel-header">
      <span className="panel-title">
        {subtitle} — {title}
      </span>
      <button type="button" className="pill" onClick={onClose} aria-label="Close inspector selection">
        Close
      </button>
    </header>
  );
}

export default function Inspector({ scene, frame, selectedId, selectedAction, onClose, onPreviewAction }: InspectorProps): React.JSX.Element {
  if (selectedAction) {
    return <section className="panel"><AgentActionView action={selectedAction} scene={scene} onClose={onClose} onPreview={onPreviewAction} /></section>;
  }
  if (!selectedId) {
    return (
      <section className="panel">
        <header className="panel-header">
          <span className="panel-title">Inspector</span>
        </header>
        <div className="panel-body">
          <p className="empty-state">Nothing selected</p>
        </div>
      </section>
    );
  }

  const farm = scene.farms.find((f) => f.farmId === selectedId);
  if (farm) {
    return (
      <section className="panel">
        <FarmView farm={farm} batches={frame.batches.filter((b) => b.farmId === selectedId)} reference={scene.referencePlaces.find((place) => place.referencePlaceId === farm.referencePlaceId)} onClose={onClose} />
      </section>
    );
  }

  const buyer = scene.buyers.find((b) => b.buyerId === selectedId);
  if (buyer) {
    return (
      <section className="panel">
        <BuyerView buyer={buyer} demands={frame.demands.filter((d) => d.buyerId === selectedId)} reference={scene.referencePlaces.find((place) => place.referencePlaceId === buyer.referencePlaceId)} onClose={onClose} />
      </section>
    );
  }

  const transporter = scene.transporters.find((t) => t.transporterId === selectedId);
  if (transporter) {
    return (
      <section className="panel">
        <TransporterView transporter={transporter} missions={frame.missions.filter((m) => m.transporterId === selectedId)} reference={scene.referencePlaces.find((place) => place.referencePlaceId === transporter.referencePlaceId)} onClose={onClose} />
      </section>
    );
  }

  const mission = frame.missions.find((m) => m.missionId === selectedId);
  if (mission) {
    return (
      <section className="panel">
        <MissionView mission={mission} onClose={onClose} />
      </section>
    );
  }

  const disruption = frame.disruptions.find((d) => d.eventId === selectedId);
  if (disruption) {
    return (
      <section className="panel">
        <DisruptionView disruption={disruption} onClose={onClose} />
      </section>
    );
  }

  const referencePlace = scene.referencePlaces.find((place) => place.referencePlaceId === selectedId);
  if (referencePlace) {
    return (
      <section className="panel">
        <ReferencePlaceView place={referencePlace} source={scene.referenceDataSources.find((source) => source.sourceId === referencePlace.sourceId)} onClose={onClose} />
      </section>
    );
  }

  // The id came from a past frame (e.g. a cleared disruption) and no longer
  // resolves against the current one — say so rather than showing nothing.
  return (
    <section className="panel">
      <header className="panel-header">
        <span className="panel-title">Inspector</span>
        <button type="button" className="pill" onClick={onClose} aria-label="Close inspector selection">
          Close
        </button>
      </header>
      <div className="panel-body">
        <p className="empty-state">That item is no longer present at this point in the run.</p>
      </div>
    </section>
  );
}
