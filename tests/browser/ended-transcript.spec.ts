import { test, expect } from '@playwright/test';

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
test(`ending groups its label with cards and preserves the full transcript (${viewport.width})`, async ({ page }) => {
  await page.setViewportSize(viewport);
  await page.goto('http://127.0.0.1:4274/tests/browser/fixtures/loading-preview.html?transcript', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'How do sunflowers follow the light?', exact: true }).click();
  await page.getByRole('button', { name: 'Preview: release local video' }).click();
  await expect(page.locator('[data-opening-chapter]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Play again', exact: true })).toBeVisible();
  const label = await page.getByText('Ask next', { exact: true }).boundingBox();
  const card = await page.getByRole('button', { name: 'Why do flowers face the sun?', exact: true }).boundingBox();
  expect(label).not.toBeNull();
  expect(card).not.toBeNull();
  const gap = card!.y - label!.y - label!.height;
  expect(gap).toBeGreaterThanOrEqual(0);
  expect(gap).toBeLessThanOrEqual(36);
  await expect(page.getByRole('region', { name: 'Transcript', exact: true })).toHaveCount(0);
  const transcript = page.getByRole('button', { name: 'Show transcript', exact: true });
  await expect(transcript).toBeVisible();
  await expect(page.locator('.line')).toHaveCount(0);
  expect((await transcript.boundingBox())!.height).toBeLessThanOrEqual(44);
  await transcript.click();
  const expanded = page.getByRole('region', { name: 'Transcript', exact: true });
  await expect(expanded.locator('p').first()).toHaveText('Sunflowers follow a changing sky.');
  await expect(expanded.getByText('Sunflowers follow a changing sky.', { exact: true })).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Transcript', exact: true })).toContainText('early pollinators');
  await page.getByRole('button', { name: 'Play again', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Transcript', exact: true })).toHaveCount(0);
  await expect(page.locator('[data-opening-chapter]')).toBeVisible();
  await expect(page.locator('.line')).toContainText('Sunflowers follow');
  await expect(page.locator('[data-opening-chapter]')).toHaveCount(0);
  await expect(page.locator('.line')).toContainText('early pollinators');
});
}
