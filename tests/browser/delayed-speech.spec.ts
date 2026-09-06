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
