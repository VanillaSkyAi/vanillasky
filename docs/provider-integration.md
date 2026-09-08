# Provider integration

The running app connects one `VideoChat` to `functions/api/video-chat.mjs`.
Provider code lives in `functions/_video-chat/`; planner, validation and playback
remain separate internal modules. Start with the existing working configuration
before changing providers.

## Current providers

- `provider.mjs`: Anthropic Haiku 4.5 for streaming planning and small text tasks.
- `stock.mjs`: bounded Pexels video search and selection.
- `fal.mjs`: MiniMax H3 Max Turbo, five-second 768P generated footage.
- `speech.mjs`: optional xAI Eve speech; the browser speaks when unavailable.

Set server-side keys in ignored `.dev.vars` locally or your deployment secret
store. The API advertises configured capabilities before a turn. Missing planning
or footage configuration gives a setup requirement. No generated-video provider
means configured Pexels; no generated voice means browser speech. Once a footage
mode is selected, a failed or late clip uses chapter recovery. The application's
separate quota policy can use configured Pexels when a public viewer exhausts
their personal generated-video allowance, including during an answer. It never
selects unavailable Pexels. Stock mode never submits generated-video jobs.

## Text callbacks

`streamText` receives `systemPrompt`, `userPrompt` and `signal`; return an
`AsyncIterable<string>` or an object with `textStream`. The planner emits a
complete answer brief followed by shot records as NDJSON. Keep incremental
validation: do not buffer the entire answer before announcing ready scenes.

`generateText` handles bounded helper tasks. Honor `systemPrompt`, `userPrompt`,
`maxOutputTokens` and `signal`. Handle `narration`, `narration-rewrite` and
`suggestions` if dispatching by task. A narration rewrite is at most one short
attempt to fit an existing spoken beat, not another answer-planning run.

Keep models, token limits, timeouts and usage accounting together in the provider
module. Propagate cancellation, preserve both prompts and avoid automatic
resubmission of ambiguous paid requests. See the
[callback reference](reference/provider-adapters.md).

## Use an existing assistant

The internal handler's optional `resolveAnswer({ prompt, conversation, signal })`
callback accepts your assistant's completed answer. Add it where the application
constructs `createVideoChatHandler`. Keep retrieval, tools, tenant authorization
and answer policy in that callback's implementation.

Return one completed, nonempty string of at most 32,000 characters after trimming.
The handler waits at most 30 seconds and forwards cancellation. A failed, empty,
oversized or timed-out answer returns `answer_unavailable`; it never silently
substitutes a different answer. The completed answer becomes the planner's sole
factual source. The planner still uses `streamText` to present it as video.
Without this callback, the planner answers the prompt and conversation directly.

## Footage, speech and delivery

The internal `generateVideo`, `searchMedia`, `generateSpeech` and `transcribe`
callbacks keep provider details out of the player. When changing providers,
retain admission and quota reservations around every billable call. Local
development uses the bounded owner reservation path only with the explicit local
server flag and a loopback request URL. Production still requires verified owner
identity; public limits remain unchanged.

Video callbacks receive the visual query, `requestedDurationSec`, `shotDirection`,
orientation, `generatedLook`, cancellation `signal` and absolute `deadlineAt`.
Return browser-safe media such as `{ type: "video", url, durationSec }`. Keep
model, duration, resolution, concurrency and deadline settings aligned.

fal returns a browser-playable URL directly. There is no required upload service.
If a different provider returns private or short-lived assets, your delivery
code must supply a browser-safe URL with an appropriate replay lifetime. Storage
is a customization for that requirement, not part of the default setup.

The planner leaves a 0.8-second visual tail. Five-second clips target six ordinary
spoken words and one idea. A bounded rewrite can use the full safe speech budget;
if it fails or still cannot fit, the original speech plays over a chapter without
submitting a video job. Measured speech and physical clip duration remain
responsible for playback recovery. See [media and voice](media-and-audio.md).

Stock footage has its own lookup deadline and no generated-video duration cap.
Return its duration when known; the player checks the decoded duration too.
Neither mode requests additional generation simply to extend narration time.

Submit each paid job once. Preserve its identifier and uncertain quota reservation
if the response is ambiguous. Cancellation is best effort and does not establish
that accepted work was free. Return safe errors; never expose provider payloads
or credentials to the browser.

Use `onComplete` for successful completion and usage summaries. It does not fire
for terminal failure or cancellation. Validate saved responses with `parseVideo`
before replay. Deterministic tests prove callback behavior, not live quality,
cost or latency.
