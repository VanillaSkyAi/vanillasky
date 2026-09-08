import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/browser",
  timeout: 20_000,
  fullyParallel: true,
  // Native media timing probes must not compete for the same CI decoders.
  workers: process.env.CI ? 1 : undefined,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "line",
  use: {
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "vite --config tests/browser/fixtures.config.ts",
      url: "http://127.0.0.1:4274/tests/browser/fixtures/frame-parity.html",
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
