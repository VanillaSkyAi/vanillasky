import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
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
      const lines = turn === 1 ? ["The Moon rotates once per orbit.", "One face stays toward Earth."] : ["Walk around a friend while facing them.", "You turn once during the trip."];
      const shot = (narration: string) => ({ narration, subject: "moon orbit", action: "Show the Moon rotating around Earth.", durationSec: 4, continuity: "cut" });
      yield JSON.stringify({ type: "answer", intent: "explanation", opening: "The Moon turns once around its orbit.", subject: "moon orbit", development: "Explain matching rotation and orbital periods.", visualDirection: "Clear generated orbital illustration.", ending: shot(lines[1]!) }) + "\n";
      yield JSON.stringify({ type: "shot", ...shot(lines[0]!) }) + "\n";
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
  await expect(page.locator(".line-row")).toBeVisible();
  await expect(page.locator(".caption-actions")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Expand subtitles" })).toHaveCount(0);
  if (recoveryNotice) {
    await expect(page.locator(".recovery-notice [role=status]")).toContainText("Some visuals were replaced");
    await page.getByRole("button", { name: "Dismiss notice" }).click();
  }
  await expect(page.locator(".recovery-notice [role=status]")).toHaveCount(0);
  await expect(page.locator("[data-media-unavailable]")).toHaveCount(0);
  await expect(page.locator('[data-video-frame="ready"] [data-template="title"]').first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Some parts were simplified");
  await page.locator(".line-row").hover();
  await expect(page.getByRole("button", { name: "Hide subtitles" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Transcript" })).toHaveCount(0);
  await page.locator(".vanillasky-video-chat").hover();
  await page.getByRole("textbox", { name: "Prompt" }).fill("Explain that with an analogy.");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].conversation).toEqual([expect.objectContaining({ prompt: requests[0].prompt, response: expect.stringContaining("The Moon rotates once per orbit.") })]);
  await expect(page.locator('[data-video-frame="ready"]')).toHaveAttribute("data-scene-id", /-shot-/);
  await expect(page.getByRole("button", { name: "Play again", exact: true, includeHidden: true })).toHaveCount(1, { timeout: 12_000 });
  await page.locator(".vanillasky-video-chat").hover();
  await expect(page.getByRole("button", { name: "Play again", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Show transcript", exact: true }).click();
  await expect(page.getByRole("region", { name: "Transcript" })).toContainText("Walk around a friend while facing them.");
  await expect(page.getByRole("region", { name: "Transcript" })).toContainText("You turn once during the trip.");
  expect(await page.locator("body").innerText()).not.toContain("private-provider-detail");
  if (recoveryNotice) {
    await expect(page.locator(".recovery-notice [role=status]")).toContainText("Some visuals were replaced");
    const dismiss = await page.getByRole("button", { name: "Dismiss notice" }).boundingBox();
    expect(dismiss!.height).toBeGreaterThanOrEqual(44);
    expect(dismiss!.width).toBeGreaterThanOrEqual(44);
  }
  expect(errors).toEqual([]);
});


test("plays a chapter through the hook, then replaces it with the ready body", async ({ page, baseURL }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  // Keep native playback while fixing both the soundtrack and welcome assets.
  await page.addInitScript(() => { Math.random = () => .99; });
  const footageFormat = process.platform === "linux" ? "webm" : "mp4";
  const footageFile = process.platform === "linux" ? "waterfall-hold.webm" : "waterfall.mp4";
  await page.route("https://videos.pexels.com/**", route => route.fulfill({
    path: fileURLToPath(new URL(`./fixtures/media-transition/${footageFile}`, import.meta.url)), contentType: `video/${footageFormat}`,
  }));
  await page.route("https://images.pexels.com/**", route => route.fulfill({
    path: fileURLToPath(new URL("./fixtures/media-transition/waterfall.jpg", import.meta.url)), contentType: "image/jpeg",
  }));
  const origin = baseURL ?? "http://127.0.0.1:4274";
  const handler = createVideoChatHandler({
    authorize: "none", heartbeatMs: false,
    generateText: async () => "[]",
    streamText: async function* () {
      yield JSON.stringify({ type: "answer", intent: "explanation", opening: "A waterfall starts our short journey.", subject: "waterfall", development: "Explain water flowing downhill.", visualDirection: "Natural waterfall footage.", ending: { narration: "Water keeps moving through the landscape.", subject: "waterfall", action: "Follow water flowing downstream.", durationSec: 4, continuity: "continue" } }) + "\n";
    },
  });
  await page.route("**/api/video-chat?*", async route => {
    const request = route.request();
    if (request.url().includes("action=opening-media")) {
      expect(request.postDataJSON()).toMatchObject({ keyword: "waterfall" });
      return route.fulfill({ json: { media: { url: `${origin}/tests/browser/fixtures/media-transition/${footageFile}`, type: "video" } } });
    }
    if (request.url().includes("action=response")) expect(request.postDataJSON()).toMatchObject({ initialTrackId: "rainy-forest" });
    const response = await handler(new Request(request.url(), { method: request.method(), ...(request.postData() ? { body: request.postData(), headers: { "content-type": "application/json" } } : {}) }));
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
  });
  await page.goto(`${origin}/tests/browser/fixtures/video-chat.html?hold-opening`);
  await page.getByRole("textbox", { name: "Prompt" }).fill("Explain a waterfall");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  const intro = page.locator("[data-opening-chapter]");
  await expect(intro).toBeVisible();
  await expect(intro).toHaveText("A waterfall starts our short journey.");
  await expect(page.locator('[data-soundtrack="active"]')).toHaveAttribute("src", "/audio-library/rainy-forest.mp3");
  await expect(page.locator(".ground, .asked, .stage > video.frame-media")).toHaveCount(0);
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
