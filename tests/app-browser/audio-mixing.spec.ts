import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { createVideoChatHandler } from "../../src/server";

for (const width of [390, 1280]) test(`mixes a narrated answer and remembers listening controls at ${width}px`, async ({ page, baseURL }) => {
  test.setTimeout(45_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const narration = readFileSync("tests/support/chat/speech/explanation-body.mp3");
  const footage = readFileSync("tests/browser/fixtures/media-transition/waterfall-audio.mp4");
  let generations = 0;
  const handler = createVideoChatHandler({
    authorize: "none", heartbeatMs: false, generatedVideoAudio: true,
    generateSpeech: async () => ({ audio: narration, mediaType: "audio/mpeg" }),
    generateVideo: async () => ({ url: `${baseURL}/test-media/waterfall.mp4`, type: "video", durationSec: 5, audio: "ambient" }),
    generateText: async () => "[]",
    streamText: async function* () {
      generations++;
      const shot = { subject: "waterfall", action: "Water flows over the rocks.", narration: "Wind transfers energy to the surface water.", durationSec: 5, continuity: "cut" };
      yield JSON.stringify({ type: "answer", intent: "explanation", musicMood: "focused", opening: "Wind transfers energy to the surface water.",
        subject: "waterfall", development: "Explain flowing water.", visualDirection: "Natural water movement.", ending: { ...shot, title: "Water keeps moving" } }) + "\n";
      yield JSON.stringify({ type: "shot", ...shot, narration: "Water flows toward the shore.", title: "The current" }) + "\n";
    },
  });
  await page.route("**/test-media/waterfall.mp4", route => route.fulfill({ contentType: "video/mp4", body: footage }));
  await page.route("**/api/video-chat?*", async route => {
    const request = route.request();
    if (request.url().includes("action=status")) return route.fulfill({ json: { ready: true, missing: [], videoMode: "cinematic" } });
    const response = await handler(new Request(request.url(), {
      method: request.method(), ...(request.postData() ? { body: request.postData(), headers: { "content-type": "application/json" } } : {}),
    }));
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
  });
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("slider", { name: "Voice volume" })).toHaveValue("100");
  await expect(page.getByRole("slider", { name: "Music volume" })).toHaveValue("15");
  await expect(page.getByRole("slider", { name: "Sound from video" })).toHaveValue("15");
  await page.getByRole("combobox", { name: "Music mood" }).selectOption("focused");
  await page.getByRole("button", { name: "Close settings" }).click();
  await page.getByRole("textbox", { name: "Prompt" }).fill("Explain flowing water");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect.poll(() => page.locator("video").evaluateAll(elements => (elements as HTMLVideoElement[]).some(video =>
    video.currentTime > .15 && !video.paused && !video.muted && video.volume > 0 && video.volume <= .15)), { timeout: 15_000 }).toBe(true);
  await expect.poll(() => page.locator("audio").evaluateAll(elements => (elements as HTMLAudioElement[]).some(audio => audio.currentTime > .05 && !audio.paused && !audio.muted))).toBe(true);
  await page.locator(".vanillasky-video-chat").hover();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect.poll(() => page.locator("audio, video").evaluateAll(elements => elements.every(element => (element as HTMLMediaElement).paused))).toBe(true);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const selected = await page.locator(".music-track > span").textContent();
  await page.getByRole("button", { name: "Try another track" }).click();
  await expect(page.locator(".music-track > span")).not.toHaveText(selected!);
  const shuffled = await page.locator(".music-track > span").textContent();
  const music = page.getByRole("slider", { name: "Music volume" });
  await music.focus();
  await page.keyboard.press("ArrowRight");
  await expect(music).toHaveValue("16");
  await page.getByRole("button", { name: "Close settings" }).click();
  await page.getByRole("button", { name: "Mute sound", exact: true }).click();
  await expect.poll(() => page.locator("audio, video").evaluateAll(elements => elements.every(element => (element as HTMLMediaElement).muted))).toBe(true);
  await page.getByRole("button", { name: "Unmute sound", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("button", { name: "Play again", exact: true, includeHidden: true })).toHaveCount(1, { timeout: 15_000 });
  await page.locator(".vanillasky-video-chat").hover();
  await page.getByRole("button", { name: "Play again", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.locator(".music-track > span")).toHaveText(shuffled!);
  await expect(music).toHaveValue("16");
  expect(generations).toBe(1);
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("slider", { name: "Music volume" })).toHaveValue("16");
  await expect(page.getByRole("combobox", { name: "Music mood" })).toHaveValue("focused");
  const bounds = await page.getByRole("dialog", { name: "Settings" }).boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(900);
  await page.getByRole("dialog", { name: "Settings" }).evaluate(async element => {
    await Promise.all(element.getAnimations().map(animation => animation.finished));
  });
  await page.screenshot({ path: test.info().outputPath("audio-settings.png") });
  expect(errors).toEqual([]);
});
