import { afterEach, expect, it, vi } from 'vitest';
import { createVideoChatVoice } from '../src/video-chat/voice';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function browser() {
  let active = true;
  const elements: Sink[] = [];
  class Sink {
    src = ''; currentTime = 0; muted = false; unlocked = false;
    onplaying: (() => void) | null = null;
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    pause = vi.fn(); load = vi.fn(); removeAttribute = vi.fn();
    play = vi.fn(async () => {
      if (active) this.unlocked = true;
      if (!this.unlocked) throw new DOMException('Gesture required', 'NotAllowedError');
    });
    constructor() { elements.push(this); }
  }
  vi.stubGlobal('navigator', { userActivation: { get isActive() { return active; } } });
  vi.stubGlobal('Audio', Sink);
  vi.stubGlobal('AudioContext', class { decodeAudioData() { return Promise.resolve({ duration: 3 }); } });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:recorded');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  return { elements, expire: () => { active = false; } };
}

it('gesture resume unlocks the reused sink before delayed opening and body speech', async () => {
  vi.useFakeTimers();
  const state = browser();
  const fallback = vi.fn();
  const voice = createVideoChatVoice({ fetcher: async () => new Response(new Uint8Array([1, 2])), onFallback: fallback });
  voice.resume();
  expect(state.elements).toHaveLength(1);
  expect(state.elements[0]!.unlocked).toBe(true);
  state.expire();
  await vi.advanceTimersByTimeAsync(6000);
  for (const text of ['Opening', 'Body']) {
    const onset = vi.fn();
    const done = voice.speak(text, { signal: new AbortController().signal, onStart: onset });
    await vi.advanceTimersByTimeAsync(0);
    const sink = state.elements[0]!;
    sink.currentTime = .1;
    sink.onplaying?.();
    expect(onset).toHaveBeenCalledWith('generated');
    sink.onended?.();
    await done;
    await vi.advanceTimersByTimeAsync(6000);
  }
  expect(state.elements).toHaveLength(1);
  expect(fallback).not.toHaveBeenCalled();
  voice.dispose?.();
});

it('automatic, muted and disposed resumes never create a priming sink', () => {
  const state = browser();
  const voice = createVideoChatVoice();
  voice.setMuted(true);
  voice.resume();
  expect(state.elements).toHaveLength(0);
  voice.setMuted(false);
  state.expire();
  voice.resume();
  expect(state.elements).toHaveLength(0);
  voice.dispose?.();
  voice.resume();
  expect(state.elements).toHaveLength(0);
});
