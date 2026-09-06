"use client";

/**
 * Read-only reenactment of one saved simulated action, shown inside the normal
 * participant website.
 *
 * The control room embeds this website in a frame using the same 15-minute
 * read-only participant session as "Open participant website", adds
 * `?preview=<actionId>`, and posts the safe action payload in. This component
 * scrolls to the control a person would have used, rings it, and states what
 * was actually recorded next to it.
 *
 * It performs no action. The layer is inert (`pointer-events: none`), the
 * workspace is already inside a disabled fieldset, and the Product API refuses
 * every write from a replay session with `SIMULATION_RUN_IMMUTABLE`. Those are
 * three independent reasons a preview cannot change a saved run, and the
 * outermost one is the API's.
 *
 * It only ever runs for a read-only actor. A signed-in participant who lands on
 * a URL carrying `?preview=` sees their normal workspace and nothing else.
 */

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ACTION_PREVIEW_READY, isActionPreviewMessage, type ActionPreviewMessage } from "@harvest/shared";

import { api, type SessionActor } from "@/lib/api";
import {
  isUnmapped,
  previewActionIdFrom,
  previewTargetFor,
  resolvePreviewRoute,
  type PreviewEntityProbes,
  type ResolvedPreviewRoute,
} from "@/lib/action-preview";

/** Where the frame's parent is allowed to be. Anything else is ignored. */
const CONTROL_ROOM_ORIGIN = process.env.NEXT_PUBLIC_CONTROL_ROOM_URL ?? "http://localhost:3002";

const MEASURE_INTERVAL_MS = 250;

interface TargetBox {
  top: number;
  left: number;
  width: number;
  height: number;
}

function reducedMotion() {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Only a laid-out element can be ringed; a collapsed panel has no box. */
function visibleBox(selector: string): TargetBox | null {
  const element = document.querySelector(selector);
  if (!(element instanceof HTMLElement)) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return null;
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

function firstVisible(selectors: string[]): { selector: string; box: TargetBox } | null {
  for (const selector of selectors) {
    const box = visibleBox(selector);
    if (box) return { selector, box };
  }
  return null;
}

function formatSimulationTime(value: string) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Date(parsed).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function compactId(value: string) {
  return value.slice(0, 8);
}

function toolWords(tool: string) {
  return tool.replaceAll("_", " ");
}

/** Reads used only to check that a recorded reference matches its detail route. */
const probes: PreviewEntityProbes = {
  order: (id) => api.order(id).then((order) => ({ orderId: order.orderId })).catch(() => null),
  mission: (id) => api.mission(id).then((mission) => ({ missionId: mission.missionId })).catch(() => null),
  cropBatch: (id) => api.cropBatch(id).then((batch) => ({ cropBatchId: batch.cropBatchId })).catch(() => null),
  listing: (id) => api.listing(id).then((listing) => ({ cropBatchId: listing.cropBatchId })).catch(() => null),
};

export interface ActionPreviewCaptionProps {
  action: ActionPreviewMessage;
  control: string | null;
  located: boolean;
  unmappedReason: string | null;
  /** Which bottom corner the card sits in, so it never covers the ring. */
  side?: "left" | "right";
}

/** The card that says who did what, when, and what was recorded. */
export function ActionPreviewCaption({ action, control, located, unmappedReason, side = "right" }: ActionPreviewCaptionProps) {
  const rejected = action.status === "REJECTED";
  return (
    <aside className={`action-preview-caption${side === "left" ? " is-left" : ""}`} role="status" aria-live="polite">
      <p className="action-preview-eyebrow">Action replay</p>
      <h2>{action.participantName}</h2>
      <dl className="action-preview-facts">
        <div><dt>Role</dt><dd>{action.role.toLowerCase()}</dd></div>
        <div><dt>Simulation time</dt><dd>{formatSimulationTime(action.simulationTime)}</dd></div>
        <div><dt>Action</dt><dd>{toolWords(action.tool)}</dd></div>
        <div>
          <dt>Recorded outcome</dt>
          <dd>
            <span className={`action-preview-status${rejected ? " is-rejected" : ""}`}>
              {rejected ? "rejected" : "succeeded"}
            </span>
          </dd>
        </div>
        <div>
          <dt>Entity</dt>
          <dd>{action.entityIds.length ? action.entityIds.map(compactId).join(", ") : "not recorded"}</dd>
        </div>
      </dl>
      <p className="action-preview-summary">{action.summary}</p>
      {unmappedReason
        ? <p className="action-preview-note">{unmappedReason}</p>
        : control && (
          located
            ? <p className="action-preview-note">A person does this with <strong>{control}</strong>, highlighted here.</p>
            : <p className="action-preview-note">A person does this with <strong>{control}</strong>. It is not on screen at this point in the saved run, so the section that owns it is shown instead.</p>
        )}
    </aside>
  );
}

export function ActionPreviewController({ actor }: { actor: SessionActor }) {
  const pathname = usePathname();
  const router = useRouter();
  // Read from the location rather than `useSearchParams`, which would force a
  // Suspense boundary around the whole shell for a flag that never changes
  // within a preview session.
  const [requestedActionId, setRequestedActionId] = useState<string | null>(null);
  const [action, setAction] = useState<ActionPreviewMessage | null>(null);
  const [resolved, setResolved] = useState<ResolvedPreviewRoute | null>(null);
  const [box, setBox] = useState<TargetBox | null>(null);
  const [still] = useState(reducedMotion);
  const scrolled = useRef<string | null>(null);

  const target = action ? previewTargetFor(action.tool) : undefined;
  const unmappedReason = action
    ? isUnmapped(target)
      ? target.reason
      : target
        ? null
        : "No visual mapping for this action yet. The recorded detail above is the whole of what Harvest saved."
    : null;

  useEffect(() => {
    setRequestedActionId(previewActionIdFrom(window.location.search));
  }, [pathname]);

  // Ask the parent for the payload, and keep asking until it answers: the
  // control room may finish mounting the frame before its own state is ready.
  useEffect(() => {
    if (!requestedActionId || action) return;
    const ask = () => {
      window.parent?.postMessage({ type: ACTION_PREVIEW_READY, actionId: requestedActionId }, CONTROL_ROOM_ORIGIN);
    };
    ask();
    const retry = window.setInterval(ask, 400);
    return () => window.clearInterval(retry);
  }, [action, requestedActionId]);

  useEffect(() => {
    if (!requestedActionId) return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== CONTROL_ROOM_ORIGIN) return;
      if (!isActionPreviewMessage(event.data)) return;
      if (event.data.actionId !== requestedActionId) return;
      const payload = event.data;
      setAction((current) => (current?.actionId === payload.actionId ? current : payload));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [requestedActionId]);

  // Work out which page hosts the equivalent control, then go there. The
  // `?preview=` flag is carried across so a reload keeps the preview alive.
  useEffect(() => {
    if (!action) return;
    let cancelled = false;
    void (async () => {
      const route = await resolvePreviewRoute(action.tool, action.role, action.entityIds, probes);
      if (cancelled || !route) return;
      setResolved(route);
      const [path, hash] = route.route.split("#");
      if (path && path !== pathname) {
        router.replace(`${path}?preview=${encodeURIComponent(action.actionId)}${hash ? `#${hash}` : ""}`);
      }
    })();
    return () => { cancelled = true; };
  }, [action, pathname, router]);

  const measure = useCallback(() => {
    if (!resolved) return;
    const found = firstVisible(resolved.targets);
    setBox(found?.box ?? null);
    if (found && scrolled.current !== found.selector) {
      scrolled.current = found.selector;
      document.querySelector(found.selector)?.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });
    }
  }, [resolved, still]);

  // Participant pages poll every five seconds, so a target can appear well
  // after the route settles. Re-measure on a timer rather than once on mount.
  useEffect(() => {
    if (!resolved) return;
    measure();
    const interval = window.setInterval(measure, MEASURE_INTERVAL_MS);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [measure, resolved]);

  const ringStyle = useMemo(() => box && ({
    top: Math.max(6, box.top - 8),
    left: Math.max(6, box.left - 8),
    width: box.width + 16,
    height: box.height + 16,
  }), [box]);

  /**
   * The card goes in the bottom corner away from the ring. Deciding from which
   * half of the window the ring is in, rather than from the card's own measured
   * box, keeps the choice stable: measuring the card would move it, which would
   * change the measurement.
   */
  const captionSide = box && box.left + box.width / 2 > window.innerWidth / 2 ? "left" : "right";

  if (!actor.readOnly || !requestedActionId) return null;
  if (!action) {
    return (
      <div className="action-preview-layer" data-testid="action-preview-layer">
        <aside className="action-preview-caption"><p className="action-preview-eyebrow">Action replay</p><p className="action-preview-summary">Waiting for action…</p></aside>
      </div>
    );
  }

  return (
    <div className={`action-preview-layer${still ? " is-still" : ""}`} data-testid="action-preview-layer">
      {ringStyle && (
        <>
          <div className="action-preview-ring" data-testid="action-preview-ring" style={ringStyle} />
          {!still && <span className="action-preview-pointer" data-testid="action-preview-pointer" style={{ top: ringStyle.top + ringStyle.height, left: ringStyle.left + ringStyle.width }} />}
        </>
      )}
      <ActionPreviewCaption
        action={action}
        control={resolved?.control ?? null}
        located={Boolean(box)}
        unmappedReason={unmappedReason}
        side={captionSide ?? "right"}
      />
    </div>
  );
}
