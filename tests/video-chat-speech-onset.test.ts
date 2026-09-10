import { afterEach, describe, expect, it, vi } from "vitest";
import { createVideoChatVoice } from "../src/video-chat/voice";

interface Playback {
  currentTime?: number;
  onplaying?: (() => void) | null;
  onended?: (() => void) | null;
  onerror?: (() => void) | null;
}

describe("video chat speech onset", () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  function fixture() {
    vi.useFakeTimers();
    let playback: Playback;
    vi.stubGlobal("Audio", function () {
      const element = { currentTime: 0, onplaying: null, play: () => Promise.resolve(), pause: () => undefined };
      playback = element;
      return element;
    });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:speech");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const voice = createVideoChatVoice({ fetcher: vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))) });
    return { voice, playback: () => playback, start: () => { playback.currentTime = 0.05; playback.onplaying?.(); },
      end: () => playback.onended?.(), captureStart: () => playback.onplaying };
  }

  it.each([0, 2])("waits for the media clock after early playing at offset %s", async (offsetSeconds) => {
    const { voice, playback, end } = fixture();
    vi.stubGlobal("AudioContext", class { decodeAudioData() { return Promise.resolve({ duration: 6 }); } });
    const onStart = vi.fn();
    const controller = new AbortController();
    const speaking = voice.speak("A useful answer.", { signal: controller.signal, onStart, offsetSeconds });
    await vi.advanceTimersByTimeAsync(0);
    playback().onplaying?.();
    playback().currentTime = offsetSeconds + 0.004;
    await vi.advanceTimersByTimeAsync(1500);
    expect(onStart).not.toHaveBeenCalled();
    playback().currentTime = offsetSeconds + 0.05;
    await vi.advanceTimersByTimeAsync(16);
    expect(onStart).toHaveBeenCalledExactlyOnceWith("generated");
    end();
    await speaking;
    voice.dispose?.();
  });

  it("reports generated speech only on actual playback, once per call", async () => {
    const { voice, start, end, captureStart } = fixture();
    const onStart = vi.fn();
    const speaking = voice.speak("A useful answer.", { signal: new AbortController().signal, onStart });
    await vi.advanceTimersByTimeAsync(0);
    expect(onStart).not.toHaveBeenCalled();
    voice.pause();
    start();
    expect(onStart).not.toHaveBeenCalled();
    voice.resume();
    start();
    start();
    expect(onStart).toHaveBeenCalledExactlyOnceWith("generated");
    const lateStart = captureStart();
    end();
    await speaking;
    lateStart?.();
    expect(onStart).toHaveBeenCalledOnce();
    voice.dispose?.();
  });

  it("suppresses stale generated onset after mute, cancellation, or disposal", async () => {
    for (const action of ["mute", "cancel", "dispose"] as const) {
      const { voice, start, end, captureStart } = fixture();
      const onStart = vi.fn();
      const controller = new AbortController();
      const speaking = voice.speak("A useful answer.", { signal: controller.signal, onStart });
      await vi.advanceTimersByTimeAsync(0);
      const lateStart = captureStart();
      if (action === "mute") voice.setMuted(true);
      else if (action === "cancel") controller.abort();
      else voice.dispose?.();
      start();
      lateStart?.();
      expect(onStart).not.toHaveBeenCalled();
      end();
      await speaking;
      voice.dispose?.();
    }
  });

  it.each([false, true])("never reports browser onset when generated playback fails (already started: %s)", async (alreadyStarted) => {
    const { voice, playback, start } = fixture();
    const onStart = vi.fn();
    const speaking = voice.speak("A useful answer.", { signal: new AbortController().signal, onStart });
    await vi.advanceTimersByTimeAsync(0);
    if (alreadyStarted) start();
    playback().onerror?.();
    await vi.advanceTimersByTimeAsync(0);
    await speaking;
    expect(onStart.mock.calls).toEqual(alreadyStarted ? [["generated"]] : []);
    voice.dispose?.();
  });

  it.each(["throw", "reject"])("isolates observers that %s", async (failure) => {
    const { voice, start, end } = fixture();
    const onStart = vi.fn(() => {
      if (failure === "throw") throw new Error("observer failed");
      return Promise.reject(new Error("observer failed"));
    });
    const speaking = voice.speak("A useful answer.", { signal: new AbortController().signal, onStart });
    await vi.advanceTimersByTimeAsync(0);
    expect(() => start()).not.toThrow();
    end();
    await speaking;
    expect(onStart).toHaveBeenCalledOnce();
    voice.dispose?.();
  });
});
