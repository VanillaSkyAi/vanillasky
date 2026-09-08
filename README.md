# Video answers for your AI chat

[![CI](https://github.com/VanillaSkyAi/video/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/VanillaSkyAi/video/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@vanillaskyai/video.svg)](https://www.npmjs.com/package/@vanillaskyai/video)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

VanillaSky is an open-source React SDK for spoken video conversations. A short
chapter introduction starts the answer while footage prepares; narrated clips
then play in order as the response is generated.

Your application owns models, keys, authentication, storage, and spending.
VanillaSky owns the chat interface, shot-planning prompts, streaming, validation,
voice timing, and playback. The core has no runtime dependencies.

Pre-1.0 beta: pin an exact version for production and review
[breaking changes](CHANGELOG.md) before upgrading.

## Start on localhost

```bash
npx @vanillaskyai/video init
```

Add `ANTHROPIC_API_KEY` to the generated, ignored `.env.local`, then run:

```bash
npx vanillasky doctor
npm run dev
```

One text key gives you the complete chat, chapter introductions, subtitles, and
browser voice. Add `PEXELS_API_KEY` for stock footage, or run
`npx vanillasky providers add video fal` (or `google`, `runway`, `custom`) for
generated footage. Configure its server-only credentials and app-owned media
delivery before enabling it. `providers add speech` and `providers add transcription`
are separate optional capabilities. Missing footage preserves a narrated chapter.
See [Getting started](docs/getting-started.md) for setup and
[Provider integration](docs/provider-integration.md) for the adapter boundary.

To avoid an AI framework dependency, start with `npx @vanillaskyai/video init --native`.
That editable Gemini REST adapter uses `GEMINI_API_KEY`; the default starter uses
the optional Vercel AI SDK with Anthropic. Both mount the same React interface.

```tsx
import { VideoChat } from "@vanillaskyai/video/react";
import "@vanillaskyai/video/video-chat.css";

export function App() {
  return <VideoChat />;
}
```

Use `useVideoChat` to build your own interface, and `parseVideo` with
`VideoPlayer` to replay completed responses. Changing a provider does not
require changing the React client.

## How it works

The model streams an answer brief and shot directions, not component code.
The server prepares footage and speech concurrently, validates each scene, and
streams ready scenes to the browser in order. AI-video mode never silently
substitutes stock; stock mode never spends on generated video. A failed or late
clip becomes a narrated chapter. Silent footage can loop when narration exceeds
a clip; media timing and provider latency still need real-footage evaluation.

The supported visual vocabulary is deliberately small: footage and chapter
introductions/fallbacks. There is no template-authoring CLI, renderer plugin
system, or hosted service dependency.

## Documentation

- [Agent integration](docs/agent-integration.md) and the optional
  [integration skill](https://github.com/VanillaSkyAi/video/blob/main/skills/vanillasky/SKILL.md)
- [Provider integration](docs/provider-integration.md), [adapter reference](docs/reference/provider-adapters.md), and [media and voice](docs/media-and-audio.md)
- [Customization](docs/customization.md) and [prompt guidance](docs/prompt-and-input.md)
- [Persistence and replay](docs/persistence.md), [protocol](docs/reference/protocol.md), and [testing](docs/testing.md)
- [Performance](docs/performance.md), [production](docs/production.md), [security](docs/security.md), and [errors](docs/errors.md)
- [Architecture](docs/architecture.md), [development](docs/development.md), and [contributing](https://github.com/VanillaSkyAi/video/blob/main/CONTRIBUTING.md)

Node 22+; React 18 or 19. The four code entry points are the root package,
`/server`, `/react`, and `/test`, plus the scoped `/video-chat.css` stylesheet.
See the [public API contract](PUBLIC-API.md).
