import { test, expect } from '@playwright/test';

test('phone ending collapses the full transcript and replay restores scene captions', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:4274/tests/browser/fixtures/loading-preview.html?transcript', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'How do sunflowers follow the light?', exact: true }).click();
  await page.getByRole('button', { name: 'Preview: release local video' }).click();
  await expect(page.locator('[data-opening-chapter]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Play again', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Expanded subtitles' })).toHaveCount(0);
  const transcript = page.getByRole('button', { name: 'Show transcript', exact: true });
  await expect(transcript).toBeVisible();
  await expect(page.locator('.line')).toHaveCount(0);
  expect((await transcript.boundingBox())!.height).toBeLessThanOrEqual(44);
  await transcript.click();
  await expect(page.getByRole('region', { name: 'Expanded subtitles' })).toContainText('early pollinators');
  await page.getByRole('button', { name: 'Play again', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Expanded subtitles' })).toHaveCount(0);
  await expect(page.locator('.line')).toContainText('Sunflowers turn');
});
