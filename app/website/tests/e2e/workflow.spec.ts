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
