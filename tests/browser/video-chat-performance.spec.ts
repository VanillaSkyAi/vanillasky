import { expect, test, type Page } from "@playwright/test";

type Metric = { type: string; elapsedMs: number; durationMs?: number; reason?: string; source?: string };
async function metrics(page: Page): Promise<Metric[]> {
  return JSON.parse(await page.getByTestId("metrics").innerText());
}

test("reports speech onset, first presentation and controlled stream starvation without content", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:4274/tests/browser/fixtures/video-chat-performance.html");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.locator('[data-video-frame="ready"]')).toBeVisible();
  await expect.poll(async () => (await metrics(page)).map((metric) => metric.type)).toEqual(expect.arrayContaining(["first-frame", "first-speech"]));
  // Exhaust the first prepared scene before releasing the next scene.
  await page.waitForTimeout(9_000);
  await page.getByRole("button", { name: "Release scene" }).click();
  await expect.poll(async () => (await metrics(page)).filter((metric) => metric.type === "stall").length).toBe(1);
  const observed = await metrics(page);
  expect(observed.filter((metric) => metric.type === "first-frame")).toHaveLength(1);
  expect(observed.filter((metric) => metric.type === "first-speech")).toHaveLength(1);
  expect(observed.find((metric) => metric.type === "first-speech")?.source).toBe("custom");
  expect(observed.find((metric) => metric.type === "stall")).toMatchObject({ reason: "scene-generation", durationMs: expect.any(Number) });
  expect(observed.find((metric) => metric.type === "stall")!.durationMs).toBeGreaterThan(500);
  for (const metric of observed) {
    expect(metric.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(Object.keys(metric).every((key) => ["type", "turnId", "mode", "elapsedMs", "source", "durationMs", "reason"].includes(key))).toBe(true);
  }
  expect(JSON.stringify(observed)).not.toMatch(/private-prompt|private-provider|https?:|narration|An opening/);
  await testInfo.attach("controlled-browser-metrics", {
    body: JSON.stringify({ scenario: "mocked providers; manually released second scene", metrics: observed }, null, 2),
    contentType: "application/json",
  });
  expect(errors).toEqual([]);
});

test("does not count a deliberate pause as stream starvation", async ({ page }) => {
  await page.goto("http://127.0.0.1:4274/tests/browser/fixtures/video-chat-performance.html");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.locator('[data-video-frame="ready"]')).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByTestId("status")).toHaveText("paused");
  await page.waitForTimeout(5_000);
  await page.getByRole("button", { name: "Release scene" }).click();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect.poll(async () => (await metrics(page)).some((metric) => metric.type === "first-frame")).toBe(true);
  expect((await metrics(page)).filter((metric) => metric.type === "stall")).toEqual([]);
});


test("starts a short prepared scene while the next scene is still pending", async ({ page }) => {
  await page.goto("http://127.0.0.1:4274/tests/browser/fixtures/video-chat-performance.html?shortBuffer");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect.poll(async () => (await metrics(page)).some((metric) => metric.type === "first-speech")).toBe(true);
  await expect(page.locator('[data-video-frame="ready"]')).toBeVisible();
  await page.getByRole("button", { name: "Release scene" }).click();
  await expect(page.locator('[data-video-frame="ready"]')).toBeVisible();
});
