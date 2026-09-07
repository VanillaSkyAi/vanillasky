import { test, expect } from '@playwright/test';

for (const zoom of [1, 1.6]) {
  test(`two-line caption pages follow a held audio clock at phone font scale ${zoom}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('http://127.0.0.1:4274/tests/browser/fixtures/caption-pages.html', { waitUntil: 'domcontentloaded' });
    if (zoom !== 1) await page.addStyleTag({ content: `.vanillasky-video-chat .line { font-size: ${16 * zoom}px; }` });
    const line = page.locator('.line:not([aria-hidden])');
    await expect(line).toContainText('Sunflowers');
    const fits = async () => expect.poll(() => line.evaluate(element => element.getBoundingClientRect().height / parseFloat(getComputedStyle(element).lineHeight))).toBeLessThanOrEqual(2.02);
    await fits();
    const first = await line.textContent();
    await page.getByRole('button', { name: 'Middle' }).click();
    await expect(line).not.toHaveText(first!);
    await fits();
    const held = await line.textContent();
    await page.waitForTimeout(350);
    await expect(line).toHaveText(held!);
    await page.getByRole('button', { name: 'Last' }).click();
    await expect(line).toContainText('early pollinators.');
    await fits();
    await page.getByRole('button', { name: 'Replay' }).click();
    await expect(line).toHaveText(first!);
  });
}


test('prerecorded speech advances caption pages and a native audio pause holds them', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:4274/tests/browser/fixtures/caption-pages.html?recorded', { waitUntil: 'domcontentloaded' });
  await page.addStyleTag({ content: '.vanillasky-video-chat .line { font-size: 25px; }' });
  const line = page.locator('.line:not([aria-hidden])');
  await expect(line).toContainText('First we see');
  await expect.poll(() => line.evaluate(element => element.getBoundingClientRect().height / parseFloat(getComputedStyle(element).lineHeight))).toBeLessThanOrEqual(2.02);
  const first = await line.textContent();
  await page.getByRole('button', { name: 'Play recording', exact: true }).click();
  await expect(line).toHaveAttribute('data-caption-timing', 'audio');
  await expect.poll(() => page.evaluate(() => {
    const state = (window as unknown as { captionNativeState: () => { time: number; duration: number; boundary: number } }).captionNativeState();
    return Number.isFinite(state.duration) && state.time >= state.boundary;
  }), { timeout: 10000 }).toBe(true);
  await expect(line).not.toHaveText(first!);
  await page.getByRole('button', { name: 'Pause recording', exact: true }).click();
  const paused = await line.textContent();
  const time = await page.evaluate(() => (window as unknown as {captionAudioTime: () => number}).captionAudioTime());
  await page.waitForTimeout(400);
  await expect(line).toHaveText(paused!);
  expect(await page.evaluate(() => (window as unknown as {captionAudioTime: () => number}).captionAudioTime())).toBeCloseTo(time, 1);
  await page.getByRole('button', { name: 'Resume recording', exact: true }).click();
  await expect(line).toContainText('toward the light.');
  await expect(page.locator('body')).toHaveAttribute('data-audio-ended', 'true');
  await expect(line).toContainText('toward the light.');
});


test.afterEach(async ({ page }, testInfo) => {
  const diagnostics = await page.evaluate(() => (window as unknown as {captionDiagnostics?: unknown[]}).captionDiagnostics).catch(() => undefined);
  if (diagnostics) await testInfo.attach('caption-audio-evidence', { body: JSON.stringify(diagnostics), contentType: 'application/json' });
});
