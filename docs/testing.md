# Test video chat without a model

Use deterministic callbacks for your route and the React-free
`@vanillaskyai/video/test` helpers for protocol cases. These tests need no keys,
provider SDKs, or real model requests.

## Test the default route

Return the answer-brief shape requested by the handler's planning prompt, not
a generic template plan:

```ts
import { expect, it } from "vitest";
import { createVideoChatHandler } from "@vanillaskyai/video/server";

it("completes a narrated chapter when footage is unavailable", async () => {
  const handle = createVideoChatHandler({
    authorize: "none", // In-process test only.
    heartbeatMs: false,
    streamText: async function* () {
      yield JSON.stringify({
        type: "answer", intent: "informational",
        opening: "Waves move toward the shore.",
        subject: "ocean waves", development: "",
        visualDirection: "Natural ocean footage.",
        ending: {
          title: "Waves carry energy",
          narration: "Ocean waves carry energy toward the shore.",
          subject: "ocean waves", action: "Follow waves toward the shore.",
          durationSec: 4, continuity: "cut",
        },
      }) + "\n";
    },
    generateText: async () => "[]",
  });
  const response = await handle(new Request(
    "https://app.test/api/video-chat?action=response",
    { method: "POST", body: JSON.stringify({ prompt: "Explain waves" }) },
  ));
  const body = await response.text();
  expect(response.status).toBe(200);
  expect(body).toContain('"type":"scene.add"');
  expect(body).toContain('"type":"response.complete"');
});
```

Also test authorization and capability discovery. In the browser, submit through
the visible composer and verify a completed answer and recovery. Do not couple
application tests to private hook state or exact prompt wording.

## Protocol fixtures

```ts
import { expect, it } from "vitest";
import { simulateVideoStream, videoFixtures } from "@vanillaskyai/video/test";

it("keeps a truncated result playable", async () => {
  const events = [];
  for await (const event of simulateVideoStream(videoFixtures.scenarios.truncated)) {
    events.push(event);
  }
  expect(events.at(-1)).toMatchObject({
    type: "response.complete", data: { finishReason: "length" },
  });
});
```

The portrait and landscape fixtures contain frozen `{ input, parts }`.
Helpers clone inputs for each run. `createMockVideoPlanner({ scenario })`
provides success, delayed, truncated, invalidScene, providerFailure,
contentFilter, abort, and timeout scenarios for structural protocol tests.
Those structural parts are not the default chat model's answer-brief format.

`simulateVideoStream(parts, { signal, timeoutMs })` handles abort and timeout
without a server. Delays use ordinary timers and work with Vitest fake timers.
Test cancellation at your route boundary too: every provider must honor the
request signal.

Keep fast tests focused on behavior. Run the real packed consumer when public
types or installation change and browser media tests when playback changes.
A deterministic fixture proves integration, not live-video quality or latency.

[Documentation home](../README.md)
