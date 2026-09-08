# Architecture

The product is one video-chat pipeline: a chapter introduction, then narrated
footage, with chapter fallback when footage is unavailable. The application owns
providers and policy. There is no public template builder or template registry.

## Follow one response

```text
VideoChat / useVideoChat
  → createVideoChatHandler (HTTP, host policy, capabilities)
  → createChatShotPlanner (answer brief → ordered shots)
  → media and speech preparation
  → createVideo (validated protocol events)
  → browser stream reducer → player + narration
```

Scenes can start before the full answer is ready. Preparation may overlap, but
public scene order stays deterministic. The final Video is replayable data;
saved replay does not request another generation.

## Where to work

| Change | Source |
| --- | --- |
| Chat interface and lifecycle | `src/video-chat/` |
| HTTP actions, policy and provider callbacks | `src/server/create-video-chat-handler.ts` |
| Default planning instructions | `src/server/video-chat-prompts.ts` |
| Answer brief and shot planning | `src/server/chat-shot-planner.ts` |
| Validated composition and completion | `src/server/compose-video.ts` |
| Wire contract and reduction | `src/protocol/` |
| Media readiness, timeline and narration | `src/player/` |
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

See [development](development.md) for the fast edit loop and
[testing](testing.md) for deterministic public helpers.
