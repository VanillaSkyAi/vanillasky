import { describe, expect, it, vi } from "vitest";
import { createVideoChatHandler, type VideoChatHandlerOptions } from "../src/server";

const request = (signal?: AbortSignal) => new Request("https://app.test/video?action=response", { method: "POST", signal, body: JSON.stringify({ prompt: "Explain the result", conversation: [{ prompt: "Earlier question", response: "Earlier answer" }] }) });
const streamText = vi.fn<VideoChatHandlerOptions["streamText"]>(async function* () {
  yield JSON.stringify({ type: "answer", opening: "The result has limits.", subject: "ocean", development: "", ending: { narration: "It works only under controlled conditions.", title: "Controlled conditions", subject: "ocean waves" } }) + "\n";
});
describe("existing assistant integration", () => {
  it("keeps the inbound body limit separate from a bounded completed answer and its JSON encoding", async () => {
    const answer = '🌊"\\\n'.repeat(8_000).trim();
    const resolveAnswer = vi.fn(async () => answer);
    const planner = vi.fn(streamText);
    const handler = createVideoChatHandler({ authorize: "none", heartbeatMs: false, maxBodyBytes: 1_024,
      streamText: planner, generateText: () => "", resolveAnswer });
    const response = await handler(request());
    expect(response.status).toBe(200);
    await response.text();
    expect(JSON.parse(planner.mock.calls[0]![0].request.input.input).completedAssistantAnswer).toBe(answer);
    const oversizedRequest = new Request("https://app.test/video?action=response", { method: "POST", body: JSON.stringify({ prompt: "x".repeat(1_100) }) });
    expect((await handler(oversizedRequest)).status).toBe(413);
    expect(resolveAnswer).toHaveBeenCalledOnce();
    resolveAnswer.mockResolvedValue("x".repeat(32_001));
    expect((await handler(request())).status).toBe(502);
    expect(planner).toHaveBeenCalledOnce();
  });
  it("uses the completed answer as the only factual source without changing the client", async () => {
    const resolveAnswer = vi.fn<NonNullable<VideoChatHandlerOptions["resolveAnswer"]>>(async () => "It works only under controlled conditions.");
    const planner = vi.fn(streamText);
    const handler = createVideoChatHandler({ authorize: "none", heartbeatMs: false, streamText: planner, generateText: () => "", resolveAnswer });
    const response = await handler(request());
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(resolveAnswer).toHaveBeenCalledOnce();
    expect(resolveAnswer.mock.calls[0]?.[0]).toMatchObject({ prompt: "Explain the result", conversation: [{ prompt: "Earlier question", response: "Earlier answer" }], signal: expect.any(AbortSignal) });
    const context = planner.mock.calls[0]?.[0];
    expect(context?.request.input.knowledgeMode).toBe("input-only");
    expect(context?.userPrompt).toContain("It works only under controlled conditions.");
    expect(context?.systemPrompt).toContain("sole factual source");
    expect(context?.userPrompt).not.toContain("Earlier answer");
    expect(body).toContain("It works only under controlled conditions.");
  });
  it.each(["", "   ", null])("rejects empty output explicitly before planning or paid generation", async answer => {
    const planner = vi.fn(streamText), generateVideo = vi.fn(() => null);
    const handler = createVideoChatHandler({ authorize: "none", streamText: planner, generateText: () => "", generateVideo, resolveAnswer: async () => answer as string });
    const response = await handler(request());
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: { code: "answer_unavailable" } });
    expect(planner).not.toHaveBeenCalled(); expect(generateVideo).not.toHaveBeenCalled();
  });
  it("keeps upstream failures private", async () => {
    const handler = createVideoChatHandler({ authorize: "none", streamText, generateText: () => "", resolveAnswer: async () => { throw new Error("private-api-key"); } });
    const response = await handler(request());
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("private-api-key");
  });
  it("bounds a callback that ignores cancellation and does not start planning", async () => {
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const planner = vi.fn(streamText);
    const handler = createVideoChatHandler({ authorize: "none", streamText: planner, generateText: () => "", resolveAnswer: async () => { started(); return new Promise<string>(() => undefined); } });
    const controller = new AbortController();
    const response = handler(request(controller.signal));
    await ready; controller.abort();
    expect((await response).status).toBe(499);
    expect(planner).not.toHaveBeenCalled();
  });
  it("expires an unresponsive assistant without starting paid work", async () => {
    vi.useFakeTimers();
    try {
      let started!: () => void;
      const ready = new Promise<void>(resolve => { started = resolve; });
      let signal: AbortSignal | undefined;
      const generateVideo = vi.fn(() => null);
      const handler = createVideoChatHandler({ authorize: "none", streamText, generateText: () => "", generateVideo,
        resolveAnswer: context => { signal = context.signal; started(); return new Promise<string>(() => undefined); },
      });
      const response = handler(request());
      await ready;
      await vi.advanceTimersByTimeAsync(30_000);
      expect((await response).status).toBe(502);
      expect(signal?.aborted).toBe(true);
      expect(generateVideo).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});
