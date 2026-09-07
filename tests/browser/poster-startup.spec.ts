import { expect, test } from '@playwright/test';

test('a missing optional poster does not delay real video and complete narration', async ({ page, browserName }, info) => {
  test.setTimeout(25000);
  let posterRequested = false;
  await page.route('**/never-ready-poster.jpg', () => { posterRequested = true; });
  const clip = process.platform === 'linux' && browserName === 'webkit' ? 'sunflowers.webm' : 'sunflowers.mp4';
  await page.goto(`http://127.0.0.1:4274/tests/browser/fixtures/poster-startup.html?clip=${clip}`);
  await page.getByRole('textbox', { name: 'Prompt' }).fill('Show sunflowers moving');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  type Probe = { samples: { at: number; opening: boolean; videos: number; frame: boolean; visibleFrame: boolean; moving: boolean }[]; audio: { kind: string; at: number; time: number; duration: number | null }[] };
  const read = () => page.evaluate(() => (window as unknown as { posterProbe: Probe }).posterProbe);
  try {
    await page.waitForFunction(() => (window as unknown as { posterProbe: Probe }).posterProbe.audio.some(event => event.kind === 'ended' && (event.duration ?? 0) > 1), null, { timeout: 20000 });
    const probe = await read();
    expect(posterRequested).toBe(true);
    const motion = probe.samples.find(sample => sample.moving)!;
    expect(motion).toBeDefined();
    expect(motion.at).toBeLessThan(7000);
    const audioStart = probe.audio.find(event => event.kind === 'playing' && (event.duration ?? 0) > 1)!;
    expect(audioStart.at).toBeLessThan(7000);
    const ended = probe.audio.find(event => event.kind === 'ended' && (event.duration ?? 0) > 1)!;
    expect(ended.time).toBeCloseTo(ended.duration!, 1);
    expect(probe.audio.filter(event => event.kind === 'error')).toEqual([]);
    expect(probe.samples.some(sample => sample.opening)).toBe(true);
    expect(probe.samples.every(sample => sample.opening || sample.visibleFrame)).toBe(true);
    console.info(JSON.stringify({ firstFrameMs: probe.samples.find(sample => sample.frame)?.at,
      firstMotionMs: motion.at, firstSpeechMs: audioStart.at, speechEndMs: ended.at }));
    expect(Math.max(...probe.samples.map(sample => sample.videos))).toBeLessThanOrEqual(2);
    await expect(page.locator('[data-opening-chapter]')).toHaveCount(0);
  } finally {
    await info.attach('poster-startup', { body: JSON.stringify(await read()), contentType: 'application/json' });
  }
});
