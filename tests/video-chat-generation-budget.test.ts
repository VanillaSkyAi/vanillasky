import { afterEach, describe, expect, it, vi } from "vitest";
import { createVideoChatHandler } from "../src/server";
import { decodeVideoSse } from "../src/protocol/sse";

async function run(budget: number | undefined, fail = false, queries = Array.from({ length: 7 }, (_, i) => `ocean wave ${i}`), stockFails = false, mediaConcurrency = 5) {
  let generated = 0;
  let stock = 0;
  let brief = "";
  const handler = createVideoChatHandler({
    authorize: "none", heartbeatMs: false, mediaConcurrency,
    ...({ maxGeneratedVideos: budget }),
    generateText: async () => "unused",
    streamText: ({ systemPrompt }) => {
      brief = systemPrompt;
      return (async function* () {
        yield `${JSON.stringify({ type: "video-chat.opening", spokenHook: "Watch the ocean come alive today", mediaKeyword: "ocean", firstShot: { text: "Ocean waves", narration: "The ocean moves with a rhythm all of its own today.", mediaKeyword: queries[0] } })}\n`;
        for (const [i, query] of queries.slice(1).entries()) yield `${JSON.stringify({ type: "scene.add", ...(i === queries.length - 2 ? { placement: "closer" } : {}), scene: { id: `shot-${i}`, templateId: "cinemaMedia", variables: { fallbackText: "Ocean", mediaType: "video", mediaSource: "generate", mediaKeyword: query }, narration: "A new wave brings another quiet moment to the shore today.", timing: { fixedDuration: 4 } } })}\n`;
        yield '{"type":"plan.complete"}\n';
      })();
    },
    generateVideo: async () => { generated++; if (fail) throw new Error("private provider detail"); return { url: "https://media.example/generated.mp4", type: "video" }; },
    searchMedia: async () => { stock++; if (stockFails) return null; return { url: "https://media.example/stock.mp4", type: "video" }; },
  });
  const response = await handler(new Request("https://app.example/api?action=response", { method: "POST", body: JSON.stringify({ prompt: "Ocean", mode: "cinematic", opening: "Watch the ocean come alive today" }) }));
  const events = [];
  for await (const event of decodeVideoSse(response.body!)) events.push(event);
  return { generated, stock, brief, events };
}

describe("chat generation budget", () => {
  afterEach(() => vi.useRealTimers());
  it.each([0, -1, 120001, Infinity, NaN, 1.5])("rejects invalid generation deadline %s", (generateVideoTimeoutMs) => {
    expect(() => createVideoChatHandler({ authorize: "none", streamText: async function* () {}, generateText: async () => "", generateVideoTimeoutMs })).toThrow("generateVideoTimeoutMs");
  });
  it.each([false, true])("honors a longer deadline and settles slow media (success=%s)", async (succeeds) => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const handler = createVideoChatHandler({
      authorize: "none", heartbeatMs: false, generateVideoTimeoutMs: 20000,
      generateText: async () => "unused",
      streamText: async function* () {
        yield JSON.stringify({ type: "video-chat.opening", spokenHook: "Watch the ocean come alive today", mediaKeyword: "ocean", firstShot: { text: "Ocean waves", narration: "The ocean moves with a rhythm all of its own today.", mediaKeyword: "ocean" } }) + "\n";
        yield '{"type":"plan.complete"}\n';
      },
      generateVideo: async (_query, context) => { signal = context.signal; return new Promise<{ url: string; type: "video" }>((resolve) => { if (succeeds) setTimeout(() => resolve({ url: "https://media.example/slow.mp4", type: "video" }), 18000); }); },
      searchMedia: async () => ({ url: "https://media.example/stock.mp4", type: "video" }),
    });
    const response = await handler(new Request("https://app.example/api?action=response", { method: "POST", body: JSON.stringify({ prompt: "Ocean", mode: "cinematic" }) }));
    const result = response.text();
    await vi.advanceTimersByTimeAsync(16000);
    expect(signal).toBeDefined();
    expect(signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(4000);
    expect(signal!.aborted).toBe(true);
    expect(await result).toContain(succeeds ? "slow.mp4" : "stock.mp4");
  });
  it("defaults to five attempts including the reserved shot while stock continues", async () => {
    const result = await run(undefined);
    expect(result.generated).toBe(5);
    expect(result.stock).toBe(2);
    expect(JSON.stringify(result.events)).not.toContain('"templateId":"chapterTitle"');
  });
  it("enforces a configured attempt limit even when attempts fail", async () => {
    const result = await run(2, true);
    expect(result.generated).toBe(2);
    expect(result.stock).toBe(7);
    expect(JSON.stringify(result.events)).not.toContain("private provider detail");
    expect(result.brief).toContain("2 generated-video attempts");
  });
  it("supports zero paid attempts", async () => {
    const result = await run(0);
    expect(result.generated).toBe(0);
    // With no generation capability there is no host-inserted generated first shot.
    expect(result.stock).toBe(6);
  });
  it("reuses a completed exact-subject clip once when stock fails, never unrelated footage", async () => {
    const result = await run(1, false, ["ocean waves", "ocean waves", "ocean waves", "desert dunes"], true, 1);
    const text = JSON.stringify(result.events);
    // One generated shot plus one reuse; subsequent/unrelated shots recover to templates.
    const scenes = result.events.filter((event) => event.type === "scene.add");
    expect(scenes.filter((event) => JSON.stringify(event).includes("generated.mp4"))).toHaveLength(2);
    expect(text).toContain('"templateId":"chapterTitle"');
  });
  it.each([-1, 1.5, Infinity, NaN])("rejects invalid limit %s", (maxGeneratedVideos) => {
    expect(() => createVideoChatHandler({ authorize: "none", streamText: async function* () {}, generateText: async () => "", ...({ maxGeneratedVideos }) })).toThrow("maxGeneratedVideos");
  });
});
