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
