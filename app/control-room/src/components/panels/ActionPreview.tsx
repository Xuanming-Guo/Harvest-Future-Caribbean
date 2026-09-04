"use client";

/**
 * Embedded read-only reenactment of one saved agent action.
 *
 * The frame is the real participant website on port 3000, opened with the same
 * 15-minute read-only session the "Open participant website" button uses. This
 * panel does not draw a copy of the product; a hand-built imitation would drift
 * from the thing it claims to show, and the point of the preview is that a
 * judge sees the actual interface.
 *
 * Nothing is replayed as input. The website receives a payload describing what
 * was recorded and rings the corresponding control itself, which is why the
 * header says so in as many words. Playback is untouched: this panel holds no
 * transport state and stopping or starting the timeline while it is open
 * changes nothing here.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { isActionPreviewReadyMessage, type ActionPreviewMessage } from "@harvest/shared";

import { PARTICIPANT_WEBSITE_ORIGIN } from "@/lib/action-preview";

export interface ActionPreviewProps {
  message: ActionPreviewMessage;
  frameUrl: string | null;
  error: string | null;
  onClose: () => void;
}

export default function ActionPreview({ message, frameUrl, error, onClose }: ActionPreviewProps): React.JSX.Element {
  const frame = useRef<HTMLIFrameElement>(null);
  const [delivered, setDelivered] = useState(false);

  const send = useCallback(() => {
    const target = frame.current?.contentWindow;
    if (!target) return;
    target.postMessage(message, PARTICIPANT_WEBSITE_ORIGIN);
    setDelivered(true);
  }, [message]);

  // The frame asks for its payload once it has a session and has mounted its
  // controller, so answering the request is the reliable path; posting on load
  // as well only shortens the wait when it is already listening.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== PARTICIPANT_WEBSITE_ORIGIN) return;
      if (!isActionPreviewReadyMessage(event.data)) return;
      if (event.data.actionId !== message.actionId) return;
      send();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [message.actionId, send]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <section className="action-preview-panel" role="dialog" aria-modal="false" aria-labelledby="action-preview-title">
      <header className="panel-header">
        <span className="panel-title" id="action-preview-title">
          Preview in Harvest — {message.participantName}
        </span>
        <button type="button" className="pill" onClick={onClose} aria-label="Close the Harvest preview">
          Close
        </button>
      </header>
      <p className="action-preview-provenance">
        Replay of a typed Product API action, not browser automation. The participant website below is open on a
        read-only replay session; nothing is submitted and the saved run cannot change.
      </p>
      <div className="action-preview-frame">
        {error ? (
          <p className="run-error" role="alert">{error}</p>
        ) : !frameUrl ? (
          <p className="empty-state">Opening the participant’s read-only session…</p>
        ) : (
          <iframe
            ref={frame}
            src={frameUrl}
            title={`${message.participantName}'s Harvest workspace, read-only replay`}
            onLoad={send}
            // The frame is same-product but a separate origin; keep it to what a
            // read-only reenactment needs and nothing more.
            sandbox="allow-scripts allow-same-origin"
            referrerPolicy="no-referrer"
          />
        )}
      </div>
      <p className="panel-help">
        {delivered
          ? "Sent this action's role, tool, safe summary, recorded outcome and simulation time. No private reasoning and no other participant's data."
          : "Waiting for the workspace to open its read-only session."}
      </p>
    </section>
  );
}
