import { expect, test } from "@playwright/test";
import { createVideoChatHandler } from "../../src/server";

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`shows the spoken opening as a centered chapter when media is unavailable (${viewport.width})`, async ({ page }) => {
    const hook = "The Moon turns once around its orbit.";
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const handler = createVideoChatHandler({
      authorize: "none", heartbeatMs: false,
      welcome: { prompts: [{ prompt: "Explain the Moon" }] },
      generateText: async () => "[]",
      searchMedia: async () => null,
      async *streamText() {
        yield JSON.stringify({ type: "answer", intent: "explanation", opening: hook, subject: "moon orbit", development: "Explain synchronous rotation.", visualDirection: "Simple generated illustration.", ending: { narration: "One face stays toward Earth.", subject: "moon orbit", action: "Show the same lunar face pointing toward Earth.", durationSec: 4, continuity: "cut" } }) + "\n";
      },
    });
    await page.route("**/api/video-chat?*", async route => {
      const request = route.request();
      const response = await handler(new Request(request.url(), {
        method: request.method(),
        ...(request.postData() ? { body: request.postData(), headers: { "content-type": "application/json" } } : {}),
      }));
      await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
    });
    await page.setViewportSize(viewport);
    await page.goto("http://127.0.0.1:4274/tests/browser/fixtures/video-chat.html?hold-opening");
    await page.getByRole("textbox", { name: "Prompt" }).fill("Why does the Moon show one face?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    const title = page.locator(".stage").getByText(hook, { exact: true });
    await expect(title).toBeVisible();
    await expect(page.locator("[data-opening-chapter]")).toHaveCSS("background-color", "rgb(0, 0, 0)");
    await expect(title).toHaveCSS("opacity", "1");
    await expect(title).toHaveCSS("font-weight", "500");
    await expect(title).toHaveCSS("text-align", "center");
    await expect(title).toHaveCSS("color", "rgb(255, 255, 255)");
    const caption = page.locator(".line");
    await expect(caption).toHaveText(hook);
    await expect(caption).toBeVisible();
    const stage = await page.locator(".stage").boundingBox();
    const box = await title.boundingBox();
    expect(stage).not.toBeNull();
    expect(box).not.toBeNull();
    expect(Math.abs(box!.x + box!.width / 2 - stage!.x - stage!.width / 2)).toBeLessThan(3);
    expect(Math.abs(box!.y + box!.height / 2 - stage!.y - stage!.height / 2)).toBeLessThan(3);
    await expect(page.locator('[data-video-frame="ready"]')).toHaveCount(0);
    if (process.env.VANILLASKY_OPENING_PROOF_DIR) {
      await page.screenshot({ path: `${process.env.VANILLASKY_OPENING_PROOF_DIR}/opening-${viewport.width}.png` });
    }
    await page.getByRole("button", { name: "Finish opening" }).click();
    await expect(page.locator('[data-video-frame="ready"]')).toBeVisible();
    await expect(title).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
