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

The default text adapter uses the optional Vercel AI SDK. Add its key to `.env.local`:

```bash
ANTHROPIC_API_KEY=...
```

Prefer native callbacks? In a new folder run `npx vanillasky init --native` and
set `GEMINI_API_KEY`. This installs editable Gemini REST text callbacks without
`ai` or `@ai-sdk/anthropic`. The SDK itself requires neither Vercel nor Google.
Change `providers/text.ts` to use any text model or your own service.

That enables the introduction and browser voice. Add the video adapter for
generated footage; without media, narration and subtitles remain available.
The starter installs only the text provider. Enable adapters as needed:

```bash
npx vanillasky providers add speech
npx vanillasky providers add video fal
npx vanillasky providers add transcription
```

Video choices are `fal`, `google`, `runway`, or `custom`; omitting a name selects
fal. Pick one. These are editable reference integrations, not an SDK vendor
registry. Video and transcription use native `fetch` with no provider packages.
Only the optional speech upgrade installs `ai` and `@ai-sdk/xai`.

- Speech: add `XAI_API_KEY` to replace browser voice with generated speech.
- Video: `FAL_KEY`, `GEMINI_API_KEY`, or `RUNWAY_API_KEY` for the selected vendor,
  plus your app-owned video delivery callback described below.
- Transcription: add `FAL_KEY` for Whisper independently of your video vendor.
- Stock: add `PEXELS_API_KEY` for footage and suggestion images; no installation
  is needed.

The adapters live in `providers/` and remain application-owned. Running an
upgrade again can finish an interrupted dependency installation.
To switch an already-installed video vendor, replace `providers/video.ts` with
the corresponding packaged reference (or your implementation) and update
`vanillasky.videoVendor` in package.json. The CLI will not overwrite edited code.

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

Speech and video prepare together. Each adapter owns its model, duration,
resolution, concurrency and deadline; its exported preset forwards those values
to the handler. Do not override the preset's `generatedClipDurationSec` without
changing the model request, too. It returns `durationSec` with the delivered
video. The SDK budgets narration to the clip and holds its last frame if speech
still overruns; failed media becomes a simple authored chapter.

The fal reference requests five seconds at 480P, concurrency 3, deadline 120s.
Google Veo requests six seconds at 720p, concurrency 2, deadline 360s.
Runway Gen-4.5 requests five seconds at 720p, concurrency 2, deadline 180s.
These are explicit starting policies, not measured performance promises.
Google and Runway may take minutes. Preparing scenes early and playing them in
order does not make a provider's job API a real-time video stream.

Each request submits paid generation once and retains its job ID while polling.
An ambiguous network failure is never automatically resubmitted. Inspect the
provider dashboard before retrying. To survive process restarts, add an
`onSubmitted` callback to `runVideoJob` that persists the ID in your job ledger.
Abort/deadline stops polling and requests best-effort cancellation on fal/Runway.
Google Veo has no documented cancellation operation; accepted work can still
complete and be billed. Cancellation never promises a refund.

### App-owned storage and delivery

Every direct video adapter requires a delivery callback. `video-delivery.ts`
includes an example for **your own** upload endpoint: configure `VIDEO_UPLOAD_URL`
and `VIDEO_STORAGE_TOKEN`; the endpoint accepts `PUT` MP4 bytes with a `jobId`
query parameter and returns `{ "url": "https://your-cdn.example/clip.mp4" }`.
This endpoint is not supplied by VanillaSky. Replace the callback with your
existing S3/R2/storage code and update `videoDeliveryConfigured` if preferred.
Until delivery is configured, the starter does not submit video jobs.

The callback receives server-side bytes, the job ID and clip duration. Google
downloads require a private API key; that key and its private video URI must
never be sent to the player. Store all vendors' temporary results long enough
for playback/replay. Deliver H.264 MP4 with the moov atom at the front, correct
Content-Type/Content-Length, byte-range support and appropriate CORS. The app
owns storage, access rules, retention and deletion; the core SDK owns none of it.

`providers add video custom` supplies a callback skeleton for any native API or
vendor SDK. Fill in submit, poll, optional cancel and deliver, then wire the
factory into `videoProvider.generateVideo`. There is no vendor allowlist in the
core API. Update `vanillasky.requiredEnv` for custom text key requirements;
`doctor` checks configuration locally and never submits a paid test job.

The provider names its own model. Override the tested defaults with
`ANTHROPIC_PLANNER_MODEL`, `ANTHROPIC_NARRATION_MODEL`, `GEMINI_TEXT_MODEL`,
`FAL_VIDEO_MODEL`, `GOOGLE_VIDEO_MODEL`, or `RUNWAY_VIDEO_MODEL`
when needed.

API references checked for these examples: [fal queue](https://fal.ai/docs/documentation/model-apis/inference/queue),
[fal H3](https://fal.ai/models/minimax/h3-max-turbo/text-to-video/api),
[Google Veo](https://ai.google.dev/gemini-api/docs/video),
[Runway](https://docs.dev.runwayml.com/api/),
[native Gemini text](https://ai.google.dev/gemini-api/docs/generate-content/text-generation).
The offline tests check request/response contracts; they do not establish live
model quality, account access, provider availability or paid generation speed.

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
