# Provider integration

Follow [Getting started](getting-started.md) for setup. Keep one `VideoChat`
client and one `createVideoChatHandler` endpoint. Models, credentials,
authentication, retrieval, tools, storage and spending belong to the application;
the SDK owns shot planning, validation, streaming and playback.

The generated `providers/text.ts` is an editable Vercel AI SDK example.
`init --native` instead installs native Gemini REST callbacks with no `ai` or
`@ai-sdk/anthropic` dependency. Neither integration is required by the core.
Any native API, vendor SDK or application service can implement the callbacks.

## Text callbacks

`streamText` receives the SDK's `systemPrompt`, `userPrompt` and `signal`.
Return an `AsyncIterable<string>` directly, or an AI SDK-shaped object with a
`textStream`. The stream contains the model's answer brief and shot records,
not React components or pre-generated MP4 bytes.

`generateText` handles bounded helper tasks. Honor its `systemPrompt`,
`userPrompt`, `maxOutputTokens` and `signal`; return a string. If you dispatch by
`task`, handle `narration`, `narration-rewrite` and `suggestions`. The rewrite
task is an intentional part of the speech/clip budget, not a second answer.

Model IDs, reasoning effort, sampling, prompt caching and provider timeouts
remain in the adapter. Measure first usable scene and answer quality, not only
time to first token. Keep credentials and raw provider metadata server-side.
See the [adapter reference](reference/provider-adapters.md) for lower-level
text stream and completion fields.

## Use an existing assistant

Add `resolveAnswer` when your application already decides what the assistant
should say. For example, in your generated `server.ts`:

```ts
import { createVideoChatHandler } from "@vanillaskyai/video/server";
import { textProvider } from "./providers/text";
import { providers } from "./providers";
import { answerQuestion } from "./assistant";
import { verifySession } from "./auth";

export const handleVideoChat = createVideoChatHandler({
  authorize: verifySession,
  ...textProvider,
  ...providers,
  resolveAnswer: ({ prompt, conversation, signal }) =>
    answerQuestion({ prompt, conversation, signal }),
});
```

`answerQuestion` and `verifySession` above are functions supplied by **your app**.
Keep tenant lookup, retrieval, tool execution and answer policy there. The
callback receives the validated prompt, bounded prior conversation and an
abort signal. It must return one completed, nonempty string of at most 32,000
characters after trimming—not an event stream, agent object or partial answer.

The SDK waits up to 30 seconds and forwards cancellation. A failed, empty,
oversized or timed-out answer returns HTTP 502 with `answer_unavailable`;
request cancellation returns `aborted`. It does not silently replace your
assistant's failure with a different answer. Provider work that ignores the
signal may continue, so your assistant adapter must honor it.

The completed answer becomes the planner's sole factual source in input-only
mode. Planning still uses `streamText` to present that source as video; it is
not a second retrieval/tool run or a fact-checking guarantee. The video plan
streams after the answer has completed. Without `resolveAnswer`, the normal
planner answers from the prompt and conversation directly.

## Video, speech and transcription

`generateVideo`, `searchMedia`, `generateSpeech` and `transcribe` are separate
optional callbacks. Their availability advertises the relevant capabilities;
changing providers does not require a new React interface.

`providers add video fal`, `google` or `runway` copies an app-owned REST reference
into `providers/video.ts`. `custom` supplies a callback skeleton. These names
are onboarding examples, not a core allowlist. Keep any other SDK dependency
inside your application's adapter.

Setup never overwrites an edited adapter. To switch an existing vendor, edit
`providers/video.ts` and the app manifest's `vanillasky.videoVendor` deliberately;
keep duration, timeout, concurrency and delivery settings together. No client
edit or SDK release is needed. Doctor follows that selected configuration.

The video callback receives the visual query plus `requestedDurationSec`,
`shotDirection`, orientation, `generatedLook`, `signal`, and an absolute
epoch-millisecond `deadlineAt`. Return browser-safe media such as
`{ type: "video", url, durationSec }`; report the actual delivered duration when
known. Keep `generatedClipDurationSec`, `mediaConcurrency` and
`generateVideoTimeoutMs` aligned with the adapter's model, supported duration,
resolution and account limits. A model-name change alone is not always enough.

The planner targets speech ending at least 0.8 seconds before each clip ends.
An oversized beat gets at most one bounded `narration-rewrite` call before
footage generation. If the rewrite fails or still cannot fit, no video job is
submitted for that beat: its complete original narration plays over a chapter.
Rewrites are instructed to preserve facts and qualifications; applications
should still evaluate meaning and timing with their actual models and voices.
Measured speech can overrun the estimate; playback recovers to a chapter
rather than looping or cutting off the sentence. Requested duration constrains
the paid submission; a valid returned duration describes the footage actually
available for playback. The mounted decoder also checks its physical duration.
Without reported duration, generated footage keeps its requested budget.

Stock search has its own bounded lookup deadline and no generated-video duration
cap. Return `durationSec` when known: the SDK selects footage first, then checks
the spoken beat against that duration. Unknown stock duration is checked by the
mounted decoder, not replaced with an unrelated video vendor's clip setting.
Neither path submits another video job to make narration fit.

`onDiagnostic` includes a `narration-rewrite` phase with elapsed work time, clip
budget and a fixed `rewritten`, `empty`, `oversized`, `timeout`, `provider-error`
or `cancelled` reason. It never includes the original or rewritten text. Keep
normal rewrite latency within its 2.5-second bound; shortening the first-pass
plan avoids that additional call in the common path.

Speech setup uses the optional xAI/AI SDK adapter. Transcription setup uses
Whisper via fal REST independently of the selected video vendor. Stock footage
uses `searchMedia`; AI-video mode never silently calls stock, and stock mode
does not spend on generated video.

## Video delivery and cancellation

Direct references require an app-owned delivery callback. The starter's
`providers/video-delivery.ts` receives downloaded video bytes, job ID, duration
and signal. Replace it with your storage code, or implement its example upload
endpoint: `PUT` MP4 bytes to `VIDEO_UPLOAD_URL` with `VIDEO_STORAGE_TOKEN`, then
return a public HTTPS `{ url }`. VanillaSky does not host that endpoint.

Google video downloads require a private API key. Keep it server-side, strip
credentials when following off-origin redirects, and never pass the private
provider URI to the player. Copy temporary vendor outputs into storage with an
appropriate replay lifetime. Deliver H.264 MP4 with the moov atom first,
Content-Type/Content-Length, byte ranges and CORS. Access rules, retention and
deletion remain application responsibilities.

The references submit each paid job once, retain its ID and poll to a deadline.
Persist the ID through the helper's `onSubmitted` callback if jobs must survive
server restarts. Never automatically resubmit an ambiguous network failure;
check the provider dashboard first. Cancellation is best effort for fal and
Runway. Gemini Veo has no documented cancellation operation: accepted work may
finish and be billed even after local polling stops. No cancellation promises
a refund.

Initial policies are fal: 5s/480P, concurrency 3, 120s deadline; Google:
6s/720p, concurrency 2, 360s; Runway: 5s/720p, concurrency 2, 180s. These are
editable settings, not measured latency guarantees. Google and Runway may take
minutes. Early media preparation enables progressive scene playback, not
real-time streaming from a provider that only returns completed jobs.

## Completion and integration scope

Use `onComplete` for successful server-side completion and usage summaries;
it does not fire for terminal failure or cancellation. Use safe diagnostics
and `onError` for failures without exposing raw provider payloads to browsers.
Stored completed responses can be validated with `parseVideo` and replayed
without another generation.

This is a beta npm SDK with [best-effort support](../SUPPORT.md), not a hosted
generation service or a guarantee for every vendor/model combination. Offline
fixtures establish callback contracts; live model availability, output quality,
cost and latency require an explicitly budgeted check in your own account.
See [production](production.md) before exposing the endpoint publicly and
[customization](customization.md) for branding or application-owned controls.
