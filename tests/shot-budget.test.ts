import { afterEach, describe, expect, it, vi } from "vitest";
import { createVideoChatHandler } from "../src/server/create-video-chat-handler";
import { decodeVideoSse } from "../src/protocol/sse";
import { prepareNarratedScene } from "../src/player/scene-readiness";
import { narrationFitsClip } from "../src/protocol/clip-budget";

const oversized = "This explanation needs considerably more time than the short clip allows, especially because the result only applies under these specific conditions.";
const ending = { narration: "Conditions still matter.", title: "Conditions", subject: "ocean waves", action: "Show the shore", durationSec: 5 };
const brief = { type: "answer", opening: "Watch the shore.", subject: "ocean", visualDirection: "Soft light", development: "Conditions matter", ending };
function setup(rewrite: string) {
  const generation = vi.fn<NonNullable<Parameters<typeof createVideoChatHandler>[0]["generateVideo"]>>(() => ({ type: "video" as const, url: "https://app.test/clip.mp4", durationSec: 5 }));
  const text = vi.fn(() => rewrite);
  const handler = createVideoChatHandler({ authorize: "none", heartbeatMs: false,
    generateText: text, generateVideo: generation,
    streamText: async function* () {
      yield JSON.stringify(brief) + "\n";
      yield JSON.stringify({ type: "shot", ...ending, narration: oversized }) + "\n";
    },
  });
  return { handler, generation, text };
}
const request = () => new Request("https://app.test/video?action=response", { method: "POST", body: JSON.stringify({ prompt: "Explain the shore" }) });
async function collect(response: Response) {
  const events = []; for await (const event of decodeVideoSse(response.body!)) events.push(event); return events;
}
describe("clip budget before paid generation", () => {
  afterEach(() => vi.useRealTimers());
  it("preserves a two-second requested budget through streaming when actual duration is unknown", async () => {
    const handler = createVideoChatHandler({ authorize: "none", heartbeatMs: false, generatedClipDurationSec: 2,
      generateText: () => "", generateVideo: () => ({ type: "video", url: "https://app.test/short.mp4" }),
      streamText: async function* () { yield JSON.stringify({ ...brief, development: "", ending: { ...ending, narration: "Waves rise." } }) + "\n"; },
    });
    const events = await collect(await handler(request()));
    const scene = events.find(e => e.type === "scene.add")?.data.scene;
    expect(scene?.timing.fixedDuration).toBe(2);
    expect(prepareNarratedScene(scene!, 1).scene.timing.fixedDuration).toBe(2);
  });
  it.each([20, undefined])("retains every long stock beat with reported duration %s", async durationSec => {
    const lines = ["First", "Second", "Third", "Final"].map(label => `${label}, ${oversized}`);
    const handler = createVideoChatHandler({ authorize: "none", heartbeatMs: false, generatedClipDurationSec: 2,
      generateText: () => "",
      searchMedia: () => ({ type: "video", url: "https://app.test/stock.mp4", ...(durationSec ? { durationSec } : {}) }),
      streamText: async function* () {
        yield JSON.stringify({ ...brief, ending: { ...ending, narration: lines.at(-1) } }) + "\n";
        for (const narration of lines.slice(0, -1)) yield JSON.stringify({ type: "shot", ...ending, narration }) + "\n";
      },
    });
    const events = await collect(await handler(new Request("https://app.test/video?action=response", { method: "POST", body: JSON.stringify({ prompt: "Explain waves", mode: "pexels" }) })));
    const scenes = events.filter(e => e.type === "scene.add").map(e => e.data.scene);
    expect(scenes.map(s => s.narration)).toEqual(lines);
    // Unknown stock duration is checked on the mounted decoder, not against an AI vendor's request budget.
    expect(scenes.map(s => prepareNarratedScene(s, 11).recovered)).toEqual([false, false, false, false]);
  });
  it("stock lookup deadlines do not inherit a video adapter's timeout", async () => {
    vi.useFakeTimers();
    let searches = 0;
    const handler = createVideoChatHandler({ authorize: "none", heartbeatMs: false, generateVideoTimeoutMs: 1, generatedClipDurationSec: 2,
      generateText: () => "", searchMedia: () => { searches++; return { type: "video", url: "https://app.test/stock.mp4", durationSec: 12 }; },
      streamText: async function* () {
        yield JSON.stringify(brief) + "\n";
        yield JSON.stringify({ type: "shot", ...ending, narration: "Waves arrive." }) + "\n";
        await new Promise(resolve => setTimeout(resolve, 6_000));
      },
    });
    const pending = collect(await handler(new Request("https://app.test/video?action=response", { method: "POST", body: JSON.stringify({ prompt: "Explain waves", mode: "pexels" }) })));
    await vi.advanceTimersByTimeAsync(7_000);
    const events = await pending;
    expect(searches).toBe(2);
    expect(events.filter(e => e.type === "scene.add").map(e => e.data.scene.templateId)).toEqual(["cinemaMedia", "cinemaMedia"]);
  });
  it.each([2, 5, 6, 8, 10])("passes an explicit %ss narration budget to the single rewrite and video adapter", async durationSec => {
    const generated: number[] = [];
    let rewrites = 0;
    let budget: { clipDurationSec: number; maxSpeechSec: number; targetWords: number; targetUnspacedCharacters: number; maxWords: number; narration: string } | undefined;
    const handler = createVideoChatHandler({ authorize: "none", heartbeatMs: false, generatedClipDurationSec: durationSec,
      generateText: context => {
        rewrites++;
        budget = JSON.parse(context.userPrompt);
        return "Conditions matter.";
      },
      generateVideo: (_query, context) => {
        generated.push(context.requestedDurationSec);
        return { type: "video", url: "https://app.test/clip.mp4", durationSec };
      },
      streamText: async function* () { yield JSON.stringify({ ...brief, development: "", ending: { ...ending, narration: oversized } }) + "\n"; },
    });
    const events = await collect(await handler(request()));
    expect(budget).toMatchObject({ clipDurationSec: durationSec, maxSpeechSec: durationSec - .8, maxWords: Math.floor((durationSec - .8) * 2), narration: oversized });
    expect(budget!.targetWords).toBeLessThan(budget!.maxWords);
    expect(narrationFitsClip(`${"word ".repeat(budget!.targetWords).trim()}.`, durationSec)).toBe(true);
    expect(narrationFitsClip(`${"水".repeat(budget!.targetUnspacedCharacters)}。`, durationSec)).toBe(true);
    expect(rewrites).toBe(1);
    expect(generated).toEqual([durationSec]);
    expect(events.find(e => e.type === "scene.add")?.data).toMatchObject({ scene: { templateId: "cinemaMedia", narration: "Conditions matter." } });
  });
  it.each(["empty", "oversized", "provider-error", "timeout"] as const)("retains healthy footage after a %s rewrite without exposing its content", async reason => {
    vi.useFakeTimers();
    const diagnostics: unknown[] = [];
    const generateVideo = vi.fn(() => ({ type: "video" as const, url: "https://app.test/clip.mp4", durationSec: 5 }));
    const handler = createVideoChatHandler({ authorize: "none", heartbeatMs: false, generateVideo,
      onDiagnostic: event => { diagnostics.push(event); },
      generateText: () => {
        if (reason === "provider-error") throw new Error("private-provider-detail");
        if (reason === "timeout") return new Promise<string>(() => undefined);
        return reason === "empty" ? "" : oversized;
      },
      streamText: async function* () { yield JSON.stringify({ ...brief, development: "", ending: { ...ending, narration: oversized } }) + "\n"; },
    });
    const pending = collect(await handler(request()));
    await vi.advanceTimersByTimeAsync(10_000);
    const events = await pending;
    expect(diagnostics).toContainEqual(expect.objectContaining({ phase: "narration-rewrite", reason, clipDurationSec: 5, durationMs: expect.any(Number) }));
    expect(JSON.stringify(diagnostics)).not.toContain(oversized);
    expect(JSON.stringify(diagnostics)).not.toContain("private-provider-detail");
    expect(events.find(e => e.type === "scene.add")?.data).toMatchObject({ scene: { templateId: "cinemaMedia", narration: oversized, variables: { mediaUrl: "https://app.test/clip.mp4" } } });
    expect(generateVideo).toHaveBeenCalledOnce();
    expect(events.filter(e => e.type === "response.warning")).toEqual([]);
  });
  it("uses available stock duration rather than the generated-video budget through speech preparation", async () => {
    const narration = "Water moving across the shallow sea floor slows the wave before it breaks near shore.";
    const generateVideo = vi.fn(() => null), rewrite = vi.fn(() => "");
    const handler = createVideoChatHandler({ authorize: "none", heartbeatMs: false, generatedClipDurationSec: 2,
      generateVideo, generateText: rewrite,
      searchMedia: () => ({ type: "video", url: "https://app.test/stock.mp4", durationSec: 12 }),
      streamText: async function* () { yield JSON.stringify({ ...brief, development: "", ending: { ...ending, narration } }) + "\n"; },
    });
    const events = await collect(await handler(new Request("https://app.test/video?action=response", { method: "POST", body: JSON.stringify({ prompt: "Explain waves", mode: "pexels" }) })));
    const scene = events.find(e => e.type === "scene.add")?.data.scene;
    expect(scene).toMatchObject({ templateId: "cinemaMedia", narration, variables: { mediaDurationSec: 12 } });
    expect(prepareNarratedScene(scene!, 8).recovered).toBe(false);
    expect(rewrite).not.toHaveBeenCalled();
    expect(generateVideo).not.toHaveBeenCalled();
  });
  it("rewrites once before buying a clip, then prepares the accepted narration", async () => {
    const { handler, text, generation } = setup("The result depends on these conditions.");
    const events = await collect(await handler(request()));
    expect(text).toHaveBeenCalledOnce();
    expect(text.mock.invocationCallOrder[0]).toBeLessThan(generation.mock.invocationCallOrder[0]!);
    expect(generation.mock.calls[0]?.[1]).toMatchObject({ requestedDurationSec: 5, shotDirection: expect.stringContaining("Show the shore"), deadlineAt: expect.any(Number) });
    expect(events.find(e => e.type === "scene.add")?.data).toMatchObject({ scene: { narration: "The result depends on these conditions.", variables: { mediaDurationSec: 5 } } });
  });
  it.each(["", "[]", oversized])("preserves the entire oversized line with footage when rewrite is unusable", async rewrite => {
    const { handler, text, generation } = setup(rewrite);
    const events = await collect(await handler(request()));
    expect(text).toHaveBeenCalledOnce();
    expect(generation).toHaveBeenCalledTimes(2);
    expect(generation.mock.calls.map(([, context]) => context.requestedDurationSec)).toEqual([5, 5]);
    expect(events.find(e => e.type === "scene.add")?.data).toMatchObject({ scene: { templateId: "cinemaMedia", narration: oversized, timing: { fixedDuration: 5 } } });
    expect(events.filter(e => e.type === "response.warning")).toEqual([]);
    expect(events.find(e => e.type === "response.complete")?.data.snapshot.scenes).toEqual(events.filter(e => e.type === "scene.add").map(e => e.data.scene));
  });
  it("retains selected short stock footage after an oversized rewrite without generating or searching again", async () => {
    const rewrite = vi.fn(() => oversized);
    const generateVideo = vi.fn(() => null);
    const searchMedia = vi.fn(() => ({ type: "video" as const, url: "https://app.test/stock.mp4", durationSec: 5 }));
    const handler = createVideoChatHandler({ authorize: "none", heartbeatMs: false,
      generateText: rewrite, generateVideo, searchMedia,
      streamText: async function* () { yield JSON.stringify({ ...brief, development: "", ending: { ...ending, narration: oversized } }) + "\n"; },
    });
    const events = await collect(await handler(new Request("https://app.test/video?action=response", { method: "POST", body: JSON.stringify({ prompt: "Explain waves", mode: "pexels" }) })));
    expect(searchMedia).toHaveBeenCalledOnce();
    expect(rewrite).toHaveBeenCalledOnce();
    expect(searchMedia.mock.invocationCallOrder[0]).toBeLessThan(rewrite.mock.invocationCallOrder[0]!);
    expect(generateVideo).not.toHaveBeenCalled();
    expect(events.find(e => e.type === "scene.add")?.data.scene).toMatchObject({ templateId: "cinemaMedia", narration: oversized, variables: { mediaUrl: "https://app.test/stock.mp4", mediaDurationSec: 5 } });
    expect(events.filter(e => e.type === "response.warning")).toEqual([]);
  });
  it.each([
    { mode: "cinematic", failure: "missing" }, { mode: "cinematic", failure: "rejected" },
    { mode: "pexels", failure: "missing" }, { mode: "pexels", failure: "rejected" },
  ] as const)("preserves complete narration on a chapter for actual $mode media $failure", async ({ mode, failure }) => {
    const failedMedia = () => { if (failure === "rejected") throw new Error("private-media-detail"); return null; };
    const generateVideo = vi.fn(failedMedia), searchMedia = vi.fn(failedMedia);
    const handler = createVideoChatHandler({ authorize: "none", heartbeatMs: false,
      generateText: () => "", generateVideo, searchMedia,
      streamText: async function* () { yield JSON.stringify({ ...brief, development: "", ending: { ...ending, narration: oversized } }) + "\n"; },
    });
    const events = await collect(await handler(new Request("https://app.test/video?action=response", { method: "POST", body: JSON.stringify({ prompt: "Explain waves", mode }) })));
    expect(generateVideo).toHaveBeenCalledTimes(mode === "cinematic" ? 1 : 0);
    expect(searchMedia).toHaveBeenCalledTimes(mode === "pexels" ? 1 : 0);
    expect(events.find(e => e.type === "scene.add")?.data.scene).toMatchObject({ templateId: "chapterTitle", narration: oversized, variables: { title: ending.title } });
    expect(events.filter(e => e.type === "response.warning")).toContainEqual(expect.objectContaining({ data: { warning: expect.objectContaining({ code: "provider_warning", recoverable: true }) } }));
    expect(events.at(-1)?.type).toBe("response.complete");
    expect(JSON.stringify(events)).not.toContain("private-media-detail");
  });
  it("cancels a stalled rewrite before any paid video job starts", async () => {
    let started!: () => void;
    const rewriting = new Promise<void>(resolve => { started = resolve; });
    const generateVideo = vi.fn(() => null);
    const handler = createVideoChatHandler({ authorize: "none", heartbeatMs: false, generateVideo,
      generateText: async () => { started(); return new Promise<string>(() => undefined); },
      streamText: async function* () { yield JSON.stringify({ ...brief, development: "", ending: { ...ending, narration: oversized } }) + "\n"; },
    });
    const controller = new AbortController();
    const response = await handler(new Request(request(), { signal: controller.signal }));
    const events = collect(response);
    await rewriting;
    controller.abort();
    expect((await events).at(-1)?.type).toBe("response.abort");
    expect(generateVideo).not.toHaveBeenCalled();
  });
  it("announces later resolved media while an earlier paid job is still pending", async () => {
    let release!: (value: { type: "video"; url: string }) => void;
    const first = new Promise<{ type: "video"; url: string }>(resolve => { release = resolve; });
    let count = 0;
    const handler = createVideoChatHandler({ authorize: "none", heartbeatMs: false, generateText: () => "", mediaConcurrency: 2,
      generateVideo: () => ++count === 1 ? first : { type: "video", url: "https://app.test/later.mp4" },
      streamText: async function* () { yield JSON.stringify(brief) + "\n"; yield JSON.stringify({ type: "shot", ...ending, narration: "Waves reach the shore." }) + "\n"; },
    });
    const events = decodeVideoSse((await handler(request())).body!)[Symbol.asyncIterator]();
    const seen = [];
    try {
      while (true) {
        const next = await events.next(); if (next.done) break; seen.push(next.value);
        if (next.value.type === "data.video-chat-preparation" && (next.value.data as { media?: { url?: string } }).media?.url === "https://app.test/later.mp4") break;
      }
      expect(seen.some(e => e.type === "scene.add")).toBe(false);
    } finally { release({ type: "video", url: "https://app.test/first.mp4" }); await events.return?.(undefined); }
  });
});
