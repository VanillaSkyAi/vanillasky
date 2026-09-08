---
name: vanillasky
description: Integrate @vanillaskyai/video in React applications for spoken video chat, using app-owned model and media providers.
---

# VanillaSky integration

Use one `VideoChat` with one `createVideoChatHandler`. The supported visuals
are narrated footage plus chapter introductions/fallbacks. There is no template
builder, registry CLI, or custom renderer contract.

In an empty app, run `npx @vanillaskyai/video init`, inspect
`npx vanillasky doctor`, then start `npm run dev`. In an existing app, preserve
its framework and follow the installed package's `docs/provider-integration.md`.
The generated shell is editable application code; do not copy SDK internals.

Doctor reports missing key names and readiness. Have the host add credentials
to ignored server-only environment files. Never read, print, screenshot, or
send secret values. The application owns provider selection, authentication,
limits, storage, media rights, and spending.

Verify a complete answer and a follow-up in a real browser with normal motion.
Check the final spoken sentence, moving footage when configured, pause/mute,
and console/network failures. Report the localhost URL and actual capabilities,
not scaffold completion.

Use `useVideoChat` for an application-owned interface, and `parseVideo` with
`VideoPlayer` for saved responses. Provider changes belong in server callbacks,
not a second client. Read the installed `docs/media-and-audio.md` for footage
and voice integration and `docs/production.md` before public deployment.
