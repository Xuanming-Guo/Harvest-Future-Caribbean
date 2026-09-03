import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const productApiUrl = process.env.HARVEST_E2E_API_URL ?? "http://localhost:3001";
const seededOrderId = "20202020-2020-4020-8020-202020202020";

async function developmentToken(request: APIRequestContext, persona: string) {
  const response = await request.post(productApiUrl + "/dev/session", { data: { persona } });
  expect(response.ok()).toBe(true);
  return (await response.json()).accessToken as string;
}

async function approveSeededOrder(request: APIRequestContext, persona: string) {
  const token = await developmentToken(request, persona);
  const approvals = await request.get(productApiUrl + "/v1/approvals?status=PENDING&limit=100", {
    headers: { authorization: "Bearer " + token },
  });
  const approval = (await approvals.json()).items.find((item: { context?: { orderId?: string } }) => item.context?.orderId === seededOrderId);
  expect(approval).toBeTruthy();
  const decision = await request.post(productApiUrl + "/v1/approvals/" + approval.approvalId + "/decisions", {
    data: { decision: "APPROVE" },
    headers: {
      authorization: "Bearer " + token,
      "idempotency-key": "e2e-approve-" + persona + "-" + Date.now(),
    },
  });
  expect(decision.ok()).toBe(true);
}

async function signIn(page: Page, persona: RegExp, tutorial: "start" | "skip" = "skip") {
  await page.getByRole("button", { name: persona }).click();
  const prompt = page.getByRole("dialog");
  await expect(prompt.getByRole("heading", { name: /Would you like a quick/ })).toBeVisible();
  await prompt.getByRole("button", { name: tutorial === "start" ? /Yes, show me around/ : /No, skip tutorial/ }).click();
}

function tutorialDialog(page: Page) {
  return page.getByRole("dialog");
}

test("signs in to role-specific product workspaces and signs out", async ({ page }, testInfo) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Local food, coordinated from field to table." })).toBeVisible();
  await signIn(page, /Ana Joseph/);
  await expect(page).toHaveURL(/\/farmer$/);
  await expect(page.getByRole("heading", { name: /Welcome, Ana/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "My farm" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Simulation" })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("farmer-workspace.png"), fullPage: true });
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);

  await signIn(page, /Bay Gardens Hotel/);
  await expect(page).toHaveURL(/\/buyer$/);
  await page.getByRole("link", { name: "Marketplace" }).click();
  await expect(page.getByRole("heading", { name: "Find produce you can rely on" })).toBeVisible();
  await expect(page.getByText("Selected supply")).toBeVisible();
  await page.locator(".listing-card").first().click();
  await expect(page.getByRole("heading", { name: "Cucumber supply evidence" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("buyer-marketplace.png"), fullPage: true });
});

test("guards a product route from the wrong role", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await signIn(page, /Daniel Felix/);
  await expect(page).toHaveURL(/\/transporter$/);
  await page.goto("/marketplace", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/transporter$/);
  await expect(page.getByRole("heading", { name: "Choose a route. Move the harvest." })).toBeVisible();
});

test("prepares an editable crop draft and requires the farmer to save it", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await signIn(page, /Ana Joseph/);
  await page.locator(".crop-card").first().click();
  await page.getByLabel("Describe your update").fill("Approximately 20 kg of cucumbers are harvest ready, with some rain damage.");
  await page.getByRole("button", { name: "Prepare editable draft" }).click();
  await expect(page.getByText(/Draft prepared with/)).toBeVisible();
  await expect(page.getByLabel("Crop stage")).toHaveValue("HARVEST_READY");
  await expect(page.getByLabel("Estimated crop (kg)")).toHaveValue("20");
  await expect(page.getByText("Nothing is saved until you review it and select Save crop update.")).toBeVisible();
  await page.getByRole("button", { name: "Save crop update" }).click();
  await expect(page.getByText(/Crop update saved/)).toBeVisible();
});

test("offers, remembers, and restarts the optional farmer tutorial", async ({ page }, testInfo) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Ana Joseph/ }).click();
  await expect(tutorialDialog(page).getByRole("heading", { name: "Would you like a quick farmer tutorial?" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("onboarding-choice.png"), fullPage: true });
  await tutorialDialog(page).getByRole("button", { name: "No, skip tutorial" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();

  await page.getByRole("button", { name: /Ana Joseph/ }).click();
  await expect(tutorialDialog(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Take the tutorial" }).click();
  await expect(tutorialDialog(page).getByRole("heading", { name: "Your farm at a glance" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("farmer-tour-home.png"), fullPage: true });
  await tutorialDialog(page).getByRole("button", { name: "Next" }).click();
  await expect(tutorialDialog(page).getByRole("heading", { name: "Open a crop" })).toBeVisible();
  await tutorialDialog(page).getByRole("button", { name: "Open this crop" }).click();
  await expect(page).toHaveURL(/\/crops\//);
  await expect(tutorialDialog(page).getByRole("heading", { name: "Understand the harvest outlook" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("farmer-tour-crop.png"), fullPage: true });
  await tutorialDialog(page).getByRole("button", { name: "Exit tutorial" }).click();
});

test("guides a buyer through marketplace and orders", async ({ page }, testInfo) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await signIn(page, /Bay Gardens Hotel/, "start");
  await expect(tutorialDialog(page).getByRole("heading", { name: "Your buying overview" })).toBeVisible();
  await tutorialDialog(page).getByRole("button", { name: "Next" }).click();
  await tutorialDialog(page).getByRole("button", { name: "Open marketplace" }).click();
  await expect(page).toHaveURL(/\/marketplace$/);
  await expect(tutorialDialog(page).getByRole("heading", { name: "Compare safe local supply" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("buyer-tour-marketplace.png"), fullPage: true });
  await tutorialDialog(page).getByRole("button", { name: "Next" }).click();
  await expect(tutorialDialog(page).getByRole("heading", { name: "Record what you need" })).toBeVisible();
  await tutorialDialog(page).getByRole("button", { name: "Next" }).click();
  await expect(page).toHaveURL(/\/orders$/);
  await tutorialDialog(page).getByRole("button", { name: "Finish tutorial" }).click();
  await expect(tutorialDialog(page)).toHaveCount(0);
});

test("guides a transporter through vehicle and job controls", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await signIn(page, /Daniel Felix/, "start");
  for (const heading of ["Your delivery workspace", "Choose the vehicle first", "Accept suitable work", "Open a mission to report progress"]) {
    await expect(tutorialDialog(page).getByRole("heading", { name: heading })).toBeVisible();
    await tutorialDialog(page).getByRole("button", { name: heading === "Open a mission to report progress" ? "Finish tutorial" : "Next" }).click();
  }
  await expect(tutorialDialog(page)).toHaveCount(0);
});

test("guides a coordinator through human-control workspaces", async ({ page }, testInfo) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await signIn(page, /Maya Charles/, "start");
  for (const heading of ["Your coordination queue", "Review sensitive decisions", "Check crop evidence", "Handle exceptions"]) {
    await expect(tutorialDialog(page).getByRole("heading", { name: heading })).toBeVisible();
    await tutorialDialog(page).getByRole("button", { name: "Next" }).press("Enter");
  }
  await expect(tutorialDialog(page).getByRole("heading", { name: "Open permitted crop evidence" })).toBeVisible();
  await expect(page.locator('[data-tour-step="coordinator-crops"]')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("coordinator-tour.png"), fullPage: true });
  await tutorialDialog(page).getByRole("button", { name: "Open crop evidence" }).click();
  await expect(page).toHaveURL(/\/crops\//);
  await expect(tutorialDialog(page).getByRole("heading", { name: "Review without changing farm data" })).toBeVisible();
  await tutorialDialog(page).getByRole("button", { name: "Next" }).click();
  await expect(page).toHaveURL(/\/orders$/);
  await tutorialDialog(page).getByRole("button", { name: "Finish tutorial" }).click();
  await expect(tutorialDialog(page)).toHaveCount(0);
});

test("completes the driver route and mirrors it for the hotel at mobile width", async ({ page, request }) => {
  test.setTimeout(90_000);
  for (const persona of ["buyer-hotel", "farmer-ana", "farmer-marcus"]) {
    await approveSeededOrder(request, persona);
  }

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await signIn(page, /Daniel Felix/);
  await page.getByRole("button", { name: /Choose a vehicle/ }).click();
  await page.getByRole("option", { name: /refrigerated van/i }).click();
  await page.locator(".delivery-ticket", { hasText: "20 kg" }).click();
  await page.getByRole("button", { name: "Accept delivery" }).click();
  await expect(page.getByRole("link", { name: "Open full route" })).toBeVisible();
  await page.getByRole("link", { name: "Open full route" }).click();

  await page.getByRole("button", { name: "Arrived at next stop" }).click();
  await expect(page.getByRole("button", { name: "Confirm pickup" })).toBeVisible();
  await page.getByRole("button", { name: "Confirm pickup" }).click();
  await expect(page.locator(".island-game-renderer")).toHaveAttribute("data-position", "at-stop");
  await page.getByRole("button", { name: "Arrived at next stop" }).click();
  await expect(page.getByRole("button", { name: "Confirm pickup" })).toBeVisible();
  await page.getByRole("button", { name: "Confirm pickup" }).click();
  await expect(page.locator(".island-game-renderer")).toHaveAttribute("data-position", "mid-leg");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".island-game-renderer")).toHaveAttribute("data-motion", "reduced");
  await page.getByRole("button", { name: "Arrived at next stop" }).click();
  await expect(page.getByRole("button", { name: "Mark delivered" })).toBeVisible();
  await page.getByRole("button", { name: "Mark delivered" }).click();
  await expect(page.getByText("Every stop is complete.")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  await page.getByRole("button", { name: "Sign out" }).click();
  await signIn(page, /Bay Gardens Hotel/);
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page.getByRole("link", { name: "Orders", exact: true }).click();
  await expect(page).toHaveURL(/\/orders$/, { timeout: 15_000 });
  await page.locator('a[href="/orders/' + seededOrderId + '"]').click();
  await expect(page).toHaveURL(new RegExp("/orders/" + seededOrderId + "$"), { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Saint Lucia delivery journey" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: /Accept delivery|Arrived at next stop|Confirm pickup|Mark delivered/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Show route card" }).click();
  await page.locator(".journey-stop-list").getByRole("button", { name: /Mabouya Growers/ }).click();
  await expect(page.getByText("Only crops committed to this delivery are shown.")).toBeVisible();
  await expect(page.locator(".crop-progress-plot")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("keeps the onboarding choice and guide usable on a small screen", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Daniel Felix/ }).click();
  const prompt = tutorialDialog(page);
  await expect(prompt.getByRole("button", { name: "No, skip tutorial" })).toBeVisible();
  await expect(prompt.getByRole("button", { name: /Yes, show me around/ })).toBeVisible();
  await prompt.getByRole("button", { name: /Yes, show me around/ }).click();
  const tooltip = page.locator(".tour-tooltip");
  await expect(tooltip).toBeVisible();
  const bounds = await tooltip.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
  await page.screenshot({ path: testInfo.outputPath("mobile-onboarding.png"), fullPage: true });
});
