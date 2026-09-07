import {expect, it, vi} from 'vitest';
import {WELCOME_CARDS, orderWelcomeCards} from '../src/video-chat/welcome-cards';
it('puts one of each category first and preserves all eight cards', () => {
  const cards = WELCOME_CARDS.map(({prompt,media}) => ({prompt,media}));
  const ordered = orderWelcomeCards(cards, 42);
  expect(ordered).toHaveLength(8);
  expect(new Set(ordered.map(c => c.prompt)).size).toBe(8);
  expect(new Set(ordered.slice(0,4).map(c => WELCOME_CARDS.find(x => x.prompt===c.prompt)?.category)).size).toBe(4);
  expect(orderWelcomeCards(cards,42)).toEqual(ordered);
  expect(orderWelcomeCards(cards,17)).not.toEqual(ordered);
  expect(cards[0]?.prompt).toBe(WELCOME_CARDS[0]?.prompt);
});
it('preserves custom host ordering', () => {
  const cards=[{prompt:'Custom prompt',media:null}];
  expect(orderWelcomeCards(cards,42)).toEqual(cards);
});

it('keeps a seed within the page but creates a fresh one on a fresh page load', async () => {
  const random=vi.spyOn(Math,'random').mockReturnValueOnce(0.1).mockReturnValueOnce(0.9);
  try {
    vi.resetModules();
    const first=await import('../src/video-chat/welcome-cards');
    const seed=first.welcomeVisitSeed();
    expect(first.welcomeVisitSeed()).toBe(seed);
    vi.resetModules();
    const next=await import('../src/video-chat/welcome-cards');
    expect(next.welcomeVisitSeed()).not.toBe(seed);
  } finally {random.mockRestore();}
});
