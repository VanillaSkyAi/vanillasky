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

That enables the introduction and browser voice. Add the video adapter for
generated footage; without media, narration and subtitles remain available.
The starter installs only the text provider. Enable adapters as needed:

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

The planner streams an answer brief and short narrated shots through one model
call. A template introduction starts while footage prepares; body shots contain
moving footage, narration and subtitles. Intent changes the visible actions and
pacing, not the rendering pipeline.

The SDK tries generated footage first, then relevant approved stock when the
provider is unavailable, denied, or fails. Attempts, including failures, share
the host's `maxGeneratedVideos` ceiling. A stock miss never broadens the subject
automatically. If no relevant footage is available, narration and subtitles
continue with an unavailable-visual state.

Plan narration that fits the provider's five-second clips. Playback measures
speech and prepares upcoming media before cuts. Verify full answers, including
longer-than-expected speech and late or failed footage; a finished clip must not
freeze while the answer keeps speaking.

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
