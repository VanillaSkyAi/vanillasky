import { describe, expect, it } from 'vitest';
import { splitCaptionPages, captionPageAt } from '../src/video-chat/caption-pages';

describe('caption pages', () => {
  it('preserves every word while respecting measured page capacity', () => {
    const text = 'A long spoken explanation should remain complete while each caption fits the available two lines.';
    const pages = splitCaptionPages(text, value => value.length <= 24);
    expect(pages.join('')).toBe(text);
    expect(pages.every(page => page.length <= 24)).toBe(true);
  });
  it('does not split an emoji when a long token needs breaking', () => {
    const pages = splitCaptionPages('🌻🌞🌊', value => Array.from(value).length <= 1);
    expect(pages).toEqual(['🌻', '🌞', '🌊']);
  });
  it('advances from the real utterance clock and stays fixed when that clock holds', () => {
    const pages = ['The first sentence.', 'The next sentence.', 'The final sentence.'];
    expect(captionPageAt(pages, 0, 12)).toBe(0);
    expect(captionPageAt(pages, 6, 12)).toBe(1);
    expect(captionPageAt(pages, 6, 12)).toBe(1);
    expect(captionPageAt(pages, 12, 12)).toBe(2);
    expect(captionPageAt(pages, 0, 12)).toBe(0);
  });
});
