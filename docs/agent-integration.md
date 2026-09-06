[← Documentation home](../README.md) · [Next: Getting started →](getting-started.md)

# Agent integration

Coding agents should build the same canonical video chat as a human developer.
Install the repository skill when the agent supports skills:

```bash
npx skills add VanillaSkyAi/video@vanillasky
```

Then prompt: `Use $vanillasky to set up and verify a general-purpose video chat in this project.`

## Set up the canonical chat

The skill follows this public path in an empty npm project:

```bash
npx @vanillaskyai/video init
npx vanillasky doctor
npm run dev
```

Init generates the thin application-owned shell around the SDK's complete
`VideoChat` experience and runs doctor automatically. The baseline uses an immediate introduction and browser voice, and installs
no optional provider packages. Add the video adapter for moving video answers;
without a media provider, narration and subtitles remain available.
`ANTHROPIC_API_KEY` is the only required key. Rerun init after an interrupted
installation.

If doctor reports a missing key, add the named key to the ignored `.env.local`
yourself. Never read or print a secret value, and never paste one into the chat.
Doctor is the safe capability interface: it reports names and readiness only.

For requested upgrades, run `npx vanillasky providers add speech` for xAI speech
or `npx vanillasky providers add video` for FAL video and transcription. Have the
developer add `XAI_API_KEY` or `FAL_KEY` locally, then restart the server. Stock
media needs only `PEXELS_API_KEY`. The client does not change.

## Verify, do not merely scaffold

The agent should leave the dev server running and open its reported localhost
URL in a real browser. Browser automation should use normal motion
(`reducedMotion: "no-preference"`) so playback advances.

1. Confirm the welcome screen, suggestions, composer, and voice control load
   without console or page errors.
2. Ask one explanatory question and confirm the answer streams, speaks, reaches
   its final frame, and returns to a usable composer.
3. Ask one unrelated creative question in the same conversation and confirm it
   produces a distinct response.
4. If doctor reports generated video ready, verify moving footage throughout
   one complete answer, including its ending, without editing client code.
5. Check failed network responses before reporting success.

The handoff should name the localhost URL and ready capabilities. It should
never include credential values.

## Keep ownership clear

VanillaSky owns the chat flow, planning prompts, templates, validation,
streaming, voice timing, and player. The application owns provider choices,
keys, authentication, persistence, branding, copy, and policy.

Customize generated application files only after the default chat passes in the
browser. Do not inspect SDK internals, copy its template tree, or invent a
parallel integration path. Source-own a template with
`npx vanillasky templates ...` only when the product actually needs to edit it.

The root README and [Getting started](getting-started.md) are the canonical
human references. Evaluation-only package checks remain in the maintainer docs.
