import { afterEach, beforeEach, expect, it, vi } from "vitest";

const shared = vi.hoisted(() => ({ context: undefined as unknown as AudioContext, resume: vi.fn() }));
vi.mock("../src/player/ios-audio-output", () => ({
  isIosAudioOutput: () => true,
  getIosAudioContext: () => shared.context,
  resumeIosAudioContext: shared.resume,
}));

class Source {
  buffer: AudioBuffer | null = null;
  onended: (() => void) | null = null;
  playbackRate = { value: 1 };
  connect = vi.fn(); disconnect = vi.fn();
  start = vi.fn(); stop = vi.fn();
}
const decoded = (seconds = 6, length = seconds * 48000) => ({ duration: seconds, length, numberOfChannels: 1 }) as AudioBuffer;
let context: { currentTime: number; state: string; destination: object; decodeAudioData: ReturnType<typeof vi.fn>; createBufferSource: ReturnType<typeof vi.fn>; createGain: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; suspend: ReturnType<typeof vi.fn> };
let sources: Source[];
let gains: Array<{ gain: { value: number; cancelScheduledValues: ReturnType<typeof vi.fn>; setValueAtTime: ReturnType<typeof vi.fn>; setTargetAtTime: ReturnType<typeof vi.fn> }; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }>;
let voices: Array<ReturnType<typeof import("../src/video-chat/voice").createVideoChatVoice>>;
let nativeAudio: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers(); vi.resetModules();
  sources = []; gains = []; voices = [];
  context = {
    currentTime: 0, state: "running", destination: {},
    decodeAudioData: vi.fn(async () => decoded()),
    createBufferSource: vi.fn(() => { const source = new Source(); sources.push(source); return source; }),
    createGain: vi.fn(() => {
      const parameter = { value: 1, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn((value: number) => { parameter.value = value; }), setTargetAtTime: vi.fn((value: number) => { parameter.value = value; }) };
      const gain = { gain: parameter, connect: vi.fn(), disconnect: vi.fn() }; gains.push(gain); return gain;
    }),
    close: vi.fn(async () => {}), suspend: vi.fn(async () => {}),
  };
  shared.context = context as unknown as AudioContext;
  shared.resume.mockReset().mockResolvedValue(shared.context);
  vi.stubGlobal("navigator", { userActivation: { isActive: true } });
  vi.stubGlobal("AudioContext", function () { return context; });
  nativeAudio = vi.fn(function () { return { src: "", currentTime: 0, volume: 1, play: vi.fn(async () => {}), pause: vi.fn(), removeAttribute: vi.fn(), load: vi.fn() }; });
  vi.stubGlobal("Audio", nativeAudio);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:voice");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(() => { voices.forEach(voice => voice.dispose?.()); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function fixture(options: Parameters<typeof import("../src/video-chat/voice").createVideoChatVoice>[0] = {}) {
  const { createVideoChatVoice } = await import("../src/video-chat/voice");
  const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
  const voice = createVideoChatVoice({ fetcher, ...options }); voices.push(voice);
  return { voice, fetcher };
}

it("decodes once, reuses the buffer for each line playback, and never creates an iOS audio media element", async () => {
  const { voice, fetcher } = await fixture();
  voice.resume();
  expect(nativeAudio).not.toHaveBeenCalled();
  expect(await voice.prepare("The complete line.")).toMatchObject({ seconds: 6, supportsOffsets: true });
  const start = vi.fn();
  const task = voice.speak("The complete line.", { signal: new AbortController().signal, onStart: start });
  await vi.advanceTimersByTimeAsync(0);
  expect(sources).toHaveLength(1);
  expect(start).not.toHaveBeenCalled();
  context.currentTime = .05; await vi.advanceTimersByTimeAsync(20);
  expect(start).toHaveBeenCalledExactlyOnceWith("generated");
  expect(voice.getCurrentTime?.()).toBeCloseTo(.05);
  context.currentTime = 6; sources[0]!.onended?.(); await task;
  expect(voice.getCurrentTime?.()).toBeUndefined();
  const again = voice.speak("The complete line.", { signal: new AbortController().signal });
  await vi.advanceTimersByTimeAsync(0);
  expect(sources[1]!.buffer).toBe(sources[0]!.buffer);
  sources[1]!.onended?.(); await again;
  expect(fetcher).toHaveBeenCalledOnce();
  expect(context.decodeAudioData).toHaveBeenCalledOnce();
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(nativeAudio).not.toHaveBeenCalled();
});

it("freezes on pause, resumes at the same offset, ignores stale ended, and leaves shared music running", async () => {
  const { voice } = await fixture();
  const started = vi.fn(), finished = vi.fn();
  const task = Promise.resolve(voice.speak("Keep every word.", { signal: new AbortController().signal, onStart: started })).then(finished);
  await vi.advanceTimersByTimeAsync(0);
  context.currentTime = .1; await vi.advanceTimersByTimeAsync(20);
  const oldEnded = sources[0]!.onended!;
  context.currentTime = 2.2; voice.pause();
  expect(sources[0]!.stop).toHaveBeenCalledOnce();
  context.currentTime = 20;
  expect(voice.getCurrentTime?.()).toBeCloseTo(2.2);
  await vi.advanceTimersByTimeAsync(20000);
  expect(finished).not.toHaveBeenCalled();
  voice.resume(); await vi.advanceTimersByTimeAsync(0);
  expect(sources[1]!.start).toHaveBeenCalledWith(0, 2.2);
  oldEnded();
  expect(finished).not.toHaveBeenCalled();
  context.currentTime = 21;
  expect(voice.getCurrentTime?.()).toBeCloseTo(3.2);
  sources[1]!.onended?.(); await task;
  expect(started).toHaveBeenCalledOnce();
  voice.dispose?.();
  expect(context.close).not.toHaveBeenCalled();
  expect(context.suspend).not.toHaveBeenCalled();
});

it("keeps zero-volume and master-muted buffers on their clock without canceling or restarting speech", async () => {
  const { voice } = await fixture();
  voice.setVolume?.(0);
  const start = vi.fn();
  const task = voice.speak("Keep timing.", { signal: new AbortController().signal, onStart: start });
  await vi.advanceTimersByTimeAsync(0);
  expect(gains[0]!.gain.value).toBe(0);
  context.currentTime = .1; await vi.advanceTimersByTimeAsync(20);
  expect(start).toHaveBeenCalledOnce();
  voice.setVolume?.(.6);
  expect(gains[0]!.gain.value).toBe(.6);
  voice.setMuted(true); context.currentTime = 2;
  expect(gains[0]!.gain.value).toBe(0);
  expect(voice.getCurrentTime?.()).toBe(2);
  expect(sources[0]!.stop).not.toHaveBeenCalled();
  voice.setMuted(false);
  expect(gains[0]!.gain.value).toBe(.6);
  expect(sources).toHaveLength(1);
  sources[0]!.onended?.(); await task;
});

it("supports measured group offsets and aborts only the active source", async () => {
  const { voice } = await fixture();
  const controller = new AbortController();
  const task = voice.speak("A grouped line.", { signal: controller.signal, offsetSeconds: 3 });
  await vi.advanceTimersByTimeAsync(0);
  expect(sources[0]!.start).toHaveBeenCalledWith(0, 3);
  context.currentTime = .5;
  expect(voice.getCurrentTime?.()).toBe(3.5);
  controller.abort(); await task;
  expect(sources[0]!.stop).toHaveBeenCalledOnce();
  expect(gains[0]!.disconnect).toHaveBeenCalled();
  expect(voice.getCurrentTime?.()).toBeUndefined();
  await expect(voice.speak("A grouped line.", { signal: new AbortController().signal, offsetSeconds: 6 })).rejects.toThrow(/measured, seekable/);
  expect(context.close).not.toHaveBeenCalled();
});

it("bounds decoded cache memory while retaining one larger current line", async () => {
  context.decodeAudioData.mockResolvedValue(decoded(6, 9 * 1024 * 1024));
  const { voice, fetcher } = await fixture();
  await voice.prepare("One large line.");
  await voice.prepare("One large line.");
  expect(fetcher).toHaveBeenCalledOnce();
  await voice.prepare("Another large line.");
  await voice.prepare("One large line.");
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it("can evict queued PCM without stopping the current decoded line", async () => {
  context.decodeAudioData.mockImplementation(async () => decoded(6, 5 * 1024 * 1024));
  const { voice, fetcher } = await fixture();
  const task = voice.speak("Playing line.", { signal: new AbortController().signal });
  await vi.advanceTimersByTimeAsync(0);
  const activeBuffer = sources[0]!.buffer;
  await voice.prepare("Upcoming line.");
  expect(sources[0]!.buffer).toBe(activeBuffer);
  expect(sources[0]!.stop).not.toHaveBeenCalled();
  sources[0]!.onended?.(); await task;
  await voice.prepare("Playing line.");
  expect(fetcher).toHaveBeenCalledTimes(3);
});

function browserSpeech() {
  let utterance!: SpeechSynthesisUtterance;
  vi.stubGlobal("SpeechSynthesisUtterance", class {});
  vi.stubGlobal("speechSynthesis", { speak: vi.fn((value: SpeechSynthesisUtterance) => { utterance = value; }), cancel: vi.fn(), pause: vi.fn(), resume: vi.fn() });
  return () => utterance;
}

it("falls back to browser speech when a decoded source cannot start", async () => {
  const utterance = browserSpeech();
  context.createBufferSource.mockImplementationOnce(() => { throw new Error("Output unavailable"); });
  const fallback = vi.fn(), start = vi.fn();
  const { voice, fetcher } = await fixture({ onFallback: fallback });
  const task = voice.speak("Continue this line.", { signal: new AbortController().signal, onStart: start });
  await vi.advanceTimersByTimeAsync(0);
  expect(fallback).toHaveBeenCalledOnce();
  expect(gains[0]!.disconnect).toHaveBeenCalledOnce();
  expect(start).not.toHaveBeenCalled();
  utterance().onstart?.({} as SpeechSynthesisEvent);
  expect(start).toHaveBeenCalledExactlyOnceWith("browser");
  utterance().onend?.({} as SpeechSynthesisEvent);
  await task;
  expect(fetcher).toHaveBeenCalledOnce();
  expect(nativeAudio).not.toHaveBeenCalled();
});

it("never treats failed decoding or oversized encoded audio as measured speech", async () => {
  context.decodeAudioData.mockRejectedValueOnce(new Error("Invalid audio"));
  const fallback = vi.fn();
  const { voice } = await fixture({ onFallback: fallback });
  expect(await voice.prepare("Invalid recording.")).not.toHaveProperty("supportsOffsets");
  expect(fallback).toHaveBeenCalledOnce();
  const oversized = await fixture({ fetcher: async () => new Response(new Uint8Array(1024 * 1024 + 1)) });
  expect(await oversized.voice.prepare("Oversized recording.")).not.toHaveProperty("supportsOffsets");
  expect(context.decodeAudioData).toHaveBeenCalledOnce();
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});

it("bounds a locked output with the speech watchdog and ignores its late resume", async () => {
  context.state = "suspended";
  let resume!: (value: AudioContext) => void;
  shared.resume.mockReturnValue(new Promise<AudioContext>(resolve => { resume = resolve; }));
  const { voice } = await fixture();
  const start = vi.fn();
  const task = voice.speak("A locked line.", { signal: new AbortController().signal, offsetSeconds: 1, onStart: start });
  const rejected = expect(task).rejects.toThrow("Grouped narration playback failed");
  await vi.advanceTimersByTimeAsync(17_000);
  await rejected;
  expect(start).not.toHaveBeenCalled();
  expect(voice.getCurrentTime?.()).toBeUndefined();
  context.state = "running"; resume(shared.context);
  await vi.advanceTimersByTimeAsync(0);
  expect(sources).toHaveLength(0);
  expect(gains[0]!.disconnect).toHaveBeenCalledOnce();
  expect(context.close).not.toHaveBeenCalled();
});

it("disposes a pending resume without starting or closing shared audio later", async () => {
  context.state = "suspended";
  let resume!: (value: AudioContext) => void;
  shared.resume.mockReturnValue(new Promise<AudioContext>(resolve => { resume = resolve; }));
  const { voice } = await fixture();
  const task = voice.speak("Canceled before onset.", { signal: new AbortController().signal });
  await vi.advanceTimersByTimeAsync(0);
  voice.dispose?.(); await task;
  context.state = "running"; resume(shared.context);
  await vi.advanceTimersByTimeAsync(0);
  expect(sources).toHaveLength(0);
  expect(gains[0]!.disconnect).toHaveBeenCalledOnce();
  expect(context.close).not.toHaveBeenCalled();
  expect(context.suspend).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("does not let an old resume rejection cancel a replacement line", async () => {
  const fallback = vi.fn();
  browserSpeech();
  const { voice } = await fixture({ onFallback: fallback });
  const firstController = new AbortController();
  const first = voice.speak("First line.", { signal: firstController.signal });
  await vi.advanceTimersByTimeAsync(0);
  voice.pause();
  let reject!: (reason: Error) => void;
  shared.resume.mockReturnValueOnce(new Promise<AudioContext>((_, fail) => { reject = fail; }));
  voice.resume(); firstController.abort(); await first;
  const second = voice.speak("Replacement line.", { signal: new AbortController().signal });
  await vi.advanceTimersByTimeAsync(0);
  reject(new Error("Old resume failed"));
  await vi.advanceTimersByTimeAsync(0);
  expect(sources[1]!.stop).not.toHaveBeenCalled();
  expect(fallback).not.toHaveBeenCalled();
  sources[1]!.onended?.(); await second;
});

it("retains exact validated word timing against the reused decoded audio", async () => {
  const wordTimings = [{ text: "Aligned", start: .1, end: .7 }, { text: "words.", start: .8, end: 1.4 }];
  const { voice } = await fixture({ fetcher: async () => Response.json({ audio: "SUQz", mediaType: "audio/mpeg", wordTimings }) });
  expect(await voice.prepare("Aligned words.")).toEqual({ seconds: 6, supportsOffsets: true, wordTimings });
  const task = voice.speak("Aligned words.", { signal: new AbortController().signal });
  await vi.advanceTimersByTimeAsync(0);
  context.currentTime = .9;
  expect(voice.getCurrentTime?.()).toBe(.9);
  sources[0]!.onended?.(); await task;
  expect(context.decodeAudioData).toHaveBeenCalledOnce();
});
