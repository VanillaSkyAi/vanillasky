import { describe, expect, it, vi } from "vitest";
import { createVideoHandler } from "../src/server/create-video-handler";
import { decodeVideoSse } from "../src/protocol/sse";

const scene = (id: string, media = false) => JSON.stringify({ type: "scene.add", scene: {
  id, templateId: media ? "cinemaMedia" : "chapterTitle", variables: media ? { fallbackText: id, mediaKeyword: "ocean waves", mediaType: "video" } : { title: id },
  timing: { fixedDuration: 4 }, narration: `This is ${id}.`,
} });
async function response(options: Partial<Parameters<typeof createVideoHandler>[0]> = {}, lines = [scene("one"), scene("two"), '{"type":"plan.complete"}']) {
  const handler = createVideoHandler({ authorize: "none", heartbeatMs: false, requireCloser: false,
    streamText: async function* () { for (const line of lines) yield `${line}\n`; }, ...options });
  const result = await handler(new Request("https://app.test/api", { method: "POST", body: JSON.stringify({
    protocolVersion: "0.6", requestId: "recovery-test", input: { input: "Explain ocean waves", opening: false },
  }) }));
  const events = [];
  for await (const event of decodeVideoSse(result.body!)) events.push(event);
  return events;
}
function expectPlayable(events: Awaited<ReturnType<typeof response>>, ids: string[]) {
  expect(events.at(-1)).toMatchObject({ type: "response.complete", data: { snapshot: { scenes: ids.map(id => ({ id })) } } });
  expect(events.some(event => event.type === "response.error" && event.data.terminal)).toBe(false);
  expect(events.some(event => event.type === "response.warning")).toBe(true);
  expect(JSON.stringify(events)).not.toContain("private-provider-detail");
}
describe("response pipeline recovery", () => {
  it.each(['{"type":"scene.add",broken}', '{"type":"scene.add","scene":{"id":"bad"}}'])('continues after invalid planner line %s', async bad => {
    expectPlayable(await response({}, [scene("one"), bad, scene("two"), '{"type":"plan.complete"}']), ["one", "two"]);
  });
  it("keeps completed scenes when the planner disconnects", async () => {
    expectPlayable(await response({ streamText: async function* () { yield `${scene("one")}\n`; throw new Error("private-provider-detail"); } }), ["one"]);
  });
  it("completes a playable response without a completion marker", async () => {
    expectPlayable(await response({}, [scene("one")]), ["one"]);
  });
  it.each([new DOMException("private-provider-detail", "AbortError"), { url: "", type: "video" }, { url: "https://media.test/x", type: "bad" }, { url: "https://media.test/x", type: "video", posterUrl: 7 }])("falls back from failed or malformed optional media %j and continues", async outcome => {
    const resolveMedia = vi.fn(async () => { if (outcome instanceof Error) throw outcome; return outcome as never; });
    const events = await response({ resolveMedia, mediaConcurrency: 3 }, [scene("one", true), scene("two"), '{"type":"plan.complete"}']);
    expectPlayable(events, ["one", "two"]);
    expect(events.find(event => event.type === "scene.add")?.data).toMatchObject({ scene: { templateId: "chapterTitle", variables: { title: "one" } } });
  });
  it("drains ordered media already queued when the planner fails", async () => {
    const events = await response({ mediaConcurrency: 3,
      resolveMedia: async () => { await new Promise(resolve => setTimeout(resolve, 5)); return { type: "video", url: "https://media.test/x.mp4" }; },
      streamText: async function* () { yield `${scene("one", true)}\n${scene("two", true)}\n`; throw new Error("private-provider-detail"); },
    });
    expectPlayable(events, ["one", "two"]);
  });
  it("does not wait for stranded diagnostics after a stream disconnect", async () => {
    const events = await response({ streamText: () => ({
      textStream: (async function* () { yield `${scene("one")}\n`; throw new Error("private-provider-detail"); })(),
      finishReason: new Promise<string>(() => undefined),
    }) });
    expectPlayable(events, ["one"]);
  }, 1000);
  it("bounds optional diagnostics after an otherwise completed stream", async () => {
    const events = await response({ streamText: () => ({
      textStream: (async function* () { yield `${scene("one")}\n{"type":"plan.complete"}\n`; })(),
      usage: new Promise(() => undefined),
    }) });
    expectPlayable(events, ["one"]);
  }, 1800);
  it("recovers a completed closer even before a body scene arrived", async () => {
    const closer = JSON.parse(scene("close")); closer.placement = "closer";
    // Built-in media supports payoff placement.
    expectPlayable(await response({}, [JSON.stringify(closer)]), ["close"]);
  });
  it("uses a safe template for an unavailable scene template and preserves its narration", async () => {
    const unavailable = JSON.parse(scene("one")); unavailable.scene.templateId = "unavailable";
    const events = await response({}, [JSON.stringify(unavailable), scene("two"), '{"type":"plan.complete"}']);
    expectPlayable(events, ["one", "two"]);
    expect(events.find(event => event.type === "scene.add")).toMatchObject({ data: { scene: { templateId: "chapterTitle", narration: "This is one." } } });
  });
  it("isolates throwing warning observers while bounding copy", async () => {
    const long = JSON.parse(scene("one")); long.scene.variables.title = "word ".repeat(100);
    const events = await response({ onWarning() { throw new Error("private-provider-detail"); } }, [JSON.stringify(long), scene("two"), '{"type":"plan.complete"}']);
    expect(events.at(-1)).toMatchObject({ type: "response.complete", data: { snapshot: { scenes: [{ id: "one" }, { id: "two" }] } } });
  });
  it("still fails when there is no playable scene", async () => {
    const events = await response({ streamText: async function* () { throw new Error("private-provider-detail"); yield ""; } });
    expect(events.at(-1)).toMatchObject({ type: "response.error", data: { terminal: true } });
    expect(JSON.stringify(events)).not.toContain("private-provider-detail");
  });
  it("preserves explicitly strict malformed-part behavior", async () => {
    const events = await response({ invalidPartBehavior: "fail" }, [scene("one"), '{"type":"scene.add",broken}', scene("two")]);
    expect(events.at(-1)).toMatchObject({ type: "response.error", data: { terminal: true } });
  });
});
