// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { Soundtrack } from '../src/player/soundtrack';
import type { SoundtrackPlayback } from '../src/player/buffer-soundtrack';
import type { VideoAudio } from '../src/protocol/types';

const output = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('../src/player/ios-audio-output', () => ({ isIosAudioOutput: () => true }));
vi.mock('../src/player/buffer-soundtrack', () => ({ createBufferedSoundtrack: output.create }));

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function handle(url: string) {
  const starts: ReturnType<typeof deferred>[] = [];
  const value = {
    url, starts, volume: 1, muted: false, currentTime: 0, paused: true,
    play: vi.fn(() => { value.paused = false; const start = deferred(); starts.push(start); return start.promise; }),
    pause: vi.fn(() => { value.paused = true; }),
    dispose: vi.fn(() => { value.paused = true; }),
  };
  return value;
}
const track = (id: string): VideoAudio => ({ trackId: id, audioUrl: `/${id}.mp3`, volume: .2, fadeOutMs: 2000, duration: 20, beatDetection: { sensitivity: .5 }, beatMarkers: [] });
let outputs: ReturnType<typeof handle>[];
let frame: (milliseconds: number) => void;
let audioRef: { current: SoundtrackPlayback | null };
const props = (id?: string, playing = true, muted = false) => ({ audio: id ? track(id) : undefined, playing, muted, volume: .2, time: 0, duration: 0, terminal: false, audioRef });
const started = async (index: number, attempt = 0) => act(async () => { outputs[index]!.starts[attempt]!.resolve(); });
beforeEach(() => {
  vi.useFakeTimers();
  outputs = []; audioRef = { current: null };
  output.create.mockImplementation((url: string) => { const next = handle(url); outputs.push(next); return next; });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(new Error('No native iOS music'));
  const pending = new Map<number, FrameRequestCallback>();
  let id = 0, now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { pending.set(++id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (key: number) => pending.delete(key));
  frame = milliseconds => act(() => { now += milliseconds; const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(callback => callback(now)); });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); output.create.mockReset(); });

it('starts its fade after buffered playback is ready, without a native audio element', async () => {
  const view = render(createElement(Soundtrack, props('one')));
  expect(view.container.querySelector('audio')).toBeNull();
  expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  frame(3000);
  expect(outputs[0]!.volume).toBe(0);
  await started(0);
  frame(400);
  expect(outputs[0]!.volume).toBeCloseTo(.1);
  frame(400);
  expect(outputs[0]!.volume).toBeCloseTo(.2);
});

it('holds outgoing music through a delayed replacement then crossfades both outputs', async () => {
  const view = render(createElement(Soundtrack, props('one')));
  await started(0); frame(800);
  view.rerender(createElement(Soundtrack, props('two')));
  frame(3000);
  expect(outputs[0]!.volume).toBeCloseTo(.2);
  expect(outputs[0]!.dispose).not.toHaveBeenCalled();
  expect(outputs[1]!.volume).toBe(0);
  await started(1); frame(400);
  expect(outputs[0]!.volume).toBeCloseTo(.1);
  expect(outputs[1]!.volume).toBeCloseTo(.1);
  frame(400);
  expect(outputs[0]!.dispose).toHaveBeenCalledOnce();
  expect(outputs[1]!.volume).toBeCloseTo(.2);
});

it('starts a new handle when rapid shuffle reuses the same React key', async () => {
  const view = render(createElement(Soundtrack, props('one')));
  await started(0); frame(800);
  view.rerender(createElement(Soundtrack, props('two')));
  view.rerender(createElement(Soundtrack, props('one')));
  expect(outputs).toHaveLength(3);
  expect(outputs[0]!.dispose).toHaveBeenCalledOnce();
  expect(outputs[2]!.play).toHaveBeenCalledOnce();
  expect(audioRef.current).toBe(outputs[2]);
  await started(2); frame(800);
  expect(outputs[2]!.volume).toBeCloseTo(.2);
});

it('ignores a stale ready result after pause and preserves gain and mute on resume', async () => {
  const view = render(createElement(Soundtrack, props('one')));
  view.rerender(createElement(Soundtrack, props('one', false, true)));
  await started(0); frame(1000);
  expect(outputs[0]!.paused).toBe(true);
  view.rerender(createElement(Soundtrack, props('one', true, true)));
  frame(800);
  expect(outputs[0]!.volume).toBe(0);
  expect(outputs[0]!.muted).toBe(true);
  await started(0, 1); frame(400);
  expect(outputs[0]!.volume).toBeCloseTo(.1);
  view.rerender(createElement(Soundtrack, props('one', true, false)));
  frame(400);
  expect(outputs[0]!.volume).toBeCloseTo(.2);
  expect(outputs[0]!.muted).toBe(false);
  expect(outputs[0]!.play).toHaveBeenCalledTimes(2);
});

it('does not expire a deliberate pause or let a replaced handle make its successor ready', async () => {
  const view = render(createElement(Soundtrack, props('one')));
  view.rerender(createElement(Soundtrack, props('one', false)));
  await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
  expect(outputs[0]!.dispose).not.toHaveBeenCalled();
  view.rerender(createElement(Soundtrack, props('one')));
  view.rerender(createElement(Soundtrack, props('two')));
  view.rerender(createElement(Soundtrack, props('one')));
  await started(0, 1); frame(2000);
  expect(outputs[2]!.volume).toBe(0);
  expect(outputs[2]!.dispose).not.toHaveBeenCalled();
  await started(2); frame(400);
  expect(outputs[2]!.volume).toBeCloseTo(.1);
});

it('reinitializes active output ownership when the same track returns during its ending fade', async () => {
  const view = render(createElement(Soundtrack, props('one')));
  await started(0); frame(800);
  view.rerender(createElement(Soundtrack, props()));
  frame(200);
  view.rerender(createElement(Soundtrack, props('one', true, true)));
  expect(outputs).toHaveLength(2);
  expect(outputs[1]!.play).toHaveBeenCalledOnce();
  expect(outputs[1]!.muted).toBe(true);
  expect(audioRef.current).toBe(outputs[1]);
  await started(1); frame(400);
  expect(outputs[1]!.volume).toBeCloseTo(.1);
});

it('fades and releases outgoing music when the replacement fails', async () => {
  const view = render(createElement(Soundtrack, props('one')));
  await started(0); frame(800);
  view.rerender(createElement(Soundtrack, props('two')));
  await act(async () => { outputs[1]!.starts[0]!.reject(new Error('Track unavailable')); });
  frame(400);
  expect(outputs[0]!.volume).toBeCloseTo(.1);
  frame(400);
  expect(outputs[0]!.dispose).toHaveBeenCalledOnce();
  expect(outputs[1]!.volume).toBe(0);
});

it('bounds an unresolved start and ignores readiness arriving after that deadline', async () => {
  const view = render(createElement(Soundtrack, props('one')));
  await started(0); frame(800);
  view.rerender(createElement(Soundtrack, props('two')));
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  frame(800);
  expect(outputs[0]!.dispose).toHaveBeenCalledOnce();
  expect(outputs[1]!.dispose).toHaveBeenCalledOnce();
  await started(1); frame(800);
  expect(outputs[1]!.volume).toBe(0);
  expect(audioRef.current).toBeNull();
});

it('keeps the answer completion fade and releases every owned handle on unmount', async () => {
  const view = render(createElement(Soundtrack, props('one')));
  await started(0); frame(800);
  view.rerender(createElement(Soundtrack, props()));
  frame(400);
  expect(outputs[0]!.volume).toBeCloseTo(.1);
  frame(400);
  expect(outputs[0]!.dispose).toHaveBeenCalledOnce();
  expect(audioRef.current).toBeNull();
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
