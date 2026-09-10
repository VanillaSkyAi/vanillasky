import { expect, test } from '@playwright/test';

for (const mode of ['video', 'fallback', 'error', 'cancel']) {
  test(`preparation follows opening speech and clears on ${mode}`, async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`http://127.0.0.1:4274/tests/browser/fixtures/loading-preview.html?mode=${mode}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'How do sunflowers follow the light?', exact: true }).click();
    const loading = page.getByRole('status', { name: 'Video preparation' });
    await expect(page.locator('body')).toHaveAttribute('data-preview-voice', 'speaking');
    await expect(loading).toHaveCount(0);
    await page.waitForFunction(() => document.body.dataset.previewVoice === 'finished');
    await expect(loading).toHaveCount(0);
    await expect(loading).toBeVisible();
    const elapsed = await page.evaluate(() => performance.now() - Number(document.body.dataset.previewVoiceEndedAt));
    expect(elapsed).toBeGreaterThanOrEqual(1000);
    const title = await page.locator('[data-title-composition="centered"]').first().boundingBox();
    const status = await loading.boundingBox();
    expect(status!.y - (title!.y + title!.height)).toBeCloseTo(24, 0);
    await expect(loading).toHaveCSS('font-size', '17px');
    await expect(loading.locator('.video-preparation-spinner')).toHaveCSS('animation-name', 'none');
    await expect(loading.locator('.video-preparation-text')).toHaveCSS('animation-name', 'none');
    await page.locator('.vanillasky-video-chat').hover();
    await expect(page.getByRole('link', { name: 'Home', exact: true })).toHaveAttribute('href', '/');
    if (mode === 'video') await page.screenshot({ path: info.outputPath('loading-mobile.png') });
    if (mode === 'cancel') {
      await page.getByRole('button', { name: 'Sessions', exact: true }).click();
      await page.getByRole('button', { name: 'New session', exact: true }).click();
    } else {
      await page.getByRole('button', { name: 'Preview: release local video' }).click();
      if (mode === 'video' || mode === 'fallback') {
        // Reduced motion requires the player's explicit start control.
        await page.getByRole('button', { name: 'Play video response' }).click();
      }
    }
    await expect(loading).toHaveCount(0);
    if (mode === 'video' || mode === 'fallback') {
      await expect(page.locator('[data-video-frame]')).toHaveAttribute('data-scene-id', 'local-video');
      await expect(page.locator('[data-opening-chapter]')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Play again', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Play again', exact: true }).click();
      await expect(page.locator('[data-opening-chapter]')).toBeVisible();
      await expect(page.locator('body')).toHaveAttribute('data-preview-voice', 'speaking');
      await expect(page.locator('[data-video-frame]')).toHaveCount(0);
      await page.waitForFunction(() => document.body.dataset.previewVoice === 'finished');
      await page.getByRole('button', { name: 'Play video response' }).click();
      await expect(page.locator('[data-opening-chapter]')).toHaveCount(0);
      await expect(loading).toHaveCount(0);
    }
  });
}

test('ready playback cancels the pending preparation indicator', async ({ page }) => {
  await page.goto('http://127.0.0.1:4274/tests/browser/fixtures/loading-preview.html', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'How do sunflowers follow the light?', exact: true }).click();
  await page.getByRole('button', { name: 'Preview: release local video' }).click();
  await expect(page.locator('[data-opening-chapter]')).toHaveCount(0);
  await page.waitForFunction(() => document.body.dataset.previewVoice === 'finished');
  await expect(page.getByRole('status', { name: 'Video preparation' })).toHaveCount(0);
});

test('mounting a player does not restart the completed speech delay', async ({ page }) => {
  const held: import('@playwright/test').Route[] = [];
  await page.route('**/media-transition/sunflowers.mp4', route => { held.push(route); });
  await page.goto('http://127.0.0.1:4274/tests/browser/fixtures/loading-preview.html', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'How do sunflowers follow the light?', exact: true }).click();
  const loading = page.getByRole('status', { name: 'Video preparation' });
  await expect(loading).toBeVisible();
  const original = await loading.elementHandle();
  await page.getByRole('button', { name: 'Preview: release local video' }).click();
  await expect(page.locator('[data-video-frame]')).toHaveCount(1);
  expect(await original!.evaluate(element => element.isConnected)).toBe(true);
  await expect(loading).toBeVisible();
  await expect.poll(() => held.length).toBeGreaterThan(0);
  await Promise.all(held.map(route => route.continue()));
  await page.unroute('**/media-transition/sunflowers.mp4');
  await expect(loading).toHaveCount(0);
});
