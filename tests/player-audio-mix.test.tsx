// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { Soundtrack } from '../src/player/soundtrack';
import type { VideoAudio } from '../src/protocol/types';

const track = (id: string): VideoAudio => ({ trackId: id, audioUrl: `/${id}.mp3`, volume: .15, fadeOutMs: 2000, duration: 20, beatDetection: { sensitivity: .5 }, beatMarkers: [] });
let frame: (elapsed: number) => void;
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  const pending = new Map<number, FrameRequestCallback>();
  let id = 0, now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { pending.set(++id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (key: number) => pending.delete(key));
  frame = elapsed => act(() => { now += elapsed; const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(callback => callback(now)); });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const base = { audio: track('one'), playing: true, muted: false, volume: .2, ducked: false, waiting: false, time: 1, duration: 20, terminal: false, audioRef: { current: null as HTMLAudioElement | null } };

it('combines viewer gain, speech reduction and end fade through one output while looping', () => {
  const view = render(createElement(Soundtrack, base));
  frame(1000);
  const audio = view.container.querySelector('audio')!;
  expect(audio.volume).toBeCloseTo(.2, 2);
  expect(audio.loop).toBe(true);
  view.rerender(createElement(Soundtrack, { ...base, ducked: true }));
  frame(1000);
  expect(audio.volume).toBeCloseTo(.07, 2);
  view.rerender(createElement(Soundtrack, { ...base, ducked: true, terminal: true, time: 19 }));
  frame(1000);
  expect(audio.volume).toBeCloseTo(.035, 2);
  view.rerender(createElement(Soundtrack, { ...base, volume: 0, terminal: true, time: 19 }));
  frame(1000);
  expect(audio.volume).toBe(0);
});

it('crossfades explicit replacements, keeps playback independent, and stops both layers on pause/unmount', () => {
  const view = render(createElement(Soundtrack, base));
  frame(1000);
  const first = view.container.querySelector('audio')!;
  first.currentTime = 7;
  view.rerender(createElement(Soundtrack, { ...base, audio: track('two') }));
  frame(200);
  const all = view.container.querySelectorAll('audio');
  expect(all).toHaveLength(2);
  expect(first.currentTime).toBe(7);
  expect(all[0]!.volume + all[1]!.volume).toBeLessThanOrEqual(.201);
  expect(all[0]!.volume).toBeGreaterThan(0);
  expect(all[1]!.volume).toBeGreaterThan(0);
  view.rerender(createElement(Soundtrack, { ...base, audio: track('two'), playing: false, muted: true }));
  expect([...all].every(audio => audio.muted)).toBe(true);
  expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  view.unmount();
  expect(base.audioRef.current).toBeNull();
});

it('eases down on stalls without stopping the music clock and ignores an unavailable track', async () => {
  vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValue(new Error('Unavailable'));
  const view = render(createElement(Soundtrack, base));
  await act(async () => {});
  frame(1000);
  const audio = view.container.querySelector('audio')!;
  audio.currentTime = 4;
  view.rerender(createElement(Soundtrack, { ...base, waiting: true }));
  frame(1000);
  expect(audio.currentTime).toBe(4);
  expect(audio.volume).toBeCloseTo(.04, 2);
});

it('never exposes full-volume music on a fixed-gain mobile output before its audio graph unlocks', () => {
  vi.spyOn(HTMLMediaElement.prototype, 'volume', 'get').mockReturnValue(1);
  vi.spyOn(HTMLMediaElement.prototype, 'volume', 'set').mockImplementation(() => {});
  const view = render(createElement(Soundtrack, base));
  const audio = view.container.querySelector('audio')!;
  expect(audio.muted).toBe(true);
  frame(1000);
  expect(audio.muted).toBe(true);
});
