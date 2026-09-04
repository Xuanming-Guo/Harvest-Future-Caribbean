/**
 * Behaviour of the in-website reenactment layer.
 *
 * The three things that matter are all asserted here: it runs only for a
 * read-only replay session carrying the flag, it states what was recorded
 * rather than inventing an outcome, and it never renders anything that could be
 * pressed. The Playwright spec covers the same ground against the real API and
 * additionally proves no write leaves the page.
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTION_PREVIEW_MESSAGE, ACTION_PREVIEW_READY, type ActionPreviewMessage } from "@harvest/shared";

import type { SessionActor } from "@/lib/api";

const CONTROL_ROOM_ORIGIN = "http://localhost:3002";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  pathname: { value: "/farmer" },
  api: {
    order: vi.fn(async () => { throw new Error("not an order"); }),
    mission: vi.fn(async () => { throw new Error("not a mission"); }),
    cropBatch: vi.fn(async () => { throw new Error("not a crop batch"); }),
    listing: vi.fn(async () => { throw new Error("not a listing"); }),
  },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname.value,
  useRouter: () => ({ replace: mocks.replace, push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/api", () => ({ api: mocks.api }));

const { ActionPreviewController } = await import("@/components/action-preview");

const readOnlyFarmer = {
  actorId: "20000000-0000-4000-8000-000000000001",
  authSubject: "sim-farmer",
  name: "Mabouya Valley smallholding",
  role: "FARMER",
  synthetic: true,
  readOnly: true,
} as SessionActor;

const action: ActionPreviewMessage = {
  type: ACTION_PREVIEW_MESSAGE,
  actionId: "30000000-0000-4000-8000-000000000001",
  tool: "publish_listing",
  status: "SUCCEEDED",
  summary: "Published 120.00 kg of cucumber at EC$4.50 per kg.",
  simulationTime: "2026-09-03T06:00:00.000Z",
  participantName: "Mabouya Valley smallholding",
  role: "FARMER",
  entityIds: ["50000000-0000-4000-8000-000000000001"],
};

/** A laid-out control to ring. jsdom gives every element a zero-sized box. */
function renderTarget(tour: string) {
  const element = document.createElement("div");
  element.setAttribute("data-tour", tour);
  element.getBoundingClientRect = () => ({ top: 120, left: 60, width: 240, height: 44, right: 300, bottom: 164, x: 60, y: 120, toJSON: () => ({}) });
  document.body.append(element);
  return element;
}

function deliver(payload: ActionPreviewMessage, origin = CONTROL_ROOM_ORIGIN) {
  window.dispatchEvent(new MessageEvent("message", { data: payload, origin }));
}

function stubReducedMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes("reduce"),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  mocks.replace.mockClear();
  mocks.pathname.value = "/farmer";
  Element.prototype.scrollIntoView = vi.fn();
  stubReducedMotion(false);
  window.history.replaceState(null, "", "/farmer?preview=30000000-0000-4000-8000-000000000001");
});

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("simulated action preview", () => {
  it("stays out of the way of a participant who is working for real", () => {
    const { container } = render(<ActionPreviewController actor={{ ...readOnlyFarmer, readOnly: false }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("stays out of the way of a read-only session that was not asked for a preview", () => {
    window.history.replaceState(null, "", "/farmer");
    const { container } = render(<ActionPreviewController actor={readOnlyFarmer} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("asks the control room for the action the flag names", async () => {
    const post = vi.spyOn(window.parent, "postMessage");
    render(<ActionPreviewController actor={readOnlyFarmer} />);
    await waitFor(() => expect(post).toHaveBeenCalledWith(
      { type: ACTION_PREVIEW_READY, actionId: action.actionId },
      CONTROL_ROOM_ORIGIN,
    ));
    post.mockRestore();
  });

  it("ignores a payload that did not come from the control room", async () => {
    render(<ActionPreviewController actor={readOnlyFarmer} />);
    deliver(action, "https://not-the-control-room.example");
    await waitFor(() => expect(screen.getByText(/Waiting for the control room/)).toBeInTheDocument());
    expect(screen.queryByText(action.summary)).not.toBeInTheDocument();
  });

  it("rings the equivalent control and captions what was recorded", async () => {
    renderTarget("farmer-crop-link");
    render(<ActionPreviewController actor={readOnlyFarmer} />);
    deliver(action);

    expect(await screen.findByText(action.summary)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Mabouya Valley smallholding" })).toBeInTheDocument();
    expect(screen.getByText("publish listing")).toBeInTheDocument();
    expect(screen.getByText("succeeded")).toBeInTheDocument();
    expect(screen.getByText("50000000")).toBeInTheDocument();
    expect(screen.getByText(/Replay of a typed Product API action, not browser automation/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("action-preview-ring")).toBeInTheDocument());
    expect(screen.getByTestId("action-preview-pointer")).toBeInTheDocument();
  });

  it("keeps a rejection a rejection", async () => {
    renderTarget("farmer-crop-link");
    render(<ActionPreviewController actor={readOnlyFarmer} />);
    deliver({ ...action, status: "REJECTED", summary: "Rejected: only 40.00 kg is safe to promise." });

    expect(await screen.findByText("rejected")).toBeInTheDocument();
    expect(screen.queryByText("succeeded")).not.toBeInTheDocument();
  });

  it("replaces the animated pointer with a static highlight under reduced motion", async () => {
    stubReducedMotion(true);
    renderTarget("farmer-crop-link");
    render(<ActionPreviewController actor={readOnlyFarmer} />);
    deliver(action);

    await waitFor(() => expect(screen.getByTestId("action-preview-ring")).toBeInTheDocument());
    expect(screen.queryByTestId("action-preview-pointer")).not.toBeInTheDocument();
    expect(screen.getByTestId("action-preview-layer").className).toContain("is-still");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ behavior: "auto" }));
  });

  it("says so plainly when a tool has no visual equivalent yet", async () => {
    render(<ActionPreviewController actor={readOnlyFarmer} />);
    deliver({ ...action, tool: "some_tool_added_later" });

    expect(await screen.findByText(/No visual mapping for this action yet/)).toBeInTheDocument();
    expect(screen.getByText(action.summary)).toBeInTheDocument();
    expect(screen.queryByTestId("action-preview-ring")).not.toBeInTheDocument();
  });

  it("names the section instead when the control has already been used", async () => {
    renderTarget("farmer-home");
    render(<ActionPreviewController actor={readOnlyFarmer} />);
    deliver(action);

    expect(await screen.findByText(/It is not on screen at this point in the saved run/)).toBeInTheDocument();
  });

  it("renders nothing anyone could press, and sends no request of its own", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    renderTarget("farmer-crop-link");
    render(<ActionPreviewController actor={readOnlyFarmer} />);
    deliver(action);

    const layer = await screen.findByTestId("action-preview-layer");
    expect(layer.querySelectorAll("button, a, input, textarea, select, form, [role=button]")).toHaveLength(0);
    // Everything the layer needs comes from the payload and the read probes, so
    // a request leaving this component at all would be one it should not make.
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("carries the flag with it when it routes to the page hosting the control", async () => {
    mocks.api.cropBatch.mockResolvedValueOnce({ cropBatchId: "70000000-0000-4000-8000-000000000009" } as never);
    render(<ActionPreviewController actor={readOnlyFarmer} />);
    deliver(action);

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith(
      `/crops/70000000-0000-4000-8000-000000000009?preview=${action.actionId}#offer-produce`,
    ));
  });
});
