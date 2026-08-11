import { expect, test } from "@playwright/test";

test("signs in to role-specific product workspaces and signs out", async ({ page }, testInfo) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Local food, coordinated from field to table." })).toBeVisible();
  await page.getByRole("button", { name: /Ana Joseph/ }).click();
  await expect(page).toHaveURL(/\/farmer$/);
  await expect(page.getByRole("heading", { name: /Welcome, Ana/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "My farm" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Simulation" })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("farmer-workspace.png"), fullPage: true });
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.getByRole("button", { name: /Bay Gardens Hotel/ }).click();
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
  await page.getByRole("button", { name: /Daniel Felix/ }).click();
  await expect(page).toHaveURL(/\/transporter$/);
  await page.goto("/marketplace", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/transporter$/);
  await expect(page.getByRole("heading", { name: "Move local food with confidence" })).toBeVisible();
});

test("prepares an editable crop draft and requires the farmer to save it", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Ana Joseph/ }).click();
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
