import { expect, test } from "@playwright/test";
import { assertAppMarkup } from "../../scripts/deployment-app-identity.mjs";

test.beforeEach(async ({ request }) => {
  const expected = JSON.parse(process.env.APP_TEST_IDENTITY!);
  const page = await request.get("/");
  assertAppMarkup(await page.text(), expected);
  const health = await request.get("/api/health");
  expect(health.ok()).toBe(true);
  expect(await health.json()).toMatchObject(expected);
});

test("an unconfigured checkout explains setup and cannot create an answer", async ({ page, request, baseURL }) => {
  const statusResponse = await request.get("/api/video-chat?action=status");
  expect(statusResponse.ok()).toBe(true);
  const status = await statusResponse.json();
  expect(status.ready).toBe(false);
  expect(status.missing).toContain("VIDEO_CHAT_PAID_PROVIDERS");
  await page.goto("/");
  await expect(page.getByText(/setup|configure/i).first()).toBeVisible();
  const response = await request.post("/api/video-chat?action=response", {
    headers: { origin: new URL(baseURL!).origin },
    data: { prompt: "Explain the water cycle", mode: "pexels" },
  });
  expect(response.status()).toBe(503);
  expect(await response.json()).toMatchObject({ error: { code: "setup_required" } });
  await expect(page.locator("video[src]")).toHaveCount(0);
});

test("developer server does not serve private backend or test fixtures", async ({ request }) => {
  for (const path of [
    "/functions/api/video-chat.mjs", "/tests/app-browser/setup.spec.ts", "/scripts/dev.mjs",
    "/.wrangler/local/quota-salt", "/.git", "/.generated/local-static/index.html", "/src/server.ts",
    `/@fs/${process.cwd()}/.wrangler/local/quota-salt`,
    `/@fs/${encodeURIComponent(process.cwd())}/.wrangler/local/quota-salt`,
  ]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(404);
  }
});
