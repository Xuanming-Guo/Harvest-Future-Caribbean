import { expect, test, type Page } from "@playwright/test";

const productApiUrl = process.env.NEXT_PUBLIC_PRODUCT_API_URL ?? "http://localhost:3001";
const OBSERVATIONS_PATH = "/v1/crop-observations";

async function signIn(page: Page, persona: RegExp) {
  await page.getByRole("button", { name: persona }).click();
  const prompt = page.getByRole("dialog");
  await expect(prompt.getByRole("heading", { name: /Would you like a quick/ })).toBeVisible();
  await prompt.getByRole("button", { name: /No, skip tutorial/ }).click();
}

async function readCropBatch(page: Page, cropBatchId: string) {
  const token = await page.evaluate(() => window.localStorage.getItem("harvest.access-token"));
  const response = await page.request.get(`${productApiUrl}/v1/crop-batches/${cropBatchId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok()).toBe(true);
  return response.json() as Promise<{ latestObservationId?: string }>;
}

test("keeps a farmer crop update on the device while offline and sends it exactly once after reconnecting", async ({ page, context }) => {
  const acceptedObservationPosts: string[] = [];
  page.on("response", (response) => {
    if (response.request().method() === "POST" && response.url().endsWith(OBSERVATIONS_PATH) && response.status() < 400) {
      acceptedObservationPosts.push(response.url());
    }
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await signIn(page, /Ana Joseph/);
  await expect(page).toHaveURL(/\/farmer$/);

  // The app shell worker must be in control before the offline reload is meaningful.
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 20_000 });

  await page.locator(".crop-card").first().click();
  await expect(page).toHaveURL(/\/crops\//);
  await expect(page.getByRole("heading", { name: "Share a crop update" })).toBeVisible();
  const cropBatchId = new URL(page.url()).pathname.split("/").pop()!;
  const before = await readCropBatch(page, cropBatchId);

  // Give the persisted read cache a moment to hold this page before the signal drops.
  await expect(page.getByRole("heading", { name: "Harvest outlook" })).toBeVisible();

  await context.setOffline(true);
  await expect(page.getByText(/^Offline · showing/)).toBeVisible();

  await page.getByLabel("Estimated crop (kg)").fill("18");
  await page.getByLabel("What have you noticed?").fill("Recorded from the field with no signal.");
  await expect(page.getByText("No connection. This update is kept on your device")).toBeVisible();
  await page.getByRole("button", { name: "Save crop update" }).click();

  await expect(page.getByText("Updates on this device")).toBeVisible();
  await expect(page.getByText("Saved on this device")).toBeVisible();
  expect(acceptedObservationPosts).toHaveLength(0);

  // Still offline: the page can only come back from the cached app shell.
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Share a crop update" })).toBeVisible();
  await expect(page.getByText(/^Offline · showing/)).toBeVisible();
  await expect(page.getByText("Saved on this device")).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByText("Synced")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/^Offline · showing/)).toHaveCount(0);

  // Exactly one observation reached the Product API, and it moved the crop batch head once.
  expect(acceptedObservationPosts).toHaveLength(1);
  const after = await readCropBatch(page, cropBatchId);
  expect(after.latestObservationId).toBeTruthy();
  expect(after.latestObservationId).not.toBe(before.latestObservationId);
});

test("never queues an online-only decision while the device is offline", async ({ page, context }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await signIn(page, /Bay Gardens Hotel/);
  await page.getByRole("link", { name: "Marketplace" }).click();
  await expect(page.getByRole("heading", { name: "Find produce you can rely on" })).toBeVisible();

  await context.setOffline(true);
  await expect(page.getByText(/An order reserves supply from other farms/)).toBeVisible();
  const placeOrder = page.getByRole("button", { name: "Place order" });
  await expect(placeOrder).toHaveAttribute("aria-disabled", "true");

  await context.setOffline(false);
  await expect(placeOrder).not.toHaveAttribute("aria-disabled", "true");
  await expect(page.getByText(/An order reserves supply from other farms/)).toHaveCount(0);
});
