[← Documentation home](../README.md)

# Customization

## Video chat interface

The default `VideoChat` uses an immersive video canvas with a floating
conversation field, on-video subtitles, and a single dark settings/history
treatment. See [interface behavior](immersive-interface.md) and the
[component reference](reference/design-system.html). Pass a custom welcome
heading and a root class when the application needs its own copy or chrome colors:

```tsx
<VideoChat
  className="acme-chat"
  welcomeTitle={<>Ask Acme<br />See the answer</>}
/>
```

Override the scoped custom properties after importing
`@vanillaskyai/video/video-chat.css`; the selectors and values stay local to
that instance:

```css
.acme-chat {
  --vs-media-glass: rgb(18 24 40 / 80%);
  --vs-media-text: #f8f8fc;
  --vs-voice: #e11d74;
  --vs-font: "Inter", sans-serif;
}
```

The built-in navigation carries the VanillaSky logo. `welcomeTitle` changes
the welcome heading; it does not replace the navigation logo. Graphic scenes
use fixed black backgrounds and white/neutral system typography.

Use `options` for the endpoint, templates, orientation, request
headers, and an optional custom voice. Provider capabilities are discovered
from the server. Use `useVideoChat()` only when the application needs to own the
entire interface.

Pass the following visual settings through `VideoChat` or `useVideoChat` options.
Keep viewer context in the prompt and completed conversation turns; use the
server handler’s `instructions` for trusted product guidance.

## Cinematic visual direction

Graphics use black backgrounds and white/neutral typography. Full-bleed media
and Reach out can show naturally colored footage; the other six templates
explain with their own composition and motion. There is no brand-kit option.

The host can provide a shared `generatedLook` description for media preparation.
Custom source-owned templates can define their own visual language in code.
Do not rely on old global brand, text-effect, or gradient controls to restyle
the eight cinematic templates.

## Opening

The planner streams a short spoken hook before the scenes. The chat holds that
opening until its speech finishes and the first scene is ready. A selected
suggestion can start with its prewritten opening and already-loaded media:

```ts
await chat.ask(card.prompt, { opening: card.opening, openingMedia: card.media });
```

Openings and scene narration share the chat voice and pause/mute controls.

## Aspect ratio and responsive layout

The player is responsive by default: it fills its container width. Templates
and copy must work at either aspect ratio; orientation is not an AI-planning
input and must not influence the selected templates or wording.

`portrait` reserves a 9:16 response/export frame and `landscape` reserves 16:9.
This input setting remains stable in the completed config. For an embed that
should display landscape on desktop and portrait on mobile without changing the
saved response, pass `orientation="auto"` to `VideoPlayer`; it responds
to its container width. See [responsive orientation](responsive-orientation.md).

## Media and voice

Configure `searchMedia`, `generateVideo`, and `generateSpeech` on the server
handler. They progressively enhance the same chat; failed optional providers
fall back to templates or browser voice. See [Media and voice](media-and-audio.md).

## Custom templates

The built-in catalog needs no setup. Only source-owned templates need the
optional local TSX compiler; install it once with `npm install --save-dev tsx`.
Then use `npx vanillasky templates create <id>` for an original one-file template or
`npx vanillasky templates add <builtin>` to copy a close built-in. Edit the owned file,
run `npx vanillasky templates sync`, then run `npx vanillasky templates check` before committing.
Pass the generated registry to the server and browser; project-owned IDs
replace matching built-ins and new IDs extend the catalog.

The model sees selection guidance and a schema, not component source. It chooses
a trusted template and fills validated variables. Never evaluate model-authored
React, HTML, CSS, or JavaScript on the live path.

See [custom templates](custom-templates.md).
