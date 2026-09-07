# Give your AI a voice and a face

[![CI](https://github.com/VanillaSkyAi/video/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/VanillaSkyAi/video/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@vanillaskyai/video.svg)](https://www.npmjs.com/package/@vanillaskyai/video)
[![runtime dependencies](https://img.shields.io/badge/runtime%20dependencies-0-brightgreen)](package.json)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

**VanillaSky is the open-source voice-and-video chat layer.** Add a polished,
general-purpose AI conversation that speaks and starts playing visual answers
while they are still being composed.

> **Status: Beta.** VanillaSky is pre-1.0 and its public API may change as we
> test it in real applications. Pin an exact version before production use.

Your application owns the providers, keys, authentication, persistence,
branding, and product copy. VanillaSky owns the chat flow, planning prompts,
trusted templates, validation, streaming, voice timing, and player.

## Start on localhost

```bash
npx @vanillaskyai/video init
```

Init installs the baseline dependencies and runs doctor automatically. Add
`ANTHROPIC_API_KEY` to the generated, ignored `.env.local`, then run:

```bash
npx vanillasky doctor
npm run dev
```

Open the reported localhost URL. One text key gives you the chat, an immediate introduction, and browser voice.
Add the video adapter for AI footage, or a Pexels key for the lower-cost stock mode.
Without footage, authored chapter scenes carry the narration and subtitles. If installation is interrupted, rerun the init command.

Optional upgrades keep the same client:

| Add | Setup command | Server-only key |
| --- | --- | --- |
| Generated speech | `npx vanillasky providers add speech` | `XAI_API_KEY` |
| Generated video and voice transcription | `npx vanillasky providers add video` | `FAL_KEY` |
| Pexels video search | No install needed | `PEXELS_API_KEY` |

Run the selected command, add its key to `.env.local`, and restart the server.
Only selected provider packages are installed. `npx vanillasky doctor` reports
readiness by key name and never prints values. Provider SDKs remain application
dependencies, outside the core package.

For coding agents:

```bash
npx skills add VanillaSkyAi/video@vanillasky
```

Then prompt: `Use $vanillasky to set up and verify a general-purpose video chat in this project.`

## What init creates

The generated application is a thin, editable shell:

- `src/main.tsx` mounts the complete SDK-owned `<VideoChat />` interface;
- `server.ts` connects app-owned text, speech, transcription, stock, and video
  providers through one `createVideoChatHandler`;
- `vite.config.ts` serves the UI and the single `/api/video-chat` endpoint;
- `.env.local` holds server-only keys and is ignored by Git.

The UI stays this small:

```tsx
import { VideoChat } from "@vanillaskyai/video/react";
import "@vanillaskyai/video/video-chat.css";

export function App() {
  return <VideoChat />;
}
```

The default interface puts video behind a floating conversation field, with
on-video subtitles and contextual controls. See the [immersive interface guide](docs/immersive-interface.md)
for behavior and [customization](docs/customization.md) for application branding.

Use `useVideoChat` when you want a custom interface while keeping the SDK-owned
conversation and playback lifecycle. Edit the generated server when you want a
different provider. The [provider guide](docs/provider-integration.md) explains
both boundaries.

## An immediate intro, then moving footage

The default chat uses a template introduction while its first shot prepares,
then footage with narration and subtitles. Choose AI video or Pexels in Settings.
AI mode never substitutes stock, and Pexels mode never calls the AI-video provider.
Missing or late footage becomes a useful chapter scene. The planner adapts its
visible actions and spoken beats to explanations, stories, comedy, imagination,
and practical requests. It does not choose body templates.

Speech and footage prepare together. Silent clips loop through the remaining
narration when necessary, and every answer preserves its intended ending.

Packaged templates remain available for custom compositions and source ownership.

Copy template source only when you want to own and edit it:

```bash
npm install --save-dev tsx
npx vanillasky templates add chapterTitle
```

That compiler is needed only for source-owned templates. See
[Custom templates](docs/custom-templates.md).

## Go deeper

Completed chat responses are deterministic JSON and can be stored and replayed.
MP4/WebM export remains application-owned.

## Documentation

| Goal | Guide |
| --- | --- |
| Run the complete chat | [Getting started](docs/getting-started.md) |
| Set it up with a coding agent | [Agent integration guide](docs/agent-integration.md) |
| Change or add providers | [Provider integration](docs/provider-integration.md) |
| Customize the interface | [Customization](docs/customization.md) |
| Understand prompts and grounding | [Prompt and input](docs/prompt-and-input.md) |
| Add media or voice | [Media and voice](docs/media-and-audio.md) |
| Persist and replay results | [Performance measurements](docs/performance.md) · [Persistence and replay](docs/persistence.md) |
| Test routes and streams | [Test integrations](docs/testing.md) |
| Iterate on SDK chat | [Development](docs/development.md): `dev:chat`, `check:chat`, `verify:release` |
| Deploy securely | [Production](docs/production.md) · [Security](docs/security.md) |
| Inspect the API contract | [Public API](PUBLIC-API.md) · [Protocol](docs/reference/protocol.md) |

Try a keyless template response in the
[playground](https://vanillasky.ai/playground/), or visit
[vanillasky.ai](https://vanillasky.ai/).

Apache-2.0
