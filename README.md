# VanillaSky

[![CI](https://github.com/VanillaSkyAi/video/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/VanillaSkyAi/video/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

An open-source chat that answers with generated video and voice.

Ask a question, hear a short introduction, and watch the answer unfold in
narrated scenes. Try it at [vanillasky.ai](https://vanillasky.ai), then run the
same application with your own provider keys.

## Why video chat now?

VanillaSky was inspired by [fal's work on MiniMax H3 Max](https://fal.ai/learn/devs/introducing-h3-max-by-fal):
video generation can take less time than the scene takes to play. That opens up
a different way to use video. While someone watches one scene, the application
can prepare the next, making generated video part of a conversation.

VanillaSky brings the pieces together: an AI planner shapes the answer, fal
generates its footage, and the player coordinates scenes with narration. A spoken
opening gives the conversation a beginning while footage prepares; ready scenes
can play while later scenes are still being generated.

Fast video generation is one part of a responsive conversation. Planning, voice
preparation and media loading also affect when you hear and see the answer.
See [how we measure playback](docs/performance.md).

## Providers

| Role | Included provider | Configuration |
| --- | --- | --- |
| Generated video | [MiniMax H3 Max Turbo on fal](https://fal.ai/models/minimax/h3-max-turbo/text-to-video) — five-second clips at 768P | `FAL_KEY` |
| Answer and scene planning | Anthropic Haiku 4.5 | `ANTHROPIC_API_KEY` |
| Narration | xAI Eve, with browser speech when no voice provider is configured | Optional `XAI_API_KEY` |

Provider calls live in [`functions/_video-chat/`](functions/_video-chat/), so you
can change a model or connect another provider without rewriting the player.
Generated clips play directly from fal's media URLs; no upload service is required.

Pexels is an optional stock-footage alternative when fal is not configured.
See [setup and fallbacks](docs/getting-started.md#what-happens-with-missing-keys).

## Run locally

Use Node 22+ and the npm version in `package.json`.

```bash
git clone https://github.com/VanillaSkyAi/video.git
cd video
npm ci
cp .dev.vars.example .dev.vars
```

Add your keys to the ignored `.dev.vars` file:

```dotenv
ANTHROPIC_API_KEY=your-anthropic-key
FAL_KEY=your-fal-key
```

Add `XAI_API_KEY` for generated narration, or start with browser speech. Then run:

```bash
npm run dev
```

Open [localhost:4200](http://localhost:4200). One command starts the app with hot
reload and its local API, and initializes isolated local quota storage. Local
conversations use your keys with up to five generated clips per answer. Provider
calls incur charges. Missing required configuration produces setup guidance;
every conversation uses real AI planning.

## Build your app

The interface, providers, planner and player are all in this repository.

- **Interface and branding:** start in [`app/pages/Home.tsx`](app/pages/Home.tsx), then [customize the chat](docs/customization.md).
- **Answer guidance:** edit the server `instructions` in [`functions/api/video-chat.mjs`](functions/api/video-chat.mjs).
- **Models and providers:** edit the adapters in [`functions/_video-chat/`](functions/_video-chat/); see [provider integration](docs/provider-integration.md).
- **Planning and playback:** use the [architecture map](docs/architecture.md) to find the relevant module.

Use `npm run dev` while building and `npm run verify` before a PR. The release
workflow deploys the exact build verified by main CI, with live checks and
rollback. See [development](docs/development.md) and [deployment](docs/production.md).

## Documentation

- [Getting started](docs/getting-started.md) · [Customization](docs/customization.md) · [Provider integration](docs/provider-integration.md)
- [Prompts](docs/prompt-and-input.md) · [Media and voice](docs/media-and-audio.md) · [Performance](docs/performance.md)
- [Persistence](docs/persistence.md) · [Protocol](docs/reference/protocol.md) · [Testing](docs/testing.md) · [Security](docs/security.md)
