import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { createVideoChatHandler } from "../../src/server";

for (const width of [390, 1280]) test(`mixes a narrated answer and remembers listening controls at ${width}px`, async ({ page, baseURL }) => {
  test.setTimeout(45_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const narration = readFileSync("tests/support/chat/speech/explanation-body.mp3");
  const footageFormat = process.platform === "linux" ? "webm" : "mp4";
  const footage = readFileSync(`tests/browser/fixtures/media-transition/waterfall-audio.${footageFormat}`);
  let generations = 0;
  let releaseResponse!: () => void;
  const responseGate = new Promise<void>(resolve => { releaseResponse = resolve; });
  const handler = createVideoChatHandler({
    authorize: "none", heartbeatMs: false, generatedVideoAudio: true,
    generateSpeech: async () => ({ audio: narration, mediaType: "audio/mpeg" }),
    generateVideo: async () => ({ url: `${baseURL}/test-media/waterfall.${footageFormat}`, type: "video", durationSec: 5, audio: "ambient" }),
    generateText: async () => "[]",
    streamText: async function* () {
      generations++;
      const shot = { subject: "waterfall", action: "Water flows over the rocks.", narration: "Wind transfers energy to the surface water.", durationSec: 5, continuity: "cut" };
      yield JSON.stringify({ type: "answer", intent: "explanation", musicMood: "focused", opening: "Wind transfers energy to the surface water.",
        subject: "waterfall", development: "Explain flowing water.", visualDirection: "Natural water movement.", ending: { ...shot, title: "Water keeps moving" } }) + "\n";
      yield JSON.stringify({ type: "shot", ...shot, narration: "Water flows toward the shore.", title: "The current" }) + "\n";
    },
  });
  await page.route(`**/test-media/waterfall.${footageFormat}`, route => route.fulfill({ contentType: `video/${footageFormat}`, body: footage }));
  await page.route("**/api/video-chat?*", async route => {
    const request = route.request();
    if (request.url().includes("action=status")) return route.fulfill({ json: { ready: true, missing: [], videoMode: "cinematic" } });
    if (request.url().includes("action=response")) await responseGate;
    const response = await handler(new Request(request.url(), {
      method: request.method(), ...(request.postData() ? { body: request.postData(), headers: { "content-type": "application/json" } } : {}),
    }));
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
  });
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("slider", { name: "Voice volume" })).toHaveValue("100");
  await expect(page.getByRole("slider", { name: "Music volume" })).toHaveValue("20");
  await expect(page.getByRole("slider", { name: "Sound from video" })).toHaveValue("60");
  await page.getByRole("combobox", { name: "Music mood" }).selectOption("focused");
  await page.getByRole("button", { name: "Close settings" }).click();
  await page.getByRole("textbox", { name: "Prompt" }).fill("Explain flowing water");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  const initialMusic = await page.locator('audio[data-soundtrack="active"]').elementHandle();
  expect(initialMusic).not.toBeNull();
  await expect.poll(() => initialMusic!.evaluate(element => (element as HTMLAudioElement).currentTime), { timeout: 5000 }).toBeGreaterThan(.1);
  expect(generations).toBe(0);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  expect(await initialMusic!.evaluate(element => (element as HTMLAudioElement).paused)).toBe(true);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect.poll(() => initialMusic!.evaluate(element => (element as HTMLAudioElement).paused)).toBe(false);
  releaseResponse();
  // The first second of this recorded line is voiced: both backgrounds must
  // already stay at their chosen levels, not recover only once speech ends.
  const mixSamples: unknown[] = [];
  try {
    await expect.poll(async () => {
      const sample = await page.locator("video").evaluateAll(elements => ({
        musicVolume: document.querySelector<HTMLAudioElement>('audio[data-soundtrack="active"]')?.volume ?? null,
        videos: (elements as HTMLVideoElement[]).map(video => ({
          time: video.currentTime, volume: video.volume, paused: video.paused, muted: video.muted,
        })),
      }));
      mixSamples.push(sample);
      // Native media backends can round the selected gain through a float.
      return sample.musicVolume !== null && Math.abs(sample.musicVolume - .2) < .001 && sample.videos.some(video =>
        video.time > .15 && video.time < 1 && !video.paused && !video.muted && Math.abs(video.volume - .6) < .001);
    }, { timeout: 15_000, intervals: [50] }).toBe(true);
  } finally {
    await test.info().attach("early-narration-mix", {
      body: JSON.stringify(mixSamples), contentType: "application/json",
    });
  }
  expect(await initialMusic!.evaluate(element => element.isConnected)).toBe(true);
  await expect(page.locator("audio[data-soundtrack]")).toHaveCount(1);
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
  await expect(music).toHaveValue("21");
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
  await expect(music).toHaveValue("21");
  expect(generations).toBe(1);
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("slider", { name: "Music volume" })).toHaveValue("21");
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
