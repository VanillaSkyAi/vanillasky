# Test video chat without a model

`@vanillaskyai/video/test` provides deterministic planner streams and
in-process protocol events. It has no React or provider-SDK dependency, makes
no network request, and needs no model key.

## Test the chat route with Vitest

Pass `createMockVideoPlanner()` to the same `createVideoChatHandler` used by the
application, using an explicit template registry for the structured composition
fixtures. Default AI-first chat tests should instead return an authored answer
brief and shot descriptions matching the supplied planning prompt. A standard
`Request` exercises parsing, validation, pacing, the
opening extension, and SSE without starting an HTTP server.

```ts
import { describe, expect, it } from "vitest";
import { createVideoChatHandler, createServerTemplateRegistry } from "@vanillaskyai/video/server";
import { createMockVideoPlanner } from "@vanillaskyai/video/test";

describe("POST /api/video-chat", () => {
  it("returns a completed video answer", async () => {
    const handle = createVideoChatHandler({
      authorize: "none", // Only acceptable because this handler stays in process.
      heartbeatMs: false,
      templates: createServerTemplateRegistry({ templates: [] }),
      streamText: createMockVideoPlanner(),
      generateText: async ({ task }) => task === "suggestions"
        ? JSON.stringify({ suggestions: [] })
        : "A deterministic narration line.",
    });

    const response = await handle(new Request(
      "https://app.test/api/video-chat?action=response",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: "Explain why the Moon shows one face",
          opening: "The Moon turns, perfectly matching its orbit.",
          mode: "cinematic",
          orientation: "landscape",
        }),
      },
    ));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('"type":"data.video-chat-opening"');
    expect(body).toContain('"type":"scene.add"');
    expect(body).toContain('"type":"response.complete"');
  });
});
```

Also request `?action=capabilities` and `?action=welcome` in route tests. Assert
that optional modes and controls appear only when their callbacks are present.
For browser coverage, render `<VideoChat />`, submit through the visible prompt,
and wait for a known template rather than reaching into hook internals.

## Test protocol events in process

`simulateVideoStream(parts, options?)` runs the composition and validation
pipeline without an HTTP boundary. It yields typed event objects and remains
useful for focused planner and protocol cases beneath the chat handler.

```ts
import { expect, it } from "vitest";
import {
  simulateVideoStream,
  videoFixtures,
} from "@vanillaskyai/video/test";

it("keeps a truncated result playable", async () => {
  const events = [];
  for await (const event of simulateVideoStream(
    videoFixtures.scenarios.truncated,
  )) {
    events.push(event);
  }

  expect(events.at(-1)).toMatchObject({
    type: "response.complete",
    data: { finishReason: "length" },
  });
});
```

The portrait and landscape fixtures each contain `{ input, parts }`. Public
fixture values are deeply frozen and every helper clones parts before a run.

## Delays, aborts, and timeouts

Delays and `timeoutMs` use ordinary timers and work with Vitest fake timers.

```ts
import { expect, it, vi } from "vitest";
import {
  simulateVideoStream,
  videoFixtures,
} from "@vanillaskyai/video/test";

it("times out deterministically", async () => {
  vi.useFakeTimers();
  try {
    const result = (async () => {
      const events = [];
      for await (const event of simulateVideoStream(
        videoFixtures.scenarios.timeout,
        { timeoutMs: 50 },
      )) events.push(event);
      return events;
    })();

    await vi.advanceTimersByTimeAsync(50);
    await expect(result).resolves.toMatchObject([
      { type: "response.start" },
      { type: "scene.add" },
      { type: "response.abort", data: { reason: "Request timed out" } },
    ]);
  } finally {
    vi.useRealTimers();
  }
});
```

For host cancellation, pass an `AbortController` signal and abort after the
desired partial event. At the route boundary, the host remains responsible for
aborting the request signal and each provider callback must honour it.

## Fixed planner scenarios

`createMockVideoPlanner({ scenario })` accepts:

| Scenario | Expected terminal behavior |
| --- | --- |
| `success` | Completed portrait fixture |
| `delayed` | Success after a 25 ms fake-timer-safe delay |
| `truncated` | Partial playable result completed with `length` |
| `invalidScene` | Invalid scene dropped with a recoverable warning, then completion |
| `providerFailure` | Redacted terminal generation failure |
| `contentFilter` | Partial playable result completed with `content-filter` |
| `abort` | Waits for the supplied request signal to abort |
| `timeout` | Waits for the host signal or simulator `timeoutMs` |

Use `parts` for custom structural plan parts and `delayMs` to delay each
provider chunk. Keep provider selection, credentials, retries, and real-model
acceptance outside deterministic CI.

[← Documentation home](../README.md)
