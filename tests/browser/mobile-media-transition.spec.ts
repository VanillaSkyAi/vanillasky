import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("keeps the real media element across an iPhone video-to-video cut", async ({ browser, browserName }) => {
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
  await page.goto("http://127.0.0.1:4274/tests/browser/fixtures/mobile-media-transition.html");

  const player = page.getByTestId("video-player");
  await expect(player).toHaveAttribute("data-playing", "true");
  await expect(page.locator('[data-video-frame="ready"]')).toHaveAttribute("data-scene-id", "first-video");
  await expect(page.locator('[data-video-frame="ready"]')).toHaveAttribute("data-template-id", "cinemaMedia");
  const firstVideo = page.locator("video");
  await expect(firstVideo).toHaveCount(1);
  await expect.poll(() => firstVideo.evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2);
  const videoIdBeforeCut = await firstVideo.getAttribute("data-probe-video-id");
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
  await expect(videoAfterCut).toHaveAttribute("src", /tram\.mp4/);

  await expect.poll(() => page.evaluate(() =>
    window.__mobileMediaTransitionProbe?.some((entry) =>
      entry.kind === "presented-frame" && String(entry.currentSrc).includes("tram.mp4"),
    ) ?? false,
  )).toBe(true);

  await expect(page.locator('[data-video-frame="ready"]')).toHaveAttribute("data-scene-id", "third-video", { timeout: 8_000 });
  await expect(page.locator('[data-video-frame="ready"]')).toHaveAttribute("data-template-id", "cinemaMedia");
  const loopPoster = page.locator('img[src*="waterfall.jpg"]');
  await expect(loopPoster).toHaveAttribute("data-video-poster-plane", "prepared");
  await expect.poll(() => loopPoster.evaluate((image: HTMLImageElement) =>
    image.complete && image.naturalWidth > 0,
  )).toBe(true);
  expect(await page.locator("video").getAttribute("data-probe-video-id")).toBe(videoIdBeforeCut);
  await expect(page.locator("video")).toHaveAttribute("src", /sunflowers\.mp4/);
  await expect.poll(() => page.evaluate(() =>
    window.__mobileMediaTransitionProbe?.some((entry) =>
      entry.kind === "presented-frame" && entry.sceneId === "third-video",
    ) ?? false,
  )).toBe(true);
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
  await page.route("**/waterfall.mp4*", async route => { await new Promise(resolve => setTimeout(resolve, 500)); await route.continue(); });
  await page.goto("http://127.0.0.1:4274/tests/browser/fixtures/mobile-media-transition.html?noPoster");
  await expect.poll(() => page.evaluate(() => window.__mobileMediaTransitionProbe?.filter(entry => entry.kind === "scene-narration-cue").length ?? 0)).toBeGreaterThanOrEqual(1);
  await expect(page.locator("video")).toHaveCount(1);
  const firstId = await page.locator("video").getAttribute("data-probe-video-id");
  await expect.poll(() => page.evaluate(() => window.__mobileMediaTransitionProbe?.some(entry => entry.kind === "scene-narration-cue" && entry.sceneId === "second-video") ?? false), {timeout:10000}).toBe(true);
  const cues = await page.evaluate(() => window.__mobileMediaTransitionProbe?.filter(entry => entry.kind === "scene-narration-cue") ?? []);
  expect(cues.every(entry => Number(entry.readyState) >= 2)).toBe(true);
  expect(String(cues[0].currentSrc)).toContain("waterfall.mp4");
  expect(String(cues[1].currentSrc)).toContain("tram.mp4");
  expect(await page.locator("video").getAttribute("data-probe-video-id")).toBe(firstId);
  expect(errors).toEqual([]);
  await page.screenshot({path: test.info().outputPath("cinematic-no-poster.png"), fullPage: true});
  await writeFile(test.info().outputPath("cinematic-readiness.json"), JSON.stringify({
    sourceCommit: process.env.TEST_SOURCE_COMMIT ?? "unrecorded",
    browser: browserName, browserVersion: browser.version(),
    profile: "Playwright WebKit with iPhone viewport and user agent; not a physical device",
    videoElementIdentityPreserved: true, pageErrors: errors, narrationCues: cues,
  }, null, 2));
  await context.close();
});


test("holds the last actual clip frame while a longer scene continues", async ({ page }) => {
  await page.goto("http://127.0.0.1:4274/tests/browser/fixtures/mobile-media-transition.html?longHold&clean");
  await expect.poll(() => page.locator("video").evaluate((video: HTMLVideoElement) => video.ended), { timeout: 8000 }).toBe(true);
  const before = await page.locator("video").evaluate((video: HTMLVideoElement) => ({ time: video.currentTime, duration: video.duration, loop: video.loop }));
  expect(before.loop).toBe(false);
  await page.waitForTimeout(600);
  expect(await page.locator("video").evaluate((video: HTMLVideoElement) => video.currentTime)).toBeCloseTo(before.time, 1);
  expect(before.time).toBeCloseTo(before.duration, 1);
  await expect(page.locator('[data-video-frame="ready"]')).toHaveAttribute("data-scene-id", "first-video");
});
