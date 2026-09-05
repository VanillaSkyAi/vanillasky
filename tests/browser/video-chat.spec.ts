import { expect, test } from "@playwright/test";
import { createVideoChatHandler } from "../../src/server";

for (const recoveryNotice of [false, true]) test(`plays an answer, keeps follow-up context, and recovers from optional media failures (notice=${recoveryNotice})`, async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const requests: Array<{ prompt: string; conversation: Array<{ prompt: string; response: string }> }> = [];
  let turn = 0;
  const handler = createVideoChatHandler({
    authorize: "none", heartbeatMs: false,
    welcome: { prompts: [{ prompt: "Explain the Moon" }] },
    generateText: async () => "[]",
    generateVideo: async () => { throw new Error("private-provider-detail"); },
    searchMedia: async () => { throw new Error("private-provider-detail"); },
    streamText: () => (async function* () {
      turn += 1;
      yield JSON.stringify({ type: "video-chat.opening", spokenHook: "The Moon turns once around its orbit.", mediaKeyword: "moon" }) + "\n";
      for (const [index, text] of (turn === 1 ? ["The Moon rotates once per orbit.", "One face stays toward Earth."] : ["Walk around a friend while facing them.", "You turn once during the trip."]).entries()) {
        yield JSON.stringify({ type: "scene.add", ...(index === 1 ? { placement: "closer" } : {}), scene: {
          id: `turn-${turn}-${index}`, templateId: "cinemaMedia", variables: { fallbackText: text, mediaKeyword: "moon orbit", mediaType: "video", mediaSource: "generate" }, narration: text, timing: { fixedDuration: 4 },
        } }) + "\n";
      }
      yield '{"type":"plan.complete"}\n';
    })(),
  });
  await page.route("**/api/video-chat?*", async (route) => {
    const request = route.request();
    const body = request.postData();
    if (new URL(request.url()).searchParams.get("action") === "response") requests.push(JSON.parse(body!));
    const response = await handler(new Request(request.url(), { method: request.method(), ...(body ? { body, headers: { "content-type": "application/json" } } : {}) }));
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
  });
  await page.setViewportSize(recoveryNotice ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  await page.goto(`http://127.0.0.1:4274/tests/browser/fixtures/video-chat.html${recoveryNotice ? "?recovery-notice" : ""}`);
  await page.getByRole("textbox", { name: "Prompt" }).fill("Why does the Moon show one face?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.locator('[data-video-frame="ready"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Expand subtitles" })).toBeVisible();
  if (recoveryNotice) {
    await expect(page.getByRole("status")).toContainText("Some visuals were replaced");
    await page.getByRole("button", { name: "Dismiss notice" }).click();
  }
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Some parts were simplified");
  await page.locator(".line-row").hover();
  await page.getByRole("button", { name: "Expand subtitles" }).click();
  await expect(page.getByRole("region", { name: "Expanded subtitles" })).toContainText("The Moon rotates once per orbit.");
  await expect(page.getByRole("region", { name: "Expanded subtitles" })).toContainText("One face stays toward Earth.");
  await page.getByRole("button", { name: "Collapse subtitles" }).click();
  await page.locator(".vanillasky-video-chat").hover();
  await page.getByRole("textbox", { name: "Prompt" }).fill("Explain that with an analogy.");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].conversation).toEqual([expect.objectContaining({ prompt: requests[0].prompt, response: expect.stringContaining("The Moon rotates once per orbit.") })]);
  await expect(page.locator('[data-video-frame="ready"]')).toHaveAttribute("data-scene-id", /^turn-2-/);
  await expect(page.getByRole("button", { name: "Play again", exact: true, includeHidden: true })).toHaveCount(1, { timeout: 12_000 });
  await page.locator(".vanillasky-video-chat").hover();
  await expect(page.getByRole("button", { name: "Play again", exact: true })).toBeVisible();
  await page.locator(".line-row").hover();
  await page.getByRole("button", { name: "Expand subtitles" }).click();
  await expect(page.getByRole("region", { name: "Expanded subtitles" })).toContainText("Walk around a friend while facing them.");
  await expect(page.getByRole("region", { name: "Expanded subtitles" })).toContainText("You turn once during the trip.");
  expect(await page.locator("body").innerText()).not.toContain("private-provider-detail");
  if (recoveryNotice) {
    await expect(page.getByRole("status")).toContainText("Some visuals were replaced");
    const dismiss = await page.getByRole("button", { name: "Dismiss notice" }).boundingBox();
    expect(dismiss!.height).toBeGreaterThanOrEqual(44);
    expect(dismiss!.width).toBeGreaterThanOrEqual(44);
  }
  expect(errors).toEqual([]);
});


test("plays posterless intro footage through the hook, then replaces it with the ready body", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const handler = createVideoChatHandler({
    authorize: "none", heartbeatMs: false,
    generateText: async () => "[]",
    streamText: async function* () {
      yield JSON.stringify({ type: "video-chat.opening", spokenHook: "A waterfall starts our short journey.", mediaKeyword: "waterfall", fallbackKeyword: "river" }) + "\n";
      yield JSON.stringify({ type: "scene.add", placement: "closer", scene: { id: "body", templateId: "chapterTitle", variables: { title: "Water flows downhill" }, narration: "Water keeps moving through the landscape.", timing: { fixedDuration: 4 } } }) + "\n";
      yield '{"type":"plan.complete"}\n';
    },
  });
  await page.route("**/api/video-chat?*", async route => {
    const request = route.request();
    if (request.url().includes("action=opening-media")) {
      expect(request.postDataJSON()).toMatchObject({ keyword: "waterfall", fallbackKeyword: "river" });
      return route.fulfill({ json: { media: { url: "http://127.0.0.1:4274/tests/browser/fixtures/media-transition/waterfall.mp4", type: "video" } } });
    }
    const response = await handler(new Request(request.url(), { method: request.method(), ...(request.postData() ? { body: request.postData(), headers: { "content-type": "application/json" } } : {}) }));
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
  });
  await page.goto("http://127.0.0.1:4274/tests/browser/fixtures/video-chat.html?hold-opening");
  await page.getByRole("textbox", { name: "Prompt" }).fill("Explain a waterfall");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  const intro = page.locator(".stage > video.frame-media");
  await expect(intro).toBeVisible();
  await expect.poll(() => intro.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(0);
  expect(await intro.getAttribute("poster")).toBeNull();
  await expect(page.locator('[data-video-frame="ready"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Finish opening" }).click();
  await expect(page.locator('[data-video-frame="ready"]')).toBeVisible();
  await expect(intro).toHaveCount(0);
  expect(errors).toEqual([]);
});

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`keeps developer links reachable within Settings at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/video-chat?*", route => route.fulfill({ json: { prompts: [] } }));
    await page.goto("http://127.0.0.1:4274/tests/browser/fixtures/video-chat.html");
    await page.getByRole("button", { name: "Settings", exact: true }).focus();
    await page.keyboard.press("Enter");
    const about = page.getByRole("button", { name: "About", exact: true });
    await about.click();
    await expect(about).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("region", { name: "About VanillaSky" })).toBeVisible();
    const github = page.getByRole("link", { name: "GitHub", exact: true });
    await github.focus();
    const bounds = await github.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Close settings" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeFocused();
    await expect(page.getByRole("dialog", { name: "Settings" })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

for (const width of [390, 700, 1440]) test(`header controls have equal gaps at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  await page.route("**/api/video-chat**", (route) => route.fulfill({ json: { prompts: [] } }));
  await page.goto("http://127.0.0.1:4274/tests/browser/fixtures/video-chat.html");
  const buttons = page.locator(".chrome button");
  await expect(buttons).toHaveCount(3);
  const boxes = await buttons.evaluateAll((elements) => elements.map((element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  }));
  const [sessions, settings, voice] = boxes;
  const firstGap = settings.x - sessions.x - sessions.width;
  const secondGap = voice.x - settings.x - settings.width;
  expect(firstGap).toBeGreaterThanOrEqual(6);
  expect(Math.abs(firstGap - secondGap)).toBeLessThan(0.5);
  expect(sessions.y).toBe(settings.y);
  expect(settings.y).toBe(voice.y);
  expect(voice.x + voice.width).toBeLessThanOrEqual(width);
});
