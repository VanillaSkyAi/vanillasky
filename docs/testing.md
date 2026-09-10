# Test video chat without a model

Use deterministic callbacks for the application route and import the actual
protocol modules in focused tests. These tests need no keys, provider SDKs,
or real model requests.

## Test the default route

Return the answer-brief shape requested by the handler's planning prompt, not
a generic template plan:

```ts
import { expect, it } from "vitest";
import { createVideoChatHandler } from "../src/server";

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

## Protocol and playback tests

Protocol tests exercise the real modules in `src/protocol/` and
`src/server/compose-video.ts`. Keep provider output beside the regression it
explains instead of maintaining a separate set of shared mocks.

The browser scenarios in `tests/browser/` use recorded media and the local
callbacks in `tests/support/chat/`. Those fixtures are test-only and never appear
in the runnable application. They verify decoding, narration, cancellation,
media recovery and complete endings without provider calls.

Test cancellation at the route boundary too: every provider must honor the
request signal. Existing core and resilience tests cover partial results,
invalid scenes and interrupted streams.

Keep fast tests focused on behavior. Run the fresh application setup check when
installation changes and browser media tests when playback changes.
A deterministic fixture proves integration, not live-video quality or latency.
