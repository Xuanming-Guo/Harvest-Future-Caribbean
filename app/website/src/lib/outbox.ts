import { newIdempotencyKey, type ApiSchema } from "@harvest/shared";

import { ApiProblem, api, type SessionActor } from "@/lib/api";

/**
 * Offline write queue for the only two updates a farmer must be able to record
 * without a connection. Everything else stays online-only on purpose: queuing a
 * commitment decision would let a stale device approve something twice.
 */
export const OUTBOX_PATHS = {
  observation: "/v1/crop-observations",
  listing: "/v1/listings",
} as const;

export type OutboxKind = keyof typeof OUTBOX_PATHS;
export type OutboxPath = (typeof OUTBOX_PATHS)[OutboxKind];
export type OutboxStatus = "saved" | "waiting" | "synced" | "attention";

export type ObservationBody = ApiSchema<"CropObservationCreate">;
export type ListingBody = ApiSchema<"ListingCreate">;

export interface OutboxItem {
  id: string;
  kind: OutboxKind;
  path: OutboxPath;
  body: ObservationBody | ListingBody;
  idempotencyKey: string;
  cropBatchId: string;
  /** Crop batch head this draft was written against, used to detect conflicts. */
  baseObservationId?: string;
  createdAt: string;
  status: OutboxStatus;
  error?: string;
}

export interface OutboxDraft {
  kind: OutboxKind;
  cropBatchId: string;
  body: ObservationBody | ListingBody;
  baseObservationId?: string;
}

/** Only the crop batch fields the conflict checks need. */
export interface OutboxBatchState {
  status: string;
  latestObservationId?: string;
  availableToPromise: { value: number };
}

export interface OutboxTransport {
  send(item: OutboxItem): Promise<{ observationId?: string }>;
  cropBatch(cropBatchId: string): Promise<OutboxBatchState>;
}

export type OutboxActor = Pick<SessionActor, "authSubject"> & Partial<Pick<SessionActor, "readOnly">>;

const STORAGE_PREFIX = "harvest.outbox.v1";
const LISTABLE_STATUSES = ["HARVEST_READY", "HARVESTED"];
const SYNCED_RETENTION_MS = 30 * 60 * 1000;

export const OUTBOX_STATUS_LABELS: Record<OutboxStatus, string> = {
  saved: "Saved on this device",
  waiting: "Waiting to sync",
  synced: "Synced",
  attention: "Needs attention",
};

const listeners = new Set<() => void>();

function storageKey(actor: OutboxActor) {
  return `${STORAGE_PREFIX}:${actor.authSubject}`;
}

function announce() {
  for (const listener of [...listeners]) listener();
}

/** Drops long-settled entries so the farmer list stays short without hiding work. */
function prune(items: OutboxItem[], now: number) {
  return items.filter((item) => item.status !== "synced" || now - Date.parse(item.createdAt) < SYNCED_RETENTION_MS);
}

export function readOutbox(actor: OutboxActor | null | undefined): OutboxItem[] {
  if (!actor || typeof window === "undefined") return [];
  const stored = window.localStorage.getItem(storageKey(actor));
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored) as OutboxItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeOutbox(actor: OutboxActor, items: OutboxItem[]) {
  if (typeof window === "undefined") return items;
  const kept = prune(items, Date.now());
  window.localStorage.setItem(storageKey(actor), JSON.stringify(kept));
  announce();
  return kept;
}

/**
 * Records a draft with the idempotency key it keeps for every later retry, so a
 * reconnection can never turn one farmer update into two stored updates.
 */
export function enqueueOutboxItem(actor: OutboxActor | null | undefined, draft: OutboxDraft): OutboxItem | null {
  if (!actor || actor.readOnly || typeof window === "undefined") return null;
  const item: OutboxItem = {
    id: newIdempotencyKey("outbox"),
    kind: draft.kind,
    path: OUTBOX_PATHS[draft.kind],
    body: draft.body,
    idempotencyKey: newIdempotencyKey(draft.kind),
    cropBatchId: draft.cropBatchId,
    baseObservationId: draft.baseObservationId,
    createdAt: new Date().toISOString(),
    status: "saved",
  };
  writeOutbox(actor, [...readOutbox(actor), item]);
  return item;
}

export function removeOutboxItem(actor: OutboxActor | null | undefined, id: string) {
  if (!actor) return [];
  return writeOutbox(actor, readOutbox(actor).filter((item) => item.id !== id));
}

export function subscribeToOutbox(listener: () => void) {
  listeners.add(listener);
  if (typeof window !== "undefined") window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", listener);
  };
}

/** Unsent crop-update form state, kept per crop batch so a reload loses nothing. */
export interface CropDraft {
  stage: string;
  quantity: number;
  notes: string;
  description: string;
}

const DRAFT_PREFIX = "harvest.crop-draft.v1";

function draftKey(actor: OutboxActor, cropBatchId: string) {
  return `${DRAFT_PREFIX}:${actor.authSubject}:${cropBatchId}`;
}

export function readCropDraft(actor: OutboxActor | null | undefined, cropBatchId: string): CropDraft | null {
  if (!actor || typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(draftKey(actor, cropBatchId));
  if (!stored) return null;
  try {
    return JSON.parse(stored) as CropDraft;
  } catch {
    return null;
  }
}

export function writeCropDraft(actor: OutboxActor | null | undefined, cropBatchId: string, draft: CropDraft) {
  if (!actor || actor.readOnly || typeof window === "undefined") return;
  window.localStorage.setItem(draftKey(actor, cropBatchId), JSON.stringify(draft));
}

export function clearCropDraft(actor: OutboxActor | null | undefined, cropBatchId: string) {
  if (!actor || typeof window === "undefined") return;
  window.localStorage.removeItem(draftKey(actor, cropBatchId));
}

const productTransport: OutboxTransport = {
  send: (item) =>
    item.path === OUTBOX_PATHS.observation
      ? api.submitObservation(item.body as ObservationBody, item.idempotencyKey)
      : api.createListing(item.body as ListingBody, item.idempotencyKey).then(() => ({})),
  cropBatch: (cropBatchId) => api.cropBatch(cropBatchId),
};

/** Returns why this queued write must not be sent, or null when it is still safe. */
function conflictReason(item: OutboxItem, batch: OutboxBatchState) {
  if (item.kind === "observation") {
    if ((batch.latestObservationId ?? null) !== (item.baseObservationId ?? null)) {
      return "This crop batch changed after you wrote the update. Review it and send it again.";
    }
    return null;
  }
  if (!LISTABLE_STATUSES.includes(batch.status)) {
    return `This crop batch is now ${batch.status.toLowerCase().replaceAll("_", " ")}, so it cannot be listed. Review the offer and send it again.`;
  }
  const requested = (item.body as ListingBody).quantity.value;
  if (requested > batch.availableToPromise.value) {
    return `Only ${batch.availableToPromise.value} kg is still safe to promise, less than the ${requested} kg you offered. Review the offer and send it again.`;
  }
  return null;
}

let running: Promise<OutboxItem[]> | null = null;

/**
 * Sends queued writes oldest first. A network failure stops the run and leaves
 * the remaining drafts waiting, so ordering survives a partial reconnection.
 */
export function flushOutbox(actor: OutboxActor | null | undefined, transport: OutboxTransport = productTransport) {
  if (!actor || actor.readOnly) return Promise.resolve<OutboxItem[]>([]);
  if (running) return running;
  running = runFlush(actor, transport).finally(() => {
    running = null;
  });
  return running;
}

async function runFlush(actor: OutboxActor, transport: OutboxTransport): Promise<OutboxItem[]> {
  const items = readOutbox(actor);
  if (!items.some((item) => item.status === "saved" || item.status === "waiting")) return items;

  let offline = typeof navigator !== "undefined" && navigator.onLine === false;
  for (const item of items) {
    if (item.status === "synced" || item.status === "attention") continue;
    if (offline) {
      item.status = "waiting";
      continue;
    }
    try {
      const conflict = conflictReason(item, await transport.cropBatch(item.cropBatchId));
      if (conflict) {
        item.status = "attention";
        item.error = conflict;
        continue;
      }
      const result = await transport.send(item);
      item.status = "synced";
      delete item.error;
      // Later drafts written against the same head now follow this update.
      if (item.kind === "observation" && result.observationId) {
        for (const next of items) {
          if (next.status !== "synced" && next.cropBatchId === item.cropBatchId && next.baseObservationId === item.baseObservationId) {
            next.baseObservationId = result.observationId;
          }
        }
      }
    } catch (error) {
      if (error instanceof ApiProblem) {
        item.status = "attention";
        item.error = error.message;
        continue;
      }
      // Anything that is not a Product API answer means the connection is gone.
      item.status = "waiting";
      offline = true;
    }
  }
  return writeOutbox(actor, items);
}
