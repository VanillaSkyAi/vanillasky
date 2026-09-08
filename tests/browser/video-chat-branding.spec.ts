import { expect, test } from "@playwright/test";

for (const width of [390, 1280]) test(`keeps custom identity usable over moving footage at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/video-chat?*", route => route.fulfill({ json: route.request().url().includes("action=welcome")
    ? { hero: { url: "http://127.0.0.1:4274/tests/browser/fixtures/media-transition/waterfall.mp4", type: "video" }, cards: [] }
    : { generatedSpeech: false, generatedVideo: false, stockMedia: false, transcription: false, modes: ["cinematic"] } }));
  await page.goto("http://127.0.0.1:4274/tests/browser/fixtures/video-chat.html?branding");
  const home = page.getByRole("link", { name: "Acme home" });
  await expect(home).toHaveText("Acme");
  await expect(home).toHaveAttribute("href", "/app");
  await expect.poll(() => page.locator(".welcome video").evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0);
  const homeBounds = await home.boundingBox();
  const settingsBounds = await page.getByRole("button", { name: "Settings", exact: true }).boundingBox();
  expect(homeBounds!.x + homeBounds!.width).toBeLessThan(settingsBounds!.x);
  await page.screenshot({ path: testInfo.outputPath(`branding-${width}.png`) });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Build with VanillaSky" })).toHaveCount(0);
  await expect(page.getByRole("switch", { name: /Subtitles/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Sessions", exact: true }).click();
  await expect(page.getByRole("button", { name: "New session" })).toBeVisible();
  expect(errors).toEqual([]);
});
