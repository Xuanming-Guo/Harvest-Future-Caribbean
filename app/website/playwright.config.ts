import { defineConfig } from "@playwright/test";

const baseURL = process.env.HARVEST_E2E_WEB_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  use: { baseURL, channel: "msedge", trace: "retain-on-failure" },
  webServer: {
    command: "npm run dev",
    cwd: "../..",
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
