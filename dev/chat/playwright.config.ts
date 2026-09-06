import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: ".", testMatch: "smoke.spec.ts", timeout: 20000, workers: 1,
  reporter: "line", outputDir: "../../test-results/chat-development",
  use: {...devices["Desktop Chrome"]},
  webServer: {command: "npx vite --config dev/chat/vite.config.ts", cwd: new URL("../..", import.meta.url).pathname,
    url: "http://127.0.0.1:4281/dev/chat/", reuseExistingServer: false, timeout: 30000},
});
