import { describe, expect, it, vi } from "vitest";
import { createVideoChatHandler } from "../src/server/create-video-chat-handler";
import { decodeVideoSse } from "../src/protocol/sse";

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
  it("rewrites once before buying a clip, then prepares the accepted narration", async () => {
    const { handler, text, generation } = setup("The result depends on these conditions.");
    const events = await collect(await handler(request()));
    expect(text).toHaveBeenCalledOnce();
    expect(text.mock.invocationCallOrder[0]).toBeLessThan(generation.mock.invocationCallOrder[0]!);
    expect(generation.mock.calls[0]?.[1]).toMatchObject({ requestedDurationSec: 5, shotDirection: expect.stringContaining("Show the shore"), deadlineAt: expect.any(Number) });
    expect(events.find(e => e.type === "scene.add")?.data).toMatchObject({ scene: { narration: "The result depends on these conditions.", variables: { mediaDurationSec: 5 } } });
  });
  it.each(["", oversized])("preserves the entire oversized line as a chapter when rewrite does not fit", async rewrite => {
    const { handler, text, generation } = setup(rewrite);
    const events = await collect(await handler(request()));
    expect(text).toHaveBeenCalledOnce();
    expect(generation).toHaveBeenCalledTimes(1); // Only the short ending is billable.
    expect(events.find(e => e.type === "scene.add")?.data).toMatchObject({ scene: { templateId: "chapterTitle", narration: oversized } });
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
