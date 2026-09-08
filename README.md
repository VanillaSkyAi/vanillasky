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

Pre-1.0 beta, distributed through npm with [best-effort support](SUPPORT.md).
Pin an exact version and use its matching docs; an unreleased checkout is not
the published package. Review [breaking changes](CHANGELOG.md) before upgrading.

## Start on localhost

```bash
npx @vanillaskyai/video init
```

The default starter uses the optional Vercel AI SDK text adapter. Add
`ANTHROPIC_API_KEY` to the generated, ignored `.env.local`, then run:

```bash
npx vanillasky doctor
npm run dev
```

Prefer native callbacks? Use `init --native` in a new directory and configure
`GEMINI_API_KEY`; that starter needs neither `ai` nor `@ai-sdk/anthropic`.
Both are application examples, not SDK requirements.

One text key gives you chat, chapter introductions, subtitles, and browser voice.
Add stock or generated footage through app-owned adapters. fal, Google, and
Runway references are included; any vendor can implement the same callback.
Direct video generation also requires your storage/delivery callback.
See [Getting started](docs/getting-started.md) for the complete setup and
[Provider integration](docs/provider-integration.md) for the adapter boundary.

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

Already have an assistant? The optional server `resolveAnswer` callback turns
its completed answer into the source for the video, while your application
keeps retrieval, tools and answer policy. See [existing-assistant integration](docs/provider-integration.md#use-an-existing-assistant).

## How it works

The model streams an answer brief and shot directions, not component code.
Footage generation overlaps browser-owned speech preparation. The server
announces prepared media early and streams validated scenes in order. AI-video mode never silently
substitutes stock; stock mode never spends on generated video. A failed or late
clip becomes a narrated chapter. Narration targets a 0.8-second visual tail;
one short rewrite may fit an oversized beat before generation. If it still
does not fit, the complete original narration plays over a chapter. Footage
normally plays once at native speed. A small measured speech overrun can repeat
healthy footage once, only until speech finishes; larger or unmeasured overruns
recover to a chapter without cutting off the sentence.

This is progressive **scene** delivery, not real-time frames from every vendor.
Some generation APIs take minutes; preloading cannot remove that latency.
Evaluate the model, voice and delivery path you actually deploy.

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
