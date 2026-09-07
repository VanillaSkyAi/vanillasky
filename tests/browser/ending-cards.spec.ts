import { test, expect } from "@playwright/test";
for (const size of [{name: "desktop", width: 1440, height: 900, columns: 4}, {name: "mobile", width: 390, height: 844, columns: 2}, {name: "landscape", width: 844, height: 390, columns: 2}, {name: "text-zoom", width: 390, height: 844, columns: 2}]) {
  test(`ending cards keep long labels readable at ${size.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(size);
    await page.goto(`${testInfo.project.use.baseURL ?? "http://127.0.0.1:4274"}/tests/browser/fixtures/ending-cards.html`);
    if (size.name === "text-zoom") await page.addStyleTag({content: ".vanillasky-video-chat .card-prompt {font-size: 28px !important}"});
    const cards = page.locator(".ending .cards button");
    await expect(cards).toHaveCount(4);
    const geometry = await cards.evaluateAll(elements => elements.map(element => {
      const box = element.getBoundingClientRect(), text = element.querySelector(".card-prompt")!.getBoundingClientRect();
      return {width: box.width, y: box.y, top: text.top - box.top, bottom: box.bottom - text.bottom};
    }));
    if (size.name === "desktop") expect(geometry[0]!.width).toBeGreaterThan(280);
    expect(new Set(geometry.map(item => Math.round(item.y))).size).toBe(4 / size.columns);
    for (const item of geometry) { expect(item.top).toBeGreaterThanOrEqual(0); expect(item.bottom).toBeGreaterThanOrEqual(-1); }
    for (const card of await cards.all()) {
      await card.scrollIntoViewIfNeeded();
      const box = await card.boundingBox();
      const panel = await page.locator(".panel").boundingBox();
      const scroll = await page.locator(".ending-body").boundingBox();
      expect(scroll!.y).toBeGreaterThanOrEqual(0);
      expect(scroll!.y + scroll!.height).toBeLessThanOrEqual(panel!.y);
      expect(box!.y).toBeLessThan(scroll!.y + scroll!.height);
      expect(box!.y + box!.height).toBeGreaterThan(scroll!.y);
    }
    await page.getByRole("textbox").fill("Another question");
    await expect(page.getByRole("textbox")).toHaveValue("Another question");
    await cards.nth(2).hover();
    await expect.poll(() => page.locator(".cards video").evaluateAll(videos => videos.filter(video => !(video as HTMLVideoElement).paused).length)).toBe(1);
    const reachability = await page.locator(".ending-body").evaluate(element => {
      element.scrollTop = element.scrollHeight;
      const end = element.querySelector(".cards li:last-child .card-prompt")!.getBoundingClientRect();
      const bounds = element.getBoundingClientRect();
      return {end: end.bottom, bottom: bounds.bottom, horizontalOverflow: element.scrollWidth - element.clientWidth};
    });
    expect(reachability.end).toBeLessThanOrEqual(reachability.bottom);
    expect(reachability.horizontalOverflow).toBeLessThanOrEqual(1);
    await page.screenshot({path: testInfo.outputPath(`${size.name}.png`)});
  });
}

test("welcome cards retain their compact horizontal rail", async ({page}, info) => {
  await page.setViewportSize({width:1440,height:900});
  await page.goto(`${info.project.use.baseURL ?? "http://127.0.0.1:4274"}/tests/browser/fixtures/ending-cards.html?welcome`);
  const widths = await page.locator(".welcome .cards button").evaluateAll(cards => cards.map(card => card.getBoundingClientRect().width));
  expect(widths).toHaveLength(4);
  expect(widths.every(width => width <= 260)).toBe(true);
  await expect(page.locator(".welcome .cards")).toHaveCSS("display", "flex");
});
