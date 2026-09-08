import { describe, expect, it } from 'vitest';
import { compileVisualDirection } from '../src/server/chat-visual-direction';

describe('answer visual direction', () => {
  it.each(['explanation', 'practical', 'story', 'comedy', 'imagination'])('keeps %s intent while defaulting missing or invalid style to realistic', intent => {
    for (const visualStyle of [undefined, null, '', 'unknown', 'constructor', {}, 1]) {
      const direction = compileVisualDirection({ intent, visualStyle });
      expect(direction.intent).toBe(intent);
      expect(direction.visualStyle).toBe('realistic');
      expect(direction.generatedLook).toBe(compileVisualDirection({visualStyle: 'realistic'}).generatedLook);
      expect(direction.generatedLook.length).toBeLessThanOrEqual(500);
    }
  });
  it.each(['illustrated', 'realistic', 'cinematic'])('accepts an explicitly planned %s style for any intent', visualStyle => {
    expect(compileVisualDirection({ intent: 'practical', visualStyle }).visualStyle).toBe(visualStyle);
  });
  it.each([undefined, 'constructor', {}, 'comparison'])('validates intent independently from a valid planned style (%s)', intent => {
    expect(compileVisualDirection({intent, visualStyle: 'cinematic'})).toMatchObject({intent: 'explanation', visualStyle: 'cinematic'});
  });
  it('falls back safely for absent or invalid enums and discards oversized direction', () => {
    expect(compileVisualDirection({ intent: {}, visualStyle: 'unknown', visualDirection: 'x'.repeat(601) })).toEqual(compileVisualDirection({}));
  });
  it('keeps shared bounded identity details and gives caller look precedence', () => {
    const details = 'One red fox in a snowy forest, a blue and gold palette.';
    const automatic = compileVisualDirection({ intent: 'story', visualDirection: details });
    expect(automatic.visualDirection).toBe(details);
    expect(automatic.generatedLook.length).toBeLessThanOrEqual(500);
    const custom = compileVisualDirection({ intent: 'explanation', visualStyle: 'illustrated', visualDirection: details }, 'Tactile stop-motion clay');
    expect(custom.generatedLook).toBe('Tactile stop-motion clay');
    expect(custom.visualDirection).toBe(details);
  });
});
