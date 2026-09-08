// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { createScenePreparation } from "../src/video-chat/scene-preparation";

it("prepares announced media before ordered scenes arrive, without trusting it as playable data", async () => {
  const controller = new AbortController();
  const voice = { prepare: vi.fn(async () => ({ seconds: 2 })), speak: vi.fn(), pause: vi.fn(), resume: vi.fn(), setMuted: vi.fn(), dispose: vi.fn() };
  const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());
  const prepare = createScenePreparation({ voice: () => voice, customVoice: true, signal: controller.signal,
    onVoiceUnavailable: vi.fn(), warn: vi.fn() });
  try {
    prepare.announce({ sceneId: "later", narration: "A later line.", media: { url: "javascript:alert(1)", type: "video" } });
    prepare.announce({ sceneId: "later", narration: "A later line.", clipDurationSec: 5,
      media: { url: "https://media.example/later.mp4", type: "video", durationSec: 5 } });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledWith("https://media.example/later.mp4", expect.any(Object)));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(voice.prepare).toHaveBeenCalledTimes(1);
    expect(document.querySelector("video")).toBeNull();
    controller.abort();
    prepare.announce({ sceneId: "cancelled", narration: "Must not prepare.", media: { url: "https://media.example/cancelled.mp4", type: "video" } });
    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally { controller.abort(); fetcher.mockRestore(); }
});
