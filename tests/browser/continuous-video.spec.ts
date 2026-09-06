import { writeFile } from "node:fs/promises";
import { devices, expect, test } from "@playwright/test";
for (const mode of ["normal", "short", "audible", "missing", "unusable", "delayed"]) test(`narration completes with moving footage or an honest unavailable state: ${mode}`, async ({ browser, browserName }, info) => {
  test.setTimeout(30000);
  const context = await browser.newContext({ ...(browserName === "webkit" ? devices["iPhone 13"] : {}), recordVideo: { dir: info.outputPath("recording") } });
  const page = await context.newPage();
  const webm = process.platform === "linux" && browserName === "webkit";
  try {
    await page.goto(`http://127.0.0.1:4274/tests/browser/fixtures/continuous-video.html?${mode}${webm ? "&webm" : ""}`);
    await page.getByRole("button").click();
    // In-page observation does not refresh Safari's transient user activation.
    await page.waitForFunction(() => document.body.dataset.proofComplete === "true" && (window as unknown as { continuityProof: { events: string[] } }).continuityProof.events.filter(event => event === "audio-ended").length === 2, undefined, { timeout: 25000 });
    const proof = await page.evaluate(() => (window as unknown as { continuityProof: { events: string[]; samples: { at: number; time: number; muted: boolean; paused: boolean; rate: number; ended: boolean; hidden: boolean; status: string; playerEnded: boolean }[] } }).continuityProof);
    expect(proof.events.filter(event => event === "audio-ended")).toHaveLength(2);
    expect(proof.events.filter(event => event.includes("error"))).toEqual([]);
    const active = proof.samples.filter(sample => !sample.playerEnded);
    let stalledAt = 0, maximumFrozenMs = 0;
    for (const sample of active) {
      if (sample.ended && !sample.hidden) { stalledAt ||= sample.at; maximumFrozenMs = Math.max(maximumFrozenMs, sample.at - stalledAt); }
      else stalledAt = 0;
    }
    let lastMediaTime = -1, lastAdvance = 0, maximumMotionStallMs = 0;
    for (const sample of active) {
      if (sample.paused || sample.hidden || sample.time !== lastMediaTime) lastAdvance = sample.at;
      else maximumMotionStallMs = Math.max(maximumMotionStallMs, sample.at - lastAdvance);
      lastMediaTime = sample.time;
    }
    expect(maximumMotionStallMs).toBeLessThan(500);
    await writeFile(info.outputPath("continuous-video-proof.json"), JSON.stringify({ mode, browser: browserName, platform: process.platform, codec: webm ? "VP8/Opus" : "H264/AAC", maximumFrozenMs, maximumMotionStallMs, ...proof }));
    // A native ended event and React paint may be separated by one frame.
    expect(maximumFrozenMs).toBeLessThan(100);
    if (mode === "delayed") expect(active.filter(sample => sample.paused && sample.time >= 0 && sample.time < .3).length).toBeGreaterThan(20);
    if (mode === "audible") expect(active.some(sample => !sample.muted)).toBe(true);
    if (mode === "normal" || mode === "audible" || mode === "delayed") {
      expect(active.some(sample => sample.rate >= .75 && sample.rate < 1)).toBe(true);
      expect(active.filter(sample => sample.status === "Visual unavailable")).toHaveLength(0);
      expect(active.filter((sample, index) => index > 0 && sample.time < active[index - 1]!.time - .5)).toHaveLength(0);
    } else if (mode === "short") {
      expect(active.some(sample => sample.status === "Visual unavailable")).toBe(true);
      expect(active.filter((sample, index) => index > 0 && sample.time < active[index - 1]!.time - .5)).toHaveLength(1);
    } else expect(active.some(sample => sample.status === "Visual unavailable")).toBe(true);
    await info.attach("continuous-video-proof", { body: JSON.stringify(proof), contentType: "application/json" });
  } catch (error) {
    await info.attach("failure-proof", { body: JSON.stringify(await page.evaluate(() => (window as unknown as { continuityProof: unknown }).continuityProof)), contentType: "application/json" });
    throw error;
  } finally { await context.close(); }
});
