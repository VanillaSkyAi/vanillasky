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

Choose AI video or Pexels in Settings. Each mode uses only its selected footage
provider, and both use chapter scenes when footage cannot be prepared. AI video
attempts, including failures, share the host's `maxGeneratedVideos` ceiling.
Exhausted allowance recovers directly to authored chapters without stock calls.
The Pexels adapter searches the full catalog with bounded subject matching,
orientation selection and caching; it no longer requires a reviewed index.
Custom interfaces must display a prominent [Pexels](https://www.pexels.com) credit.

Speech and video prepare together. Keep `generatedClipDurationSec` aligned with
the duration actually requested by the video adapter (five seconds by default).
The planner writes natural short beats; measured speech controls scene timing.
Silent footage loops through any remaining narration. Cancellation stops pending
work and playback, and failed media becomes the authored chapter.

The provider names its own model. Override the tested defaults with
`ANTHROPIC_PLANNER_MODEL`, `ANTHROPIC_NARRATION_MODEL`, or `FAL_VIDEO_MODEL`
when needed.

### Stock selection hints

In Pexels mode, the same planning stream can supply an optional
`scene.variables.stockSelection` to the application's media resolver:

```ts
{ subject: "cyclist", activity: "riding", equipment: "bicycle", exclude: ["motorcycle"] }
```

`subject` names the essential actor or object separately from the search query's
setting. `activity`, `equipment` and `exclude` are optional. Each phrase has
one to four words and at most 48 characters; `exclude` has at most three phrases.
The SDK validates these fields, drops unknown keys and invalid optional values,
and omits the whole hint when the essential subject is missing or invalid.
It never guesses that subject from the first query word.

Adapters can use this hint to prefer matching subjects and reject explicitly
contradictory metadata while keeping the query broad enough for catalog search.
Missing metadata remains uncertain, not proof of a match. The hint does not
verify the depicted action or factual correctness. It is omitted from AI-video
requests and removed before scenes are emitted or persisted; it adds no model
request or public scene field.
