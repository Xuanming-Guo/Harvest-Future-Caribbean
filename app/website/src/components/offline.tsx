"use client";

import { RefreshCw, WifiOff } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";

import { formatClock, formatDate, titleCase } from "@/lib/format";
import { isOnline, readCacheTimestamp, subscribeToConnection } from "@/lib/offline";
import {
  OUTBOX_STATUS_LABELS,
  readOutbox,
  subscribeToOutbox,
  type ListingBody,
  type ObservationBody,
  type OutboxItem,
  type OutboxStatus,
} from "@/lib/outbox";
import { useSession } from "./providers";
import { Badge } from "./ui";

const OUTBOX_TONES: Record<OutboxStatus, string> = {
  saved: "in-transit",
  waiting: "pending",
  synced: "approved",
  attention: "high",
};

export function useOnlineStatus() {
  return useSyncExternalStore(subscribeToConnection, isOnline, () => true);
}

/** Queued writes belonging to the signed-in actor, refreshed as the queue moves. */
export function useOutbox(): OutboxItem[] {
  const { actor } = useSession();
  const authSubject = actor?.authSubject;
  const [items, setItems] = useState<OutboxItem[]>([]);

  useEffect(() => {
    if (!authSubject) {
      setItems([]);
      return;
    }
    const read = () => setItems(readOutbox({ authSubject }));
    read();
    return subscribeToOutbox(read);
  }, [authSubject]);

  return items;
}

/** Connection and queue state for the workspace header. */
export function ConnectionStatus() {
  const online = useOnlineStatus();
  const items = useOutbox();
  const [cachedAt, setCachedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!online) setCachedAt(readCacheTimestamp());
  }, [online]);

  const pending = items.filter((item) => item.status === "saved" || item.status === "waiting").length;
  const attention = items.filter((item) => item.status === "attention").length;
  if (online && !pending && !attention) return null;

  return (
    <div className="connection-status" role="status">
      {!online && (
        <Badge tone="pending">
          <WifiOff size={12} aria-hidden="true" />
          <span>{cachedAt ? `Offline · showing data from ${formatClock(cachedAt)}` : "Offline · showing saved data"}</span>
        </Badge>
      )}
      {pending > 0 && <Badge tone="in-transit"><span>{`${pending} update${pending === 1 ? "" : "s"} waiting to sync`}</span></Badge>}
      {attention > 0 && <Badge tone="high"><span>{`${attention} update${attention === 1 ? "" : "s"} need${attention === 1 ? "s" : ""} attention`}</span></Badge>}
    </div>
  );
}

/** One-line reason a control cannot be used until the device is back online. */
export function OfflineHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="offline-hint">
      <WifiOff size={14} aria-hidden="true" />
      {children}
    </p>
  );
}

export function OutboxStatusBadge({ status }: { status: OutboxStatus }) {
  return <Badge tone={OUTBOX_TONES[status]}><span>{OUTBOX_STATUS_LABELS[status]}</span></Badge>;
}

function describe(item: OutboxItem) {
  if (item.kind === "observation") {
    const body = item.body as ObservationBody;
    const quantity = body.estimatedQuantity ? `${body.estimatedQuantity.value} kg` : "no estimate";
    return `${titleCase(body.cropStage)} · ${quantity}`;
  }
  const body = item.body as ListingBody;
  return `${body.quantity.value} kg at EC$${body.unitPrice.amount} per kg`;
}

/**
 * Every update this device is holding, newest first. Nothing here has changed
 * operational state until it shows as synced.
 */
export function DeviceUpdateList({
  cropBatchId,
  onReview,
}: {
  cropBatchId?: string;
  onReview?: (item: OutboxItem) => void;
}) {
  const items = useOutbox().filter((item) => !cropBatchId || item.cropBatchId === cropBatchId);
  if (!items.length) return null;

  return (
    <div className="device-update-list">
      {[...items].reverse().map((item) => (
        <article className="device-update" key={item.id}>
          <div>
            <OutboxStatusBadge status={item.status} />
            <h3>{item.kind === "observation" ? "Crop update" : "Marketplace offer"}</h3>
            <p>{describe(item)}</p>
            <small>Written {formatDate(item.createdAt)}</small>
            {item.error && <small className="device-update-error">{item.error}</small>}
          </div>
          {item.status === "attention" &&
            (onReview ? (
              <button type="button" className="button button-secondary" onClick={() => onReview(item)}>
                <RefreshCw size={15} />Review and resend
              </button>
            ) : (
              <Link className="button button-secondary" href={`/crops/${item.cropBatchId}`}>
                <RefreshCw size={15} />Review and resend
              </Link>
            ))}
        </article>
      ))}
    </div>
  );
}
