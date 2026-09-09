import { devices, expect, test } from '@playwright/test';

type Probe = { kind: string; at: number; id?: number; contextId?: number; name?: string; code?: number; source?: string; duration?: number; mediaTime?: number };

function expectCompleteRecordings(events: Probe[], buffered: boolean) {
  expect(events.filter(event => ['rejected', 'error', 'fallback', 'failed'].includes(event.kind))).toEqual([]);
  expect(events.filter(event => event.kind === 'complete')).toHaveLength(1);
  const ended = events.filter(event => event.kind === (buffered ? 'buffer-ended' : 'ended') && (event.duration ?? 0) > 1);
  const playbackStarts = events.filter(event => event.kind === (buffered ? 'buffer-start' : 'playing') && (event.duration ?? 0) > 1);
  expect(ended).toHaveLength(2);
  expect(playbackStarts).toHaveLength(2);
  for (const [index, name] of ['opening', 'body'].entries()) {
    const prepared = events.find(event => event.kind === `${name}-prepared`)!;
    // Both formats contain the same 6.419-second recording; MP3 container
    // duration can include a short encoder padding tail.
    expect(prepared.duration).toBeGreaterThan(6.4);
    expect(prepared.duration).toBeLessThan(6.5);
    const started = events.find(event => event.kind === `${name}-start`)!;
    const completed = events.find(event => event.kind === `${name}-complete`)!;
    expect(started).toMatchObject({ source: 'generated' });
    // Buffer ended callbacks may be delivered after the source has completed;
    // the context clock must have covered the full recording when they arrive.
    if (buffered) expect(ended[index].mediaTime).toBeGreaterThanOrEqual(ended[index].duration! - .05);
    else expect(ended[index].mediaTime).toBeCloseTo(ended[index].duration!, 1);
    expect(completed.at).toBeGreaterThanOrEqual(ended[index].at);
    const playbackStart = playbackStarts[index];
    expect(completed.at - playbackStart.at).toBeGreaterThan((prepared.duration! - (playbackStart.mediaTime ?? 0) - .2) * 1000);
    const clock = events.filter(event => event.kind === `${name}-clock` && event.mediaTime !== undefined);
    expect(clock.some(event => event.mediaTime! > .1 && event.mediaTime! < 1)).toBe(true);
    expect(clock.some(event => event.mediaTime! > 5.5)).toBe(true);
    for (let index = 1; index < clock.length; index++) expect(clock[index].mediaTime!).toBeGreaterThanOrEqual(clock[index - 1].mediaTime!);
  }
  if (buffered) {
    const sources = events.filter(event => event.kind === 'buffer-start');
    expect(sources).toHaveLength(2);
    expect(new Set(sources.map(event => event.contextId)).size).toBe(1);
    expect(events.filter(event => event.kind === 'context-created')).toHaveLength(1);
    expect(events.filter(event => event.kind === 'playing' || event.kind === 'ended')).toEqual([]);
  } else {
    expect(new Set(events.filter(event => event.kind === 'playing').map(event => event.id)).size).toBe(1);
    expect(events.filter(event => event.kind === 'buffer-start')).toEqual([]);
  }
}

for (const profile of ['mobile-default', 'iPhone 13']) test(`generated body narration survives the expired opening gesture (${profile})`, async ({ browser, browserName, baseURL }, info) => {
  test.setTimeout(35000);
  test.skip(browserName !== 'webkit' && profile === 'iPhone 13', 'Extra device profile exercises WebKit policy');
  const context = await browser.newContext(browserName === 'webkit'
    ? profile === 'iPhone 13' ? { ...devices['iPhone 13'] } : { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
    : {});
  const page = await context.newPage();
  const read = () => page.evaluate(() => (window as unknown as { speechProbe: Probe[] }).speechProbe);
  try {
    await page.goto(`${baseURL ?? 'http://127.0.0.1:4274'}/tests/browser/fixtures/delayed-speech.html`);
    await page.getByRole('button', { name: 'Play delayed narration' }).click();
    // One in-page wait: protocol evaluate/poll calls could renew activation.
    await page.waitForFunction(() => (window as unknown as { speechProbe: Probe[] }).speechProbe.some(event => event.kind === 'complete' || event.kind === 'failed'), null, { timeout: 30000 });
    const events = await read();
    expectCompleteRecordings(events, profile === 'iPhone 13');
    expect(events.find(event => event.kind === 'body-start')!.at).toBeGreaterThanOrEqual(7400);
  } finally {
    await info.attach('delayed-speech-events', { body: JSON.stringify(await read()), contentType: 'application/json' });
    await context.close();
  }
});

for (const profile of ['mobile-default', 'iPhone 13']) test(`a fresh speech output activated on click survives delayed first and body narration (${profile})`, async ({ browser, browserName, baseURL }, info) => {
  test.setTimeout(40000);
  test.skip(browserName !== 'webkit', 'Exercises Safari user activation');
  const buffered = profile === 'iPhone 13';
  const context = await browser.newContext(buffered ? { ...devices['iPhone 13'] }
    : { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const read = () => page.evaluate(() => (window as unknown as { speechProbe: Probe[] }).speechProbe);
  try {
    await page.goto(`${baseURL ?? 'http://127.0.0.1:4274'}/tests/browser/fixtures/delayed-speech.html?freshSink`);
    await page.getByRole('button', { name: 'Play delayed narration' }).click();
    // One in-page wait: no extra calls renew activation before the delayed audio.
    await page.waitForFunction(() => (window as unknown as { speechProbe: Probe[] }).speechProbe.some(event => event.kind === 'complete' || event.kind === 'failed'), null, { timeout: 35000 });
    const events = await read();
    expectCompleteRecordings(events, buffered);
    if (!buffered) {
      const priming = events.filter(event => event.kind === 'ended' && (event.duration ?? 0) <= .1);
      expect(priming).toHaveLength(1);
      expect(priming[0].duration).toBeCloseTo(.025, 2);
    }
    expect(events.find(event => event.kind === 'opening-start')!.at).toBeGreaterThanOrEqual(6000);
    expect(events.find(event => event.kind === 'body-start')!.at - events.find(event => event.kind === 'opening-complete')!.at).toBeGreaterThanOrEqual(5500);
  } finally {
    await info.attach('fresh-output-delayed-speech-events', { body: JSON.stringify(await read()), contentType: 'application/json' });
    await context.close();
  }
});
