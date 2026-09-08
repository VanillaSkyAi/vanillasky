# VanillaSky

[![CI](https://github.com/VanillaSkyAi/video/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/VanillaSkyAi/video/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

Run the video chat you see on [vanillasky.ai](https://vanillasky.ai), with your own
provider keys. VanillaSky is an open-source application: ask a question, hear a
short introduction while footage prepares, then watch the narrated answer.

## Run locally

Use Node 22+ and npm.

```bash
git clone https://github.com/VanillaSkyAi/video.git
cd video
npm ci
cp .dev.vars.example .dev.vars
```

Add `ANTHROPIC_API_KEY` and `PEXELS_API_KEY` to the ignored `.dev.vars`, then:

```bash
npm run dev
```

Open [localhost:4200](http://localhost:4200). The command starts the frontend and
local API, initializes isolated local quota storage, and creates a local salt.
It does not use production data. Local development uses your keys with up to
five generated clips per answer, without the public site's lifetime trial limit.

Every conversation uses real AI planning. Missing required keys produce a setup
message. There are no sample answers or demo conversations.

- **Planning:** Anthropic Haiku 4.5, required.
- **Footage:** Pexels by default. Add `FAL_KEY` for generated video using
  MiniMax H3 Max Turbo, five-second clips at 768P. Pexels remains selectable.
- **Voice:** browser speech by default. Add `XAI_API_KEY` for xAI speech with Eve.

Generated clips play directly from fal's media URLs. No upload service or
storage endpoint is needed. Live conversations incur your providers' charges.

## Make it yours

The application, providers, planner and player live in one repository. Change
branding in the app, product instructions in the server handler, and provider
behavior in `functions/_video-chat/`. Keep credentials server-side.

The server selects configured capabilities before a conversation. Pexels mode
never generates video. The public site can use configured Pexels when a viewer
exhausts their personal AI-video allowance. A late or failed AI clip becomes a
narrated chapter so the answer can finish. Changing models or shortening clip budgets should be tested
with the actual voice and footage you use.

See [setup](docs/getting-started.md), [customization](docs/customization.md),
[provider integration](docs/provider-integration.md), and
[deployment](docs/production.md).

## Work on the application

Use `npm run dev` for the same application with source-level HMR. Run focused
tests while editing, then the application checks before a PR. See
[development](docs/development.md) and [contributing](CONTRIBUTING.md).

- [Architecture](docs/architecture.md), [prompts](docs/prompt-and-input.md), and [media and voice](docs/media-and-audio.md)
- [Persistence](docs/persistence.md), [protocol](docs/reference/protocol.md), and [errors](docs/errors.md)
- [Testing](docs/testing.md), [performance](docs/performance.md), and [security](docs/security.md)

VanillaSky now develops as a runnable application. The previously published
`@vanillaskyai/video` versions, including 0.11.3, remain available for existing
users; this repository no longer publishes new npm versions or generates a
separate starter. See [support](SUPPORT.md) and the historical [changelog](CHANGELOG.md).
