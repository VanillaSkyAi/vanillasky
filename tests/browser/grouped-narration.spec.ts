import { devices, expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
test("one prerecorded paragraph survives two visual cuts", async ({ browser }, info) => {
  const context = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await context.newPage();
  test.setTimeout(30000);
  await page.goto("http://127.0.0.1:4274/tests/browser/fixtures/grouped-narration.html");
  await page.getByText("Play prerecorded paragraph").click();
  try {
  await expect.poll(() => page.evaluate(() => (window as unknown as { narrationProbe: Array<{ kind: string }> }).narrationProbe.filter((event) => event.kind === "ended").length), { timeout: 15000 }).toBe(1);
  } catch (error) {
    const diagnostics = await page.evaluate(() => ({
      probe: (window as unknown as { narrationProbe: unknown[] }).narrationProbe,
      video: [...document.querySelectorAll("video")].map((media) => ({ readyState: media.readyState, currentTime: media.currentTime, duration: media.duration, paused: media.paused, error: media.error?.message })),
    }));
    console.error("Grouped narration failure:", JSON.stringify(diagnostics));
    throw error;
  }
  const probe = await page.evaluate(() => (window as unknown as { narrationProbe: Array<{ kind: string; index?: number; audioTime?: number }> }).narrationProbe);
  expect(probe.filter((event) => event.kind === "audio-created")).toHaveLength(1);
  expect(probe.filter((event) => event.kind === "pause" && event.audioTime! < 6)).toHaveLength(0);
  const cuts = probe.filter((event) => event.kind === "cut");
  expect(cuts.map((event) => event.index)).toEqual([0, 1, 2]);
  expect(cuts[1]!.audioTime).toBeGreaterThan(1);
  expect(cuts[2]!.audioTime).toBeGreaterThan(cuts[1]!.audioTime!);
  await writeFile(info.outputPath("grouped-audio.json"), JSON.stringify({ commit: process.env.TEST_SOURCE_COMMIT, browser: info.project.name, browserVersion: browser.version(), audio: "offline macOS Samantha prerecorded paragraph", probe }, null, 2));
  await page.screenshot({ path: info.outputPath("grouped-audio.png") });
  await context.close();
});
