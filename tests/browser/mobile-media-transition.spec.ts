import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("keeps the real media element across an iPhone video-to-video cut", async ({ browser, browserName }, info) => {
  test.skip(browserName !== "webkit", "The persistent plane is specific to decoder-constrained WebKit.");
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1",
  });
  const page = await context.newPage();
  const codec = process.platform === "linux" ? "VP8" : "H264";
  const extension = codec === "VP8" ? "webm" : "mp4";
  await page.goto(`http://127.0.0.1:4274/tests/browser/fixtures/mobile-media-transition.html${codec === "VP8" ? "?webm" : ""}`);

  const player = page.getByTestId("video-player");
  await expect(player).toHaveAttribute("data-playing", "true");
  await expect(page.locator('[data-video-frame="ready"]')).toHaveAttribute("data-scene-id", "first-video");
  await expect(page.locator('[data-video-frame="ready"]')).toHaveAttribute("data-template-id", "cinemaMedia");
  const firstVideo = page.locator("video");
  await expect(firstVideo).toHaveCount(1);
  await expect.poll(() => firstVideo.evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2);
  const videoIdBeforeCut = await firstVideo.getAttribute("data-probe-video-id");
  const expectSustainedMotion = (sceneId: string) => expect.poll(() => page.evaluate(({ sceneId, videoId }) => {
    const frames = (window.__mobileMediaTransitionProbe ?? []).filter(entry =>
      entry.kind === "presented-frame" && entry.sceneId === sceneId && String(entry.videoId) === videoId,
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
  }, { sceneId, videoId: videoIdBeforeCut })).toBe(true);
  await expectSustainedMotion("first-video");
  const secondPoster = page.locator('img[src*="tram.jpg"]');
  await expect(secondPoster).toHaveCount(1);
  await expect(secondPoster).toHaveAttribute("data-video-poster-plane", "prepared");
  await expect.poll(() => secondPoster.evaluate((image: HTMLImageElement) =>
    image.complete && image.naturalWidth > 0,
  )).toBe(true);
  await expect(page.locator('[data-scene-layer="active"] > div').first()).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );

  await expect(page.locator('[data-video-frame="ready"]')).toHaveAttribute("data-scene-id", "second-video", { timeout: 8_000 });
  await expect(page.locator('[data-video-frame="ready"]')).toHaveAttribute("data-template-id", "cinemaMedia");
  await expect(secondPoster).toHaveAttribute("data-video-poster-plane", "current");
  const videoAfterCut = page.locator("video");
  await expect(videoAfterCut).toHaveCount(1);

  expect(await videoAfterCut.getAttribute("data-probe-video-id")).toBe(videoIdBeforeCut);
  await expect(videoAfterCut).toHaveAttribute("src", new RegExp(`tram\\.${extension}`));

  await expectSustainedMotion("second-video");

  await expect(page.locator('[data-video-frame="ready"]')).toHaveAttribute("data-scene-id", "third-video", { timeout: 8_000 });
  await expect(page.locator('[data-video-frame="ready"]')).toHaveAttribute("data-template-id", "cinemaMedia");
  const loopPoster = page.locator('img[src*="waterfall.jpg"]');
  await expect(loopPoster).toHaveAttribute("data-video-poster-plane", "prepared");
  await expect.poll(() => loopPoster.evaluate((image: HTMLImageElement) =>
    image.complete && image.naturalWidth > 0,
  )).toBe(true);
  expect(await page.locator("video").getAttribute("data-probe-video-id")).toBe(videoIdBeforeCut);
  await expect(page.locator("video")).toHaveAttribute("src", new RegExp(`sunflowers\\.${extension}`));
  await expectSustainedMotion("third-video");
  const firstSceneFramesBeforeLoop = await page.evaluate(() =>
    window.__mobileMediaTransitionProbe?.filter((entry) =>
      entry.kind === "presented-frame" && entry.sceneId === "first-video",
    ).length ?? 0,
  );

  // One full loop exercises three source swaps without accumulating nodes.
  await expect(page.locator('[data-video-frame="ready"]')).toHaveAttribute("data-scene-id", "first-video", { timeout: 8_000 });
  await expect(page.locator("video")).toHaveCount(1);
  expect(await page.locator("video").getAttribute("data-probe-video-id")).toBe(videoIdBeforeCut);
  await expect.poll(() => page.evaluate(() =>
    window.__mobileMediaTransitionProbe?.filter((entry) =>
      entry.kind === "presented-frame" && entry.sceneId === "first-video",
    ).length ?? 0,
  )).toBeGreaterThan(firstSceneFramesBeforeLoop);
  await writeFile(info.outputPath("decoder-identity-proof.json"), JSON.stringify({
    codec, platform: process.platform, browser: browserName, browserVersion: browser.version(),
    physicalDevice: false, videoId: videoIdBeforeCut,
    events: await page.evaluate(() => window.__mobileMediaTransitionProbe),
  }));
  await context.close();
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
  await expect(page.locator("video")).toHaveCount(1);
  await expect(page.locator("video")).toHaveCount(1);
  await context.close();
});

test("waits for real first and boundary frames without posters or a second iPhone decoder", async ({ browser, browserName }) => {
  test.skip(browserName !== "webkit", "Checks the persistent constrained decoder.");
  const context = await browser.newContext({viewport: {width:390,height:844}, isMobile:true, hasTouch:true, userAgent:"Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1"});
  const page = await context.newPage();
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const codec = process.platform === "linux" ? "VP8" : "H264";
  const firstFile = codec === "VP8" ? "waterfall-hold.webm" : "waterfall.mp4";
  const secondFile = codec === "VP8" ? "tram.webm" : "tram.mp4";
  await page.route(`**/${firstFile}*`, async route => { await new Promise(resolve => setTimeout(resolve, 500)); await route.continue(); });
  await page.goto(`http://127.0.0.1:4274/tests/browser/fixtures/mobile-media-transition.html?noPoster${codec === "VP8" ? "&webm" : ""}`);
  await expect.poll(() => page.evaluate(() => window.__mobileMediaTransitionProbe?.filter(entry => entry.kind === "scene-narration-cue").length ?? 0)).toBeGreaterThanOrEqual(1);
  await expect(page.locator("video")).toHaveCount(1);
  const firstId = await page.locator("video").getAttribute("data-probe-video-id");
  await expect.poll(() => page.evaluate(() => window.__mobileMediaTransitionProbe?.some(entry => entry.kind === "scene-narration-cue" && entry.sceneId === "second-video") ?? false), {timeout:10000}).toBe(true);
  const cues = await page.evaluate(() => window.__mobileMediaTransitionProbe?.filter(entry => entry.kind === "scene-narration-cue") ?? []);
  expect(cues.every(entry => Number(entry.readyState) >= 2)).toBe(true);
  expect(String(cues[0].currentSrc)).toContain(firstFile);
  expect(String(cues[1].currentSrc)).toContain(secondFile);
  expect(await page.locator("video").getAttribute("data-probe-video-id")).toBe(firstId);
  expect(errors).toEqual([]);
  await page.screenshot({path: test.info().outputPath("cinematic-no-poster.png"), fullPage: true});
  await writeFile(test.info().outputPath("cinematic-readiness.json"), JSON.stringify({
    sourceCommit: process.env.TEST_SOURCE_COMMIT ?? "unrecorded",
    browser: browserName, browserVersion: browser.version(),
    profile: "Playwright WebKit with iPhone viewport and user agent; not a physical device",
    codec, platform: process.platform, networkDelayMs: 500,
    videoElementIdentityPreserved: true, pageErrors: errors, narrationCues: cues,
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
    await page.waitForFunction(() => (document.querySelector("video")?.currentTime ?? 0) > .5);
    // Fault injection stops actual native frame delivery, not the player's clock.
    await page.evaluate(() => { const video = document.querySelector("video")!; video.pause(); video.dispatchEvent(new Event("waiting")); });
    await expect(page.locator('[data-scene-fallback="true"]')).toContainText("Water keeps moving", { timeout: 1800 });
    await expect(page.locator("video")).toHaveCount(0);
    await expect(page.getByTestId("video-player")).toHaveAttribute("data-playing", "true");
  } finally { await context.close(); }
});
