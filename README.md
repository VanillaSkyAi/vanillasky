# VanillaSky — Ask a question. Watch the answer.

[![CI](https://github.com/VanillaSkyAi/vanillasky/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/VanillaSkyAi/vanillasky/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

An open-source AI chat app that answers with short videos, combining generated
visuals, voice, music, sound and subtitles.

Ask why we get goosebumps, and watch the explanation unfold. VanillaSky explores
a new way to experience AI conversations.

Try it at [vanillasky.ai](https://vanillasky.ai), [run it with your own keys](#run-locally),
or [contribute to the experience](#contribute).

## Demo

See the settings and the goosebumps answer with voice, music and subtitles in
this one-minute walkthrough.

https://github.com/user-attachments/assets/b4f6e6a0-dc7d-4695-9434-83684de94828

## Why video chat now?

[H3 Max Turbo from fal](https://fal.ai/learn/devs/introducing-h3-max-by-fal) can
generate video faster than playback. Inspired by that speed, VanillaSky prepares
upcoming scenes while you watch, making generated video part of the conversation.

Actual response time also includes planning, voice generation and media loading.
See [how we measure playback](docs/performance.md).

## Run locally

Use Node 22.12+ (22.23.1 is tested in CI) and the npm version in `package.json`.

```bash
git clone https://github.com/VanillaSkyAi/vanillasky.git
cd vanillasky
npm ci
cp .dev.vars.example .dev.vars
```

Add your keys to the ignored `.dev.vars` file:

```dotenv
ANTHROPIC_API_KEY=your-anthropic-key
FAL_KEY=your-fal-key
```

Add `XAI_API_KEY` for generated narration, or start with silent playback. Then run:

```bash
npm run dev
```

Open [localhost:4200](http://localhost:4200). One command starts the app with hot
reload and its local API, and initializes isolated local quota storage. Local
conversations use your keys with up to five generated clips per answer. Provider
calls incur charges. Missing required configuration produces setup guidance;
every conversation uses real AI planning.

## Providers

| Role | Included provider | Configuration |
| --- | --- | --- |
| Generated video | [MiniMax H3 Max Turbo on fal](https://fal.ai/models/minimax/h3-max-turbo/text-to-video) — five-second clips at 768P | `FAL_KEY` |
| Answer and scene planning | Anthropic Haiku 4.5 | `ANTHROPIC_API_KEY` |
| Narration | xAI Eve, with silent playback when no voice provider is configured | Optional `XAI_API_KEY` |

Provider calls live in [`functions/_video-chat/`](functions/_video-chat/), so you
can change a model or connect another provider without rewriting the player.
Generated clips play directly from fal's media URLs; no upload service is required.

Pexels is an optional stock-footage alternative when fal is not configured.
See [setup and fallbacks](docs/getting-started.md#what-happens-with-missing-keys).

## Build your app

The interface, providers, planner and player are all in this repository.

- **Interface and branding:** start in [`app/pages/Home.tsx`](app/pages/Home.tsx), then [customize the chat](docs/customization.md).
- **Answer guidance:** edit the server `instructions` in [`functions/api/video-chat.mjs`](functions/api/video-chat.mjs).
- **Models and providers:** edit the adapters in [`functions/_video-chat/`](functions/_video-chat/); see [provider integration](docs/provider-integration.md).
- **Planning and playback:** use the [architecture map](docs/architecture.md) to find the relevant module.

Use `npm run dev` while building, `npm run check` for quick feedback and
`npm run verify` before an application PR. Docs-only edits use `npm run check:docs`. The release
workflow deploys the exact build verified by main CI, with live checks and
rollback. See [development](docs/development.md) and [deployment](docs/production.md).

## Contribute

Help shape what AI video answers should feel like. Try a question, tell us what
felt slow or unclear, or send a pull request. Useful places to start:

- **Improve pacing and explanations:** refine [answer and scene guidance](docs/prompt-and-input.md) so each scene communicates a clear idea.
- **Try different models:** adapt the [video, voice or planning providers](docs/provider-integration.md) and share what improves the experience.
- **Refine sound and subtitles:** improve the balance, timing and readability of the [listening and viewing experience](docs/media-and-audio.md).

See [Contributing](CONTRIBUTING.md) for the development workflow and
[Support](SUPPORT.md) for reporting a reproducible problem.

## Documentation

- [Getting started](docs/getting-started.md) · [Customization](docs/customization.md) · [Provider integration](docs/provider-integration.md)
- [Prompts](docs/prompt-and-input.md) · [Media and voice](docs/media-and-audio.md) · [Performance](docs/performance.md)
- [Persistence](docs/persistence.md) · [Protocol](docs/reference/protocol.md) · [Testing](docs/testing.md) · [Security](docs/security.md)
