import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e-real",
  timeout: 120_000,
  reporter: [["html", { outputFolder: "playwright-report/real", open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:4000",
    actionTimeout: 15_000,
    trace: "on",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "sh e2e-real/start-worker.sh",
      url: "http://127.0.0.1:8787/api/config",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "pnpm preview --host 127.0.0.1 --port 4000",
      url: "http://127.0.0.1:4000",
      reuseExistingServer: false,
    },
  ],
});
