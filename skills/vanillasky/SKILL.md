---
name: vanillasky
description: Set up and verify a general-purpose voice-and-video chat with @vanillaskyai/video. Use whenever someone wants to install or integrate VanillaSky, create a ChatGPT-style video response experience, start a video chat app, or add spoken video answers to a React application.
---

# VanillaSky

Start from VanillaSky's canonical chat. It already includes the responsive UI,
conversation flow, streaming player, voice input, browser speech, and packaged
templates. Keep the generated application thin; only replace the defaults after
the complete experience works.

## Set up

1. Work in an empty folder and generate the canonical application with the
   scoped package command:

   ```bash
   npx @vanillaskyai/video init
   ```

   If init reports a file, script, or package-type conflict, preserve the
   existing application and use a new empty npm project. Do not recreate the
   starter by copying SDK internals or the template source tree.

2. Init runs doctor automatically. Rerun init if installation was interrupted.
   After adding the required key, check setup through the safe, read-only interface:

   ```bash
   npx vanillasky doctor
   ```

   The base capability is `templates + browser voice`; `ANTHROPIC_API_KEY` is
   the only required key. Templates provide the immediate introduction; add the
   video adapter for moving body footage, with reviewed stock as fallback.
   Without media, narration and subtitles remain available. No optional
   provider packages are installed. For a
   requested upgrade, run `npx vanillasky providers add speech` for xAI speech
   or `npx vanillasky providers add video` for FAL video and transcription.
   Add `XAI_API_KEY` or `FAL_KEY` locally, then restart the server. Stock needs
   only `PEXELS_API_KEY`. The client does not change.

3. If doctor reports a missing key, tell the developer which key name to add to
   the ignored `.env.local` themselves. Never read or print a secret value, and
   never ask the developer to paste one into chat. Do not open `.env.local`;
   rerun doctor to learn only whether each capability is ready.

4. Start the application and keep it running:

   ```bash
   npm run dev
   ```

## Verify the experience

Open the reported localhost URL in a real browser. When browser automation is
available, use normal motion (`reducedMotion: "no-preference"`) so the player
advances.

1. Confirm the welcome screen, suggestion cards, composer, and microphone load
   without console errors.
2. After doctor reports the text key ready, submit one explanatory prompt and
   confirm the answer streams, speaks, reaches its final frame, and returns to
   a usable composer.
3. Submit one creative prompt unrelated to the first. Confirm it stays in the
   same conversation and produces a distinct response.
4. On the doctor line that reports generated video ready, submit one prompt
   that clearly benefits from a generated visual. Verify that it activates
   without changing application code.
5. Check failed network responses and browser console errors. Fix setup or
   runtime failures before reporting success; rendered JSON alone is not
   acceptance.

Leave the working app running and report its localhost URL plus the capability
names doctor marked ready. Report key names only, never values.

## Customize only after acceptance

- Change product copy, branding, provider choices, authentication, persistence,
  and limits in the generated app-owned files.
- Keep the SDK-owned chat, session flow, prompts, voice timing, streaming, and
  packaged templates unless the developer explicitly wants a custom product.
- Use `npx vanillasky templates ...` only when source ownership of a visual
  template is actually needed.

Use the public package and its generated files as the source of truth. Do not
inspect private SDK internals to invent a parallel integration path.
