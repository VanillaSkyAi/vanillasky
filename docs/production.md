[← Documentation home](../README.md) · [Previous: Errors and recovery](errors.md)

# Production guide

Use one `createVideoChatHandler` endpoint for capabilities, welcome content,
video responses, speech, transcription, stock search, and follow-up prompts.
Mount `<VideoChat />` or `useVideoChat` against that boundary.

## Server boundary

- Keep provider keys, planner prompts, media tools, and raw errors on the server.
- Replace the generated localhost authorization with a real user and tenant check.
- Authenticate before reading the request body.
- Set an explicit origin allowlist; CORS is not authentication.
- Apply per-user and per-tenant request, token, concurrency, and spend limits.
- Bound prompt size, conversation turns, audio bytes, scene count, and duration.
- Forward cancellation to every text, speech, media, transcription, and video provider.

The handler rejects unknown templates and fields, invalid variables, unsafe
media, and fabricated quote-template content before a scene reaches the
player. Read the [security guide](security.md) for the complete controls.

## Cinematic direction and providers

Default chat shows an immediate chapter while speech and selected footage prepare.
Configure `generateVideo` for AI mode and `searchMedia` for Pexels mode. Neither
mode calls the other footage source. Missing or late footage uses the authored
chapter with complete narration. Explicit custom template registries keep their
existing composition and fallback contracts.
A stock candidate must match the subject, action and permitted crop. Return
`null` for uncertainty rather than broadening an essential detail.

Use explicit provider deadlines. Generated video should use idempotency keys
and `maxRetries: 0` so one visible action cannot silently create several
billable clips. Validate returned URLs, media types, byte sizes, duration, and
licensing before use.

## Fast first response

The prompt appears immediately in the chapter template. The planner's first
streamed object supplies an authored spoken opening and reserves the ending.
Prepare each shot's speech alongside its footage, and keep the opening readable
until its narration and the contiguous preparation cushion are ready. Welcome
cards may carry a prepared opening so its speech starts without a model round trip.

Do not wait for the complete plan before showing the first validated scene.
Preload upcoming assets and keep the current visual if the next one is late.
When generated footage is useful, reserve the first shot in the opening object so generation
can begin while the planner streams later scenes.

## Data and privacy

- Send only the prompt, bounded conversation, and context needed for the answer.
- Do not log authorization headers, secret values, raw prompts, signed URLs, or provider deltas.
- Review provider retention and data-processing terms.
- Keep stored media URLs valid for the expected replay window.
- Validate persisted `Video` values with `parseVideo` before replay.

## Failure experience

- Keep private diagnostics in `onError`; expose only safe typed errors.
- Treat late media as a fallback case, not a reason to freeze playback.
- Keep the current scene and its narration during recoverable generation gaps.
- End cleanly on a terminal error and show an application retry control.
- Retry only before visible output; preserve accepted scenes after playback starts.

## Measure the stages

Record safe server timing and quality fields rather than one opaque total:

- hook received;
- speech ready;
- first scene planned;
- first scene media ready;
- first frame painted;
- plan complete;
- accepted and rejected scene counts;
- provider model, finish reason, token usage, and media failures.

Use `onComplete` for server-side cost and quality reporting and `onWarning` for
bounded recoverable issues. Never send provider-native metadata to the browser
unless the application has deliberately enabled and secured it.

## Test the shipped path

Test the route with deterministic `streamText` and `generateText` callbacks.
Exercise `capabilities`, `welcome`, and `response`, then assert the rendered
conversation through `VideoChat`. Keep provider-adapter tests keyless and run a
small, explicitly gated real-provider smoke test before a release.

In CI, build one clean consumer from the packed SDK artifact. This catches
missing exports, server/browser boundary leaks, code-generation drift, and
dependency-resolution problems that workspace tests miss. If the application
owns copied templates, also run:

```bash
npx vanillasky templates sync --check
npm run build
npm test
```

## Deployment checklist

- [ ] Keys exist only in the server secret store.
- [ ] Authentication, tenant policy, rate limits, and origin allowlist are live.
- [ ] Cancellation, timeouts, fallbacks, and safe errors are tested.
- [ ] Authored chapter recovery works when every optional provider is unavailable.
- [ ] Per-scene media choices obey provider availability and spending limits.
- [ ] Both orientations render and narration stays synchronized.
- [ ] A packed-artifact consumer and deterministic browser chat pass.
- [ ] One bounded real-provider run meets the product's latency and quality target.
- [ ] Completed stored responses parse and replay correctly.

[← Documentation home](../README.md) · [Previous: Errors and recovery](errors.md)
