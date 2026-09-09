import { afterEach, expect, it, vi } from 'vitest';
import { createVideoChatVoice } from '../src/video-chat/voice';
import { createCaptionVoice } from '../src/video-chat/caption-progress';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('keeps zero-volume generated narration on its measured clock while user gain changes', async () => {
  vi.useFakeTimers();
  const element = { src: '', volume: 1, muted: false, currentTime: 0, onplaying: null as (() => void) | null,
    onended: null as (() => void) | null, play: vi.fn(async () => {}), pause: vi.fn(), removeAttribute: vi.fn(), load: vi.fn() };
  vi.stubGlobal('Audio', function () { return element; });
  vi.stubGlobal('AudioContext', class { decodeAudioData() { return Promise.resolve({ duration: 6 }); } });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:voice');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const start = vi.fn();
  const voice = createVideoChatVoice({ fetcher: async () => new Response(new Uint8Array([1, 2])) });
  const captioned = createCaptionVoice(voice);
  captioned.voice.setVolume!(0);
  await captioned.voice.prepare('A complete spoken line.');
  const task = captioned.voice.speak('A complete spoken line.', { signal: new AbortController().signal, onStart: start });
  await vi.advanceTimersByTimeAsync(0);
  expect(element.volume).toBe(0);
  element.currentTime = .1; element.onplaying?.();
  expect(start).toHaveBeenCalledWith('generated');
  expect(element.muted).toBe(true);
  element.currentTime = 2;
  expect(captioned.getCaptionProgress()).toMatchObject({ elapsedSeconds: 2, timing: 'audio' });
  captioned.voice.setVolume!(.5);
  await vi.advanceTimersByTimeAsync(400);
  expect(element.volume).toBeCloseTo(.5, 2);
  captioned.voice.setVolume!(.25);
  expect(element.volume).toBeCloseTo(.5, 2);
  await vi.advanceTimersByTimeAsync(400);
  expect(element.volume).toBeCloseTo(.25, 2);
  expect(element.muted).toBe(false);
  voice.pause(); expect(element.pause).toHaveBeenCalledOnce();
  voice.resume(); expect(element.play).toHaveBeenCalledTimes(2);
  expect(captioned.getCaptionProgress()).toMatchObject({ elapsedSeconds: 2, timing: 'audio' });
  expect(start).toHaveBeenCalledOnce();
  element.onended?.(); await task;
  voice.dispose?.();
});

it('keeps browser gain fixed for each utterance and applies user changes to the next line', async () => {
  vi.useFakeTimers();
  let utterance!: { volume: number; onstart?: () => void; onend?: () => void };
  const synthesis = { speak: vi.fn(value => { utterance = value; }), cancel: vi.fn(), pause: vi.fn(), resume: vi.fn() };
  vi.stubGlobal('speechSynthesis', synthesis);
  vi.stubGlobal('SpeechSynthesisUtterance', class { volume = 1; });
  const voice = createVideoChatVoice({ fetcher: async () => new Response(null, { status: 204 }) });
  const started = vi.fn();
  const task = voice.speak('Keep every word.', { signal: new AbortController().signal, onStart: started });
  await vi.advanceTimersByTimeAsync(0);
  expect(utterance.volume).toBe(1);
  utterance.onstart?.();
  voice.setVolume!(0);
  expect(utterance.volume).toBe(1);
  voice.pause(); expect(synthesis.pause).toHaveBeenCalledOnce();
  voice.resume(); expect(synthesis.resume).toHaveBeenCalledOnce();
  expect(synthesis.speak).toHaveBeenCalledTimes(1);
  expect(synthesis.cancel).not.toHaveBeenCalled();
  utterance.onend?.(); await task;

  const silentLine = voice.speak('The next complete line.', { signal: new AbortController().signal, onStart: started });
  await vi.advanceTimersByTimeAsync(0);
  expect(utterance.volume).toBe(0);
  utterance.onstart?.();
  expect(started.mock.calls).toEqual([['browser'], ['browser']]);
  voice.setVolume!(.4);
  expect(utterance.volume).toBe(0);
  expect(synthesis.speak).toHaveBeenCalledTimes(2);
  expect(synthesis.cancel).not.toHaveBeenCalled();
  utterance.onend?.(); await silentLine;

  const quieterLine = voice.speak('A quieter next line.', { signal: new AbortController().signal, onStart: started });
  await vi.advanceTimersByTimeAsync(0);
  expect(utterance.volume).toBe(.4);
  utterance.onstart?.();
  expect(started).toHaveBeenCalledTimes(3);
  utterance.onend?.(); await quieterLine;
  voice.dispose?.();
});

it.each([false, true])('uses a generated-speech gain graph only when native volume is fixed (%s)', async fixed => {
  vi.useFakeTimers();
  const element = { src: '', volume: 1, currentTime: 0, muted: false, play: vi.fn(async () => {}), pause: vi.fn(), removeAttribute: vi.fn(), load: vi.fn() };
  if (fixed) Object.defineProperty(element, 'volume', { get: () => 1, set: () => {} });
  vi.stubGlobal('Audio', function () { return element; });
  vi.stubGlobal('navigator', { userActivation: { isActive: true } });
  const source = { connect: vi.fn(), disconnect: vi.fn() };
  const gain = { gain: { cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), setTargetAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() };
  const connect = vi.fn(() => source);
  vi.stubGlobal('AudioContext', class {
    state = 'running'; currentTime = 0; destination = {};
    resume = vi.fn(async () => {}); close = vi.fn(async () => {});
    createMediaElementSource = connect;
    createGain = () => gain;
  });
  const voice = createVideoChatVoice({ fetcher: async () => new Response(null, { status: 204 }) });
  voice.resume();
  await vi.advanceTimersByTimeAsync(0);
  voice.setVolume!(.4);
  await vi.advanceTimersByTimeAsync(200);
  expect(connect).toHaveBeenCalledTimes(fixed ? 1 : 0);
  if (fixed) expect(gain.gain.setValueAtTime).toHaveBeenLastCalledWith(.4, 0);
  else expect(element.volume).toBeCloseTo(.4, 2);
  voice.dispose?.();
});
