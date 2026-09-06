import { expect, test } from "@playwright/test";
test("offline HMR harness plays through the actual local handler without external requests", async ({page}) => {
  const external: string[] = [], errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    if (!route.request().url().startsWith("http://127.0.0.1:4281/")) {external.push(route.request().url()); await route.abort();}
    else await route.continue();
  });
  await page.goto("http://127.0.0.1:4281/dev/chat/");
  await expect(page.getByText("OFFLINE · SDK source · deterministic fixtures")).toBeVisible();
  await page.getByRole("textbox", {name: "Prompt"}).fill("Why do waves move?");
  await page.getByRole("button", {name: "Ask", exact: true}).click();
  await expect(page.locator('[data-video-frame="ready"]')).toBeVisible({timeout: 12000});
  await expect(page.getByText(/First body frame:/)).toBeVisible();
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});
