import { defineConfig, devices } from "@playwright/test";
import { createAppIdentity } from "./scripts/deployment-app-identity.mjs";

const identity = createAppIdentity();
const port = Number(process.env.APP_TEST_PORT || 4290);
const apiPort = Number(process.env.APP_TEST_API_PORT || 8790);
for (const value of [port, apiPort]) {
  if (!Number.isInteger(value) || value < 1024 || value > 65535) throw new Error("Invalid app test port");
}
// Workers inherit this frozen checkout identity; they must not silently rebind
// verification if a source edit or commit happens while the server is running.
process.env.APP_TEST_IDENTITY ??= JSON.stringify(identity);
export default defineConfig({
  testDir: "tests/app-browser",
  timeout: 30_000,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? "github" : "line",
  use: { baseURL: `http://127.0.0.1:${port}`, trace: "retain-on-failure" },
  webServer: {
    command: "npm run dev",
    url: `http://127.0.0.1:${port}/api/health`,
    env: {
      APP_PORT: String(port), APP_API_PORT: String(apiPort),
      VIDEO_CHAT_PAID_PROVIDERS: "disabled",
    },
    reuseExistingServer: false,
    timeout: 90_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
