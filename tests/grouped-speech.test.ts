import { afterEach, describe, expect, it, vi } from "vitest";
import { createVideoChatVoice } from "../src/video-chat/voice.js";

describe("prepared paragraph audio", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  it.each([false, true])("resumes decoded audio at its offset through pauses and stalls (muted: %s)", async (muted) => {
    vi.useFakeTimers();
    vi.stubGlobal("AudioContext", class { decodeAudioData() { return Promise.resolve({ duration: 6 }); } });
    const seen: number[] = [];
    let audio!: { currentTime: number; muted?: boolean; pause: ReturnType<typeof vi.fn>; onended?: () => void };
    vi.stubGlobal("Audio", function () {
      audio = { currentTime: 0, pause: vi.fn() };
      return Object.assign(audio, { play: vi.fn(() => { seen.push(audio.currentTime); return Promise.resolve(); }) });
    });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:paragraph");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const voice = createVideoChatVoice({ fetcher: vi.fn(async () => new Response(new Uint8Array([1, 2]))) });
    expect(await voice.prepare("One. Two. Three.")).toEqual({ seconds: 6, supportsOffsets: true });
    const controller = new AbortController();
    const speaking = voice.speak("One. Two. Three.", { signal: controller.signal, offsetSeconds: 2 });
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual([2]);
    voice.pause();
    voice.setMuted(muted);
    voice.resume();
    expect(seen).toEqual([2, 2]);
    expect(audio.muted).toBe(muted);
    audio.currentTime = 2.25;
    voice.pause(); voice.resume();
    expect(seen).toEqual([2, 2, 2.25]);
    expect(voice.getCurrentTime?.()).toBe(2.25);
    controller.abort();
    await speaking;
    expect(audio.pause).toHaveBeenCalled();
    voice.dispose?.();
  });
  it("rejects unavailable speech for timed group playback", async () => {
    const voice = createVideoChatVoice({ fetcher: vi.fn(async () => new Response(null, { status: 204 })) });
    await expect(voice.speak("One. Two.", { signal: new AbortController().signal, offsetSeconds: 0 })).rejects.toThrow("seekable");
    voice.dispose?.();
  });
});
