import { expect, test, type Page } from "@playwright/test";

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
  await expect(page.getByText("Know what buyers need, show what you can supply, coordinate collection and keep a clear delivery history.")).toBeVisible();
  await expect(page.getByText("Recommended now")).toBeVisible();
  for (const section of ["Update what is growing", "Report produce ready", "View buyer demand", "Respond to an opportunity", "Track collection", "View previous deliveries"]) {
    await expect(page.getByRole("button", { name: new RegExp(section) })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: /Update what is growing/ })).toHaveAttribute("aria-expanded", "true");
  const history = page.getByRole("button", { name: /View previous deliveries/ });
  await expect(history).toHaveAttribute("aria-expanded", "false");
  await history.click();
  await expect(history).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#view-previous-deliveries-panel")).toBeVisible();
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

test("keeps the farmer's recommended action reachable on a small screen", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await signIn(page, /Ana Joseph/);
  await expect(page.getByText("Know what buyers need, show what you can supply, coordinate collection and keep a clear delivery history.")).toBeVisible();
  const action = page.locator(".button-hero");
  await expect(action).toBeVisible();
  const button = await action.boundingBox();
  expect(button!.height).toBeGreaterThanOrEqual(48);
  const summary = await page.getByRole("button", { name: /Report produce ready/ }).boundingBox();
  expect(summary!.height).toBeGreaterThanOrEqual(44);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(375);
  await page.screenshot({ path: testInfo.outputPath("farmer-workspace-mobile.png"), fullPage: true });
});

test("guards a product route from the wrong role", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await signIn(page, /Daniel Felix/);
  await expect(page).toHaveURL(/\/transporter$/);
  await page.goto("/marketplace", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/transporter$/);
  await expect(page.getByRole("heading", { name: "Move local food with confidence" })).toBeVisible();
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
    await tutorialDialog(page).getByRole("button", { name: "Next" }).click();
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
