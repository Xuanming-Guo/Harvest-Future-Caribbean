/**
 * The window message the control room sends into an embedded participant
 * website so it can reenact one saved simulated action.
 *
 * This is browser-to-browser presentation glue between two Harvest front ends,
 * not a Product API operation or a domain event, so it is defined here rather
 * than in `contracts/`. It is still a cross-application interface, which is why
 * it lives in one place instead of being written twice.
 *
 * Everything here is SAFE state, in the same sense as a replay frame: it is
 * handed to another document, so a private field reaching it would publish it.
 * The payload is built by naming fields one at a time (see the control room's
 * `toActionPreviewMessage`), never by spreading a recorded action, so a new
 * private field on `SimulationAgentAction` cannot ride along. It carries no
 * chain-of-thought, no hidden simulation truth, and nothing belonging to any
 * participant other than the one whose read-only session opened the frame.
 */

export const ACTION_PREVIEW_MESSAGE = "harvest.action-preview" as const;
export const ACTION_PREVIEW_READY = "harvest.action-preview.ready" as const;

export type ActionPreviewRole = "FARMER" | "BUYER" | "TRANSPORTER" | "COORDINATOR";
export type ActionPreviewStatus = "SUCCEEDED" | "REJECTED";

/** Control room to website: what to reenact. */
export interface ActionPreviewMessage {
  type: typeof ACTION_PREVIEW_MESSAGE;
  /** Correlates the message with the `?preview=` flag already in the frame URL. */
  actionId: string;
  /** A `ProductTools` tool name, for example `publish_listing`. */
  tool: string;
  /** The outcome that was actually recorded. A rejection stays a rejection. */
  status: ActionPreviewStatus;
  /** The action's own safe summary, already written for a reader. */
  summary: string;
  /** ISO simulation instant, not wall-clock time. */
  simulationTime: string;
  participantName: string;
  role: ActionPreviewRole;
  /** Safe Product API references the action touched, for entity routing. */
  entityIds: string[];
}

/** Website to control room: the frame is mounted and wants its payload. */
export interface ActionPreviewReadyMessage {
  type: typeof ACTION_PREVIEW_READY;
  actionId: string | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

export function isActionPreviewMessage(value: unknown): value is ActionPreviewMessage {
  const message = record(value);
  if (!message || message.type !== ACTION_PREVIEW_MESSAGE) return false;
  return typeof message.actionId === "string"
    && typeof message.tool === "string"
    && (message.status === "SUCCEEDED" || message.status === "REJECTED")
    && typeof message.summary === "string"
    && typeof message.simulationTime === "string"
    && typeof message.participantName === "string"
    && typeof message.role === "string"
    && Array.isArray(message.entityIds)
    && message.entityIds.every((entityId) => typeof entityId === "string");
}

export function isActionPreviewReadyMessage(value: unknown): value is ActionPreviewReadyMessage {
  const message = record(value);
  if (!message || message.type !== ACTION_PREVIEW_READY) return false;
  return typeof message.actionId === "string" || message.actionId === null;
}
