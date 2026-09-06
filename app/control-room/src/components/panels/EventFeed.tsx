"use client";

/**
 * Reverse-chronological log of what has happened in the run so far.
 *
 * Renders only its inner content — `page.tsx` supplies the surrounding
 * `panel`/`panel-header` chrome, because the same panel shell also hosts a
 * "return to island" affordance that belongs to the page, not this component.
 *
 * `frames` is a prefix of the full timeline (everything up to the playhead),
 * in chronological order, so consecutive entries can be diffed against one
 * another to work out *what changed* — that is the only way to turn an
 * event type into a sentence, because a frame is a snapshot of the whole
 * world rather than a record of the one thing that just happened.
 *
 * `scene` names the ids that appear in a frame (farm/buyer/transporter are
 * opaque UUIDs with no display name of their own): "important state changes
 * ... understandable without reading raw logs" means a sentence should read
 * "Rodney Bay resort kitchen ordered 220 kg", not "New order for 220 kg".
 * The lookup is built once per `scene` via `useMemo`, not per feed item —
 * this panel re-renders on every playback frame.
 */

import { useMemo } from "react";
import type { ControlRoomBatch, ControlRoomDemand, ControlRoomFrame, ControlRoomMission, ControlRoomScene, SimulationAgentAction } from "@harvest/simulation";
import { describeEvent, isAlertEvent, isNotableEvent } from "@/lib/run";

export interface EventFeedProps {
  scene: ControlRoomScene;
  frames: ControlRoomFrame[];
  onSelect: (id: string | null) => void;
  onSelectAction: (action: SimulationAgentAction) => void;
  maxItems?: number;
}

/** Id-to-name lookups, built once per scene rather than once per feed item. */
interface NameLookup {
  farm: Map<string, string>;
  buyer: Map<string, string>;
  transporter: Map<string, string>;
}

function buildNameLookup(scene: ControlRoomScene): NameLookup {
  return {
    farm: new Map(scene.farms.map((f) => [f.farmId, f.name])),
    buyer: new Map(scene.buyers.map((b) => [b.buyerId, b.name])),
    transporter: new Map(scene.transporters.map((t) => [t.transporterId, t.name])),
  };
}

const STAGE_WORDS: Record<string, string> = {
  PLANTED: "planted",
  GROWING: "growing",
  MATURING: "maturing",
  READY: "ready to harvest",
  HARVESTED: "harvested",
  SPOILED: "spoiled",
};

const DEMAND_STATUS_WORDS: Record<string, string> = {
  PENDING: "awaiting a match",
  COMMITTED: "matched to supply",
  FULFILLED: "fully delivered",
  PARTIALLY_FULFILLED: "partially delivered",
  UNMET: "unmet",
};

function formatKg(kg: number): string {
  return `${Math.round(kg).toLocaleString("en-US")} kg`;
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

interface FeedEntry {
  text: string;
  entityId: string | null;
}

/** The one grower estimate a batch carries, worded as a report rather than a fact. */
function estimateClause(batch: ControlRoomBatch): string {
  return batch.latestEstimateKg == null ? "" : `, grower's estimate ${formatKg(batch.latestEstimateKg)}`;
}

/** Finds what changed between two whole-world snapshots, by id, in either list. */
function diffById<T>(before: T[] | undefined, after: T[], id: (item: T) => string): { added: T[]; changed: Array<[T, T]>; removed: T[] } {
  const beforeMap = new Map((before ?? []).map((item) => [id(item), item]));
  const afterMap = new Map(after.map((item) => [id(item), item]));
  const added: T[] = [];
  const changed: Array<[T, T]> = [];
  for (const [key, item] of afterMap) {
    const previous = beforeMap.get(key);
    if (!previous) added.push(item);
    else if (JSON.stringify(previous) !== JSON.stringify(item)) changed.push([previous, item]);
  }
  const removed: T[] = [];
  for (const [key, item] of beforeMap) {
    if (!afterMap.has(key)) removed.push(item);
  }
  return { added, changed, removed };
}

/**
 * Builds a plain-English sentence for one notable frame, diffed against the
 * one before it. Names come from the scene lookup where they resolve; a miss
 * degrades the sentence to a slightly vaguer but still valid one rather than
 * ever interpolating "undefined" or a raw UUID.
 */
function describeFrame(frame: ControlRoomFrame, previous: ControlRoomFrame | undefined, names: NameLookup): FeedEntry {
  switch (frame.eventType) {
    case "FARMER_OBSERVATION": {
      const observed = frame.batches.find((batch) => batch.lastObservedAt === frame.atMs);
      if (observed) {
        const farmName = names.farm.get(observed.farmId);
        const stage = STAGE_WORDS[observed.lastReportedStage] ?? observed.lastReportedStage.toLowerCase();
        return {
          text: farmName
            ? `${farmName}: ${observed.crop} is ${stage}${estimateClause(observed)}.`
            : `A ${observed.crop} batch was reported ${stage}${estimateClause(observed)}.`,
          entityId: observed.farmId,
        };
      }
      break;
    }
    case "BUYER_DEMAND": {
      const { added } = diffById<ControlRoomDemand>(previous?.demands, frame.demands, (d) => d.demandId);
      const demand = added[0];
      if (demand) {
        const buyerName = names.buyer.get(demand.buyerId);
        const subject = buyerName ? `${buyerName} ordered` : "New order for";
        return {
          text: `${subject} ${formatKg(demand.quantityKg)} of ${demand.crop}, needed by ${formatDate(demand.neededBy)}.`,
          entityId: demand.buyerId,
        };
      }
      break;
    }
    case "PLAN_ALLOCATION": {
      const { changed } = diffById<ControlRoomDemand>(previous?.demands, frame.demands, (d) => d.demandId);
      const pair = changed.find(([, after]) => after.acceptedKg > 0 || after.status !== "PENDING");
      if (pair) {
        const [, demand] = pair;
        const buyerName = names.buyer.get(demand.buyerId);
        const subject = buyerName ? `${buyerName}'s order` : "Order";
        const substitution = demand.substitutedKg > 0 ? `, ${formatKg(demand.substitutedKg)} substituted` : "";
        return {
          text: `${subject} for ${demand.crop} is now ${DEMAND_STATUS_WORDS[demand.status] ?? demand.status.toLowerCase()} (${formatKg(demand.acceptedKg)} accepted${substitution}).`,
          entityId: demand.buyerId,
        };
      }
      break;
    }
    case "MISSION_DEPART": {
      const { changed, added } = diffById<ControlRoomMission>(previous?.missions, frame.missions, (m) => m.missionId);
      const mission = added.find((m) => m.status === "ACTIVE") ?? changed.find(([, after]) => after.status === "ACTIVE")?.[1];
      if (mission) {
        const transporterName = names.transporter.get(mission.transporterId);
        const subject = transporterName ?? "A vehicle";
        return { text: `${subject} departed carrying ${formatKg(mission.loadedKg)}.`, entityId: mission.missionId };
      }
      break;
    }
    case "MISSION_ARRIVE": {
      const { changed } = diffById<ControlRoomMission>(previous?.missions, frame.missions, (m) => m.missionId);
      const pair = changed.find(([, after]) => after.status === "COMPLETED" || after.status === "DELAYED");
      if (pair) {
        const [, mission] = pair;
        const late = mission.actualArrivalAt != null && mission.actualArrivalAt > mission.plannedArrivalAt;
        const transporterName = names.transporter.get(mission.transporterId);
        const subject = transporterName ? `${transporterName} delivered` : "Delivery arrived with";
        return {
          text: `${subject} ${formatKg(mission.loadedKg)}${late ? ", running late" : ""}.`,
          entityId: mission.missionId,
        };
      }
      break;
    }
    case "DISRUPTION_START": {
      const { added } = diffById(previous?.disruptions, frame.disruptions, (d) => d.eventId);
      const disruption = added[0];
      if (disruption) {
        return { text: `${disruption.description}`, entityId: disruption.eventId };
      }
      break;
    }
    case "DISRUPTION_END": {
      const { removed } = diffById(previous?.disruptions, frame.disruptions, (d) => d.eventId);
      const disruption = removed[0];
      if (disruption) {
        return { text: `Disruption cleared: ${disruption.description}`, entityId: disruption.eventId };
      }
      break;
    }
    case "DEMAND_DEADLINE": {
      const { changed } = diffById<ControlRoomDemand>(previous?.demands, frame.demands, (d) => d.demandId);
      const pair = changed.find(([, after]) => after.status === "UNMET" || after.status === "PARTIALLY_FULFILLED");
      if (pair) {
        const [, demand] = pair;
        const buyerName = names.buyer.get(demand.buyerId);
        const subject = buyerName ? `${buyerName}'s order` : "An order";
        return {
          text: `${subject} for ${formatKg(demand.quantityKg)} of ${demand.crop} passed its deadline, ${DEMAND_STATUS_WORDS[demand.status] ?? demand.status.toLowerCase()}.`,
          entityId: demand.buyerId,
        };
      }
      break;
    }
    default:
      break;
  }

  // A decision's own summary is already a human sentence — prefer it as a
  // fallback before resorting to a generic label built off the event type.
  const decision = frame.newDecisions[0];
  if (decision) return { text: decision.summary, entityId: null };

  return { text: describeEvent(frame.eventType), entityId: null };
}

export default function EventFeed({ scene, frames, onSelect, onSelectAction, maxItems = 40 }: EventFeedProps): React.JSX.Element {
  const names = useMemo(() => buildNameLookup(scene), [scene]);

  const notable: Array<{ index: number; frame: ControlRoomFrame; previous: ControlRoomFrame | undefined }> = [];
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index] as ControlRoomFrame;
    if (isNotableEvent(frame.eventType)) notable.push({ index, frame, previous: frames[index - 1] });
  }

  const physicalItems = notable.map(({ index, frame, previous }) => ({
    key: `frame-${index}`,
    kind: "physical" as const,
    at: frame.atMs,
    frame,
    previous,
  }));
  const agentItems = frames.flatMap((frame) => (frame.agentActions ?? []).map((action) => ({
    kind: "agent" as const,
    at: Date.parse(action.at),
    action,
  })));
  const items = [...physicalItems, ...agentItems]
    .sort((left, right) => right.at - left.at)
    .slice(0, maxItems);

  if (items.length === 0) {
    return <p className="empty-state">Nothing notable has happened yet.</p>;
  }

  return (
    <div className="feed">
      {items.map((item) => {
        if (item.kind === "agent") {
          const participant = scene.participants.find((candidate) => candidate.simulationActorId === item.action.simulationActorId);
          return (
            <button
              key={`action-${item.action.actionId}`}
              type="button"
              className={`feed-item is-agent${item.action.status === "REJECTED" ? " is-alert" : ""}`}
              onClick={() => onSelectAction(item.action)}
            >
              <span className="feed-time">{formatTime(item.at)}</span>
              <span>
                <span className="feed-kind">{participant?.displayName ?? item.action.role} · {item.action.adapter}</span>
                <span className="feed-text">{item.action.summary}</span>
              </span>
            </button>
          );
        }
        const { frame, previous } = item;
        const entry = describeFrame(frame, previous, names);
        const alert = isAlertEvent(frame.eventType);
        const decided = frame.newDecisions.length > 0;
        const classes = ["feed-item", alert && "is-alert", decided && "is-decision"].filter(Boolean).join(" ");

        return (
          <button
            key={item.key}
            type="button"
            className={classes}
            onClick={() => onSelect(entry.entityId)}
            aria-label={`${describeEvent(frame.eventType)}: ${entry.text}`}
          >
            <span className="feed-time">{formatTime(frame.atMs)}</span>
            <span>
              <span className="feed-kind">{describeEvent(frame.eventType)}</span>
              <span className="feed-text">{entry.text}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
