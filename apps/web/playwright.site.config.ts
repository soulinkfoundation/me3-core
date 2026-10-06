import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "public-site-layout.spec.ts",
  reporter: [["list"], ["html", { outputFolder: "site-ui-report", open: "never" }]],
  outputDir: "site-ui-results",
  use: { ...devices["Desktop Chrome"], trace: "retain-on-failure" },
});
