import { describe, expect, it } from 'vitest';
import { compileVisualDirection } from '../src/server/chat-visual-direction';

describe('answer visual direction', () => {
  it.each([['explanation', 'illustrated'], ['practical', 'realistic'], ['story', 'cinematic'], ['comedy', 'cinematic'], ['imagination', 'cinematic']])('defaults %s to %s', (intent, style) => {
    expect(compileVisualDirection({ intent }).visualStyle).toBe(style);
    expect(compileVisualDirection({ intent }).generatedLook.length).toBeLessThanOrEqual(500);
  });
  it.each(['illustrated', 'realistic', 'cinematic'])('accepts an explicitly planned %s style for any intent', visualStyle => {
    expect(compileVisualDirection({ intent: 'practical', visualStyle }).visualStyle).toBe(visualStyle);
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
