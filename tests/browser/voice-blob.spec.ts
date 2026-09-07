import { expect, test } from '@playwright/test';

type Entry = { kind: string; at: number; line: number; blob?: number; source?: string; name?: string; time?: number; duration?: number };
for (const scenario of ['', '?pauseResume']) test(`local audio URLs survive four lines ${scenario || 'normally'}`, async ({ page, browserName }, info) => {
  // Four complete prerecorded utterances total about 26 seconds, before
  // preparation and native decoder startup. Keep a bounded completion margin.
  test.setTimeout(45000);
  await page.goto(`http://127.0.0.1:4274/tests/browser/fixtures/voice-blob.html${scenario}`);
  await page.getByRole('button', { name: 'Play four local lines' }).click();
  try {
    await page.waitForFunction(() => (window as unknown as { voiceBlobProbe: Entry[] }).voiceBlobProbe.some(event => event.kind === 'complete'), null, { timeout: 40000 });
  } finally {
    await info.attach('voice-lifetime', { body: JSON.stringify(await page.evaluate(() => (window as unknown as { voiceBlobProbe: Entry[] }).voiceBlobProbe)), contentType: 'application/json' });
  }
  const events = await page.evaluate(() => (window as unknown as { voiceBlobProbe: Entry[] }).voiceBlobProbe);
  expect(events.filter(event => event.kind === 'fallback' || event.kind === 'speech-failed')).toEqual([]);
  expect(events.filter(event => event.kind === 'speech-start').map(event => event.source)).toEqual(['generated', 'generated', 'generated', 'generated']);
  const ended = events.filter(event => event.kind === 'ended' && (event.duration ?? 0) > .1);
  expect(ended).toHaveLength(4);
  for (const event of ended) expect(event.time).toBeCloseTo(event.duration!, 1);
  expect(events.filter(event => event.kind === 'sink-created')).toHaveLength(1);
  if (scenario) {
    expect(events.filter(event => event.kind === 'requested-pause')).toHaveLength(3);
    if (browserName === 'chromium') expect(events.filter(event => event.kind === 'play-rejected' && event.name === 'AbortError')).toHaveLength(3);
  }
  const disposal = events.find(event => event.kind === 'dispose')!;
  expect(events.filter(event => event.kind === 'revoke').every(event => event.at >= disposal.at)).toBe(true);
});
