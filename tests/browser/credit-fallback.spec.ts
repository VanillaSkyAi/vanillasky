import { expect, test } from "@playwright/test";

for (const width of [390, 1440]) test(`credit notice stays usable over moving footage (${width})`, async ({ page, browserName }) => {
  await page.setViewportSize({ width, height: 900 });
  const webm = process.platform === "linux" && browserName !== "chromium" ? "&webm" : "";
  await page.goto(`http://127.0.0.1:4274/tests/browser/fixtures/credit-fallback.html?footage${webm}`);
  await page.getByRole("button", { name: "Show the fallback banner", exact: true }).click();
  const notice = page.locator(".credit-fallback-notice");
  await expect(notice).toBeVisible();
  const bounds = await notice.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
  const video = page.locator('[data-video-frame="ready"] video').first();
  await expect(video).toBeVisible();
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(0.25);
  const dismiss = page.getByRole("button", { name: "Dismiss Pexels fallback notice", exact: true });
  await expect.poll(() => dismiss.evaluate(element => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return element === hit || element.contains(hit);
  })).toBe(true);
  await dismiss.click();
  await expect(notice).toHaveCount(0);
  await expect(video).toBeVisible();
});
