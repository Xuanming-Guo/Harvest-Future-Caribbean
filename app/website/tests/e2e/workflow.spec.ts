import { expect, test } from "@playwright/test";

test("loads the shared-backend operations workflow", async ({ page }) => {
  await page.goto("/operations");
  await expect(page.getByRole("heading", { name: "Operations centre" })).toBeVisible();
  await expect(page.getByText("Synthetic counterfactual demo")).toBeVisible();
  await page.getByRole("link", { name: "Marketplace" }).click();
  await expect(page.getByRole("heading", { name: "Dependable local supply" })).toBeVisible();
  await page.getByRole("link", { name: "Model Lab" }).click();
  await expect(page.getByRole("heading", { name: "Model Lab" })).toBeVisible();
  await expect(page.getByText("Safe ATP")).toBeVisible();
});
