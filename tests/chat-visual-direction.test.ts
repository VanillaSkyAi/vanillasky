import { describe, expect, it } from 'vitest';
import { compileVisualDirection } from '../src/server/chat-visual-direction';

describe('shared visual direction', () => {
  it.each(['explanation', 'practical', 'story', 'comedy', 'imagination'])('keeps %s intent with the same bounded default treatment', intent => {
    const direction = compileVisualDirection({intent});
    expect(direction.intent).toBe(intent);
    expect(direction.generatedLook).toBe(compileVisualDirection({}).generatedLook);
    expect(direction.generatedLook.length).toBeLessThanOrEqual(500);
    expect(direction).not.toHaveProperty('visualStyle');
  });
  it.each([undefined, 'constructor', {}, 'comparison'])('safely defaults an invalid intent (%j)', intent => {
    expect(compileVisualDirection({intent}).intent).toBe('explanation');
  });
  it('discards oversized shared direction', () => {
    expect(compileVisualDirection({visualDirection: 'x'.repeat(601)})).toEqual(compileVisualDirection({}));
  });
  it('keeps authored direction separate from the shared default and caller look', () => {
    const details = 'User-requested watercolor: one red fox in a snowy forest.';
    const automatic = compileVisualDirection({intent: 'story', visualDirection: details});
    expect(automatic.visualDirection).toBe(details);
    expect(automatic.generatedLook).toBe(compileVisualDirection({}).generatedLook);
    const custom = compileVisualDirection({visualDirection: details}, 'Tactile stop-motion clay');
    expect(custom.generatedLook).toBe('Tactile stop-motion clay');
    expect(custom.visualDirection).toBe(details);
  });
});
