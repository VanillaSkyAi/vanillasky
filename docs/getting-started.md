# Getting started

Create the complete default chat in an empty directory:

```bash
npx @vanillaskyai/video init
```

Init creates an editable Vite app, installs its dependencies, and runs doctor.
Add `ANTHROPIC_API_KEY` to the generated, ignored `.env.local`, then:

```bash
npx vanillasky doctor
npm run dev
```

Open the reported localhost URL. Ask a question, let its spoken answer finish,
then ask a follow-up. Doctor reports key names and readiness, never key values.
Rerun init if installation was interrupted; it preserves application edits.

## Application files

- `src/main.tsx` mounts `<VideoChat />` and imports the scoped stylesheet.
- `server.ts` connects one `createVideoChatHandler` to app-owned providers.
- `providers.ts` holds optional provider wiring.
- `vite.config.ts` serves the client and `/api/video-chat`.
- `.env.local` holds server-only keys; never commit it.

The SDK owns the interface, shot planning, streaming, subtitles, voice timing,
and footage/chapter renderers. It does not copy a template tree into your app.

## Add footage and voice

Add `PEXELS_API_KEY` for stock video without another package. For optional
generated video or speech, run the corresponding setup command:

```bash
npx vanillasky providers add video
npx vanillasky providers add speech
npx vanillasky doctor
```

Configure the named keys locally and restart the server. Generated speech is
optional; browser speech remains the default. Without usable footage, chapter
scenes retain the narration and subtitles. See [provider integration](provider-integration.md)
and [media and voice](media-and-audio.md) for callback and storage responsibilities.

## Verify the result

Use the real browser with normal motion enabled. Check one complete response
and a follow-up, pause/mute, visible error recovery, and the console.
If generated video is ready, verify that the footage actually moves and that
the final spoken sentence completes. A passing mocked test does not prove
provider latency or video quality.

Before exposing the endpoint publicly, add application authentication, request
limits, media policy, and spending controls. The local starter is not a
production authorization policy. See [production](production.md) and
[security](security.md).

[Documentation home](../README.md)
