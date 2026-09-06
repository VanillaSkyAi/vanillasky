import { expect, test } from "@playwright/test";

async function visiblePixelRatio(screenshot: Buffer, page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(async (base64) => {
    const response = await fetch(`data:image/png;base64,${base64}`);
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas 2D context is unavailable.");
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const first = [pixels[0], pixels[1], pixels[2]];
    let changed = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const distance = Math.abs(pixels[offset] - first[0])
        + Math.abs(pixels[offset + 1] - first[1])
        + Math.abs(pixels[offset + 2] - first[2]);
      if (distance > 24) changed += 1;
    }
    return changed / (pixels.length / 4);
  }, screenshot.toString("base64"));
}

async function differingPixelRatio(
  screenshot: Buffer,
  baseline: Buffer,
  page: import("@playwright/test").Page,
): Promise<number> {
  return page.evaluate(async ({ actualBase64, baselineBase64 }) => {
    const decode = async (base64: string) => createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
    const [actual, expected] = await Promise.all([decode(actualBase64), decode(baselineBase64)]);
    if (actual.width !== expected.width || actual.height !== expected.height) throw new Error("Pixel baselines differ in size");
    const canvas = document.createElement("canvas");
    canvas.width = actual.width;
    canvas.height = actual.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas 2D context is unavailable.");
    context.drawImage(actual, 0, 0);
    const actualPixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(expected, 0, 0);
    const expectedPixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let changed = 0;
    for (let offset = 0; offset < actualPixels.length; offset += 4) {
      const distance = Math.abs(actualPixels[offset] - expectedPixels[offset])
        + Math.abs(actualPixels[offset + 1] - expectedPixels[offset + 1])
        + Math.abs(actualPixels[offset + 2] - expectedPixels[offset + 2]);
      if (distance > 24) changed += 1;
    }
    return changed / (actualPixels.length / 4);
  }, { actualBase64: screenshot.toString("base64"), baselineBase64: baseline.toString("base64") });
}

test("keeps frame and player templates on the same canonical canvas at thumbnail widths", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Focused pixel-geometry parity runs once in Chromium.");
  await page.goto("http://127.0.0.1:4274/tests/browser/fixtures/frame-parity.html");
  await expect(page.locator('[data-surface="player"] [data-status="complete"]')).toHaveCount(12);
  await expect(page.locator('[data-surface="saved"] [data-status="complete"]')).toHaveCount(12);

  for (const templateId of ["keyFigure", "editorialTimeline", "focusCards"]) {
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

test("keeps one scene video decoder mounted during iPhone WebKit transitions", async ({ browser, browserName }) => {
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
  await expect(transition.locator("video")).toHaveCount(1);
  await expect(transition.locator('[data-scene-layer="incoming"]')).toHaveCount(0);
  await context.close();
});

test("keeps black graphic boundaries readable without overlapping two explanations", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Focused pixel proof runs once in Chromium.");
  await page.goto("http://127.0.0.1:4274/tests/browser/fixtures/frame-parity.html");
  const black = await page.locator('[data-case="brand-baseline"]').screenshot();
  for (const orientation of ["portrait", "landscape"]) {
    for (const time of [4.7, 4.71, 4.85]) {
      const fixture = page.locator(`[data-case="${orientation}-transition-${time}"]`);
      await expect(fixture.locator('[data-scene-layer="active"]')).toHaveAttribute("data-layer-scene-id", "opening");
      await expect(fixture).toContainText(/The\s*opening\s*remains\s*readable\./);
      await expect(fixture.locator('[data-scene-layer="incoming"], [data-scene-layer="outgoing"]')).toHaveCount(0);
      const screenshot = await fixture.screenshot();
      expect(await visiblePixelRatio(screenshot, page)).toBeGreaterThan(0.01);
      if (orientation === "portrait") expect(await differingPixelRatio(screenshot, black, page)).toBeGreaterThan(0.005);
    }
    const settled = page.locator(`[data-case="${orientation}-transition-5"]`);
    await expect(settled.locator('[data-scene-layer="active"]')).toHaveAttribute("data-layer-scene-id", "proof");
    await expect(settled).toContainText("128%");
    await expect(settled).toContainText("Faster deployment cycles");
    await expect(settled.getByText("0%", { exact: true })).toHaveCount(0);
    await expect(settled).not.toContainText("The opening remains readable.");
  }
});

test("keeps exact sourced content without synthetic count-ups at graphic cuts", async ({page,browserName}) => {
  test.skip(browserName !== "chromium", "Semantic geometry runs once in Chromium.");
  await page.goto("http://127.0.0.1:4274/tests/browser/fixtures/frame-parity.html");
  for (const orientation of ["portrait","landscape"]) {
    for (const id of ["keyFigure","focusCards","editorialTimeline"]) {
      const fixture=page.locator(`[data-case="${orientation}-semantic-${id}"]`);
      await expect(fixture.locator('[data-scene-layer="incoming"]')).toHaveCount(0);
      await expect(fixture.locator('[data-transition-semantic="transient"]')).toHaveCount(0);
      await expect(fixture).toContainText(id==="keyFigure" ? "128%" : id==="focusCards" ? "Source preserved" : "Final event");
    }
  }
});

test("keeps the preview inert until focus ownership transfers at the scene boundary", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Native inert behavior is proven once in Chromium.");
  await page.goto("http://127.0.0.1:4274/tests/browser/fixtures/frame-parity.html");

  const transitionStart = page.locator('[data-case="focus-transition-4.7"]');
  const hiddenIncoming = transitionStart.locator('[data-scene-layer="incoming"] button');
  expect(await hiddenIncoming.evaluate((button) => {
    button.focus();
    return document.activeElement === button;
  })).toBe(false);

  const midpoint = page.locator('[data-case="focus-transition-4.85"]');
  const activeOutgoing = midpoint.locator('[data-scene-layer="outgoing"] button');
  const hiddenMidpointIncoming = midpoint.locator('[data-scene-layer="incoming"] button');
  expect(await activeOutgoing.evaluate((button) => {
    button.focus();
    return document.activeElement === button;
  })).toBe(true);
  expect(await hiddenMidpointIncoming.evaluate((button) => {
    button.focus();
    return document.activeElement === button;
  })).toBe(false);

  const settled = page.locator('[data-case="focus-transition-5"]');
  expect(await settled.locator('[data-scene-layer="active"] button').evaluate((button) => {
    button.focus();
    return document.activeElement === button;
  })).toBe(true);
});
