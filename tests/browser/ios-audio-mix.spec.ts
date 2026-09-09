import { expect, test } from "@playwright/test";
import path from "node:path";
import { writeFile } from "node:fs/promises";

test("intro music and complete voice survive three audible AI clips after the iOS gesture expires", async ({ page, browserName }, testInfo) => {
  test.setTimeout(30_000);
  await page.addInitScript(() => Object.defineProperty(navigator, "platform", { configurable: true, value: "iPhone" }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/audio-library/*.mp3", route => route.fulfill({ path: path.resolve("tests/browser/fixtures/media-transition/music.mp3"), contentType: "audio/mpeg" }));
  const webm = process.platform === "linux" && browserName === "webkit";
  await page.goto(`http://127.0.0.1:4274/tests/browser/fixtures/ios-audio-mix.html${webm ? "?webm" : ""}`);
  await page.getByRole("textbox", { name: "Prompt" }).fill("Show the natural world");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  const proof = () => page.evaluate(() => (window as unknown as { iosAudioProof: {
    speech: Array<{ text: string; event: string; at: number }>;
    contexts: number; nativeAudio: number; nativeInterruptions: number; frames: number;
    mixedSamples: number; musicStarts: number; musicGains: number[]; fallback: number; videoPlayers: number;
    videoEvents: Array<{ kind: string }>;
  } }).iosAudioProof);
  const music = page.locator('[data-soundtrack="active"]');
  await expect(music).toHaveAttribute("data-audio-output", "buffer");
  const track = await music.getAttribute("data-track-id");
  await expect.poll(async () => (await proof()).speech.filter(event => event.event === "start").length).toBe(1);
  await expect.poll(async () => (await proof()).musicStarts).toBe(1);
  await page.getByRole("button", { name: "Deliver body", exact: true }).click();
  // Await real clocks in-page; polling page.evaluate can renew WebKit activation.
  await page.waitForFunction(() => (window as unknown as { iosAudioProof: { speech: Array<{ event: string }> } }).iosAudioProof.speech.filter(event => event.event === "end").length === 4);
  await expect(music).toHaveAttribute("data-track-id", track!);
  const result = await proof();
  const evidence = testInfo.outputPath("ios-audio-proof.json");
  await writeFile(evidence, JSON.stringify({ ...result, webm, physicalIos: false }));
  await testInfo.attach("ios-audio-proof.json", { path: evidence, contentType: "application/json" });
  expect(result.speech.map(event => event.event)).toEqual(["start", "end", "start", "end", "start", "end", "start", "end"]);
  expect(result.speech[1].at - result.speech[0].at).toBeGreaterThan(6000);
  for (const start of [2, 4, 6]) expect(result.speech[start + 1].at - result.speech[start].at).toBeGreaterThan(1700);
  expect(result.frames).toBeGreaterThan(10);
  expect(result.mixedSamples).toBeGreaterThan(5);
  expect(result.videoPlayers).toBeLessThanOrEqual(2);
  expect(result.videoEvents.filter(event => ["rejected", "recovery", "error"].includes(event.kind))).toEqual([]);
  expect(result.contexts).toBe(1);
  expect(result.nativeAudio).toBe(0);
  expect(result.nativeInterruptions).toBe(0);
  expect(result.fallback).toBe(0);
  expect(result.musicStarts).toBe(1);
  expect(result.musicGains.every(gain => Math.abs(gain - .2) < .005)).toBe(true);
});

test("the final audible iOS clip repeats through complete long narration and continuous music", async ({ page, browserName }, testInfo) => {
  test.setTimeout(45_000);
  await page.addInitScript(() => Object.defineProperty(navigator, "platform", { configurable: true, value: "iPhone" }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/audio-library/*.mp3", route => route.fulfill({ path: path.resolve("tests/browser/fixtures/media-transition/music.mp3"), contentType: "audio/mpeg" }));
  const webm = process.platform === "linux" && browserName === "webkit";
  await page.goto(`http://127.0.0.1:4274/tests/browser/fixtures/ios-audio-mix.html?longFinal${webm ? "&webm" : ""}`);
  await page.getByRole("textbox", { name: "Prompt" }).fill("Keep showing the water while the complete explanation finishes");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await page.waitForFunction(() => {
    const proof = (window as unknown as { iosAudioProof: { speech: Array<{ event: string }>; musicStarts: number } }).iosAudioProof;
    return proof.speech.some(event => event.event === "start") && proof.musicStarts === 1;
  });
  const track = await page.locator('[data-soundtrack="active"]').getAttribute("data-track-id");
  await page.getByRole("button", { name: "Deliver body", exact: true }).click();
  // Observe inside the page through the entire intro and final narration.
  // No evaluate polling or further gestures may grant new Safari permission.
  await page.waitForFunction(() => {
    const proof = (window as unknown as { iosAudioProof: { speech: Array<{ event: string }>; playbackEndAt?: number } }).iosAudioProof;
    return proof.speech.filter(event => event.event === "end").length === 4 && proof.playbackEndAt !== undefined;
  }, undefined, { timeout: 40_000 });
  const result = await page.evaluate(() => (window as unknown as { iosAudioProof: {
    speech: Array<{ text: string; event: string; at: number }>;
    bufferEnds: Array<{ at: number; duration: number }>;
    playbackEndAt: number;
    contexts: number; nativeAudio: number; nativeInterruptions: number; frames: number;
    mixedSamples: number; musicStarts: number; musicGains: number[]; fallback: number; videoPlayers: number;
    videoEvents: Array<{ kind: string; scene?: string }>;
    samples: Array<{
      at: number; scene: string; videoId: number; time: number; audioTime: number;
      speaking: boolean; music: boolean; voice: boolean; trackId: string | null;
      muted: boolean; hidden: boolean; chapter: boolean; rate: number;
      readyState: number; seeking: boolean; videoWidth: number;
      presentedTime: number | null; presentedFrames: number; fingerprint: number | null; luma: number | null;
    }>;
  } }).iosAudioProof);
  const final = result.samples.filter(sample => sample.speaking);
  const wraps = final.flatMap((sample, index) => index > 0 && sample.time < final[index - 1].time - .5 ? [index] : []);
  const evidence = testInfo.outputPath("ios-long-narration-proof.json");
  await writeFile(evidence, JSON.stringify({ ...result, wraps, webm, physicalIos: false }));
  await testInfo.attach("ios-long-narration-proof.json", { path: evidence, contentType: "application/json" });

  expect(result.speech.map(event => event.event)).toEqual(["start", "end", "start", "end", "start", "end", "start", "end"]);
  expect(result.speech[1].at - result.speech[0].at).toBeGreaterThan(6000);
  expect(result.speech[7].at - result.speech[6].at).toBeGreaterThan(14_000);
  expect(result.bufferEnds).toHaveLength(4);
  expect(result.bufferEnds.at(-1)!.duration).toBeGreaterThan(14.27);
  expect(result.bufferEnds.at(-1)!.duration).toBeLessThan(14.3);
  expect(result.playbackEndAt - result.bufferEnds.at(-1)!.at).toBeGreaterThanOrEqual(0);
  expect(result.playbackEndAt - result.bufferEnds.at(-1)!.at).toBeLessThan(150);
  expect(final.length).toBeGreaterThan(100);
  expect(final.every(sample => sample.scene === "water-2" && !sample.hidden && !sample.chapter && !sample.muted && sample.rate === 1)).toBe(true);
  expect(final.filter(sample => sample.luma !== null).every(sample => sample.luma! > 2)).toBe(true);
  // A 5s → 0 seek can briefly make decoded pixels unavailable: readFrame
  // returns null, not black pixels. Accept only that bounded seam between valid
  // presented frames from this same decoder. Missing pixels elsewhere fail.
  for (let index = 0; index < final.length; index++) {
    if (final[index].luma !== null) continue;
    const start = index;
    while (index < final.length && final[index].luma === null) index++;
    expect(wraps).toContain(start);
    const before = final[start - 1], after = final[index];
    expect(before).toBeDefined();
    expect(after).toBeDefined();
    expect(after.at - before.at).toBeLessThan(100);
    expect(before.time).toBeGreaterThan(4.5);
    expect(final[start].time).toBeLessThan(.05);
    expect(after.time).toBeLessThan(.2);
    expect(after.videoId).toBe(before.videoId);
    expect(after.presentedFrames).toBeGreaterThan(before.presentedFrames);
    expect(after.presentedTime).not.toBeNull();
    expect(after.presentedTime!).toBeLessThan(.2);
  }
  expect(final.every(sample => sample.trackId === track)).toBe(true);
  expect(final.at(-1)!.audioTime).toBeGreaterThan(14.1);
  expect(final.some((sample, index) => index > 0 && sample.audioTime < final[index - 1].audioTime - .05)).toBe(false);
  expect(wraps).toHaveLength(2);
  expect(result.videoEvents.filter(event => event.kind === "ended" && event.scene === "water-2")).toHaveLength(2);
  const passStarts = [0, ...wraps];
  for (const [pass, start] of passStarts.entries()) {
    const samples = final.slice(start, passStarts[pass + 1]);
    expect(new Set(samples.flatMap(sample => sample.fingerprint === null ? [] : [sample.fingerprint])).size).toBeGreaterThan(3);
    const presented = samples.flatMap(sample => sample.presentedTime === null ? [] : [sample.presentedTime]);
    expect(Math.max(...presented) - Math.min(...presented)).toBeGreaterThan(1);
    expect(samples.filter(sample => sample.music && sample.voice).length).toBeGreaterThan(5);
  }
  let lastMotion = final[0].at;
  for (let index = 1; index < final.length; index++) {
    if (final[index].fingerprint !== final[index - 1].fingerprint && final[index].presentedTime !== final[index - 1].presentedTime) lastMotion = final[index].at;
    expect(final[index].at - lastMotion).toBeLessThan(500);
  }
  expect(new Set(final.map(sample => sample.videoId)).size).toBe(1);
  expect(new Set(result.samples.filter(sample => sample.scene.startsWith("water-") && sample.videoId > 0).map(sample => sample.videoId)).size).toBe(2);
  expect(result.videoPlayers).toBe(2);
  expect(result.videoEvents.filter(event => ["rejected", "recovery", "error"].includes(event.kind))).toEqual([]);
  expect(result.contexts).toBe(1);
  expect(result.nativeAudio).toBe(0);
  expect(result.nativeInterruptions).toBe(0);
  expect(result.fallback).toBe(0);
  expect(result.musicStarts).toBe(1);
  expect(result.musicGains.every(gain => Math.abs(gain - .2) < .005)).toBe(true);
});
