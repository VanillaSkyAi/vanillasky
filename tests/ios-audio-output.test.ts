import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let output: typeof import('../src/player/ios-audio-output');

beforeEach(async () => {
  vi.resetModules();
  output = await import('../src/player/ios-audio-output');
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function browser(type = 'auto') {
  const session = { type };
  vi.stubGlobal('navigator', { platform: 'iPhone', userAgent: 'iPhone', audioSession: session });
  const context = {
    state: 'suspended', close: vi.fn(), suspend: vi.fn(),
    resume: vi.fn(async () => { context.state = 'running'; }),
  };
  const Context = vi.fn(function () { return context; });
  vi.stubGlobal('AudioContext', Context);
  vi.stubGlobal('webkitAudioContext', undefined);
  return { session, context, Context };
}

describe('iOS audio output', () => {
  it.each([
    ['iPhone', '', 0, true], ['iPad', '', 0, true], ['iPod', '', 0, true],
    ['', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 0, true],
    ['MacIntel', 'Macintosh', 5, true], ['MacIntel', 'Macintosh', 1, false],
    ['Linux armv8l', 'Android', 5, false], ['Win32', 'Windows', 0, false],
  ])('detects %s / %s with %i touch points', (platform, userAgent, maxTouchPoints, expected) => {
    vi.stubGlobal('navigator', { platform, userAgent, maxTouchPoints });
    expect(output.isIosAudioOutput()).toBe(expected);
  });

  it('reuses one context for decoding without resuming it or changing the audio session', () => {
    const { context, Context, session } = browser();
    expect(output.getIosAudioContext()).toBe(context);
    expect(output.getIosAudioContext()).toBe(context);
    expect(Context).toHaveBeenCalledTimes(1);
    expect(context.resume).not.toHaveBeenCalled();
    expect(session.type).toBe('auto');
  });

  it('selects playback and calls resume before returning to the gesture handler', async () => {
    const { context, Context, session } = browser();
    context.resume.mockImplementation(async () => {
      expect(session.type).toBe('playback');
      context.state = 'running';
    });
    const resumed = output.resumeIosAudioContext();
    expect(context.resume).toHaveBeenCalledTimes(1);
    expect(await resumed).toBe(context);
    expect(await output.resumeIosAudioContext()).toBe(context);
    expect(Context).toHaveBeenCalledTimes(1);
    expect(context.close).not.toHaveBeenCalled();
    expect(context.suspend).not.toHaveBeenCalled();
  });

  it('does not allocate or change session policy on other platforms', async () => {
    const { Context, session } = browser();
    vi.stubGlobal('navigator', { platform: 'MacIntel', maxTouchPoints: 0, audioSession: session });
    expect(output.getIosAudioContext()).toBeUndefined();
    expect(await output.resumeIosAudioContext()).toBeUndefined();
    output.beginIosAudioInput()();
    expect(Context).not.toHaveBeenCalled();
    expect(session.type).toBe('auto');
  });

  it('uses the prefixed constructor when necessary', async () => {
    const { Context, context } = browser();
    vi.stubGlobal('AudioContext', undefined);
    vi.stubGlobal('webkitAudioContext', Context);
    expect(await output.resumeIosAudioContext()).toBe(context);
  });

  it('tolerates unavailable browser and audio APIs', async () => {
    vi.stubGlobal('navigator', undefined);
    expect(output.isIosAudioOutput()).toBe(false);
    expect(output.getIosAudioContext()).toBeUndefined();
    expect(await output.resumeIosAudioContext()).toBeUndefined();
    output.beginIosAudioInput()();
    browser();
    vi.stubGlobal('AudioContext', undefined);
    expect(await output.resumeIosAudioContext()).toBeUndefined();
  });

  it('tolerates construction failure and permits a later retry', () => {
    const { Context, context } = browser();
    Context.mockImplementationOnce(() => { throw new Error('Audio unavailable'); });
    expect(output.getIosAudioContext()).toBeUndefined();
    expect(output.getIosAudioContext()).toBe(context);
  });

  it('returns no output when resume rejects, throws, or remains suspended', async () => {
    const { context } = browser();
    context.resume.mockRejectedValueOnce(new Error('Blocked'));
    expect(await output.resumeIosAudioContext()).toBeUndefined();
    context.resume.mockImplementationOnce(() => { throw new Error('Blocked'); });
    expect(await output.resumeIosAudioContext()).toBeUndefined();
    context.resume.mockResolvedValueOnce(undefined);
    expect(await output.resumeIosAudioContext()).toBeUndefined();
    expect(await output.resumeIosAudioContext()).toBe(context);
    expect(context.close).not.toHaveBeenCalled();
  });

  it('does not return or replace a context closed outside its owner', async () => {
    const { context, Context } = browser();
    output.getIosAudioContext();
    context.state = 'closed';
    expect(output.getIosAudioContext()).toBeUndefined();
    expect(await output.resumeIosAudioContext()).toBeUndefined();
    expect(Context).toHaveBeenCalledTimes(1);
  });
});

describe('iOS microphone guard', () => {
  it('selects auto before capture and restores the preceding policy on cleanup', () => {
    const { session, Context } = browser('playback');
    const end = output.beginIosAudioInput();
    expect(session.type).toBe('auto'); // The caller can now invoke getUserMedia.
    expect(Context).not.toHaveBeenCalled();
    end();
    expect(session.type).toBe('playback');
    session.type = 'ambient';
    end();
    expect(session.type).toBe('ambient');
  });

  it('keeps auto until every input guard is released, including out-of-order cleanup', async () => {
    const { session } = browser('ambient');
    const first = output.beginIosAudioInput();
    const second = output.beginIosAudioInput();
    await output.resumeIosAudioContext();
    expect(session.type).toBe('auto');
    first();
    first();
    expect(session.type).toBe('auto');
    second();
    expect(session.type).toBe('playback');
  });

  it('restores the current input scope rather than a stale earlier playback request', async () => {
    const { session } = browser();
    await output.resumeIosAudioContext();
    session.type = 'ambient';
    output.beginIosAudioInput()();
    expect(session.type).toBe('ambient');
  });

  it('does not overwrite a session policy changed by another owner during capture', async () => {
    const { session } = browser('playback');
    const end = output.beginIosAudioInput();
    await output.resumeIosAudioContext();
    session.type = 'play-and-record';
    end();
    expect(session.type).toBe('play-and-record');
  });

  it('does not restore a replaced audio session', () => {
    browser('playback');
    const end = output.beginIosAudioInput();
    const replacement = { type: 'auto' };
    vi.stubGlobal('navigator', { platform: 'iPhone', audioSession: replacement });
    end();
    expect(replacement.type).toBe('auto');
  });

  it('tolerates missing or blocked audio-session APIs without blocking context output', async () => {
    const { context } = browser();
    vi.stubGlobal('navigator', { platform: 'iPhone' });
    const endMissing = output.beginIosAudioInput();
    expect(await output.resumeIosAudioContext()).toBe(context);
    endMissing();
    const session = { get type() { return 'ambient'; }, set type(_value: string) { throw new Error('Blocked'); } };
    vi.stubGlobal('navigator', { platform: 'iPhone', audioSession: session });
    const endBlocked = output.beginIosAudioInput();
    expect(await output.resumeIosAudioContext()).toBe(context);
    expect(() => endBlocked()).not.toThrow();
    expect(await output.resumeIosAudioContext()).toBe(context);
  });
});
