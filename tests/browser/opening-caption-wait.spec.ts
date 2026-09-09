import { expect, test } from "@playwright/test";

test("completed intro subtitles stay at the final phrase while the first video is cold", async ({ page }) => {
  test.setTimeout(30_000);
  await page.setViewportSize({ width: 390, height: 844 });
  let firstRequest = 0;
  await page.route(/\/waterfall(?:-hold)?\.(?:mp4|webm)$/, async route => {
    firstRequest ||= Date.now();
    await new Promise(resolve => setTimeout(resolve, Math.max(0, firstRequest + 2500 - Date.now())));
    await route.continue();
  });
  await page.goto(`http://127.0.0.1:4274/tests/browser/fixtures/opening-caption-wait.html${process.platform === "linux" || process.env.VANILLASKY_TEST_WEBM === "1" ? "?webm" : ""}`);
  await page.getByRole("textbox", { name: "Prompt" }).fill("Show the natural world");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  const line = page.locator(".word-captions");
  const proof = () => page.evaluate(() => (window as unknown as { openingCaptionProof: {
    ended: number; speechStarts: number; frames: number; captions: Array<{ text: string; active: boolean }>;
  } }).openingCaptionProof);
  await expect(line).toHaveAttribute("data-caption-alignment", "provider");
  await expect.poll(async () => (await proof()).ended, { timeout: 12_000 }).toBe(1);
  await expect(line).toContainText("toward the light.");
  const finalPhrase = await line.textContent();
  await page.waitForTimeout(250);
  await page.getByRole("button", { name: "Deliver body", exact: true }).click();
  await expect(page.getByTestId("video-player")).toBeAttached();
  await expect(page.locator("[data-opening-chapter]")).toBeAttached();
  await expect(line).toHaveText(finalPhrase!);
  await page.waitForTimeout(800);
  await expect(line).toHaveText(finalPhrase!);
  await expect(page.locator('[data-active="true"].caption-word')).toHaveCount(0);
  const waiting = await proof();
  expect(waiting.speechStarts).toBe(1);
  expect(waiting.captions.length).toBeGreaterThan(10);
  expect(waiting.captions.every(caption => caption.text === finalPhrase && !caption.active)).toBe(true);
  // The same real player proceeds after decoding, with moving frames and the
  // complete second recording; subtitle retention must not block the handoff.
  await expect.poll(async () => (await proof()).speechStarts).toBe(2);
  await expect(page.locator("[data-opening-chapter]")).toHaveCount(0);
  await expect.poll(async () => (await proof()).ended).toBe(2);
  expect((await proof()).frames).toBeGreaterThan(3);
});
