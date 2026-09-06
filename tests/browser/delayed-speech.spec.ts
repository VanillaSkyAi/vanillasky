import { devices, expect, test } from '@playwright/test';

for (const profile of ['mobile-default', 'iPhone 13']) test(`generated body narration survives the expired opening gesture (${profile})`, async ({ browser, browserName }, info) => {
  test.setTimeout(35000);
  test.skip(browserName !== 'webkit' && profile === 'iPhone 13', 'Extra device profile exercises WebKit policy');
  const context = await browser.newContext(browserName === 'webkit'
    ? profile === 'iPhone 13' ? { ...devices['iPhone 13'] } : { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
    : {});
  const page = await context.newPage();
  type Probe = { kind: string; at: number; id?: number; name?: string; code?: number; source?: string };
  const read = () => page.evaluate(() => (window as unknown as { speechProbe: Probe[] }).speechProbe);
  try {
    await page.goto('http://127.0.0.1:4274/tests/browser/fixtures/delayed-speech.html');
    await page.getByRole('button', { name: 'Play delayed narration' }).click();
    // Protocol evaluate/poll calls can renew user activation and mask Safari's
    // restriction. Wait inside the page without further gesture-bearing calls.
    await page.waitForFunction(() => (window as unknown as { speechProbe: Probe[] }).speechProbe.some(event => event.kind === 'complete'), null, { timeout: 30000 });
    const events = await read();
    expect(events.filter(event => event.kind === 'rejected' || event.kind === 'error' || event.kind === 'fallback')).toEqual([]);
    expect(events.filter(event => event.kind === 'ended')).toHaveLength(2);
    expect(new Set(events.filter(event => event.kind === 'playing').map(event => event.id)).size).toBe(1);
    expect(events.find(event => event.kind === 'body-start')).toMatchObject({ source: 'generated' });
    expect(events.find(event => event.kind === 'body-start')!.at).toBeGreaterThanOrEqual(7400);
  } finally {
    await info.attach('delayed-speech-events', { body: JSON.stringify(await read()), contentType: 'application/json' });
    await context.close();
  }
});


test('a fresh speech sink activated on click survives delayed first and body narration', async ({ browser, browserName }, info) => {
  test.setTimeout(40000);
  test.skip(browserName !== 'webkit', 'Exercises native Safari user activation');
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  type Probe = { kind: string; at: number; id?: number; source?: string; duration?: number; mediaTime?: number };
  const read = () => page.evaluate(() => (window as unknown as { speechProbe: Probe[] }).speechProbe);
  try {
    await page.goto('http://127.0.0.1:4274/tests/browser/fixtures/delayed-speech.html?freshSink');
    await page.getByRole('button', { name: 'Play delayed narration' }).click();
    // One in-page wait: no evaluate polling or extra clicks can renew activation.
    await page.waitForFunction(() => (window as unknown as { speechProbe: Probe[] }).speechProbe.some(event => event.kind === 'complete'), null, { timeout: 35000 });
    const events = await read();
    expect(events.filter(event => ['rejected', 'error', 'fallback'].includes(event.kind))).toEqual([]);
    const ended = events.filter(event => event.kind === 'ended');
    const utterances = ended.filter(event => (event.duration ?? 0) > 1);
    const priming = ended.filter(event => (event.duration ?? 0) <= .1);
    expect(priming).toHaveLength(1);
    expect(priming[0].duration).toBeCloseTo(.025, 2);
    expect(utterances).toHaveLength(2);
    for (const event of utterances) expect(event.mediaTime).toBeCloseTo(event.duration!, 1);
    expect(new Set(events.filter(event => event.kind === 'playing').map(event => event.id)).size).toBe(1);
    expect(events.find(event => event.kind === 'opening-start')).toMatchObject({ source: 'generated' });
    expect(events.find(event => event.kind === 'opening-start')!.at).toBeGreaterThanOrEqual(6000);
    expect(events.find(event => event.kind === 'body-start')).toMatchObject({ source: 'generated' });
    expect(events.find(event => event.kind === 'body-start')!.at - utterances[0].at).toBeGreaterThanOrEqual(5500);
  } finally {
    await info.attach('fresh-sink-delayed-speech-events', { body: JSON.stringify(await read()), contentType: 'application/json' });
    await context.close();
  }
});
