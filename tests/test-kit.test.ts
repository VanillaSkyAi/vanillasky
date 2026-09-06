import { describe, expect, it, vi } from "vitest";
import { createVideoHandler } from "../src/server/create-video-handler";
import {
  createMockVideoPlanner,
  simulateVideoStream,
  videoFixtures,
} from "../src/test";
import type { MockVideoStreamPart } from "../src/test/types";

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of source) values.push(value);
  return values;
}

function request(input = videoFixtures.portrait.input, signal?: AbortSignal): Request {
  return new Request("https://app.example/api/video", {
    method: "POST",
    signal,
    body: JSON.stringify({
      protocolVersion: "0.6",
      requestId: "test-request",
      input,
    }),
  });
}

function eventsFromSse(body: string): Array<Record<string, unknown>> {
  return body
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
}

describe("public deterministic test kit", () => {
  it("types planner-only closer placement in mock provider parts", () => {
    const part = {
      type: "scene.add",
      placement: "closer",
      scene: {
        id: "ending",
        templateId: "chapterTitle",
        variables: { title: "The grounded story reaches its conclusion" },
        timing: { fixedDuration: 3 },
      },
    } satisfies MockVideoStreamPart;

    expect(part.placement).toBe("closer");
  });

  it("exposes only the three frozen runtime values", async () => {
    expect(Object.keys(await import("../src/test")).sort()).toEqual([
      "createMockVideoPlanner",
      "simulateVideoStream",
      "videoFixtures",
    ]);
  });

  it("deep-freezes portrait, landscape, and all eight named scenarios", () => {
    expect(videoFixtures.portrait.input.orientation).toBe("portrait");
    expect(videoFixtures.landscape.input.orientation).toBe("landscape");
    expect(Object.keys(videoFixtures.scenarios).sort()).toEqual([
      "abort",
      "contentFilter",
      "delayed",
      "invalidScene",
      "providerFailure",
      "success",
      "timeout",
      "truncated",
    ]);
    expect(Object.isFrozen(videoFixtures)).toBe(true);
    expect(Object.isFrozen(videoFixtures.portrait)).toBe(true);
    expect(Object.isFrozen(videoFixtures.portrait.input)).toBe(true);
    expect(Object.isFrozen(videoFixtures.portrait.parts)).toBe(true);
    expect(Object.isFrozen(videoFixtures.portrait.parts[0])).toBe(true);
    expect(Object.isFrozen(videoFixtures.scenarios.invalidScene)).toBe(true);
  });

  it("returns provider-style NDJSON without sharing mutable fixture objects", async () => {
    const streamText = createMockVideoPlanner({ scenario: "success" });
    const first = streamText({
      request: { requestId: "test-request" },
      signal: new AbortController().signal,
    });
    const second = streamText({
      request: { requestId: "test-request" },
      signal: new AbortController().signal,
    });
    const firstText = (await collect(first.textStream)).join("");
    const secondText = (await collect(second.textStream)).join("");

    expect(firstText).toBe(secondText);
    expect(firstText.endsWith("\n")).toBe(true);
    expect(firstText.trim().split("\n").map((line) => JSON.parse(line))).toMatchObject([
      { type: "scene.add", scene: { id: "portrait-summary" } },
      { type: "plan.complete" },
    ]);
    await expect(first.finishReason).resolves.toBe("stop");
    expect(videoFixtures.scenarios.success).toEqual(videoFixtures.portrait.parts);
  });

  it("runs a deterministic success stream in-process with overrideable IDs", async () => {
    const first = await collect(simulateVideoStream(videoFixtures.portrait.parts));
    const second = await collect(simulateVideoStream(videoFixtures.portrait.parts));
    const overridden = await collect(simulateVideoStream(videoFixtures.landscape.parts, {
      input: videoFixtures.landscape.input,
      requestId: "request-custom",
      runId: "run-custom",
    }));

    expect(first).toEqual(second);
    expect(first.map(({ sequence }) => sequence)).toEqual([0, 1, 2, 3]);
    expect(first.map(({ eventId }) => eventId)).toEqual([
      "test-run:0",
      "test-run:1",
      "test-run:2",
      "test-run:3",
    ]);
    expect(first[0]).toMatchObject({
      type: "response.start",
      runId: "test-run",
      data: { requestId: "test-request", format: { orientation: "portrait" } },
    });
    expect(first.at(-1)).toMatchObject({
      type: "response.complete",
      data: { finishReason: "stop", snapshot: { orientation: "portrait" } },
    });
    expect(overridden[0]).toMatchObject({
      runId: "run-custom",
      eventId: "run-custom:0",
      data: { requestId: "request-custom", format: { orientation: "landscape" } },
    });
  });

  it("uses fake-timer-safe delays", async () => {
    vi.useFakeTimers();
    try {
      const iterator = simulateVideoStream(videoFixtures.scenarios.delayed)[Symbol.asyncIterator]();
      await expect(iterator.next()).resolves.toMatchObject({ value: { type: "response.start" } });
      await expect(iterator.next()).resolves.toMatchObject({
        value: { type: "scene.add", data: { scene: { id: "supplied-opening" } } },
      });
      const pending = iterator.next();
      let settled = false;
      void pending.then(() => { settled = true; });

      await vi.advanceTimersByTimeAsync(24);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toMatchObject({ value: { type: "scene.add" } });
      await iterator.return?.(undefined);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a truncated provider result playable", async () => {
    const events = await collect(simulateVideoStream(videoFixtures.scenarios.truncated));

    expect(events.some(({ type }) => type === "scene.add")).toBe(true);
    expect(events.at(-1)).toMatchObject({
      type: "response.complete",
      data: {
        finishReason: "length",
        snapshot: { scenes: [{ id: "supplied-opening" }, { id: "truncated-partial" }] },
      },
    });
  });

  it("drops an invalid scene with a recoverable diagnostic and continues", async () => {
    const events = await collect(simulateVideoStream(videoFixtures.scenarios.invalidScene));

    expect(events).toContainEqual(expect.objectContaining({
      type: "response.warning",
      data: {
        warning: {
          code: "provider_warning", category: "provider",
          message: "Some generated content was skipped.", recoverable: true,
        },
      },
    }));
    expect(events.at(-1)).toMatchObject({
      type: "response.complete",
      data: {
        snapshot: { scenes: [{ id: "supplied-opening" }, { id: "valid-after-invalid" }] },
      },
    });
  });

  it("redacts provider failures at the route boundary", async () => {
    const privateErrors: Error[] = [];
    const handler = createVideoHandler({
      authorize: "none",
      requireCloser: false,
      heartbeatMs: false,
      onError: (error) => privateErrors.push(error),
      streamText: createMockVideoPlanner({ scenario: "providerFailure" }),
    });
    const response = await handler(request());
    const body = await response.text();
    const events = eventsFromSse(body);

    expect(events.at(-1)).toMatchObject({
      type: "response.error",
      data: {
        error: {
          code: "generation_failed",
          message: "Video response generation failed",
          recoverable: false,
        },
      },
    });
    expect(privateErrors[0]?.message).toContain("fixture-private-value");
    expect(body).not.toContain("fixture-private-value");
    expect(body).not.toContain("authorization");
  });

  it("keeps a content-filtered partial scene playable", async () => {
    const events = await collect(simulateVideoStream(videoFixtures.scenarios.contentFilter));

    expect(events.at(-1)).toMatchObject({
      type: "response.complete",
      data: {
        finishReason: "content-filter",
        snapshot: { scenes: [{ id: "supplied-opening" }, { id: "content-filter-partial" }] },
      },
    });
  });

  it("propagates an explicit abort into a deterministic partial result", async () => {
    const controller = new AbortController();
    const events = [];
    for await (const event of simulateVideoStream(videoFixtures.scenarios.abort, {
      signal: controller.signal,
    })) {
      events.push(event);
      if (event.type === "scene.add" && event.data.scene.id === "abort-partial") {
        controller.abort("consumer cancelled");
      }
    }

    expect(events.at(-1)).toMatchObject({
      type: "response.abort",
      data: {
        reason: "consumer cancelled",
        snapshot: { scenes: [{ id: "supplied-opening" }, { id: "abort-partial" }] },
      },
    });
  });

  it("uses an explicit fake-timer-safe timeout and redacts its private reason", async () => {
    vi.useFakeTimers();
    try {
      const result = collect(simulateVideoStream(videoFixtures.scenarios.timeout, {
        timeoutMs: 50,
      }));
      await vi.advanceTimersByTimeAsync(50);
      const events = await result;

      expect(events.at(-1)).toMatchObject({
        type: "response.abort",
        data: {
          reason: "Request timed out",
          snapshot: { scenes: [{ id: "supplied-opening" }, { id: "timeout-partial" }] },
        },
      });
      expect(JSON.stringify(events)).not.toContain("50");
    } finally {
      vi.useRealTimers();
    }
  });

  it("plugs directly into createVideoHandler and emits validated SSE", async () => {
    const handler = createVideoHandler({
      authorize: "none",
      requireCloser: false,
      heartbeatMs: false,
      streamText: createMockVideoPlanner(),
    });
    const response = await handler(request());
    const events = eventsFromSse(await response.text());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(events.map(({ type }) => type)).toEqual([
      "response.start",
      "scene.add",
      "scene.add",
      "response.complete",
    ]);
  });
});
