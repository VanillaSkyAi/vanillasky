import { devices, expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
for (const delayedOnset of [false, true]) test(`one prerecorded paragraph survives two visual cuts (delayed onset: ${delayedOnset})`, async ({ browser, browserName }, info) => {
  const context = await browser.newContext(browserName === "webkit" ? { ...devices["iPhone 13"] } : {});
  const page = await context.newPage();
  test.setTimeout(30000);
  await page.goto(`http://127.0.0.1:4274/tests/browser/fixtures/grouped-narration.html${delayedOnset ? "?delayedOnset" : ""}`);
  await page.getByText("Play prerecorded paragraph").click();
  try {
    await expect.poll(() => page.evaluate(() => (window as unknown as { narrationProbe: Array<{ kind: string }> }).narrationProbe.filter((event) => event.kind === "ended").length), { timeout: 15000 }).toBe(1);
    const probe = await page.evaluate(() => (window as unknown as { narrationProbe: Array<{ kind: string; index?: number; audioTime?: number; source?: string; at?: number }> }).narrationProbe);
    expect(probe.filter((event) => event.kind === "audio-created")).toHaveLength(1);
    const stall = probe.find((event) => event.kind === "cold-output-stall");
    if (delayedOnset) {
      expect(stall?.source).toBe("blob");
      const released = probe.find((event) => event.kind === "cold-output-release");
      expect(released!.at! - stall!.at!).toBeGreaterThanOrEqual(1400);
    } else expect(stall).toBeUndefined();
    expect(probe.filter((event) => event.kind === "pause" && event.audioTime! < 6)).toHaveLength(0);
    const cuts = probe.filter((event) => event.kind === "cut");
    expect(cuts.map((event) => event.index)).toEqual([0, 1, 2]);
    expect(cuts[1]!.audioTime).toBeGreaterThan(1);
    expect(cuts[2]!.audioTime).toBeGreaterThan(cuts[1]!.audioTime!);
    await writeFile(info.outputPath("grouped-audio.json"), JSON.stringify({ commit: process.env.TEST_SOURCE_COMMIT, browser: info.project.name, browserVersion: browser.version(), audio: "offline macOS Samantha prerecorded paragraph", probe }, null, 2));
    await page.screenshot({ path: info.outputPath("grouped-audio.png") });
  } catch (error) {
    const diagnostics = await page.evaluate(() => ({
      probe: (window as unknown as { narrationProbe: unknown[] }).narrationProbe,
      video: [...document.querySelectorAll("video")].map((media) => ({ readyState: media.readyState, currentTime: media.currentTime, duration: media.duration, paused: media.paused, error: media.error?.message })),
    }));
    await info.attach("grouped-narration-failure", { body: JSON.stringify(diagnostics, null, 2), contentType: "application/json" });
    console.error("Grouped narration failure:", JSON.stringify(diagnostics));
    throw error;
  } finally {
    await context.close();
  }
});

test('a cold grouped visual pauses the paragraph after its bounded handoff window', async ({browser,browserName}, info) => {
  test.skip(browserName !== 'webkit', 'Exercises bounded mobile preparation.');
  const context=await browser.newContext({...devices['iPhone 13']});
  const page=await context.newPage();
  let releaseMedia = () => {};
  try {
    const mediaGate = new Promise<void>(resolve => { releaseMedia = resolve; });
    const requests: {range?:string;at:number}[] = [];
    await page.route('**/tram.mp4',async route=>{
      requests.push({range:route.request().headers()['range'],at:Date.now()});
      await mediaGate;
      await route.continue();
    });
    await page.goto('http://127.0.0.1:4274/tests/browser/fixtures/grouped-narration.html');
    await page.getByText('Play prerecorded paragraph').click();
    // Preparation starts during the outgoing scene. Keep all Range responses
    // blocked until 1.5s after the real visual boundary, not request start.
    await page.waitForFunction(()=>document.querySelector('[data-video-frame]')?.getAttribute('data-scene-id')==='1',null,{timeout:8000});
    await page.evaluate(async()=>{
      const probe=(window as unknown as {narrationProbe:Array<{kind:string;at:number}>}).narrationProbe;
      probe.push({kind:'cold-video-boundary',at:performance.now()});
      await new Promise(resolve=>setTimeout(resolve,1500));
      probe.push({kind:'cold-video-release',at:performance.now()});
    });
    releaseMedia();
    await page.waitForFunction(()=>(window as unknown as {narrationProbe:Array<{kind:string}>}).narrationProbe.some(event=>event.kind==='ended'),null,{timeout:15000});
    const probe=await page.evaluate(()=>(window as unknown as {narrationProbe:Array<{kind:string;index?:number;audioTime?:number;source?:string;at:number}>}).narrationProbe);
    const pause=probe.find(event=>event.kind==='pause' && event.audioTime!>1 && event.audioTime!<4)!;
    expect(pause).toBeDefined();
    const boundary=probe.find(event=>event.kind==='cold-video-boundary')!;
    const released=probe.find(event=>event.kind==='cold-video-release')!;
    expect(released.at-boundary.at).toBeGreaterThanOrEqual(1500);
    expect(pause.at).toBeLessThan(released.at);
    const cut=probe.find(event=>event.kind==='cut' && event.index===1)!;
    const frame=probe.find(event=>event.kind==='video-frame' && event.source==='tram.mp4')!;
    expect(frame).toBeDefined();
    expect(cut.at).toBeGreaterThanOrEqual(frame.at);
    expect(cut.at-pause.at).toBeGreaterThan(200);
    expect(probe.filter(event=>event.kind==='cut').map(event=>event.index)).toEqual([0,1,2]);
    expect(probe.filter(event=>event.kind==='audio-created')).toHaveLength(1);
    expect(probe.filter(event=>event.kind==='ended')).toHaveLength(1);
    await writeFile(info.outputPath('cold-grouped-handoff.json'),JSON.stringify({requests,probe},null,2));
  }finally{releaseMedia();await context.close();}
});
