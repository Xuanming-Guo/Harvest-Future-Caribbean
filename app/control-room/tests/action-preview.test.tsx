/**
 * The control-room half of the reenactment: offering it on a selected action,
 * and handing the embedded website exactly the fields it is allowed to see.
 *
 * The payload assertion is deliberately exact rather than a subset check. The
 * risk this feature carries is a private field crossing into another document,
 * and a subset check would pass while one rode along.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ControlRoomFrame, ControlRoomScene, SimulationAgentAction, SimulationParticipant } from "@harvest/simulation";
import { ACTION_PREVIEW_MESSAGE, ACTION_PREVIEW_READY } from "@harvest/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import ActionPreview from "@/components/panels/ActionPreview";
import Inspector from "@/components/panels/Inspector";
import { PARTICIPANT_WEBSITE_ORIGIN, actionPreviewFrameUrl, toActionPreviewMessage } from "@/lib/action-preview";

const participant: SimulationParticipant = {
  simulationActorId: "10000000-0000-4000-8000-000000000001",
  productActorId: "20000000-0000-4000-8000-000000000001",
  role: "FARMER",
  displayName: "Mabouya Valley smallholding",
  islandId: "saint-lucia",
};

const scene = { participants: [participant], farms: [], buyers: [], transporters: [], roads: [] } as unknown as ControlRoomScene;
const frame = { batches: [], demands: [], missions: [], disruptions: [] } as unknown as ControlRoomFrame;

const action: SimulationAgentAction = {
  actionId: "30000000-0000-4000-8000-000000000001",
  at: "2026-09-03T06:00:00.000Z",
  simulationActorId: participant.simulationActorId,
  productActorId: participant.productActorId!,
  role: "FARMER",
  toolName: "publish_listing",
  status: "SUCCEEDED",
  summary: "Published 120.00 kg of cucumber at EC$4.50 per kg.",
  traceId: "40000000-0000-4000-8000-000000000001",
  entityId: "50000000-0000-4000-8000-000000000001",
  eventIds: ["60000000-0000-4000-8000-000000000001"],
  adapter: "deterministic",
  approval: "NONE",
  correlationId: "70000000-0000-4000-8000-000000000001",
  causationId: "80000000-0000-4000-8000-000000000001",
};

afterEach(cleanup);

describe("preview in Harvest", () => {
  it("offers the preview on a selected saved action", () => {
    const onPreviewAction = vi.fn();
    render(<Inspector scene={scene} frame={frame} selectedId={null} selectedAction={action} onClose={vi.fn()} onPreviewAction={onPreviewAction} />);

    const button = screen.getByRole("button", { name: "Preview in Harvest" });
    expect(screen.getByText(/replay of a typed Product API action, not browser automation/i)).toBeInTheDocument();
    fireEvent.click(button);
    expect(onPreviewAction).toHaveBeenCalledWith(action);
  });

  it("hides the preview when a run cannot produce a participant session", () => {
    render(<Inspector scene={scene} frame={frame} selectedId={null} selectedAction={action} onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Preview in Harvest" })).not.toBeInTheDocument();
  });

  it("sends the safe fields and only the safe fields", () => {
    const message = toActionPreviewMessage(action, participant);

    expect(message).toEqual({
      type: ACTION_PREVIEW_MESSAGE,
      actionId: action.actionId,
      tool: "publish_listing",
      status: "SUCCEEDED",
      summary: action.summary,
      simulationTime: action.at,
      participantName: "Mabouya Valley smallholding",
      role: "FARMER",
      entityIds: [action.entityId],
    });
    const serialised = JSON.stringify(message);
    for (const secret of [action.traceId!, action.correlationId!, action.causationId!, action.adapter, action.eventIds[0], action.simulationActorId]) {
      expect(serialised).not.toContain(secret);
    }
  });

  it("keeps a rejection a rejection", () => {
    const rejected = toActionPreviewMessage({ ...action, status: "REJECTED", summary: "Rejected: only 40.00 kg is safe to promise." }, participant);
    expect(rejected.status).toBe("REJECTED");
  });

  it("opens the frame on the read-only participant session and flags the action", () => {
    const url = new URL(actionPreviewFrameUrl("replay-token", action.actionId));
    expect(url.origin).toBe(PARTICIPANT_WEBSITE_ORIGIN);
    expect(url.searchParams.get("preview")).toBe(action.actionId);
    expect(url.hash).toBe("#harvest_access_token=replay-token");
  });

  it("posts the payload into the frame when the workspace asks for it", () => {
    const postMessage = vi.fn();
    const contentWindow = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "contentWindow")!;
    Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", { configurable: true, get: () => ({ postMessage }) });
    const message = toActionPreviewMessage(action, participant);
    try {
      render(<ActionPreview message={message} frameUrl={actionPreviewFrameUrl("replay-token", action.actionId)} error={null} onClose={vi.fn()} />);
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: ACTION_PREVIEW_READY, actionId: action.actionId },
        origin: PARTICIPANT_WEBSITE_ORIGIN,
      }));
      expect(postMessage).toHaveBeenCalledWith(message, PARTICIPANT_WEBSITE_ORIGIN);
    } finally {
      Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", contentWindow);
    }
  });

  it("ignores a request that did not come from the participant website", () => {
    const postMessage = vi.fn();
    const contentWindow = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "contentWindow")!;
    Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", { configurable: true, get: () => ({ postMessage }) });
    try {
      render(<ActionPreview message={toActionPreviewMessage(action, participant)} frameUrl="http://localhost:3000/?preview=x" error={null} onClose={vi.fn()} />);
      postMessage.mockClear();
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: ACTION_PREVIEW_READY, actionId: action.actionId },
        origin: "https://not-the-website.example",
      }));
      expect(postMessage).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", contentWindow);
    }
  });

  it("closes on demand and states that it is a replay, not browser automation", () => {
    const onClose = vi.fn();
    render(<ActionPreview message={toActionPreviewMessage(action, participant)} frameUrl={null} error={null} onClose={onClose} />);

    expect(screen.getByText(/Replay of a typed Product API action, not browser automation/)).toBeInTheDocument();
    expect(screen.getByText(/Opening the participant/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close the Harvest preview" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("reports a session it could not open instead of showing an empty frame", () => {
    render(<ActionPreview message={toActionPreviewMessage(action, participant)} frameUrl={null} error="Participant replay requires a completed Harvest run." onClose={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Participant replay requires a completed Harvest run.");
    expect(document.querySelector("iframe")).toBeNull();
  });
});
