import { chatShot, streamChatShots } from "./helpers/chat-shot-fixture";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createVideoChatHandler } from "../src/server/create-video-chat-handler";
import { decodeVideoSse } from "../src/protocol/sse";
import type { ResolvedMedia } from "../src/server/media-resolver";

const media = { url: "https://media.example/stock.mp4", type: "video" as const };
const request = () => new Request("https://app.example/api/video-chat?action=response", {
  method: "POST",
  body: JSON.stringify({ prompt: "Explain ocean currents", mode: "cinematic" }),
});
function streamText() {
  return streamChatShots([chatShot("ocean currents", "Warm currents move heat across the ocean."), chatShot("ocean currents", "That transport changes the climate along distant coasts.")]);
}

describe("video chat optional provider recovery", () => {
  it.each(["rejection", "abort", "timeout", "empty", "invalid"])("uses stock and preserves scenes after generated video %s", async (failure) => {
    const searchMedia = vi.fn(async () => media);
    const handler = createVideoChatHandler({
      authorize: "none", heartbeatMs: false, streamText,
      generateText: async () => "unused",
      generateVideo: async () => {
        if (failure === "empty") return null;
        if (failure === "invalid") return { url: "javascript:private-provider-detail", type: "video" };
        throw failure === "abort" || failure === "timeout"
          ? new DOMException("private-provider-detail", failure === "abort" ? "AbortError" : "TimeoutError")
          : new Error("private-provider-detail");
      },
      searchMedia,
    });
    const response = await handler(request());
    const events = [];
    for await (const event of decodeVideoSse(response.body!)) events.push(event);
    expect(searchMedia).toHaveBeenCalledTimes(2);
    expect(events.filter((event) => event.type === "scene.add").map((event) => event.data.scene.variables.mediaUrl)).toEqual([media.url, media.url]);
    expect(events.at(-1)?.type).toBe("response.complete");
    expect(events.some((event) => event.type === "response.warning")).toBe(true);
    expect(JSON.stringify(events)).not.toContain("private-provider-detail");
  });

  it("preserves narration with unavailable visuals when both media providers fail", async () => {
    const handler = createVideoChatHandler({
      authorize: "none", heartbeatMs: false, streamText,
      generateText: async () => "unused",
      generateVideo: async () => { throw new Error("private-ai-detail"); },
      searchMedia: async () => { throw new Error("private-stock-detail"); },
    });
    const response = await handler(request());
    const events = [];
    for await (const event of decodeVideoSse(response.body!)) events.push(event);
    expect(events.filter((event) => event.type === "scene.add").map((event) => event.data.scene.templateId)).toEqual(["cinemaMedia", "cinemaMedia"]);
    expect(events.at(-1)?.type).toBe("response.complete");
    expect(events.some((event) => event.type === "response.warning")).toBe(true);
    expect(JSON.stringify(events)).not.toMatch(/private-ai-detail|private-stock-detail/);
  });

  it("keeps valid generated footage without calling stock", async () => {
    const searchMedia = vi.fn(async () => media);
    const handler = createVideoChatHandler({
      authorize: "none", heartbeatMs: false, streamText,
      generateText: async () => "unused", generateVideo: async () => media, searchMedia,
    });
    await (await handler(request())).text();
    expect(searchMedia).not.toHaveBeenCalled();
  });

  it("does not invoke stock after request cancellation", async () => {
    const controller = new AbortController();
    const searchMedia = vi.fn(async () => media);
    const handler = createVideoChatHandler({
      authorize: "none", heartbeatMs: false, streamText,
      generateText: async () => "unused",
      generateVideo: async (): Promise<ResolvedMedia> => {
        controller.abort();
        throw new DOMException("cancelled", "AbortError");
      }, searchMedia,
    });
    const response = await handler(new Request(request(), { signal: controller.signal }));
    await response.text();
    expect(searchMedia).not.toHaveBeenCalled();
  });
});


describe("video chat provider deadlines", () => {
  afterEach(() => vi.useRealTimers());

  it("finishes with stock when generated footage ignores cancellation, and ignores late footage", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const late: Array<(value: ResolvedMedia) => void> = [];
    const searchMedia = vi.fn(async () => media);
    const handler = createVideoChatHandler({
      authorize: "none", heartbeatMs: false, streamText,
      generateText: async () => "unused", searchMedia,
      generateVideo: (_query, context) => {
        signals.push(context.signal);
        return new Promise((resolve) => late.push(resolve));
      },
    });
    let completed = false;
    const result = handler(request()).then((response) => response.text()).then((text) => { completed = true; return text; });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(completed).toBe(true);
    const text = await result;
    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(searchMedia).toHaveBeenCalledTimes(2);
    expect(text).toContain("response.complete");
    expect(text).toContain(media.url);
    for (const resolve of late) resolve({ url: "https://media.example/late.mp4", type: "video" });
    await vi.advanceTimersByTimeAsync(0);
    expect(text).not.toContain("late.mp4");
  });

  it("finishes safe scenes when stock also ignores its signal", async () => {
    vi.useFakeTimers();
    const handler = createVideoChatHandler({
      authorize: "none", heartbeatMs: false, streamText,
      generateText: async () => "unused", generateVideo: async () => null,
      searchMedia: () => new Promise(() => {}),
    });
    let completed = false;
    const result = handler(request()).then((response) => response.text()).then((text) => { completed = true; return text; });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(completed).toBe(true);
    expect(await result).toContain('"templateId":"cinemaMedia"');
  });

  it.each(["welcome", "opening-media", "suggestions"])("bounds ignored media cancellation for %s", async (action) => {
    vi.useFakeTimers();
    const handler = createVideoChatHandler({
      authorize: "none", streamText, generateText: async () => JSON.stringify({ suggestions: [{ prompt: "What next?", keyword: "ocean" }] }),
      welcome: { heroQuery: "ocean" },
      searchMedia: () => new Promise(() => {}),
    });
    let completed = false;
    const result = handler(new Request(`https://app.example/api/video-chat?action=${action}`, action === "welcome" ? {} : {
      method: "POST", body: JSON.stringify(action === "opening-media" ? { keyword: "ocean" } : { prompt: "Ocean", lines: [] }),
    })).then((response) => response.json()).then((body) => { completed = true; return body; });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(completed).toBe(true);
    expect(JSON.stringify(await result)).not.toContain("https://");
  });

  it.each(["suggestions", "speech"])("bounds an ignoring optional %s generator", async (action) => {
    vi.useFakeTimers();
    const handler = createVideoChatHandler({
      authorize: "none", streamText,
      generateText: () => new Promise(() => {}),
      generateSpeech: () => new Promise(() => {}),
    });
    let completed = false;
    const result = handler(new Request(`https://app.example/api/video-chat?action=${action}`, {
      method: "POST", body: JSON.stringify(action === "speech" ? { text: "Ocean currents" } : { prompt: "Ocean", lines: [] }),
    })).then((response) => response.json()).then((body) => { completed = true; return body; });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(completed).toBe(true);
    expect(await result).toEqual(action === "suggestions" ? { suggestions: [] } : {
      error: { code: "speech_failed", message: "Speech could not be generated" },
    });
  });

});
