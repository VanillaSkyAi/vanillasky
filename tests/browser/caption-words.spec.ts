import { expect, test } from "@playwright/test";

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  test(`aligned words hold their layout and current position across style switches at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("http://127.0.0.1:4274/tests/browser/fixtures/caption-words.html");
    const line = page.locator(".word-captions");
    const active = page.locator('.caption-word[data-active="true"]');
    await expect(active).toHaveText("First");
    const initial = await line.boundingBox();
    await page.evaluate(() => (window as unknown as { captionSetTime: (time: number) => void }).captionSetTime(.45));
    await expect(active).toHaveText("we");
    const next = await line.boundingBox();
    expect(next!.height).toBe(initial!.height);
    expect(next!.y).toBe(initial!.y);
    await page.waitForTimeout(400);
    await expect(active).toHaveText("we");
    await page.evaluate(() => (window as unknown as { captionSetTime: (time: undefined) => void }).captionSetTime(undefined));
    await expect(active).toHaveCount(0);
    await expect(line).toHaveText("First we see");
    await expect(line.locator(".caption-word")).toHaveCount(3);
    expect((await line.boundingBox())!.height).toBe(initial!.height);
    await page.evaluate(() => (window as unknown as { captionSetTime: (time: number) => void }).captionSetTime(.45));
    await expect(active).toHaveText("we");
    await page.getByRole("button", { name: "Switch style" }).click();
    await expect(line).toHaveCount(0);
    await page.getByRole("button", { name: "Switch style" }).click();
    await expect(active).toHaveText("we");
    await expect(line).toHaveAttribute("aria-live", "off");
    await expect(line).toHaveAttribute("data-caption-alignment", "provider");
    await page.evaluate(() => (window as unknown as { captionSetTime: (time: number) => void }).captionSetTime(5.9));
    await expect(line).toContainText("toward the light.");
    await page.evaluate(() => (window as unknown as { captionSetTime: (time: number) => void }).captionSetTime(.2));
    await expect(active).toHaveText("First");
    const bounds = await line.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
  });
}

test("enlarged phone captions stay readable and reduced motion removes the pop", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("http://127.0.0.1:4274/tests/browser/fixtures/caption-words.html");
  await page.addStyleTag({ content: ".vanillasky-video-chat .line.word-captions { font-size: 40px; }" });
  const line = page.locator(".word-captions");
  await expect(line).toContainText("First we see");
  expect(await line.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  const active = page.locator('.caption-word[data-active="true"]');
  await expect.poll(() => active.evaluate(element => getComputedStyle(element).animationName)).toBe("none");
  const box = await line.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(568);
});

test("recorded speech advances words, native pause holds them, and replay starts again over moving footage", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://127.0.0.1:4274/tests/browser/fixtures/caption-words.html?recorded");
  await page.getByRole("button", { name: "Play recording", exact: true }).click();
  const line = page.locator(".word-captions");
  await expect(line).toHaveAttribute("data-caption-alignment", "provider");
  await expect.poll(() => page.evaluate(() => (window as unknown as { captionMediaState: () => { time: number } }).captionMediaState().time)).toBeGreaterThan(1);
  await page.getByRole("button", { name: "Pause recording", exact: true }).click();
  // Observe the painted paused frame, after the caption's animation-frame reader.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const held = await line.innerHTML();
  const before = await page.evaluate(() => (window as unknown as { captionMediaState: () => { time: number; videoTime: number; frames: number } }).captionMediaState());
  await page.waitForTimeout(400);
  expect(await line.innerHTML()).toBe(held);
  const paused = await page.evaluate(() => (window as unknown as { captionMediaState: () => { time: number; videoTime: number; frames: number } }).captionMediaState());
  expect(paused.time).toBeCloseTo(before.time, 1);
  expect(paused.frames).toBeGreaterThan(before.frames);
  expect(paused.videoTime).toBeGreaterThan(before.videoTime);
  await page.getByRole("button", { name: "Resume recording", exact: true }).click();
  await expect(line).toContainText("toward the light.");
  await expect.poll(() => page.evaluate(() => (window as unknown as { captionMediaState: () => { ended: boolean } }).captionMediaState().ended), { timeout: 10_000 }).toBe(true);
  await expect(line).toContainText("toward the light.");
  await page.getByRole("button", { name: "Play recording", exact: true }).click();
  await expect(line).toContainText("First we see");
  await expect.poll(() => page.evaluate(() => (window as unknown as { captionMediaState: () => { time: number } }).captionMediaState().time)).toBeGreaterThan(.2);
});

test("the app's subtitle selector supports arrow keys, persists, and stays separate from visibility", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/video-chat**", route => route.fulfill({ json: { prompts: [] } }));
  await page.goto("http://127.0.0.1:4274/tests/browser/fixtures/video-chat.html");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const classic = page.getByRole("radio", { name: "Classic", exact: true });
  const words = page.getByRole("radio", { name: "Word by word", exact: true });
  await expect(words).toBeChecked();
  await words.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(classic).toBeChecked();
  await expect(classic).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(words).toBeChecked();
  await expect(words).toBeFocused();
  await page.getByRole("switch", { name: /Subtitles/ }).uncheck();
  await expect(words).toBeDisabled();
  await expect(words).toBeChecked();
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(words).toBeChecked();
  await expect(words).toBeEnabled();
  const bounds = await words.locator("..").boundingBox();
  expect(bounds!.height).toBeGreaterThanOrEqual(40);
  expect(bounds!.y + bounds!.height).toBeLessThan(844);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeFocused();
});
