import { createServer, type Server } from "node:http";
import { expect, test, type Page, type Request } from "@playwright/test";

/**
 * The preview against the real stack.
 *
 * A saved run is generated first, because a reenactment of a saved action is
 * only worth asserting on real recorded actions: the tool, the participant and
 * the outcome all come out of the run rather than out of a fixture written to
 * agree with the code under test.
 *
 * The frame is opened from a page served on the control room's origin, so the
 * cross-document handshake is exercised as it actually runs rather than being
 * short-circuited to same-origin. Nothing of the control room itself is needed
 * for that beyond the origin, which the harness server below provides. It is a
 * real server rather than an intercepted response because Chrome's local
 * network access check blocks a fulfilled page from framing localhost.
 */

const PRODUCT_API = "http://localhost:3001";
const WEBSITE_ORIGIN = "http://localhost:3000";
const CONTROL_ROOM_ORIGIN = "http://localhost:3002";
const HARNESS_PORT = 3002;

/** Reads `{ frameUrl, payload }` from its own fragment, so no token is logged. */
const HARNESS_HTML = `<!doctype html><meta charset="utf-8"><title>Harvest preview harness</title>
<style>html,body{margin:0;height:100%;background:#0d1f1a}iframe{border:0;width:100%;height:100%}</style>
<body><script>
  const config = JSON.parse(decodeURIComponent(location.hash.slice(1)));
  addEventListener("message", (event) => {
    if (event.origin !== ${JSON.stringify(WEBSITE_ORIGIN)}) return;
    if (!event.data || event.data.type !== "harvest.action-preview.ready") return;
    document.getElementById("frame").contentWindow.postMessage(config.payload, ${JSON.stringify(WEBSITE_ORIGIN)});
  });
  const frame = document.createElement("iframe");
  frame.id = "frame";
  frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
  frame.src = config.frameUrl;
  document.body.append(frame);
</script></body>`;

let harness: Server;
let harnessLoad = 0;

test.beforeAll(async () => {
  harness = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(HARNESS_HTML);
  });
  await new Promise<void>((resolve, reject) => {
    harness.once("error", reject);
    harness.listen(HARNESS_PORT, resolve);
  });
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => harness.close(() => resolve()));
});

interface SavedAction {
  actionId: string;
  toolName: string;
  status: "SUCCEEDED" | "REJECTED";
  summary: string;
  at: string;
  role: "FARMER" | "BUYER" | "TRANSPORTER" | "COORDINATOR";
  productActorId: string;
  simulationActorId: string;
  entityId?: string;
}

async function operationsToken(request: Page["request"]) {
  const response = await request.post(`${PRODUCT_API}/dev/session`, { data: { persona: "operations-demo" } });
  expect(response.ok(), "the Product API must be running on port 3001").toBeTruthy();
  return (await response.json()).accessToken as string;
}

async function savedHarvestRun(request: Page["request"], token: string) {
  const run = await request.post(`${PRODUCT_API}/v1/simulation-runs`, {
    headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": `preview-e2e-${Date.now()}` },
    data: {
      scenarioId: "caribbean-islands-v1",
      policy: "HARVEST",
      seed: 8675309,
      decisionMode: "DETERMINISTIC",
      scope: { mode: "SELECTED", islandIds: ["saint-lucia"] },
    },
  });
  expect(run.status(), await run.text()).toBe(201);
  const body = await run.json();
  expect(body.status).toBe("COMPLETED");

  const timeline = await request.get(`${PRODUCT_API}/v1/simulation-runs/${body.runId}/timeline`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(timeline.ok()).toBeTruthy();
  const replay = await timeline.json();
  const actions: SavedAction[] = replay.frames.flatMap((frame: { agentActions?: SavedAction[] }) => frame.agentActions ?? []);
  const participants = replay.scene.participants as Array<{ simulationActorId: string; displayName: string }>;
  return { runId: body.runId as string, actions, participants };
}

async function participantSession(request: Page["request"], token: string, runId: string, productActorId: string) {
  const response = await request.post(`${PRODUCT_API}/v1/simulation-runs/${runId}/participant-sessions`, {
    headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": `preview-e2e-session-${productActorId}-${Date.now()}` },
    data: { productActorId },
  });
  expect(response.status(), await response.text()).toBe(201);
  const session = await response.json();
  expect(session.participant.readOnly).toBe(true);
  return session.accessToken as string;
}

/**
 * A page on the control room's origin that embeds the workspace and answers its
 * request for a payload, which is precisely what the control-room panel does.
 */
async function openPreview(page: Page, accessToken: string, action: SavedAction, participantName: string) {
  const config = {
    frameUrl: `${WEBSITE_ORIGIN}/?preview=${encodeURIComponent(action.actionId)}#harvest_access_token=${encodeURIComponent(accessToken)}`,
    payload: {
      type: "harvest.action-preview",
      actionId: action.actionId,
      tool: action.toolName,
      status: action.status,
      summary: action.summary,
      simulationTime: action.at,
      participantName,
      role: action.role,
      entityIds: action.entityId ? [action.entityId] : [],
    },
  };
  // A changing fragment alone would not reload the harness, so each open gets
  // its own path.
  const url = `${CONTROL_ROOM_ORIGIN}/action-preview-harness/${++harnessLoad}#${encodeURIComponent(JSON.stringify(config))}`;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  return page.frameLocator("#frame");
}

function isProductWrite(request: Request) {
  return request.url().startsWith(PRODUCT_API) && !["GET", "HEAD", "OPTIONS"].includes(request.method());
}

test("replays a saved farmer listing inside the read-only participant website", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const token = await operationsToken(page.request);
  const { runId, actions, participants } = await savedHarvestRun(page.request, token);

  const listing = actions.find((action) => action.toolName === "publish_listing");
  expect(listing, "the saved run must contain a farmer listing to preview").toBeTruthy();
  const participantName = participants.find((item) => item.simulationActorId === listing!.simulationActorId)!.displayName;
  const accessToken = await participantSession(page.request, token, runId, listing!.productActorId);

  const writes: string[] = [];
  page.on("request", (request) => { if (isProductWrite(request)) writes.push(`${request.method()} ${request.url()}`); });

  const frame = await openPreview(page, accessToken, listing!, participantName);

  const caption = frame.locator(".action-preview-caption");
  await expect(caption).toBeVisible({ timeout: 30_000 });
  await expect(caption.getByRole("heading", { name: participantName })).toBeVisible();
  await expect(caption.getByText("publish listing", { exact: true })).toBeVisible();
  await expect(caption.getByText("succeeded", { exact: true })).toBeVisible();
  await expect(caption.getByText(listing!.summary)).toBeVisible();
  await expect(caption.getByText(/Replay of a typed Product API action, not browser automation/)).toBeVisible();
  await expect(frame.locator("[data-testid=action-preview-ring]")).toBeVisible({ timeout: 30_000 });

  // The reenactment is drawn over a workspace that cannot be operated at all.
  await expect(frame.locator(".workspace-fieldset")).toHaveAttribute("disabled", "");
  await expect(frame.locator(".simulation-replay-banner")).toContainText("read-only");

  await page.screenshot({ path: testInfo.outputPath("action-preview-farmer-listing.png"), fullPage: false });
  expect(writes, "a preview must not write to the Product API").toEqual([]);
});

test("replays a buyer order, a transporter update and an approval decision", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const token = await operationsToken(page.request);
  const { runId, actions, participants } = await savedHarvestRun(page.request, token);

  const writes: string[] = [];
  page.on("request", (request) => { if (isProductWrite(request)) writes.push(`${request.method()} ${request.url()}`); });

  for (const tool of ["place_order", "report_mission_progress", "decide_approval"]) {
    const action = actions.find((item) => item.toolName === tool);
    expect(action, `the saved run must contain a ${tool} action`).toBeTruthy();
    const participantName = participants.find((item) => item.simulationActorId === action!.simulationActorId)!.displayName;
    const accessToken = await participantSession(page.request, token, runId, action!.productActorId);

    const frame = await openPreview(page, accessToken, action!, participantName);
    const caption = frame.locator(".action-preview-caption");
    await expect(caption).toBeVisible({ timeout: 30_000 });
    await expect(caption.getByRole("heading", { name: participantName })).toBeVisible();
    // Exact, because a control label such as "Place order" also names the tool.
    await expect(caption.getByText(tool.replaceAll("_", " "), { exact: true })).toBeVisible();
    await expect(frame.locator("[data-testid=action-preview-ring]")).toBeVisible({ timeout: 30_000 });
  }

  expect(writes, "a preview must not write to the Product API").toEqual([]);
});

test("falls back to the recorded detail when a tool has no visual mapping", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const token = await operationsToken(page.request);
  const { runId, actions, participants } = await savedHarvestRun(page.request, token);

  const action = actions.find((item) => item.toolName === "publish_listing")!;
  const participantName = participants.find((item) => item.simulationActorId === action.simulationActorId)!.displayName;
  const accessToken = await participantSession(page.request, token, runId, action.productActorId);

  const frame = await openPreview(page, accessToken, { ...action, toolName: "some_tool_added_later" }, participantName);
  const caption = frame.locator(".action-preview-caption");
  await expect(caption).toBeVisible({ timeout: 30_000 });
  await expect(caption.getByText(/No visual mapping for this action yet/)).toBeVisible();
  await expect(caption.getByText(action.summary)).toBeVisible();
  await expect(frame.locator("[data-testid=action-preview-ring]")).toHaveCount(0);
});

test("shows a static highlight when the viewer asks for reduced motion", async ({ browser }, testInfo) => {
  const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  try {
    const token = await operationsToken(page.request);
    const { runId, actions, participants } = await savedHarvestRun(page.request, token);
    const action = actions.find((item) => item.toolName === "publish_listing")!;
    const participantName = participants.find((item) => item.simulationActorId === action.simulationActorId)!.displayName;
    const accessToken = await participantSession(page.request, token, runId, action.productActorId);

    const frame = await openPreview(page, accessToken, action, participantName);
    await expect(frame.locator("[data-testid=action-preview-ring]")).toBeVisible({ timeout: 30_000 });
    await expect(frame.locator("[data-testid=action-preview-pointer]")).toHaveCount(0);
    await expect(frame.locator("[data-testid=action-preview-layer]")).toHaveClass(/is-still/);
    await page.screenshot({ path: testInfo.outputPath("action-preview-reduced-motion.png") });
  } finally {
    await context.close();
  }
});
