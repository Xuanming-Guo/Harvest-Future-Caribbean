import { defineConfig } from "@playwright/test";

const baseURL = process.env.HARVEST_E2E_WEB_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  // Every spec drives the same seeded Product API database, so two workers race
  // on one crop batch: a crop update saved by one spec moves the batch head that
  // another spec's queued offline update is written against, and the queued
  // update is then correctly refused as stale. One worker keeps the suite
  // deterministic without weakening any assertion.
  workers: 1,
  use: { baseURL, channel: "msedge", trace: "retain-on-failure" },
  webServer: {
    command: "npm run dev",
    cwd: "../..",
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
