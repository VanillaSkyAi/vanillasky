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

Scenes can start before the full video plan is ready. Preparation overlaps;
early media announcements let the browser warm upcoming assets even while an
earlier shot is pending. Public scene order stays deterministic. The final Video is replayable data;
saved replay does not request another generation.

Narration is estimated against each clip with a 0.8-second tail. An oversized
beat gets at most one short rewrite before footage is requested. A failed or
still-oversized rewrite preserves the original speech in a chapter instead of
spending on unusable footage. Measured speech remains authoritative during
playback. Normal footage plays once; a small measured speech overrun can repeat
healthy footage once until speech completes. Larger or unmeasured overruns
recover to a chapter. See the [playback bounds](media-and-audio.md#timing-and-recovery)
for the exceptional-repeat policy. Estimation is not a guarantee that every
voice/language finishes inside its clip.

## Where to work

| Change | Source |
| --- | --- |
| Chat interface and lifecycle | `src/video-chat/` |
| HTTP admission, methods, CORS and bounded body reading | `src/server/video-chat-http.ts` |
| Response orchestration, host answer and provider callbacks | `src/server/create-video-chat-handler.ts` |
| Default planning instructions | `src/server/video-chat-prompts.ts` |
| Answer brief and shot planning | `src/server/chat-shot-planner.ts` |
| Validated composition and completion | `src/server/compose-video.ts` |
| Wire contract and reduction | `src/protocol/` |
| Turn-owned speech queue and media preparation | `src/video-chat/scene-preparation.ts` |
| Media readiness, timeline and narration | `src/player/` |
| Shared speech/clip budget | `src/protocol/clip-budget.ts` |
| Footage and chapter rendering | `src/visual-system/scene-templates/` |
| CLI setup and doctor | `src/cli/` |
| Application-owned provider examples | `starters/video-chat/` |
| Local real-chat harness | `dev/chat/` |
| Public entry points | `src/index.ts`, `src/server.ts`, `src/react.ts`, `src/test.ts` |
| Scoped UI styles and packaged fonts | `styles/` |

The root and test entry points are React-free. Server imports must not pull in
React; browser entries must not pull in Node or provider libraries.
[PUBLIC-API.md](../PUBLIC-API.md) and the packed API checks enforce that boundary.

## Prompts and ownership

The handler creates the real chat prompt from the opening, shot, pacing, and
visual-direction rules. Application `instructions` add product guidance;
the separate user prompt carries the request and bounded conversation.
The model emits structured directions, never React, HTML, or executable code.
Approved media URLs enter only through server callbacks.

Providers can return an async text iterable directly or an AI SDK-shaped result.
No particular host, model SDK, database, or storage vendor is required.
Authentication, spending limits, licensing, and persistent media delivery belong
to the application.

The optional `resolveAnswer({ prompt, conversation, signal })` accepts one
completed, nonempty string of at most 32,000 characters. It has a fixed,
abortable 30-second bound; invalid output or failure returns an explicit error,
not a newly invented answer. The video planner still needs a text callback to
turn that source into shots. See [integration](provider-integration.md).

The generated-video callback receives `requestedDurationSec`, `shotDirection`
and an absolute `deadlineAt`, alongside orientation, look and cancellation.
Its result can report `durationSec`. Model selection, supported duration and
resolution, concurrency, submission/polling and durable delivery stay in the
adapter. The SDK does not own provider jobs or a storage service.

Progressive scene delivery cannot remove a vendor's generation delay. A
minutes-long job API remains minutes-long even when the next scene is prepared
early. Scope is the beta npm SDK, its documented React/browser boundaries and
best-effort integration support—not a hosted video service or vendor uptime SLA.

See [development](development.md) for the fast edit loop and
[testing](testing.md) for deterministic public helpers.
