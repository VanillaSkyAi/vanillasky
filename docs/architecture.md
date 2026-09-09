# Architecture

The product is one video-chat pipeline: a chapter introduction, then narrated
footage, with chapter fallback when footage is unavailable. The application owns
providers and policy. There is no public template builder or template registry.

## Follow one response

```text
VideoChat / useVideoChat
  → createVideoChatHandler (host policy, capabilities)
      → optional resolveAnswer (application's completed answer)
  → createChatShotPlanner (answer brief → ordered shots)
  → concurrent footage jobs + early preparation announcements
  → createVideo (validated protocol events)
  → browser speech/media preparation → ordered player + narration
```

Without `resolveAnswer`, shot planning begins directly from the request and
conversation. With it, the handler waits for the application's completed answer
before planning; that answer becomes the sole factual source. The hook is not
a stream of partially written assistant tokens.

The planner emits a compact answer brief, the first developing shot, a saved
ending, then remaining shots. The first shot can start before the ending is
written; the ending still plays last and survives later planning interruption.
A single-scene answer uses a brief and ending only. Complete embedded endings
remain accepted, and wrapped arrays are validated as a whole before dispatch.

Scenes can start before the full video plan is ready. Preparation overlaps;
early media announcements let the browser warm upcoming assets even while an
earlier shot is pending. Public scene order stays deterministic. The final Video is replayable data;
saved replay does not request another generation.

Narration is estimated against each clip with a 0.8-second tail. An oversized
beat gets at most one short rewrite that keeps one complete idea and its
necessary qualifiers. Generated footage starts alongside that rewrite; speech
preparation uses only the final accepted narration. Stock selection still comes
first so shortening uses the selected clip's actual duration. If shortening fails, the original narration and footage
are retained. Healthy footage repeats at normal speed until narration finishes,
using the same decoder while speech and subtitles continue once. Generated and
browser voices use confirmed speech onset and completion; preparation estimates
never become measured audio evidence. Missing or failed footage still recovers
to a chapter. See the [playback bounds](media-and-audio.md#timing-and-recovery).

## Where to work

| Change | Source |
| --- | --- |
| Chat interface | `src/video-chat/video-chat.tsx` |
| Request lifecycle, cancellation and playback handoff | `src/video-chat/use-video-chat.ts` |
| Chat state and conversation history | `src/video-chat/session-state.ts` |
| Browser requests, response stream and concurrent preparation | `src/video-chat/response-stream.ts` |
| HTTP admission, methods, CORS and bounded body reading | `src/server/video-chat-http.ts` |
| Response orchestration, host answer and provider callbacks | `src/server/create-video-chat-handler.ts` |
| Handler options and provider callback types | `src/server/video-chat-options.ts` |
| Request validation and bounded conversation text | `src/server/video-chat-input.ts` |
| Opening and preparation events, stream ordering and cancellation | `src/server/video-chat-stream.ts` |
| Default planning instructions | `src/server/video-chat-prompts.ts` |
| Answer brief and shot planning | `src/server/chat-shot-planner.ts` |
| Validated composition and completion | `src/server/compose-video.ts` |
| Wire contract and reduction | `src/protocol/` |
| Turn-owned speech queue and media preparation | `src/video-chat/scene-preparation.ts` |
| Media readiness, timeline and narration | `src/player/` |
| Shared speech/clip budget | `src/protocol/clip-budget.ts` |
| Footage and chapter rendering | `src/visual-system/scene-templates/` |
| Application API and admission | `functions/api/video-chat.mjs` |
| Live provider implementation and quotas | `functions/_video-chat/` |
| Browser and server entry points | `src/react.ts`, `src/server.ts` |
| Scoped UI styles and fonts | `styles/` |

Server imports must not pull in React; browser entries must not pull in Node
or provider libraries. Tests import the modules they exercise directly.
Keep import-isolation tests for those boundaries as the application evolves.

## Prompts and ownership

The handler creates the real chat prompt from the opening, shot, pacing, and
visual-direction rules. Application `instructions` add product guidance;
the separate user prompt carries the request and bounded conversation.
The model emits structured directions, never React, HTML, or executable code.
Approved media URLs enter only through server callbacks.

Providers can return an async text iterable directly or an AI SDK-shaped result.
The application includes the website's Cloudflare API, Anthropic planner, Pexels,
fal and xAI adapters. Authentication, spending limits and media policy stay in
that application boundary; provider modules remain straightforward to replace.

The optional `resolveAnswer({ prompt, conversation, signal })` accepts one
completed, nonempty string of at most 32,000 characters. It has a fixed,
abortable 30-second bound; invalid output or failure returns an explicit error,
not a newly invented answer. The video planner still needs a text callback to
turn that source into shots. See [integration](provider-integration.md).

The generated-video callback receives `requestedDurationSec`, `shotDirection`
and an absolute `deadlineAt`, alongside orientation, look and cancellation.
Its result can report `durationSec`. Model selection, supported duration and
resolution, concurrency, submission/polling and durable delivery stay in the
adapter. The chat runtime does not own provider jobs or a storage service.

Progressive scene delivery cannot remove a vendor's generation delay. A
minutes-long job API remains minutes-long even when the next scene is prepared
early. This repository supplies a runnable application with best-effort support;
your configured providers determine generation availability and latency.

See [development](development.md) for the fast edit loop and
[testing](testing.md) for behavioral tests and recorded-media fixtures.
