"use client";

/**
 * Detail view for whatever is currently selected on the globe or in the feed.
 *
 * `selectedId` is untyped by design (it comes from map clicks and feed items
 * alike), so this resolves it against every collection the scene and frame
 * offer and renders whichever one matches. Owns its own `panel` wrapper,
 * unlike EventFeed and Legend, because it needs a close button in its header.
 */

import type { ControlRoomBatch, ControlRoomDemand, ControlRoomFrame, ControlRoomMission, ControlRoomScene, CropStage, SimulationAgentAction } from "@harvest/simulation";

export interface InspectorProps {
  scene: ControlRoomScene;
  frame: ControlRoomFrame;
  selectedId: string | null;
  selectedAction: SimulationAgentAction | null;
  onClose: () => void;
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

function FarmView({ farm, batches, onClose }: { farm: ControlRoomScene["farms"][number]; batches: ControlRoomBatch[]; onClose: () => void }): React.JSX.Element {
  const latestObservedAt = batches.reduce<number | null>((latest, batch) => {
    if (batch.lastObservedAt == null) return latest;
    return latest == null ? batch.lastObservedAt : Math.max(latest, batch.lastObservedAt);
  }, null);

  return (
    <>
      <Header title={farm.name} subtitle="Farm" onClose={onClose} />
      <div className="panel-body">
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

function BuyerView({ buyer, demands, onClose }: { buyer: ControlRoomScene["buyers"][number]; demands: ControlRoomDemand[]; onClose: () => void }): React.JSX.Element {
  return (
    <>
      <Header title={buyer.name} subtitle="Buyer" onClose={onClose} />
      <div className="panel-body">
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
  onClose,
}: {
  transporter: ControlRoomScene["transporters"][number];
  missions: ControlRoomMission[];
  onClose: () => void;
}): React.JSX.Element {
  return (
    <>
      <Header title={transporter.name} subtitle="Transporter" onClose={onClose} />
      <div className="panel-body">
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

function safeReference(value: string | undefined) {
  return value ? value.slice(0, 8) : "not recorded";
}

function AgentActionView({ action, scene, onClose }: { action: SimulationAgentAction; scene: ControlRoomScene; onClose: () => void }): React.JSX.Element {
  const participant = scene.participants.find((item) => item.simulationActorId === action.simulationActorId);
  return (
    <>
      <Header title={participant?.displayName ?? action.role.toLowerCase()} subtitle="Agent action" onClose={onClose} />
      <div className="panel-body">
        <Row label="Role" value={action.role.toLowerCase()} />
        <Row label="Tool" value={action.toolName.replaceAll("_", " ")} />
        <Row label="Status" value={<span className={`pill ${action.status === "SUCCEEDED" ? "pill-good" : "pill-bad"}`}>{action.status.toLowerCase()}</span>} />
        <Row label="Decision adapter" value={action.adapter} />
        <Row label="Simulation time" value={formatWhen(Date.parse(action.at))} />
        <Row label="Approval" value={action.approval === "SYNTHETIC_PARTICIPANT" ? "synthetic participant decision" : "not required by this action"} />
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

export default function Inspector({ scene, frame, selectedId, selectedAction, onClose }: InspectorProps): React.JSX.Element {
  if (selectedAction) {
    return <section className="panel"><AgentActionView action={selectedAction} scene={scene} onClose={onClose} /></section>;
  }
  if (!selectedId) {
    return (
      <section className="panel">
        <header className="panel-header">
          <span className="panel-title">Inspector</span>
        </header>
        <div className="panel-body">
          <p className="empty-state">Click a farm, buyer, vehicle or disruption marker on the globe — or an item in the feed — to see its detail here.</p>
        </div>
      </section>
    );
  }

  const farm = scene.farms.find((f) => f.farmId === selectedId);
  if (farm) {
    return (
      <section className="panel">
        <FarmView farm={farm} batches={frame.batches.filter((b) => b.farmId === selectedId)} onClose={onClose} />
      </section>
    );
  }

  const buyer = scene.buyers.find((b) => b.buyerId === selectedId);
  if (buyer) {
    return (
      <section className="panel">
        <BuyerView buyer={buyer} demands={frame.demands.filter((d) => d.buyerId === selectedId)} onClose={onClose} />
      </section>
    );
  }

  const transporter = scene.transporters.find((t) => t.transporterId === selectedId);
  if (transporter) {
    return (
      <section className="panel">
        <TransporterView transporter={transporter} missions={frame.missions.filter((m) => m.transporterId === selectedId)} onClose={onClose} />
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
