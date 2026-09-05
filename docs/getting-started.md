[← Documentation home](../README.md) · [Next: Provider integration →](provider-integration.md)

# Getting started

The fastest VanillaSky integration is the complete, general-purpose video chat.
It starts with packaged templates and browser voice, then turns on optional
speech and generated video when you install their adapters and add server keys.
Stock media needs only its server key.

## Create the app

Start in an empty folder:

```bash
npx @vanillaskyai/video init
```

Init installs the exact SDK version that ran it, creates a small application
shell, installs baseline dependencies, and runs doctor automatically. Optional
speech and video packages are not installed. If installation is interrupted,
rerun the same init command to finish setup.
It does not copy VanillaSky's template tree. The important generated files are:

| File | Your application owns |
| --- | --- |
| `src/main.tsx` | The mount point for the SDK-owned chat |
| `server.ts` | Provider choices and callbacks |
| `stock.ts` | Optional stock search policy |
| `vite.config.ts` | Local UI and `/api/video-chat` endpoint |
| `.env.local` | Ignored server-only credentials |

The generated browser entry is intentionally tiny:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { VideoChat } from "@vanillaskyai/video/react";
import "@vanillaskyai/video/video-chat.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode><VideoChat /></StrictMode>,
);
```

The SDK owns the responsive interface, conversation state, suggestions, voice
input, narration pacing, streaming player, and packaged templates. Your shell
stays responsible for providers, keys, authorization, limits, storage,
branding, and product copy.

## Add the one required key

Add the text-provider key to the generated, ignored `.env.local`:

```dotenv
ANTHROPIC_API_KEY=
```

Fill the value locally; do not expose it through a client-prefixed environment
variable. Then inspect the setup without calling any provider:

```bash
npx vanillasky doctor
```

The base experience reports `templates + browser voice`. `ANTHROPIC_API_KEY`
is the only required key. Doctor checks setup locally without calling providers
and reports names and readiness, never values.

## Add optional capabilities

Install only the capability you want:

```bash
# Generated speech: installs the xAI adapter
npx vanillasky providers add speech

# Generated video and transcription: installs the FAL adapter
npx vanillasky providers add video
```

Add `XAI_API_KEY` for speech or `FAL_KEY` for video and transcription to
`.env.local`, then restart the dev server. Stock media needs only
`PEXELS_API_KEY`; no extra package or command is needed. The client stays the
same. Rerun an interrupted provider command to finish its installation, then
check readiness with `npx vanillasky doctor`.

## Run and verify

```bash
npm run dev
```

Open the reported localhost URL. Try one explanatory question and one unrelated
creative request in the same conversation. Confirm each response starts with a
spoken hook from the response stream before the full plan is complete, holds its opening until the first
scene is ready, reaches its final frame, and leaves the composer ready for
another turn. With stock media enabled, click a welcome or follow-up card and
confirm its footage carries directly into that opening. With generated video
enabled, confirm that relevant generated shots and editorial templates form one
cinematic response, and the first shot continues the hook without repeating it.

The generated local authorization accepts localhost only. Replace it with your
real session check, rate limits, and usage policy before deploying.

## Continue

- Change providers or add media capabilities in [Provider integration](provider-integration.md).
- Brand or reshape the default experience in [Customization](customization.md).
- Use a fully custom UI with the headless chat hook described in
  [Provider integration](provider-integration.md#custom-interface).
- Copy and edit a visual only when needed in [Custom templates](custom-templates.md).
- Apply production authorization and key handling from
  [Production](production.md) and [Security](security.md).
