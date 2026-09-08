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

for (const mode of ["normal", "short", "oversized", "audible", "missing", "unusable", "delayed", "delayed-latePlay"]) test(`narration completes with moving footage or an authored chapter: ${mode}`, async ({ browser, browserName }, info) => {
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
    const proof = await page.evaluate(() => (window as unknown as { continuityProof: { phases: {kind: string; at: number}[]; events: string[]; samples: { at: number; narrationReady: boolean; frameFingerprint: number | null; mediaDuration: number; time: number; muted: boolean; paused: boolean; rate: number; ended: boolean; hidden: boolean; status: string; chapter: string; playerEnded: boolean }[] } }).continuityProof);
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
    if (!["missing", "unusable", "short", "oversized"].includes(mode)) {
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
    if (mode === "normal" || mode === "audible" || delayed) {
      expect(active.every(sample => sample.rate === 1)).toBe(true);
      expect(active.filter(sample => sample.status === "Visual unavailable")).toHaveLength(0);
      expect(active.filter((sample, index) => index > 0 && sample.time < active[index - 1]!.time - .5)).toHaveLength(0);
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
