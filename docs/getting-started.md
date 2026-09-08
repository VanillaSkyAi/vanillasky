# Getting started

This is the canonical quickstart. Create the default chat in an empty directory:

```bash
npx @vanillaskyai/video init
```

Init creates an editable Vite app, installs its dependencies, and runs doctor.
The default text adapter uses the optional Vercel AI SDK. Add `ANTHROPIC_API_KEY`
to the generated, ignored `.env.local`, then:

```bash
npx vanillasky doctor
npm run dev
```

Open the reported localhost URL. Ask a question, let its spoken answer finish,
then ask a follow-up. Doctor reports key names and readiness, never key values.
Rerun init if installation was interrupted. It preserves keys and installed
provider adapters, and refuses conflicting scaffold files rather than replacing
your code.

For the native alternative, start a new directory with
`npx @vanillaskyai/video init --native` and set `GEMINI_API_KEY` instead.
Its editable Gemini REST callbacks need no `ai`, `@ai-sdk/anthropic`, or other
model SDK. You can replace either text adapter with your own implementation.
Rerunning ordinary init keeps the selected adapter.

## Application files

- `src/main.tsx` mounts `<VideoChat />` and imports the scoped stylesheet.
- `server.ts` connects one `createVideoChatHandler` to app-owned providers.
- `providers.ts` holds optional provider wiring.
- `providers/text.ts` supplies streaming planning and small text tasks.
- `vite.config.ts` serves the client and `/api/video-chat`.
- `.env.local` holds server-only keys; never commit it.

The SDK owns the interface, shot planning, streaming, subtitles, voice timing,
and footage/chapter renderers. It does not copy a template tree into your app.

## Add footage and voice

Add `PEXELS_API_KEY` for stock video without another package. For optional
generated video or speech, run the corresponding setup command:

```bash
npx vanillasky providers add video fal
npx vanillasky providers add speech
npx vanillasky providers add transcription
npx vanillasky doctor
```

Choose `fal`, `google`, `runway`, or `custom` after `video`; omitting the name
selects fal. These install app-owned source, not core vendor dependencies.
The fal and Runway references use `FAL_KEY` and `RUNWAY_API_KEY`; Google uses
`GEMINI_API_KEY`. `custom` leaves a callback skeleton for any vendor.

Before enabling generated video, configure `providers/video-delivery.ts` with
your storage. Its example accepts your `VIDEO_UPLOAD_URL` and
`VIDEO_STORAGE_TOKEN`; that upload service is not supplied by VanillaSky.
See [provider integration](provider-integration.md#video-delivery-and-cancellation)
for the callback contract. Provider credentials alone do not enable the
starter's generated-video capability.

Speech and transcription are independent upgrades. Speech installs the optional
xAI/AI SDK adapter and uses `XAI_API_KEY`; Whisper transcription uses `FAL_KEY`
without selecting fal for video. Doctor inspects the selected configuration
locally; it never tests a paid generation.

Configure keys locally and restart the server. Generated speech is
optional; browser speech remains the default. Without usable footage, chapter
scenes retain the narration and subtitles. See [provider integration](provider-integration.md)
and [media and voice](media-and-audio.md) for callback and storage responsibilities.

To use an existing assistant rather than ask the planner to answer directly,
add [`resolveAnswer`](provider-integration.md#use-an-existing-assistant) to
`server.ts`. The UI does not change.

## Verify the result

Use the real browser with normal motion enabled. Check one complete response
and a follow-up, pause/mute, visible error recovery, and the console.
If generated video is ready, verify that the footage actually moves and that
the final spoken sentence completes. A passing mocked test does not prove
provider latency or video quality.
Google/Runway job APIs can take minutes; the SDK cannot turn that wait into
real-time footage. Narration aims to finish 0.8 seconds before each clip ends;
if a bounded rewrite cannot fit it, chapter recovery preserves the full speech.

Before exposing the endpoint publicly, add application authentication, request
limits, media policy, and spending controls. The local starter is not a
production authorization policy. See [production](production.md) and
[security](security.md).

[Documentation home](../README.md)
