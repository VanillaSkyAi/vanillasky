# Media, voice, and audio

Provider choice lives in `functions/_video-chat/`. Internal modules define small
server callbacks, advertise only the capabilities that are configured, and keep
all credentials out of React and the browser bundle.

## Subtitle styles

Settings → Watching offers **Classic** subtitles and **Word by word**. Word by word
is the default. It displays short phrases and highlights the
spoken word, with motion disabled when reduced motion is preferred. The style
is remembered in this browser; hiding subtitles does not change the choice.
During playback, both styles keep the complete transcript out of the way.
**Show transcript** becomes available when the answer ends, even with subtitles off.
Word captions hold their phrase between voice segments; muted speech uses
estimated reading time in the same style. The complete transcript remains
available after silent playback.

The xAI speech adapter requests character timestamps with the audio and converts
them to validated word intervals. Highlighting follows the same audio clock as
playback, including pauses and replay. Audio without usable alignment uses
estimated pacing. Requesting xAI timestamps includes a provider alignment pass,
so the application gives speech generation ten seconds and the browser twelve
seconds for the complete request, transfer and decode.

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

Replace the route's `searchMedia` callback to use a different licensed catalog:

```js
const handler = createVideoChatHandler({
  // ...planning callbacks
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
approved image or video URL, which is validated before it
reaches a scene. Return `null` when no licensed, safe, relevant asset exists;
the chat displays an authored chapter while retaining the spoken answer.

For Pexels, keep `PEXELS_API_KEY` on the server, enforce a deadline, filter for
suitable renditions, and return only validated Pexels asset domains. Licensing,
attribution, caching, MIME checks, and byte limits belong to the route.

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

Set `generatedClipDurationSec` to the ordinary duration your video adapter
requests (handler default 5, supported range 2–20 seconds). Optional
`firstGeneratedClipDurationSec` selects a shorter first scene within that range.
The application sets these to eight and five seconds respectively. An ending
that follows developing scenes gets eight seconds even though it is authored
early; an ending-only answer gets five. Five scenes use 37 seconds of footage
within the 40-second planning ceiling. Keep provider settings and spending limits
aligned; longer requests cost more even with the same clip-count allowance.

The planner leaves a 0.8-second tail plus drafting headroom: six ordinary words
for the first scene, eleven for later scenes. One bounded rewrite may shorten an
oversized beat while generated footage prepares, keeping one complete idea and
its necessary qualifiers. Failed shortening retains the original narration and
footage. It does not request longer or additional generated clips. These estimates
reduce overruns; a 99% fit target requires measurement against actual voice output.
An eight-second generated asset is not an eight-second minimum display time.
Prepared playback follows measured speech plus its short tail and readability
floor, using a shorter portion of the available footage when appropriate.

Healthy footage plays at native speed and repeats on the same decoder for as
long as its narration needs. Chat uses confirmed speech onset and the actual
completion promise for generated-voice playback. A
pending voice cannot start repetitions. Playback retains its eight-second
over-budget completion deadline and the voice's own timeout. Repetition ends
with speech; it never fills an extra quiet tail. Fitting speech retains the
available tail within its first pass. Pause holds the current pass, and replay
starts a fresh playback lifecycle. Missing media and failed/stalled decoders
still recover to a chapter without cutting off narration or buying another clip.

Without a live narration-completion callback, repetition requires fresh measured
speech and is bounded by that recording's duration. A custom voice must return
`supportsOffsets: true` from `prepare` only when its audio is measured and
seekable. Estimates and persisted variables cannot certify a measurement.
In-memory replay keeps its prepared timing; the mounted decoder
checks each pass against the actual footage duration and playback health.

`generateVideoTimeoutMs` sets the first-shot preparation budget (default 15 seconds).
Later deadlines account for their position in the answer rather than restarting
an unlimited wait. Hosts must honor cancellation. A missed deadline selects the
authored chapter instead of a second paid generation or cross-mode stock search.

## Voice and transcription

Without `generateSpeech`, `VideoChat` plays without narration. Add a speech
callback for generated voice:

```ts
generateSpeech: async ({ text, signal }) => {
  const speech = await synthesize(text, { signal });
  return { audio: speech.bytes, mediaType: speech.mediaType };
},
```

The chat runtime measures or estimates each line, keeps narration synchronized with the
picture, and prevents a new scene from replacing speech that is still playing.
If generated speech fails, playback continues silently and never substitutes
the device's browser voice.

Add `transcribe` for server-side microphone transcription when browser speech
recognition is unavailable. Set `maxAudioBytes`, validate the media type, and
apply a provider deadline.

## Native clip audio and soundtrack

Settings has separate voice, music and scene-sound volume controls. Initial
levels are 100%, 20% and 60%; the speaker button mutes all three without losing
their settings. Listening preferences are remembered on the device. Background
levels stay constant during narration, speech pauses and buffering. Music fades
at the beginning and end; deliberate pause and microphone capture pause playback together.
Generated narration volume changes immediately. The speaker button still mutes
the current line immediately.

Music starts when the viewer presses Ask, continuing through loading,
the opening and the answer with one continuous track. Auto starts with a calm
track and keeps it for the entire answer, even if the answer brief suggests
another mood. Without an initial track, the brief can select Calm, Focused,
Upbeat or silence. Viewers can choose a mood or turn music
off. Selection avoids the previous eligible track when another is available
and survives scene changes, pauses and replay. “Try another
track” and mood changes update music without generating new footage or speech.
Returning to Auto restores that answer's initial soundtrack; new answers use
automatic selection. Unavailable music never blocks the spoken answer.

On iPhone and iPad, generated narration and music use decoded audio buffers in
one gesture-resumed Web Audio context, with separate gains. Audible native video
can interrupt ordinary audio elements on iOS; routing those elements through
Web Audio does not remove that restriction. Remote video retains its native
audio path. Other browsers retain native narration and soundtrack playback.
Ask also unlocks a pool of two native video elements on iOS. Reusing those
elements for the active and upcoming clips preserves audible playback permission
after the initial gesture expires; switching sources keeps the same permission.
Music downloads are limited to 8 MiB, five minutes and 128 MiB of decoded PCM
per track; a shuffle retains at most two tracks during its crossfade. Generated
speech uses a 32 MiB decoded cache, allowing a single larger current line.
Where Audio Session is supported, playback uses its playback category;
microphone capture temporarily restores automatic category selection.

The seven included tracks have been normalized for consistent perceived
loudness. Their source, license and processing measurements are in the
[audio library](../public/audio-library/README.md). Music follows narration's
timing; beat markers do not drive these narrated answers.

The configured fal H3 Max Turbo model supports native audio through its prompt.
The application requests subtle environmental and action sounds, explicitly
excluding all voices, speech, dialogue, singing and music. Narration and music
are separate playback layers. Provider capability does not guarantee adherence
on every generated clip; a clip-volume control cannot separate unwanted voices
or music once they are mixed into that clip.

Custom video adapters opt in with `generatedVideoAudio: true` and return
`audio: "ambient"` on suitable video results. This marker survives scene
preparation and saved playback. Chat only enables native audio for marked
footage, so an unmarked stock fallback stays silent. The scene-sound control is
shown when the provider supports it or the saved answer contains marked clips.
Browsers that cannot attenuate remote clip audio keep it muted rather than
playing it at full volume. No mandatory upload or media proxy is required.

A serialized `Video` can also carry a soundtrack for replay or custom playback.
Soundtrack files, licenses, beat markers, volume and fade-out belong to whatever
supplies them; narration and speech synchronization stay with the player. Browser autoplay rules still require a viewer
interaction before audible playback on many devices.

## Safety rules

- Keep every provider key in server-only environment variables.
- Never let a planner return arbitrary final media URLs.
- Bound query length, response size, duration, concurrency, and generated spend.
- Preload upcoming footage and pause narration honestly when usable media is late.
- Plan enough moving footage for the spoken beat; do not hold a finished frame
  while narration continues.
- Return a safe fallback instead of leaving the response waiting forever.
