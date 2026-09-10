# Provider callback reference

`functions/_video-chat/` implements these callbacks and passes them to
`createVideoChatHandler` in `src/server/`. They are the seam between the route
and the planner inside this app, not a published API.

## Planning

`streamText({ systemPrompt, userPrompt, signal })` returns an
`AsyncIterable<string>` or `{ textStream, ...completionMetadata }`. Native REST
streams and AI SDK-shaped results both work. Planning uses Anthropic
Haiku 4.5 through `functions/_video-chat/provider.mjs`.

The stream contains NDJSON answer and shot records. Arbitrary text chunks are
buffered until a complete record can be parsed and validated. Preserve this
incremental path so the first scenes can prepare before the whole answer exists.

`generateText` returns a string for bounded helper tasks. Honor its
`maxOutputTokens` and `signal` in addition to both prompt strings. Model names,
usage and finish metadata stay server-side through completion observers.
Provider-native metadata requires explicit opt-in and never enters the stream
sent to the browser. Do not log prompts or provider deltas.

## Generated video

`maxGeneratedVideos` is a route-owned per-response attempt budget,
including failures. Zero skips generation. The planner is guided by the budget,
but recovery retains authored speech if it exceeds it. Stock mode never consumes
that allowance. Never copy an untrusted request value into this option.

`generateVideo` receives `requestedDurationSec`, `shotDirection`, orientation,
`generatedLook`, absolute epoch-millisecond `deadlineAt`, and `signal`. Return
approved media with its actual `durationSec` when known. A browser-playable
fal URL needs no additional storage endpoint.

Keep `generatedClipDurationSec`, `mediaConcurrency` and `generateVideoTimeoutMs`
aligned with the chosen model. Bound `generateVideoTimeoutMs` to 1–600000 ms.
Its internal default is 15000 ms; the application's provider configuration can
set a longer bounded deadline. The client timeout is separately bounded and must
leave enough room for the complete request.

Reserve quota before submission. Submit once, retain job identifiers, poll only
until cancellation or deadline and cancel accepted work best-effort. Never infer
that a disconnected or timed-out request did not cost money. Retries within a
provider callback need their own explicit bounds.

## Stock and speech

`searchMedia` uses a bounded lookup independent of generated-video allowance.
Return approved browser URLs and duration when known. Selection respects the
requested footage mode. Clip failure does not authorize switching providers;
the route has a separate personal-quota policy that can use configured
Pexels when the public AI-video allowance is exhausted.

`generateSpeech` is optional. The browser can speak when generated voice is not
configured or becomes unavailable. Preserve complete spoken text, cancellation
and existing subtitle recovery. `transcribe` is independent of speech output.

## Existing answers and private context

Use `resolveAnswer` for an already-completed assistant answer. It is bounded to
32,000 characters and 30 seconds and becomes the planner's factual source.
See [provider integration](../provider-integration.md#use-an-existing-assistant).
Keep retrieval, tools, private URLs and authorization server-side. Include
only approved facts in the supplied answer and preserve provenance separately.
