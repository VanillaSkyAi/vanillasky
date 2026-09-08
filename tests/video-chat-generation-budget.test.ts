import { chatShot, streamChatShots } from "./helpers/chat-shot-fixture";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createVideoChatHandler } from "../src/server";
import { decodeVideoSse } from "../src/protocol/sse";

async function run(budget: number | undefined, fail = false, queries = Array.from({ length: 7 }, (_, i) => `ocean wave ${i}`), stockFails = false, mediaConcurrency = 5) {
  let generated = 0;
  let stock = 0;
  const handler = createVideoChatHandler({
    authorize: "none", heartbeatMs: false, mediaConcurrency,
    ...({ maxGeneratedVideos: budget }),
    generateText: async () => "unused",
    streamText: () => {
      return streamChatShots(queries.map((query, index) => chatShot(query, `This distinct wave reveals visual detail number ${index}.`)));

    },
    generateVideo: async () => { generated++; if (fail) throw new Error("private provider detail"); return { url: "https://media.example/generated.mp4", type: "video" }; },
    searchMedia: async () => { stock++; if (stockFails) return null; return { url: "https://media.example/stock.mp4", type: "video" }; },
  });
  const response = await handler(new Request("https://app.example/api?action=response", { method: "POST", body: JSON.stringify({ prompt: "Ocean", mode: "cinematic", opening: "Watch the ocean come alive today" }) }));
  const events = [];
  for await (const event of decodeVideoSse(response.body!)) events.push(event);
  return { generated, stock, events };
}

describe("chat generation budget", () => {
  afterEach(() => vi.useRealTimers());
  it.each([0, -1, 600001, Infinity, NaN, 1.5])("rejects invalid generation deadline %s", (generateVideoTimeoutMs) => {
    expect(() => createVideoChatHandler({ authorize: "none", streamText: async function* () {}, generateText: async () => "", generateVideoTimeoutMs })).toThrow("generateVideoTimeoutMs");
  });
  it.each([false, true])("honors a longer deadline and settles slow media (success=%s)", async (succeeds) => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const handler = createVideoChatHandler({
      authorize: "none", heartbeatMs: false, generateVideoTimeoutMs: 20000,
      generateText: async () => "unused",
      streamText: () => streamChatShots([chatShot("ocean", "The surface bends into a rising wave.")]),
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
    expect(await result).toContain(succeeds ? "slow.mp4" : "chapterTitle");
  });
  it.each([1, 2, 5])("enforces %s paid clips while preserving every authored beat", async budget => {
    const result = await run(budget);
    // A model can still exceed its instruction: retain every authored beat,
    // while the existing attempt cap and chapter recovery enforce spending.
    expect(result.generated).toBe(budget);
    expect(result.events.filter(event => event.type === "scene.add")).toHaveLength(7);
  });
  it("covers a concise five-beat plan including its ending without an allowance chapter tail", async () => {
    const result = await run(5, false, ["audit records", "assemble advisers", "file disclosures", "meet investors", "launch public trading"]);
    const scenes = result.events.filter(event => event.type === "scene.add");
    expect(result.generated).toBe(5);
    expect(result.stock).toBe(0);
    expect(scenes).toHaveLength(5);
    expect(JSON.stringify(scenes)).not.toContain('"templateId":"chapterTitle"');
    expect(JSON.stringify(scenes.at(-1))).toContain("launch public trading");
    expect(JSON.stringify(scenes.at(-1))).toContain("https://media.example/generated.mp4");
    expect(scenes.map(event => event.data.scene.narration)).toEqual(Array.from({ length: 5 },
      (_, index) => `This distinct wave reveals visual detail number ${index}.`));
    expect(JSON.stringify(result.events)).not.toContain('"finishReason":"other"');
  });
  it("can deliver a complete single-beat answer from the saved ending", async () => {
    const result = await run(1, false, ["ocean wave"]);
    expect(result.generated).toBe(1);
    expect(result.events.filter(event => event.type === "scene.add")).toHaveLength(1);
    expect(JSON.stringify(result.events)).not.toContain('"finishReason":"other"');
  });
  it("keeps a complete chapter answer when no generation is available", async () => {
    const result = await run(0);
    expect(result.events.filter(event => event.type === "scene.add")).toHaveLength(7);
  });
  it("defaults to five attempts across uniform shots while chapters continue", async () => {
    const result = await run(undefined);
    expect(result.generated).toBe(5);
    expect(result.stock).toBe(0);
    expect(JSON.stringify(result.events)).toContain('"templateId":"chapterTitle"');
  });
  it("enforces a configured attempt limit even when attempts fail", async () => {
    const result = await run(2, true);
    expect(result.generated).toBe(2);
    expect(result.stock).toBe(0);
    expect(JSON.stringify(result.events)).not.toContain("private provider detail");
  });
  it("supports zero paid attempts", async () => {
    const result = await run(0);
    expect(result.generated).toBe(0);
    expect(result.stock).toBe(0);
  });
  it("does not replay an earlier clip when stock fails", async () => {
    const result = await run(1, false, ["ocean waves", "ocean waves", "ocean waves", "desert dunes"], true, 1);
    const text = JSON.stringify(result.events);
    // Only the original shot uses its clip; other narration survives without invented footage.
    const scenes = result.events.filter((event) => event.type === "scene.add");
    expect(scenes.filter((event) => JSON.stringify(event).includes("generated.mp4"))).toHaveLength(1);
    expect(text).toContain('"templateId":"chapterTitle"');
  });
  it.each([-1, 1.5, Infinity, NaN])("rejects invalid limit %s", (maxGeneratedVideos) => {
    expect(() => createVideoChatHandler({ authorize: "none", streamText: async function* () {}, generateText: async () => "", ...({ maxGeneratedVideos }) })).toThrow("maxGeneratedVideos");
  });
});
