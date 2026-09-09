import { writeFile } from "node:fs/promises";
import { devices, expect, test } from "@playwright/test";

type MotionSample = {at: number; time: number; frameFingerprint?: number | null; presentedMediaTime?: number | null; presentedFrames?: number; paused: boolean; hidden: boolean};
function maximumMotionStall(samples: MotionSample[]) {
  let lastFingerprint: number | null | undefined, lastAdvance: number | undefined, maximum = 0;
  let previous: MotionSample | undefined;
  for (const sample of samples) {
    // Linux WebKit can present moving frames while drawImage returns a stale
    // texture. Require both new presented frames and forward media time; the
    // ordinary currentTime clock alone remains insufficient evidence.
    const presentedAdvance = previous?.presentedMediaTime != null
      && sample.presentedMediaTime != null
      && sample.presentedMediaTime > previous.presentedMediaTime
      && (sample.presentedFrames ?? 0) > (previous.presentedFrames ?? 0);
    if (lastAdvance === undefined || sample.paused || sample.hidden || presentedAdvance || (sample.frameFingerprint != null && sample.frameFingerprint !== lastFingerprint)) lastAdvance = sample.at;
    else maximum = Math.max(maximum, sample.at - lastAdvance);
    lastFingerprint = sample.frameFingerprint;
    previous = sample;
  }
  return maximum;
}
test("motion proof rejects frozen pixels despite an advancing media clock", () => {
  const frozen = Array.from({length: 7}, (_, index) => ({at:100+index*100, time:index*.1, frameFingerprint:42, paused:false, hidden:false}));
  expect(maximumMotionStall(frozen)).toBe(600);
  expect(maximumMotionStall(frozen.map((sample,index)=>({...sample,time:1.5,frameFingerprint:index})))).toBe(0);
  expect(maximumMotionStall(frozen.map(sample=>({...sample,paused:true})))).toBe(0);
  expect(maximumMotionStall(frozen.map((sample, index) => ({ ...sample, presentedFrames: index, presentedMediaTime: index * .1 })))).toBe(0);
  expect(maximumMotionStall(frozen.map((sample, index) => ({ ...sample, presentedFrames: index, presentedMediaTime: 0 })))).toBe(600);
  expect(maximumMotionStall(frozen.map((sample, index) => ({ ...sample, presentedFrames: 1, presentedMediaTime: index * .1 })))).toBe(600);
});

for (const mode of ["normal", "repeat", "long-repeat", "unmeasured", "quiet-tail", "short", "oversized", "audible", "missing", "unusable", "delayed", "delayed-latePlay"]) test(`narration completes with moving footage or an authored chapter: ${mode}`, async ({ browser, browserName }, info) => {
  test.setTimeout(30000);
  const context = await browser.newContext({ ...(browserName === "webkit" ? devices["iPhone 13"] : {}), recordVideo: { dir: info.outputPath("recording") } });
  const page = await context.newPage();
  const delayed = mode.startsWith("delayed");
  const webm = process.platform === "linux" && browserName === "webkit";
  try {
    await page.goto(`http://127.0.0.1:4274/tests/browser/fixtures/continuous-video.html?${mode.replace("-latePlay", "&latePlay")}${webm ? "&webm" : ""}`);
    await page.getByRole("button").click();
    // In-page observation does not refresh Safari's transient user activation.
    await page.waitForFunction(() => document.body.dataset.proofComplete === "true" && (window as unknown as { continuityProof: { events: string[] } }).continuityProof.events.filter(event => event === "audio-ended").length === 2, undefined, { timeout: 25000 });
    const proof = await page.evaluate(() => (window as unknown as { continuityProof: { phases: {kind: string; at: number; seconds?: number}[]; events: string[]; samples: { at: number; narrationReady: boolean; audioTime: number; frameFingerprint: number | null; mediaDuration: number; time: number; muted: boolean; paused: boolean; rate: number; ended: boolean; hidden: boolean; status: string; chapter: string; playerEnded: boolean }[] } }).continuityProof);
    const active = proof.samples.filter(sample => !sample.playerEnded);
    let stalledAt = 0, maximumFrozenMs = 0;
    for (const sample of active) {
      if (sample.ended && !sample.hidden) { stalledAt ||= sample.at; maximumFrozenMs = Math.max(maximumFrozenMs, sample.at - stalledAt); }
      else stalledAt = 0;
    }
    const maximumMotionStallMs = maximumMotionStall(active);
    await writeFile(info.outputPath("continuous-video-proof.json"), JSON.stringify({ mode, browser: browserName, platform: process.platform, codec: webm ? "VP8/Opus" : "H264/AAC", maximumFrozenMs, maximumMotionStallMs, ...proof }));
    expect(proof.events.filter(event => event === "audio-ended")).toHaveLength(2);
    expect(proof.events.filter(event => event.includes("error"))).toEqual([]);
    if (!["missing", "unusable", "short"].includes(mode)) {
      expect(new Set(active.flatMap(sample => sample.frameFingerprint == null ? [] : [sample.frameFingerprint])).size).toBeGreaterThan(3);
    }
    expect(maximumMotionStallMs).toBeLessThan(500);
    // A native ended event and React paint may be separated by one frame.
    expect(maximumFrozenMs).toBeLessThan(100);
    if (delayed) {
      let heldSince: number | undefined, longestHoldMs = 0;
      for (const sample of active) {
        if (sample.paused && sample.time >= 0 && sample.time < .3) {
          heldSince ??= sample.at;
          longestHoldMs = Math.max(longestHoldMs, sample.at - heldSince);
        } else heldSince = undefined;
      }
      const delayStart = proof.phases.find(phase => phase.kind === "speech-delay-start")!;
      const delayEnd = proof.phases.find(phase => phase.kind === "speech-delay-end")!;
      expect(delayEnd.at - delayStart.at).toBeGreaterThanOrEqual(1000);
      if (mode === "delayed-latePlay") {
        const late = proof.phases.find(phase => phase.kind === "late-native-start")!;
        expect(late).toBeDefined();
        expect(late.at).toBeGreaterThan(delayStart.at);
        expect(late.at).toBeLessThan(delayEnd.at);
        expect(active.find(sample => sample.at >= late.at)?.narrationReady).toBe(false);
      }
      // Measure time held, not a frame count that assumes a particular RAF rate.
      expect(longestHoldMs).toBeGreaterThanOrEqual(800);
    }
    if (mode === "audible") expect(active.some(sample => !sample.muted)).toBe(true);
    if (!["missing", "unusable", "short"].includes(mode)) {
      expect(active.every(sample => sample.rate === 1)).toBe(true);
      expect(active.filter(sample => sample.status === "Visual unavailable")).toHaveLength(0);
      expect(active.some(sample => sample.chapter)).toBe(false);
      const wraps = active.flatMap((sample, index) => index > 0 && sample.time < active[index - 1]!.time - .5 ? [index] : []);
      const expectedRepeats = mode === "long-repeat" || mode === "unmeasured" ? 2 : mode === "repeat" || mode === "oversized" ? 1 : 0;
      expect(wraps).toHaveLength(expectedRepeats);
      if (expectedRepeats) {
        const lastAudio = proof.phases.filter(phase => phase.kind === "audio-ended").at(-1)!;
        expect(proof.samples.at(-1)!.at - lastAudio.at).toBeLessThan(150);
        expect(proof.phases.filter(phase => phase.kind === "speech-onset")).toHaveLength(1);
        expect(active.some((sample, index) => index > 0 && sample.audioTime < active[index - 1]!.audioTime - .05)).toBe(false);
        for (const [pass, start] of wraps.entries()) {
          expect(new Set(active.slice(start, wraps[pass + 1]).flatMap(sample => sample.frameFingerprint == null ? [] : [sample.frameFingerprint])).size).toBeGreaterThan(3);
        }
        if (mode === "long-repeat") expect(proof.phases.find(phase => phase.kind === "prepared-speech")?.seconds).toBeGreaterThan(10);
      }
    } else {
      expect(active.some(sample => sample.chapter === "Water keeps moving")).toBe(true);
      expect(active.some(sample => sample.status === "Visual unavailable")).toBe(false);
    }
    await info.attach("continuous-video-proof", { body: JSON.stringify(proof), contentType: "application/json" });
  } catch (error) {
    await info.attach("failure-proof", { body: JSON.stringify(await page.evaluate(() => (window as unknown as { continuityProof: unknown }).continuityProof)), contentType: "application/json" });
    throw error;
  } finally { await context.close(); }
});

test("multiple repeats preserve decoder identity through pause, replay and interruption", async ({ browser, browserName }, info) => {
  test.setTimeout(45000);
  const context = await browser.newContext({ ...(browserName === "webkit" ? devices["iPhone 13"] : {}) });
  const page = await context.newPage();
  try {
    await page.goto(`http://127.0.0.1:4274/tests/browser/fixtures/continuous-video.html?long-repeat&lifecycle${process.platform === "linux" && browserName === "webkit" ? "&webm" : ""}`);
    await page.getByRole("button", { name: "Play exact recorded narration", exact: true }).click();
    await page.waitForFunction(() => {
      const proof = (window as unknown as { continuityProof: { events: string[] } }).continuityProof;
      return proof.events.filter(event => event.startsWith("video:ended:")).length === 2 && (document.querySelector("video")?.currentTime ?? 0) > .1;
    });
    const decoder = await page.locator("video").elementHandle();
    await page.getByRole("button", { name: "Pause narration", exact: true }).click();
    await expect(page.locator("video")).toHaveJSProperty("paused", true);
    const held = await page.locator("video").evaluate(video => (video as HTMLVideoElement).currentTime);
    await page.waitForFunction(time => (document.querySelector("video")?.currentTime ?? -1) === time, held);
    await page.waitForTimeout(200);
    expect(await page.locator("video").evaluate(video => (video as HTMLVideoElement).currentTime)).toBeCloseTo(held, 1);
    await page.getByRole("button", { name: "Resume narration", exact: true }).click();
    await page.waitForFunction(() => document.body.dataset.proofComplete === "true");
    const first = await page.evaluate(() => (window as unknown as { continuityProof: { samples: Array<MotionSample & {chapter:string;loop:boolean}>; events: string[] } }).continuityProof);
    expect(first.events.filter(event => event.startsWith("video:ended:"))).toHaveLength(2);
    expect(first.events.filter(event => event === "audio-ended")).toHaveLength(2);
    expect(first.samples.some(sample => sample.chapter || sample.loop)).toBe(false);
    expect(maximumMotionStall(first.samples)).toBeLessThan(500);
    await page.getByRole("button", { name: "Replay video response", exact: true }).click();
    await page.waitForFunction(() => {
      const proof = (window as unknown as { continuityProof: { events: string[] } }).continuityProof;
      return proof.events.filter(event => event.startsWith("video:ended:")).length === 4 && (document.querySelector("video")?.currentTime ?? 0) > .1;
    });
    expect(await decoder!.evaluate(video => video === document.querySelector("video"))).toBe(true);
    await page.getByRole("button", { name: "Interrupt narration", exact: true }).click();
    await expect(page.locator("video")).toHaveJSProperty("paused", true);
    const interrupted = await page.locator("video").evaluate(video => (video as HTMLVideoElement).currentTime);
    await page.waitForTimeout(1000);
    expect(await page.locator("video").evaluate(video => (video as HTMLVideoElement).currentTime)).toBeCloseTo(interrupted, 1);
    const proof = await page.evaluate(() => (window as unknown as { continuityProof: { samples: Array<{chapter:string;loop:boolean}>; events: string[] } }).continuityProof);
    expect(proof.events.filter(event => event === "audio-ended")).toHaveLength(2);
    expect(proof.events.filter(event => event.startsWith("video:ended:"))).toHaveLength(4);
    expect(proof.samples.some(sample => sample.chapter || sample.loop)).toBe(false);
    expect(proof.events.some(event => event.includes("error"))).toBe(false);
    await writeFile(info.outputPath("repeated-narration-lifecycle-proof.json"), JSON.stringify(proof));
  } finally { await context.close(); }
});


for (const waiting of [false, true]) test(`three narrated scenes reuse one persistent video source${waiting ? " after waiting" : ""}`, async ({ browser, browserName }, info) => {
  test.setTimeout(70000);
  const context = await browser.newContext({ ...(browserName === "webkit" ? devices["iPhone 13"] : {}) });
  try {
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:4274/tests/browser/fixtures/continuous-video.html?same-url${process.platform === "linux" && browserName === "webkit" ? "&webm" : ""}`);
    await page.getByRole("button").click();
    if (waiting) {
      await page.waitForFunction(() => document.querySelector('[data-video-frame]')?.getAttribute('data-scene-id') === "three" && (document.querySelector("video")?.currentTime ?? 0) > .5);
      await page.evaluate(() => document.querySelector("video")?.dispatchEvent(new Event("waiting")));
    }
    await page.waitForFunction(() => document.body.dataset.proofComplete === "true", undefined, { timeout: 60000 });
    const proof = await page.evaluate(() => (window as unknown as { continuityProof: { samples: { scene: string; time: number; paused: boolean; hidden: boolean }[]; events: string[] } }).continuityProof);
    await writeFile(info.outputPath("same-url-proof.json"), JSON.stringify(proof));
    for (const id of ["one", "two", "three"]) {
      expect(proof.samples.some(sample => sample.scene === id && sample.time > 1 && !sample.paused && !sample.hidden), id).toBe(true);
    }
    expect(proof.events.filter(event => event === "audio-ended")).toHaveLength(4);
  } finally { await context.close(); }
});
