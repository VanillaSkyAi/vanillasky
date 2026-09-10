import { afterEach, expect, it, vi } from 'vitest';
import { createVideoChatVoice } from '../src/video-chat/voice';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('reuses an audio sink after a line ends or is aborted, retaining pause, mute and offset controls', async () => {
  vi.useFakeTimers();
  const elements: FakeAudio[] = [];
  class FakeAudio {
    src = ''; currentTime = 0; muted = false;
    onplaying: (() => void) | null = null;
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    play = vi.fn(async () => {});
    pause = vi.fn();
    load = vi.fn();
    removeAttribute = vi.fn(() => { this.src = ''; });
    constructor(src = '') { this.src = src; elements.push(this); }
  }
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('AudioContext', class { decodeAudioData() { return Promise.resolve({ duration: 6 }); } });
  let next = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:line-${++next}`);
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const voice = createVideoChatVoice({ fetcher: async () => new Response(new Uint8Array([1, 2, 3])) });
  const controller = new AbortController();
  const first = voice.speak('Opening', { signal: controller.signal });
  await vi.advanceTimersByTimeAsync(0);
  elements[0]!.onended?.();
  await first;
  const secondController = new AbortController();
  const second = voice.speak('Body', { signal: secondController.signal, offsetSeconds: 2 });
  await vi.advanceTimersByTimeAsync(0);
  expect(elements).toHaveLength(1);
  expect(elements[0]!.src).toBe('blob:line-2');
  expect(elements[0]!.currentTime).toBe(2);
  voice.pause();
  expect(elements[0]!.pause).toHaveBeenCalled();
  voice.setMuted(true);
  expect(elements[0]!.muted).toBe(true);
  voice.setMuted(false);
  voice.resume();
  secondController.abort();
  await second;
  const third = voice.speak('Another body', { signal: new AbortController().signal });
  await vi.advanceTimersByTimeAsync(0);
  expect(elements).toHaveLength(1);
  elements[0]!.onended?.();
  await third;
  expect(revoke).not.toHaveBeenCalled();
  voice.dispose?.();
  expect(elements[0]!.src).toBe('');
  expect(revoke).toHaveBeenCalledTimes(3);
  expect(elements[0]!.onended).toBeNull();
});

it('ignores a rejected play promise from an aborted line after the next line starts', async () => {
  vi.useFakeTimers();
  let rejectOld: (error: Error) => void = () => {};
  let element: { src: string; currentTime: number; pause: ReturnType<typeof vi.fn>; play: ReturnType<typeof vi.fn>; onended?: (() => void) | null };
  let plays = 0;
  vi.stubGlobal('Audio', function () {
    element = { src: '', currentTime: 0, pause: vi.fn(), play: vi.fn(() => ++plays === 1
      ? new Promise<void>((_, reject) => { rejectOld = reject; }) : Promise.resolve()) };
    return element;
  });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:prepared');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const fallback = vi.fn();
  const voice = createVideoChatVoice({ fetcher: async () => new Response(new Uint8Array([1])), onFallback: fallback });
  const oldController = new AbortController();
  const first = voice.speak('First line', { signal: oldController.signal });
  await vi.advanceTimersByTimeAsync(0);
  oldController.abort();
  await first;
  const next = voice.speak('Next line', { signal: new AbortController().signal });
  await vi.advanceTimersByTimeAsync(0);
  const pauses = element!.pause.mock.calls.length;
  rejectOld(new DOMException('Old playback interrupted', 'AbortError'));
  await vi.advanceTimersByTimeAsync(0);
  expect(element!.pause).toHaveBeenCalledTimes(pauses);
  expect(fallback).not.toHaveBeenCalled();
  element!.onended?.();
  await next;
  voice.dispose?.();
});

it('ignores a superseded same-line play rejection after pause and resume', async () => {
  vi.useFakeTimers();
  let rejectInitial!: (error: Error) => void;
  const element = { src: '', currentTime: 0, muted: false, onended: null as (() => void) | null,
    pause: vi.fn(), play: vi.fn().mockImplementationOnce(() => new Promise<void>((_, reject) => { rejectInitial = reject; })).mockResolvedValue(undefined),
    removeAttribute: vi.fn(), load: vi.fn() };
  vi.stubGlobal('Audio', function () { return element; });
  vi.stubGlobal('AudioContext', class { decodeAudioData() { return Promise.resolve({ duration: 6 }); } });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:current-line');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const fallback = vi.fn();
  const voice = createVideoChatVoice({ fetcher: async () => new Response(new Uint8Array([1])), onFallback: fallback });
  const speaking = voice.speak('Keep this complete line.', { signal: new AbortController().signal });
  const observed = Promise.resolve(speaking).catch(() => undefined);
  await vi.advanceTimersByTimeAsync(0);
  voice.pause();
  voice.resume();
  rejectInitial(new DOMException('Playback interrupted by pause', 'AbortError'));
  await vi.advanceTimersByTimeAsync(0);
  expect(fallback).not.toHaveBeenCalled();
  expect(revoke).not.toHaveBeenCalled();
  element.onended?.();
  await observed;
  voice.dispose?.();
});

it('keeps replay speech active when the reused sink reports a stale ended event', async () => {
  vi.useFakeTimers();
  const element = {
    src: '', currentTime: 0, muted: false, ended: false,
    onplaying: null as (() => void) | null,
    onended: null as (() => void) | null,
    onerror: null as (() => void) | null,
    play: vi.fn(async () => {}), pause: vi.fn(), removeAttribute: vi.fn(), load: vi.fn(),
  };
  vi.stubGlobal('Audio', function () { return element; });
  vi.stubGlobal('AudioContext', class { decodeAudioData() { return Promise.resolve({ duration: 6 }); } });
  let next = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:line-${++next}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const voice = createVideoChatVoice({ fetcher: async () => new Response(new Uint8Array([1, 2, 3])) });

  await voice.prepare('Opening');
  const body = voice.speak('Body', { signal: new AbortController().signal });
  await vi.advanceTimersByTimeAsync(0);
  element.currentTime = .1;
  element.onplaying?.();
  await vi.advanceTimersByTimeAsync(20);
  element.ended = true;
  element.onended?.();
  await body;

  element.currentTime = 0;
  element.ended = false;
  let replayFinished = false;
  const replay = Promise.resolve(voice.speak('Opening', { signal: new AbortController().signal })).then(() => { replayFinished = true; });
  await vi.advanceTimersByTimeAsync(0);
  element.onended?.();
  await vi.advanceTimersByTimeAsync(0);
  expect(replayFinished).toBe(false);

  element.currentTime = .1;
  element.onplaying?.();
  await vi.advanceTimersByTimeAsync(20);
  element.ended = true;
  element.onended?.();
  await replay;
  voice.dispose?.();
});
