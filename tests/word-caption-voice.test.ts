import { afterEach, describe, expect, it, vi } from "vitest";
import { createVideoChatVoice } from "../src/video-chat/voice";
import { createCaptionVoice } from "../src/video-chat/caption-progress";

const text = "Hello bright world.";
const wordTimings = [
  { text: "Hello", start: 0.2, end: 0.6 },
  { text: "bright", start: 0.8, end: 1.2 },
  { text: "world.", start: 1.4, end: 2 },
];

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("aligned generated speech", () => {
  function fixture(timings: unknown = wordTimings) {
    vi.stubGlobal("AudioContext", class { decodeAudioData() { return Promise.resolve({ duration: 2.2 }); } });
    const blobs: Blob[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation(blob => { blobs.push(blob as Blob); return "blob:aligned"; });
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const fetcher = vi.fn(async () => Response.json({ audio: "SUQz", mediaType: "audio/mpeg", wordTimings: timings }));
    return { voice: createVideoChatVoice({ fetcher }), fetcher, blobs, revoke };
  }

  it("decodes the audio envelope and caches words with their original audio", async () => {
    const f = fixture();
    const prepared = await f.voice.prepare(text);
    expect(prepared).toMatchObject({ seconds: 2.2, supportsOffsets: true, wordTimings });
    expect(new Uint8Array(await f.blobs[0]!.arrayBuffer())).toEqual(new Uint8Array([73, 68, 51]));
    expect(f.blobs[0]!.type).toBe("audio/mpeg");
    expect(await f.voice.prepare(text)).toEqual(prepared);
    expect(f.fetcher).toHaveBeenCalledOnce();
    f.voice.dispose?.();
    expect(f.revoke).toHaveBeenCalledExactlyOnceWith("blob:aligned");
  });

  it("keeps usable generated speech when its alignment does not match the narration", async () => {
    const f = fixture([{ text: "Unrelated", start: 0, end: 1 }]);
    expect(await f.voice.prepare(text)).toEqual({ seconds: 2.2, supportsOffsets: true });
    expect(new Uint8Array(await f.blobs[0]!.arrayBuffer())).toEqual(new Uint8Array([73, 68, 51]));
    f.voice.dispose?.();
  });

  it("restarts caption timing when audible generated speech falls back to a browser voice without boundaries", async () => {
    vi.useFakeTimers();
    const f = fixture();
    let utterance!: SpeechSynthesisUtterance;
    const element = { currentTime: 0, onplaying: null as (() => void) | null, onerror: null as (() => void) | null,
      play: async () => {}, pause: () => {}, removeAttribute: () => {}, load: () => {} };
    vi.stubGlobal("Audio", function () { return element; });
    vi.stubGlobal("SpeechSynthesisUtterance", class {});
    vi.stubGlobal("speechSynthesis", { speak: (value: SpeechSynthesisUtterance) => { utterance = value; }, cancel: vi.fn() });
    let now = 0;
    const captions = createCaptionVoice(f.voice, () => now);
    await captions.voice.prepare(text);
    const onStart = vi.fn();
    const speaking = captions.voice.speak(text, { signal: new AbortController().signal, onStart });
    await vi.advanceTimersByTimeAsync(0);
    element.currentTime = 1; element.onplaying?.();
    expect(captions.getCaptionProgress()).toMatchObject({ alignment: "provider", elapsedSeconds: 1 });
    element.onerror?.();
    await vi.advanceTimersByTimeAsync(0);
    now = 5000;
    utterance.onstart?.({} as SpeechSynthesisEvent);
    expect(captions.getCaptionProgress()).toMatchObject({ alignment: "estimated", elapsedSeconds: 0 });
    expect(captions.getCaptionProgress()?.wordTimings).toBeUndefined();
    expect(onStart).toHaveBeenCalledOnce();
    now = 5200;
    expect(captions.getCaptionProgress()?.elapsedSeconds).toBeCloseTo(.2);
    utterance.onend?.({} as SpeechSynthesisEvent);
    await speaking;
    f.voice.dispose?.();
  });

  it("falls back without allocating an audio URL for invalid audio envelopes", async () => {
    const allocate = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:invalid");
    for (const body of [
      { audio: "%%%", mediaType: "audio/mpeg" },
      { audio: "SUQz", mediaType: "text/html" },
      { audio: "", mediaType: "audio/mpeg" },
      { audio: "SUQz" },
    ]) {
      const fallback = vi.fn();
      const voice = createVideoChatVoice({ fetcher: async () => Response.json(body), onFallback: fallback });
      expect(await voice.prepare(text)).not.toHaveProperty("wordTimings");
      expect(fallback).toHaveBeenCalledOnce();
      voice.dispose?.();
    }
    expect(allocate).not.toHaveBeenCalled();
  });
});

it("observes native word boundaries only for the active, audible utterance", async () => {
  vi.useFakeTimers();
  let utterance!: SpeechSynthesisUtterance;
  vi.stubGlobal("SpeechSynthesisUtterance", class {});
  vi.stubGlobal("speechSynthesis", { speak: (value: SpeechSynthesisUtterance) => { utterance = value; }, cancel: vi.fn(), pause: vi.fn(), resume: vi.fn() });
  const voice = createVideoChatVoice({ fetcher: async () => new Response(null, { status: 204 }) });
  const onBoundary = vi.fn();
  const controller = new AbortController();
  const speaking = voice.speak(text, { signal: controller.signal, onBoundary });
  await vi.advanceTimersByTimeAsync(0);
  const boundary = (index: number, name = "word") => utterance.onboundary?.({ charIndex: index, name } as SpeechSynthesisEvent);
  boundary(0);
  expect(onBoundary).not.toHaveBeenCalled();
  utterance.onstart?.({} as SpeechSynthesisEvent);
  boundary(0);
  expect(onBoundary).toHaveBeenLastCalledWith(0);
  voice.pause(); boundary(6);
  expect(onBoundary).toHaveBeenCalledOnce();
  voice.resume(); boundary(6);
  expect(onBoundary).toHaveBeenLastCalledWith(6);
  boundary(12, "sentence"); boundary(-1); boundary(Infinity); boundary(text.length + 1);
  expect(onBoundary).toHaveBeenCalledTimes(2);
  const stale = utterance.onboundary;
  controller.abort(); await speaking;
  expect(utterance.onboundary).toBeNull();
  stale?.call(utterance, { charIndex: 13, name: "word" } as SpeechSynthesisEvent);
  expect(onBoundary).toHaveBeenCalledTimes(2);
  voice.dispose?.();
});
