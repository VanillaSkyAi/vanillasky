# VanillaSky Video public API

The 0.11 beta is a focused video-chat SDK. It supports footage (`cinemaMedia`) and chapter opening/recovery (`chapterTitle`). Custom renderers, registries, source installation and template authoring are no longer part of the product.

## Supported entry points

- `@vanillaskyai/video`: serializable video types, validation and duration helpers; no React, browser globals or providers.
- `@vanillaskyai/video/server`: `createVideoChatHandler` and its configuration/diagnostic types; no required provider or Node runtime dependencies.
- `@vanillaskyai/video/react`: `VideoChat`, `useVideoChat`, `VideoPlayer`, `createVideoChatVoice`, `VideoError` and their types.
- `@vanillaskyai/video/test`: deterministic `createMockVideoPlanner`, `simulateVideoStream`, `videoFixtures`.
- `@vanillaskyai/video/video-chat.css`: explicitly imported, scoped default UI styles.
- `vanillasky` executable: starter initialization, configuration diagnosis and application-owned provider setup.

The exact named exports are recorded in `tests/fixtures/public-api-surface.json`; normalized declarations and all reachable types are recorded in `public-api-signatures.json` beside it. Regenerate these only for an intentional contract change. `verify:api` checks a local build; `verify:package` checks the actual packed artifact and environment boundaries.

## Beta compatibility and support

The package is ESM-only, targets ES2022 and supports Node.js 22+. React 18/19 are optional peers needed only by the React entry. No provider SDK is a runtime or peer dependency. npm distribution remains supported with best-effort beta maintenance, not an unlimited vendor/model compatibility promise.

Patch releases preserve documented APIs and saved video data. Breaking pre-1.0 minor releases explain removal and adoption in the changelog; 0.11 intentionally removes `/templates`, `/templates/catalog`, server template-registry exports and custom-registry options. No retired-feature aliases or execution machinery remain. Saved footage/chapter identifiers and replay remain supported; saved custom-template scenes are outside this release's supported contract.

## Default server flow

`createVideoChatHandler` mounts one endpoint. The `action` query selects capabilities, response, opening media, narration, suggestions, speech, transcription or welcome. Every action applies authorization, origin restrictions, bounded request bodies, cancellation and safe public errors.

Applications supply required `streamText` and `generateText` callbacks, plus optional `generateSpeech`, `transcribe`, `searchMedia` and `generateVideo`. Text streams can be plain async iterables or structurally compatible AI SDK results. Vercel AI SDK is an optional application integration, not the core abstraction or a requirement.

Optional `resolveAnswer({ prompt, conversation, signal })` returns an existing assistant's completed answer as a nonempty string, bounded to 32,000 characters after trimming and 30 seconds. It runs only after authorization and full input validation. Its output is the video planner's sole factual source, not a second assistant answer. Empty, oversized, failed or timed-out output returns `502 answer_unavailable`; cancellation returns `499 aborted`. This source constraint is model guidance, not automatic fact verification.

The response action accepts `prompt`, `mode`, `orientation`, optional bounded `conversation`, `opening` and `style`. The model produces a single creative brief followed by shots, reserving an authored ending. The server converts these into validated footage scenes or chapters; models do not choose renderer IDs or author lifecycle events.

Two visual modes remain: `cinematic` (AI video) and `pexels` (application-owned stock search). AI mode never silently substitutes stock. Missing/failed footage becomes an authored chapter without losing narration. The default UI opens on a chapter; the opening-media action is available to custom interfaces.

`maxGeneratedVideos` bounds attempted generated clips, including failures (default five). Zero keeps chapter recovery. `mediaConcurrency` overlaps bounded jobs while preserving narrative order. `generatedClipDurationSec` must match the application adapter. `generateVideoTimeoutMs` bounds waiting, not provider charges. The application owns credentials, authentication, storage, delivery, billing and provider cancellation.

The video callback receives `requestedDurationSec`, `shotDirection` and an absolute `deadlineAt`, alongside its abort signal. Returned media may report `durationSec`. Configure the model, clip duration and timeout together in the application adapter; the server accepts timeouts up to ten minutes, while the client defaults to an eleven-minute response deadline. These are safety ceilings, not latency promises.

Planning and playback share one conservative narration budget, reserving at least 0.8 seconds of quiet footage. Before buying a clip, the handler allows one bounded `generateText` call with task `narration-rewrite`. Oversized or failed rewrites retain the original narration on a chapter and do not buy a clip. Measured audio and decoded footage are checked again before playback; normal video runs at its native speed without repeats. Rewriting is model-assisted, not automatic fact verification.

`authorize` is required; use `authorize: "none"` only for intentionally local/test handlers. `invalidPartBehavior: "drop"` preserves valid scenes after malformed planner output; `"fail"` opts into strict failure. Interrupted plans preserve playable partial answers and emit a safe warning. The narration action is a fallback for missing narration, not a second model call in the normal path.

## Streaming, replay and diagnostics

Responses use protocol 0.6 SSE. A declared `data.video-chat-opening` event announces the opening and `data.video-chat-preparation` allows bounded preparation ahead of ordered `scene.add`. Preparation alone never authorizes scene playback. Saved videos retain schema 0.2; parsing/checksums do not authenticate ownership or tenancy.

Completed media is announced immediately, even when an earlier shot is still generating. Byte warming uses a bounded queue; only the active and next scenes may allocate playback decoders. An ambiguous interrupted cinematic request is not automatically resubmitted.

`onError` receives private errors server-side. `onWarning` receives bounded safe warnings. `onComplete` receives a server-only generation summary after an actual completion, including recovered partial output. Raw provider usage/metadata requires explicit `includeRawProviderData`. Observer failures never affect generation.

`onDiagnostic` and client `onPlaybackMetric` provide opt-in, local callbacks with opaque IDs, fixed reason codes and timing measurements. They contain no prompts, narration, asset URLs or credentials and perform no automatic reporting. First-frame measures a presentation opportunity; first-media-frame requires actual decoder proof. Speech onset uses playback events, not preparation estimates.

Duration diagnostics distinguish estimated/rewritten narration from prepared speech and actual clip duration. Playback reports buffered seconds, native media/scene durations and repeat count. Stall reasons distinguish generation, speech and media decoding.

## React integration

```tsx
import { VideoChat } from "@vanillaskyai/video/react";
import "@vanillaskyai/video/video-chat.css";

export function App() {
  return <VideoChat options={{ endpoint: "/api/video" }} />;
}
```

The default experience includes loading states, captions, pause/mute, interruption, complete-turn history and replay. The real `npm run dev:chat` interface is the UI reference.

`VideoChat` accepts optional `branding: { name, logo?, homeUrl?, showDeveloperLinks? }`. It changes application identity only; omitting it preserves the default UI. Home URLs must be HTTP(S) or root-relative; no external theme or template system is introduced.

For an application-owned interface, call `useVideoChat(options)` and spread `chat.playerProps` onto `VideoPlayer`, keyed by `chat.playerKey`. A custom `VideoChatVoice` replaces voice output without replacing session orchestration. Its optional `onStart` callback must signal actual speech onset.

Unclocked browser/custom speech owns its completion, with a bounded watchdog and quiet tail before advancing. Direct player integrations can supply `narrationActive(scene)` to preserve that behavior; the standard hook wires it automatically.

When wiring `onStallChange(stalled, reason)` manually, do not pause the voice for a `speech` wait: the player is waiting for speech to start or finish. Pause voice only for generation or decoding waits. The standard hook already applies this policy.

`createVideoChatVoice` uses generated speech when configured and browser speech otherwise. Preparation duration may be estimated; measured generated audio supports offsets for narration groups. Cancellation releases stale voice/media work. Missing optional footage must not discard the spoken answer.

`chat.warnings` are developer notices; the unchanged default shell stays quiet. `showRecoveryNotice` opts into a fixed dismissible recovery notice without exposing arbitrary provider messages.

## Deliberately outside the maintenance scope

No provider SDK wrappers in core, custom-template product, rendering/export service, hosted persistence, automatic fact verification, provider billing management or model compatibility matrix. Applications own delivery and provider-specific configuration. See the quickstart and provider recipes for supported reference integrations.
