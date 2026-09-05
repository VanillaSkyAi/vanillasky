# Video chat starter

Prompt for an explanation, a story, a recommendation, a creative idea, or
anything else you would ask an AI chat. The response arrives as a narrated
video: scenes stream in as they are planned and the voice stays with the
picture.

<!-- verify:start -->
```bash
npm install
npm run build
npm run dev
```
<!-- verify:end -->

Add one required key to `.env.local`:

```bash
ANTHROPIC_API_KEY=...
```

That is enough for rendered templates and the browser's built-in voice. The
starter installs only the text provider. Enable optional adapters when needed:

```bash
npx vanillasky providers add speech
npx vanillasky providers add video
```

Each command installs its provider package and connects the adapter through
`providers.ts`. Run both commands to enable both upgrades.

- Speech: add `XAI_API_KEY` to replace browser voice with generated speech.
- Video: add `FAL_KEY` for generated video and server transcription.
- Stock: add `PEXELS_API_KEY` for footage and suggestion images; no installation
  is needed.

The adapters live in `providers/` and remain application-owned. Running an
upgrade again can finish an interrupted dependency installation.

Restart the development server after changing keys. Open
<http://localhost:5173> and prompt anything.

## How a response is made

The planner streams a short spoken hook, then complete narrated scenes. When a
generated provider is configured, an early shot can start generating while the
rest of the story is planned. The director chooses footage or one of eight
editorial templates for each beat; there is one cinematic mode.

Playback starts after a contiguous preparation cushion, or after a shorter
complete response is ready. Media is decoded before use. At a late video cut,
the player holds its clock and narration until a usable frame appears, with a
bounded error path. The first hook can play during preparation.

`mediaSource: "generate"` requests a distinctive illustrative shot;
`mediaSource: "stock"` requests approved footage. Generation attempts, including
failures, share the host's `maxGeneratedVideos` ceiling. A stock miss never
broadens the subject automatically. A failed full-bleed scene uses its grounded
`fallbackText` as a chapter card.

## Reviewed stock

The starter's `approvedStock` index in `stock.ts` is deliberately empty. Add an
asset only after inspecting its content, poster and allowed orientations. List
literal matching queries and a reviewed description. Add those available
queries to your host instructions so the planner can choose them when relevant.
An unreviewed query returns `null` without a network search or unrelated result.
The host owns licensing, storage, clip rendition and retention.

The provider names its own model. Override the tested defaults with
`ANTHROPIC_PLANNER_MODEL`, `ANTHROPIC_NARRATION_MODEL`, or `FAL_VIDEO_MODEL`
when needed.
