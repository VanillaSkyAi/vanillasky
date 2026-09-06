import { createVideoHandler, type VideoHandlerOptions } from "../src/server/create-video-handler";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { createVideo, createVideoRequest, decodeVideoSse } from "../src/internal";
import {
  type VideoGenerationSummary,
  type VideoProviderUsage,
  type VideoWarning,
} from "../src/server";
import { parseVideoEvent } from "../src/protocol/validation";

const scene = (id: string) => JSON.stringify({
  type: "scene.add",
  scene: {
    id,
    templateId: "mobileMessage",
    variables: { app: "VanillaSky", message: id },
    timing: { fixedDuration: 4 },
  },
});

function request(signal?: AbortSignal): Request {
  return new Request("https://app.test/api/video", {
    method: "POST",
    signal,
    body: JSON.stringify(createVideoRequest({ input: "Grounded facts" }, { requestId: "request-lifecycle" })),
  });
}

async function eventsFrom(response: Response) {
  const events = [];
  for await (const event of decodeVideoSse(response.body!)) events.push(event);
  return events;
}

describe("typed generation lifecycle", () => {
  it("normalizes OpenAI-shaped AI SDK usage and keeps provider diagnostics server-only", async () => {
    const completed: VideoGenerationSummary[] = [];
    const handler = createVideoHandler({
      authorize: "none",
      requireCloser: false,
      heartbeatMs: false,
      includeRawProviderData: true,
      onComplete: (summary) => completed.push(summary),
      streamText: () => ({
        textStream: (async function* () {
          yield `${scene("openai")}\n`;
          yield '{"type":"plan.complete"}\n';
        })(),
        finishReason: Promise.resolve("stop"),
        usage: Promise.resolve({
          inputTokens: 30,
          outputTokens: 12,
          totalTokens: 42,
          inputTokenDetails: { cacheReadTokens: 8, cacheWriteTokens: 2 },
          outputTokenDetails: { reasoningTokens: 4 },
        }),
        providerMetadata: Promise.resolve({ openai: { responseId: "response-secret" } }),
        steps: Promise.resolve([{ model: { modelId: "gpt-requested" } }]),
        response: Promise.resolve({ modelId: "gpt-resolved" }),
      }),
    });

    const events = await eventsFrom(await handler(request()));

    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
      finishReason: "stop",
      acceptedSceneCount: 1,
      rejectedSceneCount: 0,
      videoDurationSec: 7,
      requestedModelId: "gpt-requested",
      resolvedModelId: "gpt-resolved",
      usage: {
        inputTokens: 30,
        outputTokens: 12,
        totalTokens: 42,
        cachedInputTokens: 8,
        cacheWriteTokens: 2,
        reasoningTokens: 4,
      },
      providerMetadata: { openai: { responseId: "response-secret" } },
    });
    expect(completed[0].usage?.raw).toBeDefined();
    expect(completed[0]).not.toHaveProperty("proposedSceneCount");
    expect(completed[0]).not.toHaveProperty("requestedMaxDurationSec");
    expect(completed[0].totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(completed[0].timeToFirstSceneMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(events)).not.toMatch(/response-secret|gpt-requested|gpt-resolved|inputTokens/);
    expect(events.at(-1)).toMatchObject({ type: "response.complete" });
  });

  it("normalizes Anthropic-shaped cache and reasoning usage without retaining raw values by default", async () => {
    let summary: VideoGenerationSummary | undefined;
    const handler = createVideoHandler({
      authorize: "none",
      requireCloser: false,
      heartbeatMs: false,
      onComplete: (value) => { summary = value; },
      streamText: () => ({
        textStream: (async function* () {
          yield `${scene("anthropic")}\n`;
          yield '{"type":"plan.complete"}\n';
        })(),
        finishReason: "end_turn",
        usage: Promise.resolve({
          inputTokens: { total: 25, noCache: 10, cacheRead: 11, cacheWrite: 4 },
          outputTokens: { total: 9, text: 6, reasoning: 3 },
        }),
        providerMetadata: Promise.resolve({ anthropic: { cacheCreationInputTokens: 4 } }),
        finalStep: Promise.resolve({
          model: { modelId: "claude-requested" },
          response: { modelId: "claude-resolved" },
        }),
      }),
    });

    await eventsFrom(await handler(request()));

    expect(summary?.usage).toEqual({
      inputTokens: 25,
      outputTokens: 9,
      totalTokens: 34,
      cachedInputTokens: 11,
      cacheWriteTokens: 4,
      reasoningTokens: 3,
    });
    expect(summary?.requestedModelId).toBe("claude-requested");
    expect(summary?.resolvedModelId).toBe("claude-resolved");
    expect(summary).not.toHaveProperty("providerMetadata");
    expect(summary?.usage).not.toHaveProperty("raw");
  });

  it.each(["error", "tool-calls", "tool_calls"])(
    "preserves playable scenes after provider finish reason %s",
    async (finishReason) => {
      const internalErrors: Error[] = [];
      const completed: VideoGenerationSummary[] = [];
      const handler = createVideoHandler({
        authorize: "none",
        requireCloser: false,
        heartbeatMs: false,
        onError: (error) => internalErrors.push(error),
        onComplete: (summary) => completed.push(summary),
        streamText: () => ({
          textStream: (async function* () {
            yield `${scene("unsafe-finish")}\n`;
            yield '{"type":"plan.complete"}\n';
          })(),
          finishReason,
        }),
      });

      const events = await eventsFrom(await handler(request()));

      expect(events.at(-1)).toMatchObject({
        type: "response.complete",
        data: { finishReason: "other" },
      });
      expect(internalErrors).toHaveLength(1);
      expect(completed).toHaveLength(1);
    },
  );

  it.each([
    ["length", "length"],
    ["content_filter", "content-filter"],
  ] as const)("preserves a partial video for provider finish reason %s", async (providerReason, finishReason) => {
    const completed: VideoGenerationSummary[] = [];
    const handler = createVideoHandler({
      authorize: "none",
      requireCloser: false,
      heartbeatMs: false,
      onComplete: (summary) => completed.push(summary),
      streamText: () => ({
        textStream: (async function* () { yield `${scene(providerReason)}\n`; })(),
        finishReason: providerReason,
      }),
    });

    const events = await eventsFrom(await handler(request()));

    expect(events.at(-1)).toMatchObject({ type: "response.complete", data: { finishReason } });
    expect(completed).toHaveLength(1);
    expect(completed[0].finishReason).toBe(finishReason);
  });

  it("turns rejected provider metadata promises into one safe warning without failing generation", async () => {
    const warnings: VideoWarning[] = [];
    let summary: VideoGenerationSummary | undefined;
    const handler = createVideoHandler({
      authorize: "none",
      requireCloser: false,
      heartbeatMs: false,
      includeRawProviderData: true,
      onWarning: (warning) => warnings.push(warning),
      onComplete: (value) => { summary = value; },
      streamText: () => ({
        textStream: (async function* () {
          yield `${scene("metadata-rejection")}\n`;
          yield '{"type":"plan.complete"}\n';
        })(),
        finishReason: "stop",
        usage: Promise.reject(new Error("secret usage failure")),
        providerMetadata: Promise.reject(new Error("secret metadata failure")),
        response: Promise.reject(new Error("secret response failure")),
      }),
    });

    const events = await eventsFrom(await handler(request()));
    const warningEvents = events.filter(({ type }) => type === "response.warning");

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toEqual({
      code: "provider_diagnostics_unavailable",
      category: "provider",
      message: "Some provider diagnostics were unavailable.",
      recoverable: true,
    });
    expect(warningEvents).toHaveLength(1);
    expect(summary?.warnings).toEqual(warnings);
    expect(JSON.stringify(events)).not.toMatch(/secret usage|secret metadata|secret response/);
    expect(events.at(-1)?.type).toBe("response.complete");
  });

  it("isolates all lifecycle callback failures and invokes each callback exactly once per diagnostic", async () => {
    const counts = { warning: 0, error: 0, complete: 0 };
    const handler = createVideoHandler({
      authorize: "none",
      requireCloser: false,
      heartbeatMs: false,
      invalidPartBehavior: "drop",
      async onWarning() { counts.warning += 1; throw new Error("warning callback secret"); },
      async onError() { counts.error += 1; throw new Error("error callback secret"); },
      async onComplete() { counts.complete += 1; throw new Error("complete callback secret"); },
      streamText: () => ({
        textStream: (async function* () {
          yield '{"type":"scene.add","scene":{"id":"bad","templateId":"missing","variables":{},"timing":{"fixedDuration":4}}}\n';
          yield `${scene("good")}\n`;
          yield '{"type":"plan.complete"}\n';
        })(),
        finishReason: "stop",
        warnings: [{ message: "raw provider warning secret" }],
      }),
    });

    const events = await eventsFrom(await handler(request()));

    expect(counts).toEqual({ warning: 2, error: 1, complete: 1 });
    expect(events.at(-1)?.type).toBe("response.complete");
    expect(JSON.stringify(events)).not.toMatch(/callback secret|raw provider warning secret|templateId.*missing/);
  });

  it("prevents onWarning mutation from changing reducer state, completion summary, or SSE", async () => {
    let summary: VideoGenerationSummary | undefined;
    const handler = createVideoHandler({
      authorize: "none",
      requireCloser: false,
      heartbeatMs: false,
      onWarning: (warning) => {
        warning.message = "authorization=callback-secret";
        throw new Error("warning observer failed");
      },
      onComplete: (value) => { summary = value; },
      streamText: () => ({
        textStream: (async function* () {
          yield `${scene("immutable-warning")}\n`;
          yield '{"type":"plan.complete"}\n';
        })(),
        finishReason: "stop",
        warnings: [{ message: "provider detail" }],
      }),
    });

    const events = await eventsFrom(await handler(request()));
    const warningEvent = events.find(({ type }) => type === "response.warning");

    expect(warningEvent).toMatchObject({
      type: "response.warning",
      data: { warning: { message: "The model provider reported a warning." } },
    });
    expect(summary?.warnings).toEqual([
      expect.objectContaining({ message: "The model provider reported a warning." }),
    ]);
    expect(JSON.stringify(events)).not.toContain("callback-secret");
  });

  it("reports accepted/rejected scene counts and bounded timing once", async () => {
    const completed = vi.fn<(summary: VideoGenerationSummary) => void>();
    const handler = createVideoHandler({
      authorize: "none",
      requireCloser: false,
      heartbeatMs: false,
      invalidPartBehavior: "drop",
      onComplete: completed,
      streamText: async function* () {
        yield '{"type":"scene.add","scene":{"id":"bad","templateId":"missing","variables":{},"timing":{"fixedDuration":4}}}\n';
        yield `${scene("good")}\n`;
        yield '{"type":"plan.complete"}\n';
      },
    });

    await eventsFrom(await handler(request()));

    expect(completed).toHaveBeenCalledOnce();
    expect(completed.mock.calls[0][0]).toMatchObject({ acceptedSceneCount: 1, rejectedSceneCount: 1 });
    expect(completed.mock.calls[0][0].totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(completed.mock.calls[0][0].timeToFirstSceneMs).toBeGreaterThanOrEqual(0);
  });

  it("forwards request abort to the provider without reporting successful completion", async () => {
    let providerSignal: AbortSignal | undefined;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => { release = resolve; });
    const completed: VideoGenerationSummary[] = [];
    const handler = createVideoHandler({
      authorize: "none",
      heartbeatMs: false,
      onComplete: (summary) => completed.push(summary),
      streamText: ({ signal }) => {
        providerSignal = signal;
        release();
        return (async function* () {
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
          yield* [];
        })();
      },
    });
    const controller = new AbortController();
    const response = await handler(request(controller.signal));
    const body = response.text();
    await ready;
    controller.abort(new DOMException("host timeout detail", "TimeoutError"));
    const text = await body;

    expect(providerSignal?.aborted).toBe(true);
    expect(text).toContain('"type":"response.abort"');
    expect(text).toContain('"reason":"Request timed out"');
    expect(text).not.toContain("host timeout detail");
    expect(completed).toHaveLength(0);
  });

  it("does not wait for unresolved provider diagnostics before completing an abort", async () => {
    let release!: () => void;
    const ready = new Promise<void>((resolve) => { release = resolve; });
    let rejectDiagnostics!: (cause: Error) => void;
    const unresolved = new Promise<never>((_, reject) => { rejectDiagnostics = reject; });
    const handler = createVideoHandler({
      authorize: "none",
      heartbeatMs: false,
      streamText: ({ signal }) => ({
        textStream: (async function* () {
          release();
          if (!signal.aborted) {
            await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
          }
          yield* [];
        })(),
        finishReason: unresolved,
        usage: unresolved,
        providerMetadata: unresolved,
      }),
    });
    const controller = new AbortController();
    const response = await handler(request(controller.signal));
    const body = response.text();
    await ready;
    controller.abort("host cancelled");

    const text = await Promise.race([
      body,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("abort response timed out")), 100)),
    ]);

    expect(text).toContain('"type":"response.abort"');
    expect(text).toContain('"reason":"host cancelled"');
    rejectDiagnostics(new Error("late provider diagnostic rejection"));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("bounds raw provider data and exposes stable public lifecycle types", async () => {
    let summary: VideoGenerationSummary | undefined;
    const huge = "x".repeat(100_000);
    const handler = createVideoHandler({
      authorize: "none",
      requireCloser: false,
      heartbeatMs: false,
      includeRawProviderData: true,
      onComplete: (value) => { summary = value; },
      streamText: () => ({
        textStream: (async function* () {
          yield `${scene("bounded")}\n`;
          yield '{"type":"plan.complete"}\n';
        })(),
        usage: { inputTokens: 1, rawField: huge },
        providerMetadata: { openai: { raw: huge } },
        finishReason: "stop",
      }),
    });

    await eventsFrom(await handler(request()));

    expect(JSON.stringify(summary?.usage?.raw).length).toBeLessThanOrEqual(16_384);
    expect(JSON.stringify(summary?.providerMetadata).length).toBeLessThanOrEqual(16_384);
    expectTypeOf<VideoProviderUsage>().toMatchTypeOf<{
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
      cachedInputTokens?: number;
      cacheWriteTokens?: number;
      reasoningTokens?: number;
      raw?: unknown;
    }>();
    expectTypeOf<VideoHandlerOptions>().toHaveProperty("invalidPartBehavior");
    expectTypeOf<VideoHandlerOptions>().toHaveProperty("requireCloser");
    // @ts-expect-error Callback-like selector names are intentionally unsupported.
    expectTypeOf<VideoHandlerOptions>().toHaveProperty("onInvalidPart");
  });

  it("bounds and redacts host abort diagnostics", async () => {
    const run = createVideo({ input: "Grounded" }, {
      generate: async function* ({ signal }) {
        if (!signal.aborted) {
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
        }
        yield* [];
      },
    });
    run.abort(`authorization=private-token ${"x".repeat(500)}`);
    const events = [];
    for await (const event of run.stream) events.push(event);

    const terminal = events.at(-1);
    expect(terminal).toMatchObject({ type: "response.abort" });
    if (terminal?.type !== "response.abort") throw new Error("Expected response.abort");
    expect(terminal.data.reason.length).toBeLessThanOrEqual(160);
    expect(terminal.data.reason).not.toContain("private-token");
  });
});

describe("safe diagnostics", () => {
  it("rejects inconsistent warning code/category pairs and oversized diagnostics", () => {
    const base = {
      protocolVersion: "0.6",
      runId: "run",
      sequence: 0,
      eventId: "run:0",
      type: "response.warning",
    };
    expect(() => parseVideoEvent({
      ...base,
      data: { warning: {
        code: "provider_warning",
        category: "readability",
        message: "Provider warning.",
        recoverable: true,
      } },
    })).toThrow(/category/i);
    expect(() => parseVideoEvent({
      ...base,
      data: { warning: {
        code: "provider_warning",
        category: "provider",
        message: "x".repeat(161),
        recoverable: true,
      } },
    })).toThrow(/160/);
  });
});
