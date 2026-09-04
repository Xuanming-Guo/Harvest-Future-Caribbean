/**
 * Turns a selected agent action into the safe payload the embedded participant
 * website is allowed to see, and into the frame URL that carries the existing
 * read-only participant session.
 *
 * The payload is assembled field by field on purpose, exactly as the replay
 * projection is. Spreading a `SimulationAgentAction` would silently forward
 * whatever is added to it later; naming the fields means a new private one has
 * to be added here deliberately before it can cross into another document.
 *
 * Trace, correlation and causation ids stay in the Inspector. They are safe to
 * show a judge in the control room, but the preview is about the participant's
 * own view of their own action, so they are not sent into the frame.
 */

import {
  ACTION_PREVIEW_MESSAGE,
  type ActionPreviewMessage,
  type ActionPreviewRole,
} from "@harvest/shared";
import type { SimulationAgentAction, SimulationParticipant } from "@harvest/simulation";

import { PARTICIPANT_WEBSITE_URL } from "./run";

export const PARTICIPANT_WEBSITE_ORIGIN = new URL(PARTICIPANT_WEBSITE_URL).origin;

export function toActionPreviewMessage(
  action: SimulationAgentAction,
  participant: SimulationParticipant | undefined,
): ActionPreviewMessage {
  return {
    type: ACTION_PREVIEW_MESSAGE,
    actionId: action.actionId,
    tool: action.toolName,
    status: action.status,
    summary: action.summary,
    simulationTime: action.at,
    participantName: participant?.displayName ?? action.role.toLowerCase(),
    role: action.role as ActionPreviewRole,
    // `entityId` is the last event's entity, which differs per tool. The
    // website probes each reference before routing on it, so sending the ones
    // that exist is enough; guessing which is which here would not be.
    entityIds: action.entityId ? [action.entityId] : [],
  };
}

/**
 * The frame URL: the participant token in the fragment (consumed and stripped
 * by the website exactly as "Open participant website" does) plus the preview
 * flag in the query, which survives that strip.
 */
export function actionPreviewFrameUrl(accessToken: string, actionId: string) {
  return `${PARTICIPANT_WEBSITE_URL}/?preview=${encodeURIComponent(actionId)}#harvest_access_token=${encodeURIComponent(accessToken)}`;
}
