import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { createVideoChatHandler } from "../../src/server";

test("loads the footage renderer during planning and preserves complete opening and body speech", async ({ page, baseURL }, info) => {
  test.setTimeout(35_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const lines = ["Wind gives ocean waves their energy.", "Wind transfers energy to the surface water.", "The wave carries that energy toward the shore."];
  const speech = ["opening", "body", "ending"].map(beat => readFileSync(`tests/support/chat/speech/explanation-${beat}.mp3`));
  const format = process.platform === "linux" ? "webm" : "mp4";
  const footage = readFileSync(`tests/browser/fixtures/media-transition/waterfall-audio.${format}`);
  const handler = createVideoChatHandler({
    authorize: "none", heartbeatMs: false,
    generateText: async () => "[]",
    generateVideo: async () => ({ url: `${baseURL}/test-media/startup.${format}`, type: "video", durationSec: 5 }),
    generateSpeech: async ({ text }) => ({ audio: speech[lines.indexOf(text)]!, mediaType: "audio/mpeg" }),
    streamText: async function* () {
      yield JSON.stringify({ type: "answer", intent: "explanation", opening: lines[0], subject: "waves", development: "Explain how wind moves water.", visualDirection: "Natural water movement." }) + "\n";
      const shot = { subject: "waves", action: "Waves move toward the shore.", durationSec: 5, continuity: "cut" };
      yield JSON.stringify({ type: "shot", ...shot, narration: lines[1] }) + "\n";
      yield JSON.stringify({ type: "ending", ...shot, narration: lines[2] }) + "\n";
    },
  });
  const response = await handler(new Request(`${baseURL}/api/video-chat?action=response`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: "Explain waves", mode: "cinematic" }),
  }));
  expect(response.ok).toBe(true);
  const records = (await response.text()).split("\n\n").filter(Boolean);
  const firstScene = records.findIndex(record => record.includes('"type":"scene.add"'));
  expect(firstScene).toBeGreaterThan(0);
  // Keep the real handler's protocol and the actual application, but hold scene
  // delivery after its preparation announcements. No paid provider is called.
  await page.addInitScript(({ opening, body }) => {
    const proof = { events: [] as Array<{ type: string; at: number; seconds?: number }>, released: false, frames: 0 };
    const mark = (type: string, seconds?: number) => proof.events.push({ type, at: performance.now(), ...(seconds === undefined ? {} : { seconds }) });
    const controls = { proof, release: () => {} };
    Object.assign(window, { startup: controls });
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
      if (url.pathname !== "/api/video-chat" || url.searchParams.get("action") !== "response") return nativeFetch(input, init);
      mark("submit");
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode(opening));
        controls.release = () => {
          if (proof.released) return;
          proof.released = true;
          mark("scene-released");
          controller.enqueue(new TextEncoder().encode(body));
          controller.close();
        };
      } }), { headers: { "content-type": "text/event-stream", "x-vanillasky-video-stream": "0.6" } });
    };
    const NativeAudio = window.Audio;
    window.Audio = function (src?: string) {
      const audio = new NativeAudio(src);
      audio.addEventListener("playing", () => { if (audio.src.startsWith("blob:")) mark("speech-start"); });
      audio.addEventListener("ended", () => { if (audio.src.startsWith("blob:")) mark("speech-end", audio.currentTime); });
      return audio;
    } as unknown as typeof Audio;
    const observed = new WeakSet<HTMLVideoElement>();
    const sample = () => {
      for (const video of document.querySelectorAll<HTMLVideoElement>("video")) {
        if (observed.has(video)) continue;
        observed.add(video);
        let previous: number | undefined;
        const frame: VideoFrameRequestCallback = (_now, metadata) => {
          if (!video.isConnected) return;
          if (video.closest('[data-scene-layer="active"]') && !document.querySelector("[data-opening-chapter]")
            && previous !== undefined && metadata.mediaTime > previous) {
            if (proof.frames++ === 0) mark("first-moving-frame");
          }
          previous = metadata.mediaTime;
          video.requestVideoFrameCallback(frame);
        };
        video.requestVideoFrameCallback(frame);
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, { opening: records.slice(0, firstScene).join("\n\n") + "\n\n", body: records.slice(firstScene).join("\n\n") + "\n\n" });
  let rendererLoaded = false;
  // A cold code request is deliberately slow; it must finish while planning
  // waits, not become another round trip after the first ordered scene arrives.
  await page.route("**/src/visual-system/scene-templates/cinema-media.tsx", async route => {
    await new Promise(resolve => setTimeout(resolve, 1_200));
    await route.continue();
  });
  page.on("requestfinished", request => {
    if (new URL(request.url()).pathname === "/src/visual-system/scene-templates/cinema-media.tsx") rendererLoaded = true;
  });
  await page.route("**/test-media/startup.*", route => route.fulfill({ contentType: `video/${format}`, body: footage }));
  await page.route("**/api/video-chat?*", async route => {
    const request = route.request();
    if (request.url().includes("action=status")) return route.fulfill({ json: { ready: true, missing: [], videoMode: "cinematic" } });
    const result = await handler(new Request(request.url(), { method: request.method(),
      ...(request.postData() ? { body: request.postData(), headers: { "content-type": "application/json" } } : {}) }));
    await route.fulfill({ status: result.status, headers: Object.fromEntries(result.headers), body: Buffer.from(await result.arrayBuffer()) });
  });
  await page.goto("/");
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("Explain waves");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  const readProof = () => (window as unknown as { startup: { proof: { events: Array<{ type: string; at: number; seconds?: number }>; frames: number }; release(): void } }).startup.proof;
  await expect(page.locator("[data-opening-chapter]")).toContainText(lines[0]);
  await expect.poll(() => page.evaluate(readProof).then(proof => proof.events.filter(event => event.type === "speech-end").length)).toBe(1);
  await expect.poll(() => rendererLoaded, { timeout: 2_000 }).toBe(true);
  await expect(page.locator('[data-scene-layer="active"] video[src]')).toHaveCount(0);
  await page.evaluate(() => (window as unknown as { startup: { release(): void } }).startup.release());
  await expect.poll(() => page.evaluate(readProof).then(proof => proof.frames)).toBeGreaterThan(2);
  await expect(page.getByRole("button", { name: "Play again", exact: true, includeHidden: true })).toHaveCount(1, { timeout: 15_000 });
  const proof = await page.evaluate(readProof);
  const ends = proof.events.filter(event => event.type === "speech-end");
  const starts = proof.events.filter(event => event.type === "speech-start");
  expect(ends).toHaveLength(3);
  expect(starts).toHaveLength(3);
  expect(ends.every(event => event.seconds! > 1.5)).toBe(true);
  expect(starts[1].at).toBeGreaterThan(ends[0].at);
  expect(starts[2].at).toBeGreaterThan(ends[1].at);
  expect(proof.events.find(event => event.type === "first-moving-frame")!.at).toBeGreaterThan(ends[0].at);
  await info.attach("recorded-startup", { body: JSON.stringify(proof), contentType: "application/json" });
  expect(errors).toEqual([]);
});
