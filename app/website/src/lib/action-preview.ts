/**
 * Maps a simulated participant's Product API tool onto the website control a
 * person would use for the same thing.
 *
 * The agents never drive a browser; they call typed tools. A preview therefore
 * cannot replay input events, and this file deliberately does not try. It only
 * answers two questions: which page hosts the equivalent control, and which
 * element on it is that control. `ActionPreviewController` then scrolls to it,
 * rings it, and states the recorded outcome beside it.
 *
 * Targets are `data-tour` values, reusing the attribute the first-session
 * tutorial already puts on the same controls rather than inventing a parallel
 * hook that could drift from it.
 *
 * `targets` is an ordered chain, not one selector, because a saved run is a
 * finished world: the approval the agent decided is decided, the mission it
 * accepted is accepted, so the live control has usually left the page by the
 * time anyone previews it. The chain falls back from the control to the
 * section that owns it to the page itself, which always renders. Highlighting
 * the section that owns a spent control is honest; drawing a fake live button
 * would not be.
 *
 * A collapsed disclosure keeps its panel in the DOM with `hidden`, so a present
 * but zero-sized element is skipped by the controller rather than ringed at the
 * top-left corner of the page.
 */

import type { ActionPreviewRole } from "@harvest/shared";

/** Every tool name `ProductTools` in `app/api/src/simulation-agents.ts` exposes. */
export const PRODUCT_TOOL_NAMES = [
  "submit_crop_observation",
  "publish_listing",
  "create_buyer_demand",
  "place_order",
  "decide_approval",
  "accept_delivery_mission",
  "report_mission_progress",
  "record_delivery_acceptance",
  "verify_observation",
  "report_exception",
  "confirm_payment",
  "propose_inter_island_commitment",
  "book_maritime_shipment",
  "report_shipment_progress",
] as const;

export type ProductToolName = (typeof PRODUCT_TOOL_NAMES)[number];

/**
 * Which read the controller uses to check that a recorded entity reference is
 * the kind of thing its detail route expects. `entityId` on a saved action is
 * the last emitted event's entity, and that varies by tool: placing an order
 * ends on an allocation, accepting a delivery ends on the order. Probing is
 * what keeps a preview off a page that would only render an error.
 */
export type PreviewEntityKind = "CROP_BATCH_VIA_LISTING" | "ORDER" | "MISSION";

export interface ActionPreviewMapping {
  /** The page whose controls stand in for this tool. */
  route: string;
  /** Ordered selectors: the control, then the section, then the page. */
  targets: string[];
  /** What a person does here, in the words the caption uses. */
  control: string;
  /** Where a detail route is better, and how to confirm the reference first. */
  entity?: { kind: PreviewEntityKind; route: (id: string) => string; targets: string[] };
  /** Roles for which this tool has a page at all. */
  roles: ActionPreviewRole[];
}

/**
 * A tool with no visual equivalent yet. The caption still renders, and says so,
 * rather than the preview silently showing an unrelated page.
 */
export interface ActionPreviewUnmapped {
  unmapped: true;
  reason: string;
}

export type ActionPreviewTarget = ActionPreviewMapping | ActionPreviewUnmapped;

export function isUnmapped(target: ActionPreviewTarget | undefined): target is ActionPreviewUnmapped {
  return Boolean(target && "unmapped" in target);
}

const ROLE_HOME: Record<ActionPreviewRole, string> = {
  FARMER: "/farmer",
  BUYER: "/buyer",
  TRANSPORTER: "/transporter",
  COORDINATOR: "/coordinator",
};

function tour(...names: string[]): string[] {
  return names.map((name) => `[data-tour="${name}"]`);
}

/**
 * Every `ProductTools` tool, mapped or explicitly unmapped. A tool missing from
 * this record is a gap, and `action-preview.test.ts` fails on one.
 */
export const ACTION_PREVIEW_TARGETS: Record<ProductToolName, ActionPreviewTarget> = {
  submit_crop_observation: {
    route: "/farmer",
    targets: tour("farmer-crop-link", "farmer-home"),
    control: "Save crop update",
    roles: ["FARMER"],
    entity: {
      kind: "CROP_BATCH_VIA_LISTING",
      route: (id) => `/crops/${id}`,
      targets: tour("crop-update-save", "crop-update"),
    },
  },
  publish_listing: {
    route: "/farmer",
    targets: tour("farmer-crop-link", "farmer-home"),
    control: "List in marketplace",
    roles: ["FARMER"],
    entity: {
      kind: "CROP_BATCH_VIA_LISTING",
      route: (id) => `/crops/${id}#offer-produce`,
      targets: tour("crop-listing-submit", "crop-listing"),
    },
  },
  create_buyer_demand: {
    route: "/marketplace",
    targets: tour("marketplace-demand-save", "marketplace-requirement"),
    control: "Save as demand",
    roles: ["BUYER"],
  },
  place_order: {
    route: "/marketplace",
    targets: tour("marketplace-order-submit", "marketplace-requirement"),
    control: "Place order",
    roles: ["BUYER"],
  },
  decide_approval: {
    route: "",
    targets: tour("approval-decide", "approvals-section", "farmer-respond", "buyer-home", "coordinator-approvals"),
    control: "Approve or Decline",
    roles: ["FARMER", "BUYER", "COORDINATOR"],
  },
  accept_delivery_mission: {
    route: "/transporter",
    targets: tour("transporter-accept-job", "transporter-available", "transporter-home"),
    control: "Accept job",
    roles: ["TRANSPORTER"],
  },
  report_mission_progress: {
    route: "/transporter",
    targets: tour("transporter-jobs", "transporter-home"),
    control: "Arrived, Confirm pickup or Mark delivered",
    roles: ["TRANSPORTER"],
    entity: {
      kind: "MISSION",
      route: (id) => `/missions/${id}`,
      targets: tour("mission-progress", "mission-detail"),
    },
  },
  record_delivery_acceptance: {
    route: "/orders",
    targets: tour("orders-workspace"),
    control: "Confirm delivery",
    roles: ["BUYER"],
    entity: {
      kind: "ORDER",
      route: (id) => `/orders/${id}`,
      targets: tour("delivery-acceptance-submit", "delivery-acceptance", "order-detail"),
    },
  },
  verify_observation: {
    route: "/coordinator",
    targets: tour("verification-decide", "coordinator-verification", "coordinator-home"),
    control: "Verify or Request changes",
    roles: ["COORDINATOR"],
  },
  report_exception: {
    route: "/transporter",
    targets: tour("transporter-jobs", "transporter-home"),
    control: "Report problem",
    roles: ["TRANSPORTER"],
    entity: {
      kind: "MISSION",
      route: (id) => `/missions/${id}`,
      targets: tour("mission-report-problem", "mission-detail"),
    },
  },
  confirm_payment: {
    route: "/buyer",
    targets: tour("buyer-payment-confirm", "buyer-payments", "buyer-home"),
    control: "Confirm payment",
    roles: ["BUYER"],
    entity: {
      kind: "ORDER",
      route: (id) => `/orders/${id}`,
      targets: tour("order-payment-confirm", "order-payment", "order-detail"),
    },
  },
  // The three inter-island tools (#40) are coordination the website reports but
  // does not yet offer a control for. An order's detail page shows the
  // consignment, its legs and its customs state once a sailing exists, but
  // nobody can propose a cross-island fill, book a sailing or post its progress
  // from a page, so there is no control for a preview to ring. Saying so is the
  // honest answer; pointing the ring at the read-only consignment panel would
  // claim a person could act there.
  propose_inter_island_commitment: {
    unmapped: true,
    reason: "Cross-island fills are proposed from the coordinator's engine loop. The website reports the resulting consignment on the order, but has no control that raises one.",
  },
  book_maritime_shipment: {
    unmapped: true,
    reason: "A sailing is booked once every inter-island approval has landed. The order page shows the booked legs and capacity; no page books one.",
  },
  report_shipment_progress: {
    unmapped: true,
    reason: "Consignment status comes from the simulated voyage, not from a person. The order page displays departure, customs, arrival and any failure reason read-only.",
  },
};

export function previewTargetFor(tool: string): ActionPreviewTarget | undefined {
  return ACTION_PREVIEW_TARGETS[tool as ProductToolName];
}

export interface ResolvedPreviewRoute {
  route: string;
  targets: string[];
  control: string;
}

/**
 * Probes each recorded entity reference against the read that its detail route
 * needs, and uses the first that resolves. Everything here is a GET; the
 * preview never writes, and the API refuses a write from a replay session
 * regardless.
 */
export interface PreviewEntityProbes {
  order: (id: string) => Promise<{ orderId: string } | null>;
  mission: (id: string) => Promise<{ missionId: string } | null>;
  cropBatch: (id: string) => Promise<{ cropBatchId: string } | null>;
  listing: (id: string) => Promise<{ cropBatchId: string } | null>;
}

async function resolveEntity(
  kind: PreviewEntityKind,
  entityId: string,
  probes: PreviewEntityProbes,
): Promise<string | null> {
  if (kind === "ORDER") return (await probes.order(entityId))?.orderId ?? null;
  if (kind === "MISSION") return (await probes.mission(entityId))?.missionId ?? null;
  // A crop tool's last event is the crop batch for an observation and the
  // listing for a published offer, so try the batch first and fall back to
  // resolving the listing to the batch it came from.
  const batch = await probes.cropBatch(entityId);
  if (batch) return batch.cropBatchId;
  return (await probes.listing(entityId))?.cropBatchId ?? null;
}

/**
 * Picks the page a preview should open, given the tool, the participant's role
 * and whatever safe entity references the saved action carried.
 */
export async function resolvePreviewRoute(
  tool: string,
  role: ActionPreviewRole,
  entityIds: string[],
  probes: PreviewEntityProbes,
): Promise<ResolvedPreviewRoute | null> {
  const mapping = previewTargetFor(tool);
  if (!mapping || isUnmapped(mapping)) return null;
  const fallback: ResolvedPreviewRoute = {
    route: mapping.route || ROLE_HOME[role],
    targets: mapping.targets,
    control: mapping.control,
  };
  if (!mapping.entity) return fallback;
  for (const entityId of entityIds) {
    let resolved: string | null = null;
    try {
      resolved = await resolveEntity(mapping.entity.kind, entityId, probes);
    } catch {
      // A reference that no longer reads is simply not the one to route on.
      resolved = null;
    }
    if (resolved) {
      return {
        route: mapping.entity.route(resolved),
        targets: [...mapping.entity.targets, ...mapping.targets],
        control: mapping.control,
      };
    }
  }
  return fallback;
}

/** Reads the `?preview=<actionId>` flag that puts a page into preview mode. */
export function previewActionIdFrom(search: string): string | null {
  const value = new URLSearchParams(search).get("preview");
  return value && value.trim() ? value : null;
}

/**
 * Carries the preview flag across a redirect the website makes for its own
 * reasons.
 *
 * The frame opens on `/`, where the sign-in page immediately sends an actor
 * that already has a session to their workspace, and `AppShell` only mounts the
 * controller once past `/`. A redirect that dropped the query would therefore
 * end every preview before its controller existed.
 */
export function withPreviewFlag(path: string, search: string): string {
  const actionId = previewActionIdFrom(search);
  return actionId ? `${path}?preview=${encodeURIComponent(actionId)}` : path;
}
