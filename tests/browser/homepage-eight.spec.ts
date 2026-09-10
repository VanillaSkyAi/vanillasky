import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { WELCOME_CARDS } from '../../src/video-chat/welcome-cards';

test('desktop shows four current-size cards and browses all eight without hover jumps', async ({page}) => {
  await page.setViewportSize({width:1440,height:900});
  await page.goto('http://127.0.0.1:4274/tests/browser/fixtures/homepage-eight.html');
  const rail = page.getByRole('list', {name:'Suggested prompts'});
  const cards = rail.locator('button');
  await expect(cards).toHaveCount(8);
  await expect(rail.locator("video")).toHaveCount(1);
  await expect(rail.locator("img.frame-poster")).toHaveCount(7);
  const visible = () => cards.evaluateAll(elements => {
    const viewport = elements[0]!.closest('ul')!.getBoundingClientRect();
    return elements.filter(element => { const box=element.getBoundingClientRect(); return box.left>=viewport.left && box.right<=viewport.right; }).length;
  });
  expect(await visible()).toBe(4);
  expect((await cards.first().boundingBox())!.width).toBeCloseTo(259.2, 0);
  const before = await rail.evaluate(element => element.scrollLeft);
  await cards.nth(3).hover();
  await expect(rail.locator("video")).toHaveCount(1);
  await expect(cards.nth(3).locator("video")).toHaveCount(1);
  await page.waitForTimeout(350);
  expect(await rail.evaluate(element => element.scrollLeft)).toBe(before);
  await page.getByRole('button', {name:'Next suggestions'}).click();
  await expect.poll(() => rail.evaluate(element => element.scrollLeft)).toBeGreaterThan(800);
  await expect(page.getByRole('button', {name:'Previous suggestions'})).toBeVisible();
  await expect.poll(() => rail.evaluate(element => element.scrollWidth - element.clientWidth - element.scrollLeft)).toBeLessThan(2);
  expect(await visible()).toBe(4);
  await expect(cards.last()).toBeInViewport({ratio:1});
  await page.getByRole('button', {name:'Previous suggestions'}).click();
  await expect.poll(() => rail.evaluate(element => element.scrollLeft)).toBeLessThan(2);
  await page.goto('http://127.0.0.1:4274/tests/browser/fixtures/homepage-eight.html?four');
  await expect(page.getByRole('button', {name:'Next suggestions'})).toHaveCount(0);
});

test('desktop rail arrows are visually centered inside their circular buttons', async ({page}) => {
  await page.setViewportSize({width:1440,height:900});
  await page.goto('http://127.0.0.1:4274/tests/browser/fixtures/homepage-eight.html');
  const next = page.getByRole('button', {name:'Next suggestions'});
  await expect(next).toBeVisible();
  const icon = next.locator('svg');
  await expect(icon).toBeVisible();
  const offset = await next.evaluate(button => {
    const buttonBox = button.getBoundingClientRect();
    const contentBox = button.querySelector('svg')!.getBoundingClientRect();
    return {
      x: contentBox.left + contentBox.width / 2 - (buttonBox.left + buttonBox.width / 2),
      y: contentBox.top + contentBox.height / 2 - (buttonBox.top + buttonBox.height / 2),
    };
  });
  expect(Math.abs(offset.x)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(offset.y)).toBeLessThanOrEqual(0.5);
});

test('phone keeps 172px cards and native horizontal scrolling without desktop arrows', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto('http://127.0.0.1:4274/tests/browser/fixtures/homepage-eight.html');
  const rail = page.getByRole('list', {name:'Suggested prompts'});
  await expect(rail.locator('button')).toHaveCount(8);
  expect((await rail.locator('button').first().boundingBox())!.width).toBe(172);
  const fullyVisible = await rail.locator('button').evaluateAll(elements => {
    const viewport = elements[0]!.closest('ul')!.getBoundingClientRect();
    return elements.filter(element => { const box = element.getBoundingClientRect(); return box.left >= viewport.left && box.right <= viewport.right; }).length;
  });
  expect(fullyVisible).toBe(2);
  await expect(page.getByRole('button', {name:'Next suggestions'})).not.toBeVisible();
  await expect(rail).toHaveCSS('overflow-x', 'auto');
  await rail.evaluate(element => { element.scrollLeft=element.scrollWidth; });
  await expect.poll(() => rail.evaluate(element => element.scrollLeft)).toBeGreaterThan(900);
  await expect(rail.locator('button').last()).toBeInViewport();
});


test('fresh loads reshuffle balanced prompts while Home preserves this visit', async ({page}) => {
  await page.setViewportSize({width:1440,height:900});
  await page.addInitScript(() => {
    const visit = Number(sessionStorage.getItem('test-homepage-visit') ?? 0) + 1;
    sessionStorage.setItem('test-homepage-visit', String(visit));
    let seed = visit * 1234567;
    Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  });
  await page.route('https://videos.pexels.com/**', route => route.fulfill({path: fileURLToPath(new URL('./fixtures/media-transition/waterfall.mp4', import.meta.url)), contentType:'video/mp4'}));
  await page.route('https://images.pexels.com/**', route => route.fulfill({path: fileURLToPath(new URL('./fixtures/media-transition/waterfall.jpg', import.meta.url)), contentType:'image/jpeg'}));
  const url = 'http://127.0.0.1:4274/';
  const html = readFileSync(new URL('./fixtures/homepage-preview.html', import.meta.url), 'utf8').replace('./homepage-preview.tsx', '/tests/browser/fixtures/homepage-preview.tsx');
  await page.route(url, route => route.fulfill({body: html, contentType:'text/html'}));
  await page.goto(url, {waitUntil:'domcontentloaded'});
  const cards = page.getByRole('list', {name:'Suggested prompts'}).locator('button');
  await expect(cards).toHaveCount(8);
  const first = await cards.allTextContents();
  expect([...first].sort()).toEqual(WELCOME_CARDS.map(card => card.prompt).sort());
  expect(new Set(first.slice(0,4).map(prompt => WELCOME_CARDS.find(card => card.prompt === prompt)!.category)).size).toBe(4);
  await cards.first().click();
  await expect(page.locator('body')).toHaveAttribute('data-selected-prompt', first[0]!);
  await page.locator('.vanillasky-video-chat').hover();
  await expect(page.getByRole('button', {name:'Play again', exact:true})).toBeVisible();
  await page.evaluate(() => document.addEventListener('click', event => {
    if (!(event.target as Element).closest('a.home-link')) return;
    sessionStorage.setItem('test-home-click', JSON.stringify({button:event.button, meta:event.metaKey, ctrl:event.ctrlKey, shift:event.shiftKey, alt:event.altKey, path:location.pathname, prevented:event.defaultPrevented}));
  }, {once:true}));
  await page.getByRole('link', {name:'Home', exact:true}).click();
  await expect(page).toHaveURL(url);
  await expect(cards).toHaveCount(8);
  expect(await page.evaluate(() => sessionStorage.getItem('test-home-click'))).toContain('"prevented":true');
  expect(await cards.allTextContents()).toEqual(first);
  expect(await page.evaluate(() => sessionStorage.getItem('test-homepage-visit'))).toBe('1');
  await page.reload({waitUntil:'domcontentloaded'});
  await expect(cards).toHaveCount(8);
  const second = await cards.allTextContents();
  expect([...second].sort()).toEqual([...first].sort());
  expect(second).not.toEqual(first);
  expect(new Set(second.slice(0,4).map(prompt => WELCOME_CARDS.find(card => card.prompt === prompt)!.category)).size).toBe(4);
});
