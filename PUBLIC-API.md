# VanillaSky Video public API

Status: current public beta contract.

This document defines the API that may enter the fresh
`@vanillaskyai/video` package. An export not listed here is internal. Tests and
the packed-package verifier must fail if the final package adds or removes an
export without changing this contract intentionally.

`tests/fixtures/public-api-signatures.json` is the reviewed normalized
declaration report for this surface. `npm run verify:api` checks the local build's
public names, complete reachable signatures, and runtime and declaration
dependency boundaries. `npm run verify:package` applies the same contract to the
exact packed artifact. Regenerate the report only as part of an intentional
public API review.

## Compatibility promise

- Patch releases do not make breaking changes to documented APIs or the
  serialized `Video` schema.
- A compatible later `0.x` minor needs no migration ceremony. A breaking
  pre-1.0 minor must document both `### Breaking changes` and `### Adoption` in
  its changelog section, with concrete fenced before and after code examples
  respectively.
- An API prefixed with `experimental_` may change in a patch. Canonical examples
  must pin an exact package version when they use one.
- Deprecated APIs remain usable until the next minor release. The `0.1`
  package starts without undocumented compatibility aliases.
- The package is ESM-only, targets ES2022, and supports Node.js 22 or newer.
- React is an optional peer dependency. Only `/react` and renderer definitions
  under `/templates` may depend on React.
- Framework adapters are examples, not separate public APIs. The release suite
  verifies current Next.js and Vite production builds.

The frozen public API surface report is compared on every pull request. It is
intentionally conservative: every existing normalized declaration and reachable
support declaration must remain exactly equal because the report cannot safely
distinguish input and output positions.
As a result, even optional field additions to an existing public
type fail a patch gate; use a documented pre-1.0 minor unless a separately
reviewed, direction-aware compatibility check can prove the change safe. New
exports, wider supported peer ranges, and new optional peers remain additive.

## Environment boundaries

| Entry point | Environment | May import React | May import Node built-ins |
|---|---|---:|---:|
| `@vanillaskyai/video` | Universal | No | No |
| `@vanillaskyai/video/server` | Server | No | No required runtime built-ins |
| `@vanillaskyai/video/react` | Browser/React | Yes | No |
| `@vanillaskyai/video/templates` | Browser/React authoring | Yes | No |
| `@vanillaskyai/video/templates/catalog` | Universal JSON metadata | No | No |
| `@vanillaskyai/video/test` | Node test runners | No | Node test helpers allowed |

The CLI is exposed separately as the `vanillasky` binary.

## Root

The root contains serializable protocol types and pure helpers. It never starts
a request, renders React, imports a provider, or accesses browser globals.

### Values

- `getVideoDuration(video: Video): number`
- `getSceneDuration(scene, metadata)`
- `getSceneDurationBounds(scene, metadata)`
- `getSpokenDuration(text)`
- `parseVideo(value: unknown): Video`
- `resolveVideoBrand(input?: VideoBrandInput): VideoBrand`
- `VideoValidationError`

### Types

- `Video`
- `VideoAudio`
- `VideoBackground`
- `VideoBrand`
- `VideoBrandInput`
- `VideoOrientation`
- `VideoScene`
- `VideoStyle`
- `VideoStyleOptions`
- `VideoStatus`
- `VideoValidationErrorCode`
- `SceneDurationBounds`

`VideoState` remains internal protocol reducer state. Browser consumers use the
normalized fields returned by `useVideoChat` instead.

## Server

The server entry point creates a customer-owned authenticated route. It accepts
the result of Vercel AI SDK `streamText()` directly while retaining a small
provider-neutral text-delta escape hatch.

### Values

- `createVideoChatHandler(options)`
- `createServerTemplateRegistry(options)`

### Types

- `VideoChatCapabilities`
- `VideoChatConversationTurn`
- `VideoChatHandlerOptions`
- `VideoChatMode`
- `VideoChatWelcomeOptions`
- `VideoChatWelcomePrompt`
- `ServerTemplateRegistry`
- `ServerTemplateMetadata`
- `VideoFinishReason`
- `VideoGenerationSummary`
- `VideoProviderUsage`
- `VideoWarning`
- `VideoWarningCategory`

### Handler contract

`createVideoChatHandler` is the opinionated general-purpose video-chat route.
Mount it once and use its bounded `action` query parameter for capabilities,
responses, opening media, narration, suggestions, speech,
transcription, and the welcome screen. It owns the general response prompts,
application-configured visual-mode attempt limits, capability fallbacks, and auxiliary response
shapes. The application supplies provider-neutral `streamText`, `generateText`,
`generateSpeech`, `transcribe`, `searchMedia`, and `generateVideo` callbacks.
Only the two text callbacks are required. Missing optional callbacks remove
their capability; templates and browser speech remain available. During response
creation, failed generated footage falls back to stock when available, then to
matching completed footage and finally a safe template. The default handler skips invalid planner parts and preserves
playable scenes on an interrupted plan, emitting non-fatal warnings. Explicit
`invalidPartBehavior: "fail"` retains strict generation semantics.

- A response accepts `prompt`, `mode`, `orientation`, optional bounded
  `conversation`, `opening`, and `style`. `opening` is an optional
  prewritten hook from a selected suggestion. The response returns protocol
  `0.5` SSE and negotiates `data.video-chat-opening`, which carries the bounded
  6-9 word hook and optional stock-search `keyword` and `fallbackKeyword` before the first scene.
- The planner produces that opening as the first line of the same model stream
  that produces the scenes. The separate opening-media action resolves its
  keyword through the application-owned `searchMedia` callback, with an optional
  bounded `fallbackQuery` for broader opening atmosphere. Stock lookup
  never delays speech or planning. In `full` mode the first line also directs
  the exact first generated scene; the handler consumes that private direction
  and starts the clip while the model continues with scenes two through five.
- `templates` never generates video. `full` uses an application-owned
  `maxGeneratedVideos` limit (default five, nonnegative safe integer). The limit
  counts attempts including failed attempts and the reserved first shot; it is
  neither a currency nor duration cap. Stock lookup remains available after
  the limit. With zero, full mode uses stock only. The planner receives this
  budget, and the server enforces it independently. If providers fail, an
  already completed video with the identical search query and visual look may
  be reused once in the same response before a readable template fallback. Without `generateVideo`, only `templates` is exposed
  and forged generated-mode requests degrade to it.
- The response planner writes narration on each scene. The narration action is
  retained as a compatibility fallback for missing lines, not used in the
  normal path.
- Every action applies the same authorization, origin, request-size,
  cancellation, safe-error, and server-only-provider boundaries.

The chat handler requires `authorize`; `authorize: "none"` is only for an
intentionally non-public in-process/test handler. All provider callbacks receive
cancellation signals. The application owns authentication, origins, request
limits, provider credentials, deadlines, and retry budgets.

`onWarning` receives safe typed diagnostics; `onComplete` receives a server-only
`VideoGenerationSummary` after an actual `response.complete`, including recovered
playable responses. `onError` receives private internal errors. Observer failures
do not change playback. Provider metadata remains server-side, with raw usage
and metadata requiring the bounded `includeRawProviderData` opt-in.

The handler exposes chat-relevant policy, template, and provider options only.
Standalone soundtrack selection, snapshot-retention overrides, and durable
stream replay are not public chat options.

## React

### Values

- `VideoChat(props)`
- `useVideoChat(options?)`
- `createVideoChatVoice(options?)`
- `VideoPlayer`
- `VideoError`

### Types

- `VideoChatProps`
- `UseVideoChatOptions`
- `UseVideoChatResult`
- `VideoChatAskOptions`
- `VideoChatFirstFrameMetric`
- `VideoChatTurn`
- `VideoChatStatus`
- `VideoChatMode`
- `VideoChatCapabilities`
- `VideoChatWelcome`
- `VideoChatSuggestion`
- `VideoChatMedia`
- `VideoChatVoice`
- `VideoChatPreparedSpeech`
- `CreateVideoChatVoiceOptions`
- `VideoPlaybackMode`
- `VideoPlayerProps`
- `VideoErrorOptions`

`VideoChat` is the complete default interface. Import its scoped stylesheet
explicitly so the host application keeps control over CSS loading:

```tsx
import { VideoChat } from "@vanillaskyai/video/react";
import "@vanillaskyai/video/video-chat.css";

export function App() {
  return <VideoChat />;
}
```

Pass the same session configuration through `options`, for example
`<VideoChat options={{ endpoint, headers, templates }} />`. `className`
and `welcomeTitle` are the only shell-level customizations. The stylesheet is
scoped under `.vanillasky-video-chat` and does not style the host document.

`useVideoChat` is the headless client for `createVideoChatHandler`. It owns
the conversation lifecycle and returns UI-neutral state plus a spread-ready
player binding:

```tsx
const chat = useVideoChat();

await chat.ask("Tell me a tiny mystery set on a night train");

return chat.playerProps
  ? <VideoPlayer key={chat.playerKey} {...chat.playerProps} />
  : null;
```

The hook loads capabilities and welcome suggestions, sends completed turns as
bounded context, cancels replaced prompts, retries once only before playback,
paces each scene to its prepared speech, and keeps pause, mute, replay, history,
captions, and actual playback completion synchronized. The default voice tries
the handler's generated-speech action and falls back to browser speech. Pass a
`VideoChatVoice` to replace it without rebuilding session orchestration.
`createVideoChatVoice({ onFallback })` optionally observes a generated-speech
failure that selects browser speech. Observer exceptions and rejected promises
are isolated from playback; no provider diagnostics are passed to this callback.

`chat.warnings` exposes concise notices for the displayed turn, also retained
as optional `VideoChatTurn.warnings`. The default interface recovers silently; these diagnostics are
for application developers and are not rendered to viewers. Optional scene, narration, speech, or stream failures preserve
playable output; an error is shown only when no playable response remains.
`ask(prompt, { opening, openingMedia })` lets a custom interface start a
prewritten suggestion hook immediately and reuse its image or video without
another model or media lookup. The hook otherwise reads the opening from the
response stream, resolves its media keyword, holds that media while it is
spoken, and starts the planned timeline only when both speech and the first
scene are ready. `UseVideoChatOptions.onFirstFrame` receives a
`VideoChatFirstFrameMetric` once after its first active scene commits and reaches
an animation-frame opportunity. This measures presentation readiness, not physical
screen paint or media decoding. Each `VideoChatTurn` exposes `openingMedia` and `completed`, so
custom interfaces can render the same handoff while partial or cancelled
responses remain visible without being mistaken for conversation context.

`VideoPlayer` accepts either streaming player props or a completed saved video:

```tsx
<VideoPlayer {...chat.playerProps} />
<VideoPlayer video={savedVideo} />
```

Built-in renderers are always available, so a streaming `VideoPlayer` does not
require a template registry. `playerProps` is a spread-ready player binding; it
contains the customer registry supplied to `useVideoChat` when one exists, but it
does not expose the built-in planning catalog. Import `builtinTemplates` from
`@vanillaskyai/video/templates/catalog` for labels, schemas, selection guidance,
and other React-free metadata.

The chat owns playback startup, speech, and synchronization. Custom saved-video
players may choose a `VideoPlaybackMode` to match browser autoplay rules.

Set `nativeMediaAudio={{ volume: 0.85 }}` when scene video files contain an
embedded audio track. The active clip's audio becomes a second layer alongside
the video's continuous `audio` soundtrack. Both follow the player's master
mute control; `nativeMediaAudio.volume` and serialized `audio.volume` set their
independent mix levels. Incoming preroll videos remain muted until active.

Saved-video playback performs no generation request. `VideoPlayerBinding` and
the internal reducer state are not public types.

`loop` and `onSceneChange` apply to saved-video playback. `loop` restarts a
completed video from the beginning instead of showing the replay affordance;
`onSceneChange(scene, index)` fires whenever the scene under the playhead
changes, including when a loop wraps back to the first scene. Streaming
playback is unaffected by either. `onComplete(video)` reports that a streamed
response finished composing; `onPlaybackEnd(video)` reports that the visible
playhead actually reached the end for either a stream or saved replay.

Graphic scenes use fixed black backgrounds, white/neutral typography, and the system font stack. `VideoInput.brand`, `VideoStyle.brand`, `VideoBrand`, `VideoBrandInput`, `VideoBackground`, and `resolveVideoBrand` are removed. Media retains natural color. Persisted schema `0.2` and event protocol `0.6` reject earlier versions; changing a version field alone is not a migration.

## Template authoring

The template entry point owns React render definitions only. React-free server
metadata registries are created through `/server`.

### Values

- `defineTemplate(definition)`
- `createTemplateRegistry(options)`

### Types

- `TemplateDefinition`
- `TemplateExample`
- `TemplateJsonSchema`
- `TemplateFamily`
- `TemplateTimingMetadata`
- `TemplateTransitionTiming`
- `TemplateRegistry`
- `SceneTemplate`
- `SceneTemplateMetadata`
- `SceneTemplateProps`

`SceneTemplateProps.progress` is always the raw `0 → 1` scene clock.
Transition-enabled templates may use the optional `motionProgress` clock for
presentation motion; the renderer-owned overlap never prevents that clock from
reaching `1` across the complete template lifecycle. Their metadata must provide
`transitionTiming.entryReadyProgress` and `transitionTiming.holdProgress`.

Template timing uses `preferredDuration`; `duration` is not part of the
package. `AuthoringTemplate` is inferred and internal.

## Built-in catalog

The catalog entry point is JSON-safe metadata. It does not contain renderers.

### Values

- `builtinTemplates`

### Types

- `BuiltinTemplateId`
- `BuiltinTemplateMetadata`

Template family and timing types have one canonical home under `/templates`.

## Test utilities

The test entry point allows deterministic consumer tests without provider
credentials or model spend.

### Values

- `createMockVideoPlanner(options?)`
- `simulateVideoStream(parts, options?)`
- `videoFixtures`

### Types

- `MockVideoPlannerOptions`
- `SimulatedVideoStreamOptions`

The fixtures cover successful generation, delayed streaming, truncation,
invalid scenes, provider failure, content filtering, abort, and timeout.

## CLI

The `vanillasky` binary supports:

- `init`
- `doctor`
- `templates list`
- `templates describe`
- `templates create`
- `templates add`
- `templates sync`
- `templates check`
- `templates add --dry-run`
- `templates add --diff`

`init` writes the canonical app-owned provider and configuration shell while
using the SDK's packaged interface, session, handler, and built-in templates.
`doctor` is read-only and offline. The old top-level template commands are not
aliases; this is an intentional pre-1.0 namespace change.

Generated customer files import only the public entry points in this document.
Browser registries import `createTemplateRegistry` from `/templates`. Server
registries import `createServerTemplateRegistry` and `ServerTemplateMetadata`
from `/server` without crossing a React type boundary.

## Serialized video

- A completed `Video` is JSON-serializable and may be stored by the host.
- Every completed value carries the required storage field
  `schemaVersion: "0.1"`; it is independent from streaming protocol `0.5`.
- `parseVideo(value: unknown)` is the strict universal storage boundary. It
  validates the full document and returns a detached, deeply frozen `Video`.
- JSON serialization remains platform-native; the SDK has no redundant public
  serializer.
- Patch releases preserve round-trip compatibility.
- The 0.1 contract supports the current schema only. It has no compatibility
  aliases or implicit coercions.
- Invalid documents throw `VideoValidationError` with `invalid_video`.
  Unsupported future or unknown versions use `unsupported_video_version` and
  fail before any renderer runs; they are never rendered partially.
- Raw prompts, provider payloads, and credentials are never retained by
  default.
- Chat snapshots omit raw source, instructions, and the supplied-media URL
  index. Hosts own storage, tenant policy, deletion, and media URL expiry.
- Replay through `<VideoPlayer video={savedVideo} />` never calls an LLM.
- Completion checksums detect accidental drift only; they do not provide
  authenticity, authorization, or tenancy security.

## Intentionally excluded from 0.1

- Provider-specific OpenAI or Anthropic wrapper clients.
- Rendering/export infrastructure.
- Hosted persistence.
- OpenTelemetry integration.
- Automatic factual verification or scene repair.
- Standalone video generation hooks, handlers, narration, and timeline factories.
- Undocumented API aliases.


## Playback measurements

`UseVideoChatOptions.onPlaybackMetric` receives the exported
`VideoChatPlaybackMetric` union. Every event contains an opaque `turnId`, `mode`,
and nonnegative `elapsedMs` since the prompt was submitted:

- `first-frame`: first committed active scene at an animation-frame opportunity;
- `first-speech`: actual speech playback onset, with `source` equal to `browser`,
  `generated`, or `custom`;
- `stall`: a finished wait for the next prepared scene, with `durationMs` and
  `reason: "scene-generation"`.

Metrics contain no prompt, narration, scene, URL, or provider diagnostics. There
is no automatic network reporting. Use opaque identifiers when supplying
`createTurnId`. Observer throws and rejected promises cannot affect playback.
Replay and stale/cancelled callbacks do not create fresh response measurements.
Pauses end a stall interval; paused time is excluded from stall duration.

Custom `VideoChatVoice.speak` implementations can call their optional
`onStart()` argument when audio actually begins. Without that signal, speech
onset is unavailable, not zero. Built-in voices use browser utterance `start`
and audio `playing` events, not request completion or preparation estimates.

`VideoPlayerProps.onFramePresented` and `onStallChange` expose the underlying
presentation and stream-starvation signals for custom players. They do not
measure media-decoder buffering. See [Performance](docs/performance.md).

### Bounded generated-video previews

`VideoChatHandlerOptions.generateVideoTimeoutMs` optionally sets the generated media
resolver deadline (integer 1–120000 milliseconds, default 15000). The host still owns
provider cancellation, authorization and spend limits; a timeout does not prove the
provider avoided a charge. `maxGeneratedVideos` continues to count attempted clips.

`VideoChatProps.generatedVideoLabel` and `generatedVideoDescription` customize the
existing generated-video Settings choice without changing server capabilities.
`showRecoveryNotice` opts into a dismissible, fixed SDK media-fallback notice. It
never displays arbitrary provider messages. All three default to existing behavior.
These are additive members; no new entry points or exports are introduced.
