import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("promotes prepared scene videos across iPhone cuts with at most two mounted decoders", async ({ browser, browserName }, info) => {
  test.skip(browserName !== "webkit", "Exercises the iPhone prepared-video handoff.");
  const context = await browser.newContext({ viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1" });
  const page = await context.newPage();
  const codec = process.platform === "linux" ? "VP8" : "H264";
  const extension = codec === "VP8" ? "webm" : "mp4";
  const identities: Record<string, string> = {};
  try {
    await page.goto(`http://127.0.0.1:4274/tests/browser/fixtures/mobile-media-transition.html${codec === "VP8" ? "?webm" : ""}`);
    await expect(page.getByTestId("video-player")).toHaveAttribute("data-playing", "true");
    const frame = page.locator('[data-video-frame="ready"]');
    const active = page.locator('[data-scene-layer="active"] video');
    const expectSustainedMotion = (sceneId: string, videoId: string) => expect.poll(() => page.evaluate(({ sceneId, videoId }) => {
      const frames = (window.__mobileMediaTransitionProbe ?? []).filter(entry =>
        entry.kind === "presented-frame" && entry.sceneId === sceneId && entry.layer === "active" && String(entry.videoId) === videoId,
      );
      let start = 0, previous = -1, increasing = 0;
      for (const frame of frames) {
        const time = Number(frame.mediaTime);
        if (!Number.isFinite(time)) continue;
        if (time <= previous) { start = time; increasing = 1; }
        else { if (!increasing) start = time; increasing++; }
        previous = time;
        if (increasing >= 3 && time - start >= 1) return true;
      }
      return false;
    }, { sceneId, videoId })).toBe(true);
    await expect(frame).toHaveAttribute("data-scene-id", "first-video");
    await expect(active).toHaveCount(1);
    await expect(active).toHaveAttribute("data-probe-video-id", /\d+/);
    identities["first-video"] = (await active.getAttribute("data-probe-video-id"))!;
    await expectSustainedMotion("first-video", identities["first-video"]);
    let outgoingId = identities["first-video"];
    for (const [sceneId, file] of [["second-video", "tram"], ["third-video", "sunflowers"]]) {
      const prepared = page.locator(`[data-scene-layer="incoming"][data-layer-scene-id="${sceneId}"] video`);
      await expect(prepared).toHaveCount(1);
      await expect(prepared).toHaveAttribute("data-probe-video-id", /\d+/);
      const preparedId = (await prepared.getAttribute("data-probe-video-id"))!;
      identities[sceneId] = preparedId;
      expect(preparedId).not.toBe(outgoingId);
      await expect.poll(() => prepared.evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2);
      await expect(frame).toHaveAttribute("data-scene-id", sceneId, { timeout: 8_000 });
      await expect(frame).toHaveAttribute("data-template-id", "cinemaMedia");
      await expect(active).toHaveAttribute("data-probe-video-id", preparedId);
      await expect(active).toHaveAttribute("src", new RegExp(`${file}\\.${extension}`));
      await expect(page.locator(`video[data-probe-video-id="${outgoingId}"]`)).toHaveCount(0);
      await expectSustainedMotion(sceneId, preparedId);
      outgoingId = preparedId;
    }
    // Replay starts a fresh bounded pair; retired source nodes cannot accumulate.
    await expect(frame).toHaveAttribute("data-scene-id", "first-video", { timeout: 8_000 });
    await expect(active).toHaveAttribute("data-probe-video-id", /\d+/);
    const replayId = (await active.getAttribute("data-probe-video-id"))!;
    expect(replayId).not.toBe(identities["first-video"]);
    await expectSustainedMotion("first-video", replayId);
    const events = await page.evaluate(() => window.__mobileMediaTransitionProbe ?? []);
    const counts = events.filter(event => typeof event.connectedVideos === "number").map(event => Number(event.connectedVideos));
    expect(counts.length).toBeGreaterThan(0);
    expect(Math.max(...counts)).toBe(2);
    await writeFile(info.outputPath("decoder-identity-proof.json"), JSON.stringify({
      codec, platform: process.platform, browser: browserName, browserVersion: browser.version(),
      physicalDevice: false, preparedVideoIds: identities, replayId, events,
    }));
  } finally { await context.close(); }
});

test("offers an uninstrumented visual mode for physical-device compositor testing", async ({ browser, browserName }) => {
  test.skip(browserName !== "webkit", "The physical-device probe targets Mobile WebKit.");
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1",
  });
  const page = await context.newPage();
  await page.goto(
    "http://127.0.0.1:4274/tests/browser/fixtures/mobile-media-transition-clean.html",
  );

  await expect(page.locator("pre")).toHaveCount(0);
  expect(await page.evaluate(() => window.__mobileMediaTransitionProbe)).toBeUndefined();
  await expect(page.locator('[data-scene-layer="active"] video')).toHaveCount(1);
  await expect.poll(() => page.locator("video").count()).toBeLessThanOrEqual(2);
  await context.close();
});

test("waits for real first and boundary frames without posters while promoting the prepared decoder", async ({ browser, browserName }) => {
  test.skip(browserName !== "webkit", "Checks actual frames from the active and prepared decoders.");
  const context = await browser.newContext({viewport: {width:390,height:844}, isMobile:true, hasTouch:true, userAgent:"Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1"});
  const page = await context.newPage();
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const codec = process.platform === "linux" ? "VP8" : "H264";
  const firstFile = codec === "VP8" ? "waterfall-hold.webm" : "waterfall.mp4";
  const secondFile = codec === "VP8" ? "tram.webm" : "tram.mp4";
  await page.route(`**/${firstFile}*`, async route => { await new Promise(resolve => setTimeout(resolve, 500)); await route.continue(); });
  await page.goto(`http://127.0.0.1:4274/tests/browser/fixtures/mobile-media-transition.html?noPoster${codec === "VP8" ? "&webm" : ""}`);
  await expect.poll(() => page.evaluate(() => window.__mobileMediaTransitionProbe?.filter(entry => entry.kind === "scene-narration-cue").length ?? 0)).toBeGreaterThanOrEqual(1);
  await expect(page.locator('[data-scene-layer="active"] video')).toHaveCount(1);
  const prepared = page.locator('[data-scene-layer="incoming"][data-layer-scene-id="second-video"] video');
  await expect(prepared).toHaveAttribute("data-probe-video-id", /\d+/);
  const preparedId = await prepared.getAttribute("data-probe-video-id");
  await expect.poll(() => page.evaluate(() => window.__mobileMediaTransitionProbe?.some(entry => entry.kind === "scene-narration-cue" && entry.sceneId === "second-video") ?? false), {timeout:10000}).toBe(true);
  const cues = await page.evaluate(() => window.__mobileMediaTransitionProbe?.filter(entry => entry.kind === "scene-narration-cue") ?? []);
  expect(cues.every(entry => Number(entry.readyState) >= 2)).toBe(true);
  expect(String(cues[0].currentSrc)).toContain(firstFile);
  expect(String(cues[1].currentSrc)).toContain(secondFile);
  expect(await page.locator('[data-scene-layer="active"] video').getAttribute("data-probe-video-id")).toBe(preparedId);
  expect(String(cues[1].videoId)).toBe(preparedId);
  expect(await page.locator("video").count()).toBeLessThanOrEqual(2);
  expect(errors).toEqual([]);
  await page.screenshot({path: test.info().outputPath("cinematic-no-poster.png"), fullPage: true});
  await writeFile(test.info().outputPath("cinematic-readiness.json"), JSON.stringify({
    sourceCommit: process.env.TEST_SOURCE_COMMIT ?? "unrecorded",
    browser: browserName, browserVersion: browser.version(),
    profile: "Playwright WebKit with iPhone viewport and user agent; not a physical device",
    codec, platform: process.platform, networkDelayMs: 500,
    preparedVideoElementPromoted: preparedId, pageErrors: errors, narrationCues: cues,
  }, null, 2));
  await context.close();
});


test("recovers a stalled native decoder independently of healthy source identity", async ({ browser, browserName }) => {
  test.skip(browserName !== "webkit", "Checks native WebKit recovery.");
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1" });
  try {
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:4274/tests/browser/fixtures/mobile-media-transition.html${process.platform === "linux" ? "?webm" : ""}`);
    await page.waitForFunction(() => (document.querySelector<HTMLVideoElement>('[data-scene-layer="active"] video')?.currentTime ?? 0) > .5);
    // Fault injection stops actual native frame delivery, not the player's clock.
    await page.evaluate(() => { const video = document.querySelector<HTMLVideoElement>('[data-scene-layer="active"] video')!; video.pause(); video.dispatchEvent(new Event("waiting")); });
    await expect(page.locator('[data-scene-fallback="true"]')).toContainText("Water keeps moving", { timeout: 1800 });
    await expect(page.locator('[data-scene-layer="active"] video')).toHaveCount(0);
    await expect.poll(() => page.locator("video").count()).toBeLessThanOrEqual(1);
    await expect(page.getByTestId("video-player")).toHaveAttribute("data-playing", "true");
  } finally { await context.close(); }
});

test("cold replacement footage decodes before its narration cue without losing the decoder", async ({ browser, browserName }, info) => {
  test.skip(browserName !== "webkit", "Checks the constrained decoder handoff.");
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1" });
  const page = await context.newPage();
  const codec = process.platform === "linux" ? "VP8" : "H264";
  const secondFile = codec === "VP8" ? "tram.webm" : "tram.mp4";
  const requests: { range: string | undefined; at: number }[] = [];
  const delayMs = 5500;
  let releaseAt: number | undefined;
  try {
    await page.route(`**/${secondFile}`, async route => {
      releaseAt ??= Date.now() + delayMs;
      requests.push({ range: route.request().headers()["range"], at: Date.now() });
      // Preparation now starts before the four-second cut. Hold all ranges
      // past that cut, without multiplying the delay for native range retries.
      await new Promise(resolve => setTimeout(resolve, Math.max(0, releaseAt! - Date.now())));
      await route.continue();
    });
    await page.goto(`http://127.0.0.1:4274/tests/browser/fixtures/mobile-media-transition.html${codec === "VP8" ? "?webm" : ""}`);
    await expect.poll(() => page.evaluate(() => window.__mobileMediaTransitionProbe?.some(event => event.kind === "scene-narration-cue" && event.sceneId === "second-video") ?? false), { timeout: 12000 }).toBe(true);
    const events = await page.evaluate(() => window.__mobileMediaTransitionProbe ?? []);
    const cue = events.find(event => event.kind === "scene-narration-cue" && event.sceneId === "second-video")!;
    const firstFrame = events.find(event => event.kind === "presented-frame" && event.sceneId === "second-video" && String(event.currentSrc).includes(secondFile));
    expect(String(cue.currentSrc)).toContain(secondFile);
    expect(cue.readyState).toBeGreaterThanOrEqual(2);
    expect(firstFrame).toBeDefined();
    expect(cue.at).toBeGreaterThanOrEqual(firstFrame!.at);
    const coldBoundary = events.find(event => event.kind === "animation-frame"
      && Number.parseFloat(String(event.playerTime)) >= 4 && event.sceneId === "first-video");
    const revealed = events.find(event => event.kind === "animation-frame" && event.sceneId === "second-video");
    expect(coldBoundary).toBeDefined();
    expect(revealed).toBeDefined();
    expect(firstFrame!.at - coldBoundary!.at).toBeGreaterThan(200);
    // The cold target must prepare behind moving outgoing footage, not become
    // visible as a still while its data arrives. Decode alone is insufficient.
    expect(revealed!.at).toBeGreaterThanOrEqual(firstFrame!.at);
    const revealedVideos = revealed!.videos as {sceneId?: string; layer?: string; readyState?: number}[];
    const futureData = Number(revealedVideos.find(video => video.sceneId === "second-video" && video.layer === "active")?.readyState) >= 3;
    const targetFrames = events.filter(event => event.kind === "presented-frame" && event.sceneId === "second-video"
      && String(event.videoId) === String(cue.videoId) && String(event.currentSrc).includes(secondFile) && event.at <= revealed!.at);
    let forwardFrames = 0;
    for (let index = 1; index < targetFrames.length; index++) {
      forwardFrames = Number(targetFrames[index]!.mediaTime) > Number(targetFrames[index - 1]!.mediaTime) + .001
        ? forwardFrames + 1 : 0;
    }
    // Linux WebKit can remain at HAVE_CURRENT_DATA throughout real motion.
    // Three consecutive presented frames (two forward steps) also prove that
    // this same target was playable before reveal; one decoded still cannot.
    expect(futureData || forwardFrames >= 2).toBe(true);
    const outgoing = events.filter(event => event.kind === "presented-frame" && event.sceneId === "first-video"
      && event.layer === "active" && event.at >= coldBoundary!.at && event.at <= revealed!.at);
    expect(outgoing.length).toBeGreaterThanOrEqual(3);
    const observationTimes = [coldBoundary!.at, ...outgoing.map(event => event.at), revealed!.at];
    expect(Math.max(...observationTimes.slice(1).map((at,index) => at - observationTimes[index]!))).toBeLessThanOrEqual(400);
    const motion = outgoing.slice(1).reduce((seconds,event,index) => seconds + Math.max(0, Number(event.mediaTime) - Number(outgoing[index]!.mediaTime)),0);
    expect(motion).toBeGreaterThan(.15);
    const prepared = events.find(event => event.kind === "connected" && event.sceneId === "second-video" && event.layer === "incoming");
    expect(prepared).toBeDefined();
    expect(String(cue.videoId)).toBe(String(prepared!.videoId));
    expect(await page.locator('[data-scene-layer="active"] video').getAttribute("data-probe-video-id")).toBe(String(prepared!.videoId));
    expect(Math.max(...events.map(event => Number(event.connectedVideos) || 0))).toBeLessThanOrEqual(2);
    await expect(page.locator('[data-scene-fallback="true"]')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (window.__mobileMediaTransitionProbe ?? []).filter(event => event.kind === "presented-frame" && event.sceneId === "second-video" && Number(event.mediaTime) > .5).length)).toBeGreaterThanOrEqual(3);
  } finally {
    const events = await page.evaluate(() => window.__mobileMediaTransitionProbe ?? []);
    const cut = events.find(event => event.kind === "animation-frame" && Number.parseFloat(String(event.playerTime)) >= 4 && event.sceneId === "first-video");
    const frame = events.find(event => event.kind === "presented-frame" && event.sceneId === "second-video" && String(event.currentSrc).includes(secondFile));
    const proof = { codec, delayMs, requests, handoffWaitMs: cut && frame ? frame.at - cut.at : null, events };
    await writeFile(info.outputPath("cold-source-handoff.json"), JSON.stringify(proof));
    await info.attach("cold-source-handoff", { body: JSON.stringify(proof), contentType: "application/json" });
    await context.close();
  }
});
