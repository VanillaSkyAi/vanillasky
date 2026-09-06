import { expect, test } from "@playwright/test";
test("offline HMR harness plays through the actual local handler without external requests", async ({page}, info) => {
  const external: string[] = [], errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    if (!route.request().url().startsWith("http://127.0.0.1:4281/")) {external.push(route.request().url()); await route.abort();}
    else await route.continue();
  });
  await page.goto("http://127.0.0.1:4281/dev/chat/");
  await expect(page.getByText("OFFLINE · SDK source · deterministic fixtures")).toBeVisible();
  await page.getByRole("textbox", {name: "Prompt"}).fill("Why do waves move?");
  await page.evaluate(() => {
    document.addEventListener("click", event => {
      if (!(event.target instanceof Element) || !event.target.closest('button[aria-label="Ask"]')) return;
      const submittedAt = performance.now();
      const observe = () => {
        const title = document.querySelector<HTMLElement>('[data-opening-chapter] [data-title-composition]');
        if (title && title.getBoundingClientRect().height > 0 && Number(getComputedStyle(title).opacity) > 0) {
          requestAnimationFrame(() => {Object.assign(window, {openingPaintOpportunityMs: performance.now() - submittedAt});});
        } else if (performance.now() - submittedAt < 2000) requestAnimationFrame(observe);
      };
      requestAnimationFrame(observe);
    }, {capture: true, once: true});
  });
  await page.getByRole("button", {name: "Ask", exact: true}).click();
  await page.waitForFunction(() => typeof (window as unknown as {openingPaintOpportunityMs?: number}).openingPaintOpportunityMs === "number");
  const openingPaintOpportunityMs = await page.evaluate(() => (window as unknown as {openingPaintOpportunityMs: number}).openingPaintOpportunityMs);
  await info.attach("opening-paint-opportunity", {body: JSON.stringify({openingPaintOpportunityMs}), contentType: "application/json"});
  expect(openingPaintOpportunityMs).toBeLessThan(200);
  await expect(page.locator('[data-video-frame="ready"]')).toBeVisible({timeout: 12000});
  await expect(page.getByText(/Body surface:/)).toBeVisible();
  await expect(page.getByText(/Moving footage:/)).toBeVisible();
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});
