import { devices, expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
type Probe = { kind: string; at: number; sources: number; active: string; scene: string; layer: string; mediaTime: number; id: number; audioTime: number; index: number; source: string };
const fixtureUrl = `http://127.0.0.1:4274/tests/browser/fixtures/prepared-handoff.html${process.platform === "linux" ? "?webm" : ""}`;
const readProbe = () => (window as unknown as { narrationProbe: Probe[] }).narrationProbe;
for (const delayMs of [1500, 9000]) test(`prepares three cold clips with ${delayMs}ms requests while all paragraphs finish`, async ({ browser, browserName }, info) => {
  test.skip(browserName !== 'webkit', 'Checks bounded mobile preparation.');
  test.setTimeout(45000);
  const context = await browser.newContext({...devices['iPhone 13']});
  const page = await context.newPage();
  const requests: {url:string;range?:string;at:number}[]=[];
  const delayed = new Set<string>();
  await page.route(/\/(tram|sunflowers)\.(mp4|webm)$/, async route => {
    requests.push({url:route.request().url(),range:route.request().headers()['range'],at:Date.now()});
    // The late control delays only resource selection. A second Range probe
    // must not multiply that fault beyond the player's cold-start deadline.
    if (delayMs === 1500 || !delayed.has(route.request().url())) {
      delayed.add(route.request().url());
      await new Promise(resolve=>setTimeout(resolve,delayMs));
    }
    await route.continue();
  });
  try {
    await page.goto(fixtureUrl);
    await page.getByText('Play prerecorded paragraph').click();
    await expect.poll(()=>page.evaluate(()=>(window as unknown as { narrationProbe: Probe[] }).narrationProbe.filter(e=>e.kind==='ended').length),{timeout:35000}).toBe(3);
    const events=await page.evaluate(readProbe);
    expect(events.filter(e=>e.kind==='cut').map(e=>e.index)).toEqual([0,1,2]);
    expect(events.filter(e=>e.kind==='ended').every(e=>e.audioTime>6.4)).toBe(true);
    expect(events.filter(e=>e.kind==='pause' && e.audioTime<6)).toHaveLength(0);
    expect(Math.max(...events.filter(e=>e.kind==='surface').map(e=>e.sources))).toBeLessThanOrEqual(2);
    for(const index of [1,2]) {
      const firstSurface=events.find(e=>e.kind==='surface' && e.active===String(index));
      const frames=events.filter(e=>e.kind==='frame' && e.scene===String(index) && e.layer==='active');
      expect(frames.length).toBeGreaterThanOrEqual(3);
      expect(frames.at(-1)!.mediaTime-frames[0].mediaTime).toBeGreaterThan(1);
      const gap = frames[0].at-firstSurface!.at;
      if (delayMs === 1500) {
        expect(gap).toBeLessThanOrEqual(200);
        const prepared = events.find(e=>e.kind==='frame' && e.id===frames[0].id && e.layer==='incoming');
        expect(prepared).toBeDefined();
        expect(prepared!.source).toBe(frames[0].source);
        expect(prepared!.at).toBeLessThan(firstSurface!.at);
        const outgoing = events.filter(e=>e.kind==='frame' && e.scene===String(index-1) && e.at<=frames[0].at).at(-1)!;
        expect(frames[0].at-outgoing.at).toBeLessThanOrEqual(200);
      } else {
        expect(gap).toBeLessThanOrEqual(200);
        const priorEnd = events.filter(event => event.kind === 'ended')[index - 1];
        expect(firstSurface!.at - priorEnd.at).toBeGreaterThan(1000);
        const held = events.filter(event => event.kind === 'frame' && event.scene === String(index - 1)
          && event.layer === 'active' && event.at >= priorEnd.at && event.at <= frames[0].at);
        expect(held.length).toBeGreaterThanOrEqual(3);
        let advancing = 0;
        for (let frame = 1; frame < held.length; frame++) {
          expect(held[frame].at - held[frame - 1].at).toBeLessThanOrEqual(200);
          advancing += Math.max(0, held[frame].mediaTime - held[frame - 1].mediaTime);
        }
        expect(advancing).toBeGreaterThan(1);
        expect(frames[0].at - held.at(-1)!.at).toBeLessThanOrEqual(200);
        expect(events.filter(event => event.kind === 'surface' && event.at >= priorEnd.at
          && event.at < firstSurface!.at).every(event => event.active === String(index - 1))).toBe(true);
      }
      const cue = events.find(e=>e.kind==='cut' && e.index===index)!;
      expect(cue.at).toBeGreaterThanOrEqual(frames[0].at);
      const connected=events.find(e=>e.kind==='connected' && e.id===frames[0].id);
      expect(firstSurface!.at-connected!.at).toBeGreaterThanOrEqual(3000);
    }
  } finally {
    await writeFile(info.outputPath('prepared-handoff.json'),JSON.stringify({delayMs,requests,events:await page.evaluate(readProbe)}));
    await context.close();
  }
});


test('bounded preparation retains chapter recovery for a truly stalled active clip', async ({browser,browserName}) => {
  test.skip(browserName !== 'webkit', 'Checks bounded mobile preparation.');
  const context=await browser.newContext({...devices['iPhone 13']});
  try {
    const page=await context.newPage();
    await page.goto(fixtureUrl);
    await page.getByText('Play prerecorded paragraph').click();
    await page.waitForFunction(()=>(document.querySelector<HTMLVideoElement>('[data-scene-layer="active"] video')?.currentTime ?? 0)>.5 && (window as unknown as {narrationProbe:Probe[]}).narrationProbe.some(e=>e.kind==='surface' && e.audioTime>.5));
    await page.evaluate(()=>{const video=document.querySelector<HTMLVideoElement>('[data-scene-layer="active"] video')!;video.pause();video.dispatchEvent(new Event('waiting'));});
    await expect(page.locator('[data-scene-fallback="true"]')).toContainText('Water keeps moving',{timeout:1800});
    await expect(page.locator('[data-scene-layer="active"] video')).toHaveCount(0);
    await expect(page.getByTestId('video-player')).toHaveAttribute('data-playing','true');
  } finally {await context.close();}
});
