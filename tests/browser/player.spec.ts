import { expect, test } from "@playwright/test";


test("keeps frame and player templates on the same canonical canvas at thumbnail widths", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Focused pixel-geometry parity runs once in Chromium.");
  await page.goto("http://127.0.0.1:4274/tests/browser/fixtures/frame-parity.html");
  await expect(page.locator('[data-surface="player"] [data-status="complete"]')).toHaveCount(8);
  await expect(page.locator('[data-surface="saved"] [data-status="complete"]')).toHaveCount(8);

  for (const templateId of ["chapterTitle", "cinemaMedia"]) {
    for (const width of [180, 380, 600, 960]) {
      for (const surface of ["frame", "player", "saved"]) {
        const fixture = page.locator(`[data-case="${templateId}-${surface}-${width}"]`);
        const viewport = fixture.locator(surface === "frame"
          ? ":scope > [data-video-frame]"
          : ':scope > [data-testid="video-player"]');
        const canvas = fixture.locator('[data-video-canvas="true"]');
        await expect(canvas).toHaveCount(1);
        const [fixtureBox, canvasBox, dimensions] = await Promise.all([
          viewport.boundingBox(),
          canvas.boundingBox(),
          canvas.evaluate((element) => ({
            width: (element as HTMLElement).style.width,
            height: (element as HTMLElement).style.height,
          })),
        ]);
        expect(dimensions).toEqual({ width: "1080px", height: "1920px" });
        expect(Math.abs((canvasBox?.x ?? 0) - (fixtureBox?.x ?? 0))).toBeLessThanOrEqual(0.5);
        expect(Math.abs((canvasBox?.y ?? 0) - (fixtureBox?.y ?? 0))).toBeLessThanOrEqual(0.5);
        expect(Math.abs((canvasBox?.width ?? 0) - (fixtureBox?.width ?? 0))).toBeLessThanOrEqual(0.5);
        expect(Math.abs((canvasBox?.height ?? 0) - (fixtureBox?.height ?? 0))).toBeLessThanOrEqual(0.5);
      }
    }
  }
});

test("presents idle, playing, paused, and ended player states with the production controls", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Focused player-state presentation runs once in Chromium.");
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = async () => undefined;
    HTMLMediaElement.prototype.pause = () => undefined;
  });
  await page.goto("http://127.0.0.1:4274/tests/browser/fixtures/player-states.html");

  const idle = page.locator('[data-player-state="idle"]');
  await expect(idle.getByRole("button", { name: "Play video with sound" })).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(idle.locator('[data-testid="video-controls"]')).toHaveCount(0);

  const playing = page.locator('[data-player-state="playing"]');
  await playing.getByRole("button", { name: "Play video with sound" }).click();
  await page.mouse.move(0, 0);
  await expect(playing.locator('[data-testid="video-controls"]')).toHaveCSS("opacity", "0");
  await playing.locator('[data-testid="video-player"]').hover();
  await expect(playing.locator('[data-testid="video-controls"]')).toHaveCSS("opacity", "1");
  await expect(playing.getByRole("button", { name: "Pause video response" })).toBeVisible();
  const [primaryControls, secondaryControls] = await Promise.all([
    playing.locator('[data-testid="video-primary-controls"]').boundingBox(),
    playing.locator('[data-testid="video-secondary-controls"]').boundingBox(),
  ]);
  expect((primaryControls?.x ?? 0) + (primaryControls?.width ?? 0)).toBeLessThan(secondaryControls?.x ?? 0);

  const paused = page.locator('[data-player-state="paused"]');
  await paused.getByRole("button", { name: "Play video with sound" }).click();
  await page.waitForTimeout(800);
  await paused.getByRole("button", { name: "Pause video response" }).click();
  await expect(paused.getByRole("button", { name: "Play video response" })).toBeVisible();
  await expect(paused.locator('[data-testid="video-controls"]')).toHaveCSS("opacity", "1");
  await page.mouse.move(0, 0);
  await paused.getByRole("button", { name: "Play video response" }).focus();
  await page.keyboard.press("Enter");
  await expect(paused.locator('[data-testid="video-controls"]')).toHaveCSS("opacity", "1");

  const ended = page.locator('[data-player-state="ended"]');
  await ended.getByRole("button", { name: "Play video with sound" }).click();
  await expect(ended.locator('[data-ended="true"]')).toBeVisible({ timeout: 3_000 });
  await expect(ended.locator('[data-testid="video-ended-scrim"]')).toHaveCSS("backdrop-filter", "blur(4px)");
  await expect(ended.getByRole("button", { name: "Replay video response" })).toBeVisible();
  await expect(ended.getByRole("button", { name: "Play video response from beginning" })).toBeVisible();

  for (const state of [playing, paused, ended]) {
    const primary = state.locator('[data-testid="video-primary-controls"] button');
    const secondary = state.locator('[data-testid="video-secondary-controls"] button');
    await expect(primary).toHaveCSS("border-radius", "999px");
    await expect(primary.locator("svg")).toHaveCount(1);
    await expect(secondary.first().locator("svg")).toHaveCount(1);
  }
});

test("uses a viewport-filling fullscreen fallback when the browser API is unavailable", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Focused mobile fallback runs once in Chromium.");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = async () => undefined;
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(HTMLElement.prototype, "webkitRequestFullscreen", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(HTMLElement.prototype, "webkitRequestFullScreen", {
      configurable: true,
      value: undefined,
    });
  });
  await page.goto("http://127.0.0.1:4274/tests/browser/fixtures/player-states.html");

  const player = page.locator('[data-player-state="playing"] [data-testid="video-player"]');
  await page.locator('[data-player-state="playing"]').getByRole("button", { name: "Play video with sound" }).click();
  await player.dispatchEvent("touchstart");
  await page.locator('[data-player-state="playing"]').getByRole("button", { name: "Enter fullscreen" }).click();

  await expect(player).toHaveAttribute("data-fullscreen", "fallback");
  await expect(player).toHaveCSS("position", "fixed");
  const bounds = await player.boundingBox();
  expect(bounds).toMatchObject({ x: 0, y: 0, width: 390, height: 844 });
  const frameBounds = await player.locator('[data-video-frame="ready"]').boundingBox();
  expect(frameBounds?.width).toBeCloseTo(390, 0);
  expect(frameBounds?.height).toBeCloseTo(693, 0);
  expect(frameBounds?.y).toBeCloseTo((844 - 693) / 2, 0);
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");

  await page.keyboard.press("Escape");
  await expect(player).toHaveAttribute("data-fullscreen", "none");
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
});

test("keeps touch controls accessible without pinning them across resume and fullscreen", async ({ browser, browserName }) => {
  test.skip(browserName !== "webkit", "Mobile touch lifecycle runs in WebKit.");
  const context = await browser.newContext({
    viewport: { width: 430, height: 932 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = async () => undefined;
    Object.defineProperties(HTMLElement.prototype, {
      requestFullscreen: { configurable: true, value: undefined },
      webkitRequestFullscreen: { configurable: true, value: undefined },
      webkitRequestFullScreen: { configurable: true, value: undefined },
    });
  });
  await page.goto("http://127.0.0.1:4274/tests/browser/fixtures/player-states.html");
  await page.addStyleTag({ content: [
    ".state-showcase { display: block !important; width: 100% !important; min-width: 0 !important; padding: 16px !important; }",
    ".state-showcase section { display: none !important; }",
    ".state-showcase section[data-player-state='idle'] { display: grid !important; }",
  ].join("\n") });

  const state = page.locator('[data-player-state="idle"]');
  const player = state.locator('[data-testid="video-player"]');
  const controls = state.locator('[data-testid="video-controls"]');
  await state.getByRole("button", { name: "Play video with sound" }).tap();
  await expect(controls).toHaveCSS("opacity", "0");

  await player.tap({ position: { x: 190, y: 300 } });
  await expect(controls).toHaveCSS("opacity", "1");
  await state.getByRole("button", { name: "Pause video response" }).tap();
  await expect(controls).toHaveCSS("opacity", "1");
  await state.getByRole("button", { name: "Play video response" }).tap();
  await expect(controls).toHaveCSS("opacity", "0");

  await player.tap({ position: { x: 190, y: 300 } });
  await state.getByRole("button", { name: "Enter fullscreen" }).tap();
  await expect(player).toHaveAttribute("data-fullscreen", "fallback");
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  await state.getByRole("button", { name: "Exit fullscreen" }).tap();
  await expect(player).toHaveAttribute("data-fullscreen", "none");
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");

  await context.close();
});

test("keeps at most the active and next scene decoder mounted on iPhone WebKit", async ({ browser, browserName }) => {
  test.skip(browserName !== "webkit", "The decoder ceiling is specific to mobile WebKit.");
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1",
  });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4274/tests/browser/fixtures/frame-parity.html");

  const transition = page.locator('[data-case="mobile-video-transition"]');
  await expect(transition.locator("video")).toHaveCount(2);
  await expect(transition.locator('[data-scene-layer="incoming"]')).toHaveCount(1);
  await expect(transition.locator('[data-scene-layer="incoming"]')).toHaveCSS("opacity", "0");
  await context.close();
});
