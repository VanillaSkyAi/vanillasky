import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test("hovered floating captions own clicks while the idle attribute catches up", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.setContent(`<style>${readFileSync("styles/video-chat.css", "utf8")}</style>
    <div class="vanillasky-video-chat" style="height:900px">
      <div class="stage-area"><div data-template="title" style="position:absolute;inset:0;background:black"></div></div>
      <div class="panel"><div class="panel-inner"><div class="caption-slot" data-captions="true"><div class="caption-clip">
        <div class="line-row" data-actions-visible="false" data-hover-armed="true"><p class="line">The complete subtitle stays readable.</p>
          <div class="caption-actions"><button class="caption-action" onclick="this.textContent='Hidden'">Hide subtitles</button></div>
        </div>
      </div></div></div></div>
    </div>`);
  await page.locator(".line-row").hover();
  const button = page.getByRole("button", { name: "Hide subtitles" });
  await expect(button).toHaveCSS("pointer-events", "auto");
  // Cross the six-pixel visual gap as a person moving to the toolbar would.
  const row = await page.locator(".line-row").boundingBox();
  const control = await button.boundingBox();
  await page.mouse.move(control!.x + control!.width / 2, row!.y - 3);
  await button.click();
  await expect(page.getByRole("button", { name: "Hidden" })).toBeVisible();
});
