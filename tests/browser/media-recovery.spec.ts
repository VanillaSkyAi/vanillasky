import { expect, test } from '@playwright/test';

for (const fault of ['missing-video', 'hung-video', 'empty-video', 'missing-image', 'hung-image', 'stalled-video', 'ready-image']) {
  test(`preserves authored visible content through ${fault}`, async ({ page, browserName }, info) => {
    test.setTimeout(25000);
    await page.route(`**/${fault}.*`, route => fault.startsWith('hung') ? undefined : route.fulfill({ status: 404, body: '' }));
    const suffix = process.platform === 'linux' && browserName === 'webkit' ? '&webm' : '';
    // Hung media intentionally prevents load in Firefox; playback readiness is asserted below.
    await page.goto(`http://127.0.0.1:4274/tests/browser/fixtures/media-recovery.html?fault=${fault}${suffix}`, { waitUntil: 'domcontentloaded' });
    type Sample = { at: number; scene?: string; visible: boolean; fallback: boolean; videos: number; injected: boolean };
    const read = () => page.evaluate(() => (window as unknown as { recoverySamples: Sample[] }).recoverySamples);
    try {
      await expect(page.locator('[data-video-frame]')).toHaveAttribute('data-scene-id', 'ending', { timeout: 18000 });
      const samples = await read();
      const start = samples.findIndex(sample => sample.visible);
      let lastVisible = samples[start].at, gap = 0;
      for (const sample of samples.slice(start)) {
        if (sample.visible) lastVisible = sample.at;
        else gap = Math.max(gap, sample.at - lastVisible);
      }
      expect(samples.some(sample => sample.scene === 'media' && sample.fallback && sample.visible)).toBe(fault !== 'ready-image');
      if (fault === 'stalled-video') expect(samples.some(sample => sample.injected)).toBe(true);
      if (fault === 'ready-image') expect(samples.some(sample => sample.scene === 'media' && sample.visible)).toBe(true);
      console.info(JSON.stringify({ fault, longestBlankMs: gap, fallbackAtMs: samples.find(sample => sample.fallback)?.at }));
      expect(gap).toBeLessThan(500);
      expect(Math.max(...samples.map(sample => sample.videos))).toBeLessThanOrEqual(2);
    } finally { await info.attach('media-recovery', { body: JSON.stringify(await read()), contentType: 'application/json' }); }
  });
}
