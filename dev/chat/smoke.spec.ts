import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
test("offline HMR harness plays through the actual local handler without external requests", async ({page}, info) => {
  const external: string[] = [], errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    // WebKit routes generated speech blobs; they remain local to this harness.
    const local = url.origin === "http://127.0.0.1:4281" && ["http:", "blob:"].includes(url.protocol);
    if (!local) {external.push(route.request().url()); await route.abort();}
    else await route.continue();
  });
  await page.addInitScript(() => {
    const durations: number[] = [];
    const audioEvents: {type: string; code?: number; name?: string}[] = [];
    Object.assign(window, {offlineSpeechDurations: durations, offlineAudioEvents: audioEvents});
    const observed = new WeakSet<HTMLAudioElement>();
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (this instanceof HTMLAudioElement && !observed.has(this)) {
        observed.add(this);
        this.addEventListener("ended", () => durations.push(this.duration));
        for (const type of ["playing", "ended", "error"]) this.addEventListener(type, () => audioEvents.push({type, code: this.error?.code}));
      }
      const result = play.call(this);
      if (this instanceof HTMLAudioElement) result.catch(error => audioEvents.push({type: "play-rejected", name: error.name}));
      return result;
    };
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
  await page.screenshot({path: info.outputPath("immediate-chapter.png")});
  await expect(page.locator('[data-video-frame="ready"]')).toBeVisible({timeout: 12000});
  await expect(page.getByText(/Body rendered:/)).toBeVisible();
  await expect(page.getByText(/Video decoded:/)).toBeVisible();
  // A decoded player can still be covered by the opening chapter.
  await expect(page.locator("[data-opening-chapter]")).toHaveCount(0);
  await page.screenshot({path: info.outputPath("prepared-footage.png")});
  await expect(page.locator('[data-testid="video-player"][data-ended="true"]')).toBeVisible({timeout: 15000});
  const spokenDurations = await page.evaluate(() => (window as unknown as {offlineSpeechDurations: number[]}).offlineSpeechDurations);
  const diagnostics = JSON.stringify({
    externalOrigins: external.map(value => {const url = new URL(value); return {protocol: url.protocol, origin: url.origin};}),
    errors,
    phases: await page.locator(".dev-toolbar details li").allTextContents(),
    audio: await page.evaluate(() => (window as unknown as {offlineAudioEvents: unknown[]}).offlineAudioEvents),
  });
  const diagnosticPath = info.outputPath("offline-audio-diagnostics.json");
  await writeFile(diagnosticPath, diagnostics);
  await info.attach("offline-audio-diagnostics", {path: diagnosticPath, contentType: "application/json"});
  const activationDurations = spokenDurations.filter(seconds => seconds <= 0.05);
  expect(activationDurations.length).toBeLessThanOrEqual(1);
  expect(spokenDurations.filter(seconds => seconds > 0.05)).toHaveLength(3);
  expect(spokenDurations.filter(seconds => seconds > 0.05).every(seconds => seconds > 1)).toBe(true);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});
