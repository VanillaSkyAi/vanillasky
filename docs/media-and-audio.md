[← Documentation home](../README.md) · [Previous: Customization](customization.md) · [Next: Customization →](customization.md)

# Media, voice, and audio

VanillaSky keeps provider choice in the application. The chat runtime defines small
server callbacks, advertises only the capabilities you configure, and keeps
all credentials out of React and the browser bundle.

## AI-first video answers

The default chat displays the real chapter template immediately, then prepares
speech and footage concurrently. Choose `mode: "cinematic"` for AI video or
`mode: "pexels"` for stock. The UI labels these choices **AI video** and **Pexels**.
Pexels mode never generates video. Failed or late AI clips become authored
chapters with complete narration and subtitles. Separately, the application can
use configured Pexels when a public viewer exhausts their personal AI-video
allowance, including during an answer; unavailable Pexels is never selected.
Other exhausted generation budgets retain chapter recovery.

## Pexels search

The application performs bounded full-catalog Pexels video search with subject
matching, orientation-aware renditions and a bounded cache. Add `PEXELS_API_KEY`
on the server and choose Pexels in Settings. The default header has no Pexels
link; the application owns any attribution required by its media provider.

Applications can replace `searchMedia` with their own licensed catalog:

```ts
createVideoChatHandler({
  authorize: verifySession,
  streamText: planWithYourModel,
  generateText: runSmallTextTask,
  searchMedia: async (query, { purpose, orientation, signal }) => {
    const asset = await searchApprovedCatalog({
      query,
      purpose,
      orientation,
      signal,
    });
    return asset
      ? { url: asset.url, type: asset.type, posterUrl: asset.posterUrl }
      : null;
  },
});
```

The planner emits a short semantic keyword, not a URL. The callback returns an
application-approved image or video URL, and the chat runtime validates it before it
reaches a scene. Return `null` when no licensed, safe, relevant asset exists;
default chat displays an authored chapter while retaining the spoken answer.

For Pexels, keep `PEXELS_API_KEY` on the server, enforce a deadline, filter for
suitable renditions, and return only validated Pexels asset domains. Licensing,
attribution, caching, MIME checks, and byte limits remain application-owned.

## Automatic visual direction

Default chat uses the existing answer brief to choose the requested form:
explanation (including comparisons), practical instruction, story, comedy, or
imagination. These shape the content and pacing; they do not change knowledge
rules or provider allowances.

The same brief can select realistic, illustrated or cinematic treatment.
Realistic is the fallback when no valid style is selected. Answer intent does
not force a particular appearance. The planner can use illustrated or cinematic
footage when the request calls for it.

An explicit style request in the prompt takes priority over the default. The
planner carries its response-specific subjects, palette and setting in the
brief's visual direction. Every body shot and ending receives the same selected
base treatment through `generatedLook`, alongside its individual `shotDirection`.
Adapters must pass both to their video provider. An explicit
`style.generatedLook` replaces the automatic base treatment.

There is no separate classification call or image-generation stage. Selecting a
look does not guarantee that independently generated clips preserve character
identity. Evaluate actual footage for subject consistency, useful action,
narration fit and completion; mocked responses only verify the integration.

Pexels retains literal footage queries; these instructions cannot restyle stock
assets. The opening chapter keeps its existing appearance. Automatic direction
is generation-time guidance, not a new persisted style field; saved media keeps
its rendered appearance and existing caller-supplied style persistence is
unchanged.

## Generated shots

Add `generateVideo` to enable generated shots within cinematic responses. It receives the planned visual
subject plus the generated look so every clip can follow the same direction:

```ts
createVideoChatHandler({
  authorize: verifySession,
  streamText: planWithYourModel,
  generateText: runSmallTextTask,
  generateVideo: async (subject, {
    generatedLook,
    orientation,
    requestId,
    scene,
    signal,
  }) => {
    const asset = await generateAndStore({
      subject,
      generatedLook,
      orientation,
      requestId,
      sceneId: scene?.id,
      shotDirection: typeof scene?.variables.shotDirection === "string"
        ? scene.variables.shotDirection : undefined,
      signal,
      maxRetries: 0,
    });
    return asset ? { url: asset.url, type: "video" } : null;
  },
});
```

One model stream supplies an answer brief and shot descriptions. The runtime
prepares ordered shots while the model continues planning; the first and later
body shots follow the same path. Use `requestId` and `scene.id` as
an idempotency key, because generated clips are billable. Keep `maxRetries: 0`
inside provider calls, honour `signal`, and make retries an explicit product
decision with a known budget.

VanillaSky does not depend on a video model or storage service. The application
owns the provider key, model, spend, generated bytes, retention, and delivery.

### Timing and recovery

Set `generatedClipDurationSec` to the duration your video adapter actually
requests (default 5, supported range 2–20 seconds). Keep it aligned with provider
settings and host spending limits. The planner fits natural spoken beats to that
budget with a 0.8-second tail. One bounded rewrite may shorten an oversized
beat before generation; otherwise its complete narration stays on a chapter.
Measured audio and actual decoded footage are checked before playback. Normal
footage plays once at native speed. If measured speech itself exceeds a healthy
clip by at most the smaller of one second or 25% of its length, playback may
repeat that same clip once, stopping when speech finishes. It never repeats just
to fill the quiet tail: when speech already fits, a shorter available tail is
allowed. Larger or unmeasured speech overruns, missing media and failed/stalled
decoders still recover to a chapter without cutting off narration or buying
another clip. The mounted decoder rechecks the bound against actual footage;
pause/resume does not grant another repeat, and explicit replay starts a fresh
playback lifecycle.

Repeat eligibility uses the prepared audio's decoded duration, not a browser
speech estimate. A custom voice must return `supportsOffsets: true` from
`prepare` only when its audio is measured and seekable. In-memory replay keeps
that prepared timing; the mounted decoder still enforces the repeat bound.

`generateVideoTimeoutMs` sets the first-shot preparation budget (default 15 seconds).
Later deadlines account for their position in the answer rather than restarting
an unlimited wait. Hosts must honor cancellation. A missed deadline selects the
authored chapter instead of a second paid generation or cross-mode stock search.

## Voice and transcription

Without `generateSpeech`, `VideoChat` uses the browser voice. Add a speech
callback for a consistent generated voice:

```ts
generateSpeech: async ({ text, signal }) => {
  const speech = await synthesize(text, { signal });
  return { audio: speech.bytes, mediaType: speech.mediaType };
},
```

The chat runtime measures or estimates each line, keeps narration synchronized with the
picture, and prevents a new scene from replacing speech that is still playing.
If generated speech fails, the interface can fall back to browser speech.

Add `transcribe` for server-side microphone transcription when browser speech
recognition is unavailable. Set `maxAudioBytes`, validate the media type, and
apply a provider deadline.

## Native clip audio and soundtrack

Generated clips can contain diegetic audio. The chat player keeps that audio
separate from narration and uses one master mute control. Avoid generated
voiceover or music inside clips so it does not compete with the answer voice.

A serialized `Video` can also contain an application-owned soundtrack for
replay or custom playback. Soundtrack files, licenses, beat markers, volume,
and fade-out remain host-owned; narration and speech synchronization remain
the chat layer's responsibility. Browser autoplay rules still require a viewer
interaction before audible playback on many devices.

## Safety rules

- Keep every provider key in server-only environment variables.
- Never let a planner return arbitrary final media URLs.
- Bound query length, response size, duration, concurrency, and generated spend.
- Preload upcoming footage and pause narration honestly when usable media is late.
- Plan enough moving footage for the spoken beat; do not hold a finished frame
  while narration continues.
- Return a safe fallback instead of leaving the response waiting forever.

[← Documentation home](../README.md) · [Previous: Customization](customization.md) · [Next: Customization →](customization.md)
