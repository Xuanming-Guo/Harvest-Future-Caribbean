import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure" },
  webServer: {
    command: "npm run dev",
    cwd: "../..",
    url: "http://localhost:3000/operations",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
