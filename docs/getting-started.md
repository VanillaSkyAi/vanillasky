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

For a native text adapter without AI framework packages, use
`npx @vanillaskyai/video init --native` in the empty directory instead. Add
`GEMINI_API_KEY`; the generated `providers/text.ts` uses editable Gemini REST
callbacks. Rerunning ordinary init keeps that selection.

## Application files

- `src/main.tsx` mounts `<VideoChat />` and imports the scoped stylesheet.
- `server.ts` connects one `createVideoChatHandler` to app-owned providers.
- `providers.ts` holds optional provider wiring.
- `providers/text.ts` owns the text model connection.
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

Choose `google`, `runway`, or `custom` instead of `fal` when preferred. Video
and transcription are independent. Configure media delivery in
`providers/video-delivery.ts` and the named keys locally before enabling video;
the reference delivery callback requires `VIDEO_UPLOAD_URL` and `VIDEO_STORAGE_TOKEN`.
Doctor verifies configuration, not the result of a paid job. Generated speech is
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
