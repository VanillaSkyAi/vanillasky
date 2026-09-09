# Changelog

Application changes are recorded below. Versioned sections preserve the history
of previously published npm releases.

## Unreleased

- Recover complete answer and shot records when the planner wraps them in a JSON
  array, avoiding an empty failed response while preserving content validation,
  duration limits and rejection of malformed or unsupported containers.
- Add mood-based music from seven normalized tracks, with automatic selection,
  no immediate repeats and the chosen soundtrack retained for replay. Settings
  now has voice, music and scene-sound volume, track shuffle and saved listening
  preferences. Music starts on Ask and continues through loading, the intro and
  the answer. Music defaults to 20%, scene sound to 60% and voice to 100%.
  Background audio softens during narration; master mute and pause control all
  layers together.
- Request subtle environmental and action sounds from generated footage while
  explicitly excluding voices and music. Only footage marked as ambient audio
  is audible in chat; stock fallbacks remain silent.
- Default to word-by-word subtitles with short phrases, a warm active-word
  highlight and reduced-motion support. Remember the chosen style, including
  Classic, without switching styles between speech segments. Keep the complete
  transcript available only after playback. Align generated speech to xAI's
  timestamps and use native word boundaries for supported browser voices.

- Support the first production deployment to an empty Pages project while keeping
  rollback protection for existing deployments. Document initial database,
  secrets and hosting setup for a new fork.
- Split chat session state, response transport, request parsing and response
  streaming into focused internal modules without changing playback behavior.
- Align Node requirements, replace the retired SDK contributor checklist, and
  remove obsolete naming and duplicate acceptance checks.

- Add a quick local check command and automated unused-code detection; remove
  dormant helpers and exports.
- Validate docs without installing dependencies or deploying the app. Select
  browser checks by change scope, share their setup and distribute long media
  scenarios across five standard Playwright shards to shorten app verification.

- Lead the README and setup docs with generated video, the fal inspiration and
  the included video/voice providers. Keep stock footage as an optional alternative.

- Patch development image and YAML dependencies flagged by the release security gate.

- Remove the retired SDK test kit, test-only package entry points and redundant
  composition prompt construction. Keep app behavior and provider callbacks intact.
- Deploy the exact successful main CI artifact without repeating CI or rebuilding;
  verify source identity and output checksums before upload. Consolidate required
  checks under the application gate and update the everyday release instructions.

- Consolidate the website and chat engine into one runnable application with
  one local development command and the website's provider defaults.
- Require real AI planning; use configured Pexels without generated video and
  browser speech without generated voice. Remove demo conversation paths.
- Retire the generated starter and separate npm publication surface. Existing
  published versions remain available; new development uses this application.


## 0.11.3

- Select generated visual treatment by what helps communicate the answer. Missing or invalid planned styles now default to realistic for every intent; valid planned styles and explicit caller looks remain respected.

- Consolidate chat planning into a compact core and one footage-mode block, retaining source grounding, complete endings and shared speech budgets. Keep stock search guidance separate from generated-video timing.

## 0.11.2

- Show the spoken introduction in the normal subtitle line when subtitles are enabled. Keep the opening once in the full transcript, including replay and restored sessions.
- Keep “Ask next” directly above its follow-up thumbnails on desktop and phone layouts.
- Allow one native-speed repeat for a small measured speech overrun on healthy footage, ending when speech finishes. Never repeat solely for the quiet tail; retain chapter recovery for larger or unmeasured overruns and failed media. Planning still targets a 0.8-second tail and never buys an extra clip to fit narration.

## 0.11.1

- Plan single-idea narration with voice headroom against the configured video duration; keep the full repair budget for necessary meaning. Give the single rewrite explicit speech/word budgets and report content-free outcomes instead of silently collapsing timeout, empty, failed and oversized results.
- Account conservatively for spoken expansion of numeric measurements before paid generation, and request spoken-form narration rather than compact symbols.
- Keep stock search and playback independent of generated-video duration/deadline settings. Use reported footage duration when available and the mounted decoder when stock duration is unknown; retain every authored beat within the existing bounded plan.
- Preserve two-second video budgets through composition and preparation. Delivered footage duration governs playback, with the requested duration as a fallback for generated clips; keep the 0.8-second speech tail, native-speed playback and full-narration chapter recovery.
- Adopt a late narration clock without rewinding already-prepared footage. Hold visual time until forward-moving audio catches up; preserve deliberate playhead/audio resets and replay, avoiding unnecessary WebKit seeks and recovery chapters.

## 0.11.0

### Integration and developer experience

- Add optional `resolveAnswer({ prompt, conversation, signal })` for completed existing-assistant answers. Validate input before invoking it; preserve cancellation and fail explicitly on unusable output.
- Separate bounded HTTP admission from response policy; stop oversized streamed bodies without waiting for unresponsive cleanup. Keep inbound limits separate from the SDK-owned answer envelope.
- Add small optional application branding controls with unchanged default UI.
- Update the architecture, quickstart and provider/UI recipes around footage and chapters. Remove retired internal prompt guidance and duplicate prose/source-structure assertions.
- Verify native existing-assistant integration through the installed npm artifact, with no React or provider frameworks required by the server entry.

### Provider setup

- Keep providers application-owned: editable fal, Google, Runway and arbitrary-provider examples share the same client contract, not a fixed vendor list.
- Add `init --native` with plain HTTP text callbacks and no Vercel/Anthropic dependency. Keep the optional Vercel AI SDK starter.
- Separate video, speech and transcription setup; make `doctor` inspect the selected configuration. Bundle the native starter and all adapter helpers in npm.
- Submit video jobs once, retain identity, bound polling/ledger/cleanup callbacks and cancel unfinished work best-effort. Preserve terminal job records and native text finish reasons.
- Require application-owned video storage/delivery in direct-provider examples. No paid generation runs in CI.

### Timing and preparation

- Reset an unexpected native video start during narration preparation so paused WebKit decoders cannot drift ahead and freeze when speech begins.
- Share a clip budget between planning and playback, with a 0.8-second narration tail and one bounded rewrite before any paid clip. If it cannot fit, keep the complete original narration on a chapter.
- Check measured speech and actual decoded footage; play normal footage at native speed without looping. Respect browser speech completion with bounded failure handling.
- Announce completed media ahead of ordered scene delivery. Limit actual decoding to active and next scenes on every browser; isolate speech/media preparation from session state.
- Add content-free duration, buffering, repeat and wait-reason diagnostics. Stop automatically retrying ambiguous cinematic responses.
- Pass requested duration, shot direction and an absolute deadline to application video callbacks; accept actual media duration in results. Allow long-running provider deadlines without client edits.

### Breaking changes

The beta now focuses on footage and chapter opening/recovery. The default chat
experience and saved `cinemaMedia` / `chapterTitle` playback remain supported.
Custom renderers, the five other built-ins, all registry bundles, template CLI
commands, and `/templates` and `/templates/catalog` exports are removed.
Server template registries and custom-registry options are removed as well.
There is no compatibility loader for retired custom-template videos.

Before, applications could install and pass a custom registry:

```tsx
import { createTemplateRegistry } from "@vanillaskyai/video/templates";
const templates = createTemplateRegistry({ templates: customScenes });
<VideoChat options={{ endpoint: "/api/video", templates }} />;
```

### Adoption

Use the built-in video-and-chapter experience. Remove registry imports, custom
template files, authoring scripts and their configuration from your application.
Use visual direction for the footage and the headless hook for custom chat UI:

```tsx
import { VideoChat } from "@vanillaskyai/video/react";
import "@vanillaskyai/video/video-chat.css";
<VideoChat options={{ endpoint: "/api/video" }} />;
```

Keep provider integrations application-owned. npm distribution and optional
Vercel AI SDK integration remain; the SDK does not require `ai`, Anthropic or
any video-provider package. Support is best-effort beta support for the focused
chat flow, not an expanding model compatibility matrix.

## 0.10.23

- Stop shipping the maintainer-only cinematic migration note in the published
  package. The changelog now links it on GitHub.
- Remove the unreferenced text-rendering and emoji modules from the source tree.
  The bundle is unchanged; this code was already excluded from it.
- Correct the repository map in the architecture guide, and drop the stale
  comments that described a text component the templates no longer use. Those
  comments also shipped inside the installable `theme` registry item.
- Remove the CLI redirect for template command names that were renamed before
  the package had users. Use `vanillasky templates <command>`.

## 0.10.22

- Offer eight diverse homepage prompts with curated footage, a balanced fresh-page shuffle, and stable ordering when returning Home.
- Browse four cards on desktop and two on mobile, with only the active card loading video.

## 0.10.21

- Choose illustrated, realistic, or cinematic generated-video direction within the existing chat brief, with consistent treatment across shots and caller style overrides.

## 0.10.20

- Collapse completed-response subtitles to an expandable transcript and remove the Pexels header link.
- Present narration in compact, progressive caption pages while preserving the complete spoken text.
- Reflect host-resolved footage mode when a response falls back to stock.
- Prefer close stock matches while allowing provider-ranked illustrative results and one bounded broader search when no usable footage is found.

## 0.10.19

- Show a subtle preparation status while the first response scene is loading.
- Use the same compact suggestion-card layout before and after answers, and link the logo to the homepage.
- Plan relevant illustrative stock subjects per beat and prefer, rather than require, matching footage orientation in the starter.

## 0.10.18

- Preserve later valid shots after a malformed body record containing an unescaped newline, while keeping malformed initial containers rejected. Bound unfinished JSON records independently of provider chunk sizes.
- Keep the outgoing scene visible while a canonical image backdrop prepares or reaches its bounded chapter recovery.

## 0.10.17

- Let video playback prepare without waiting for an optional poster, while retaining actual video-frame and narration readiness checks.
- Guide shorter, useful spoken openings and compact streamed briefs, with clearer direct answers, comparisons, and narration-aligned actions.

## 0.10.16

- Start the first fully prepared scene without waiting for an eight-second startup buffer, while preserving narration and visual readiness.
- Keep generated narration alive when a superseded playback attempt rejects after pause and resume.
- Give ending suggestions larger responsive cards with complete labels, including narrow embedded players.
- Match simple singular and plural stock subjects in the starter without discarding required subjects or exclusions.

## 0.10.15

- Recover a mislabeled first chat brief only when its complete authored content validates, preserving its shots and ending. Keep malformed JSON and incomplete or later records rejected.

## 0.10.14

- Attach content-free record-shape diagnostics to rejected chat plans without accepting alternate formats or exposing model output.

## 0.10.13

- Plan concise AI answers around the configured video-attempt budget, including the ending, while retaining complete authored narration and chapter recovery.

## 0.10.12

- Use query context to choose between equally relevant Pexels subject matches in the starter, while preserving subject, activity and equipment priority.

## 0.10.11

- Keep the opening chapter visible until the first body visual and narration are ready, without mounting a second player or replaying the opening.
- Keep outgoing silent footage moving, or a chapter readable, while the next clip becomes playable; retain bounded chapter recovery, pause/cancel behavior and two-video preparation.
- Recognize sustained native video motion, reuse fresh readiness across scene promotion, and preserve prepared footage during narration holds instead of rewinding it. Let silent clips loop natively within their finite scene.

## 0.10.10

- Accept multiline streamed chat JSON objects without waiting for the entire answer, while retaining bounded parsing and strict scene validation.

- Wait for a presented frame with playable future data before starting narration, retaining bounded cold startup and quick recovery for footage that stalls after playback was available.

## 0.10.9

- Use essential subject hints and explicit exclusions when selecting starter Pexels footage, and isolate cached selections by those hints. Metadata-free results remain unverified provider-ranked fallbacks.

- Forward bounded optional subject/activity hints to Pexels resolvers from the existing planning stream, without adding fields to emitted scenes or AI-video requests.

- Clarify beginner instructions and condition-dependent advice, and retain essential subjects and activities in Pexels search planning.

## 0.10.8

- Reassert a requested pause if native video playback starts late, preserving footage during delayed narration and keeping viewer pauses in place.

- Distinguish decode errors, frame-readiness timeouts and stalled footage in the local chat diagnostic log without retaining media URLs or user content.

- Correct starter guidance for separate footage modes and remove obsolete planner logs that included raw model output.
- Prepare the next compatible mobile video while the current scene plays, retaining its decoded element across cuts and limiting mounted footage to the active and next scenes.
- Observe cached video frames on mount so a missed loading event cannot delay genuine stall recovery.

## 0.10.7

- Reuse the first presented video frame at scene handoffs so a second readiness observation cannot briefly interrupt continuous narration.

- Keep an already-speaking paragraph uninterrupted across brief visual handoffs, while genuinely late footage still pauses narration until it can play.

- Keep the final chapter visible through answer completion, including recovery from failed footage.
- Derive recovery titles from authored titles or subject excerpts instead of a generic placeholder.

- Let cold footage finish its bounded initial load before treating it as stalled. Require the actual new source to present a frame before narration starts, and keep source changes from cancelling their own native load.

## 0.10.6

- Initialize the reusable narration audio element during the existing user gesture so delayed first speech can play on Safari.

- Accept valid Pexels search results without descriptive URL slugs. Rank available matching metadata above unknown relevance, without requiring most query words to appear in the slug.

## 0.10.5

- Keep footage visible when native playback reports waiting without another playing event. Observe resumed motion directly and recover to the authored chapter after one second without progress, preserving narration.

## 0.10.4

- Show the canonical chapter immediately after submitting a prompt; remove the separate gradient loading placeholder and opening stock requests.
- Separate AI video and Pexels in Settings. AI mode uses generated footage only; Pexels performs full bounded video search without AI-video calls. Missing or late footage becomes an authored chapter with complete narration.
- Prepare speech while footage generates, reuse prepared lines, and limit concurrent speech requests so an answer does not flood host admission. Describe HTTP throttling as a retryable request limit.
- Keep silent footage looping for the finite narrated scene, and recover missing URLs or rejected playback to a chapter rather than an unavailable screen. Preserve user pause, cancellation and replay.
- Allow hosts to configure the actual generated clip duration (default five seconds) and apply scene-position deadlines to media preparation.
- Add optional host-only phase diagnostics with bounded timing and fixed recovery reasons, without retaining prompt or provider content.

## 0.10.3

- Remove the implicit documentary visual style from the chat interface; preserve explicitly supplied application styles and let the answer direct its own look.
- Default chat now plans an answer brief and narrated shots, with an immediate introduction followed by AI-first footage and relevant stock fallback. Creative direction adapts to the request; the model no longer chooses body templates, media sources, scene IDs, or completion commands. Explicit custom template registries retain their existing composition contract.
- Reserve the answer's ending before streaming body shots, retain valid narration when visuals are unavailable, and skip exact repeated opening or ending lines before requesting media.
- Fit short clips to measured narration within a bounded playback rate. If moving coverage runs out, use bounded recovery and an explicit waiting state instead of holding a finished frame while speech continues. Preserve deliberate pauses and audio activation across scenes.
- The optional starter video adapter uses Fal Turbo with five-second clips and intent-specific shot direction; providers, credentials, admission and spending limits remain application-owned.

## 0.10.2

- Keep generated narration playing in Safari after a delayed opening-to-body handoff by reusing the permitted audio element; isolate late playback failures from subsequent lines.
- In drop mode, a media miss without usable authored fallback skips only that scene and preserves later valid scenes and the ending. Strict mode still fails. The skipped beat is reported; its content cannot be reconstructed without a usable asset or fallback.
- Guide first-shot narration to fit its five-second footage budget and develop the answer in later scenes, without imposing a fixed sentence length on the rest of the video.

## 0.10.1

- Continue narration through failed built-in media using the authored fallback or the existing graphic on black. Keep the recovery anchor after URL resolution, and observe actual mounted images for photo readiness.

- Match planning, narration, visual progression and endings to explanations, fiction, comedy, imaginative requests and practical answers. Remove conflicting instructions that forced a factual arc, fixed sentence length or a different template for every beat.
- Ask follow-up generation to exclude questions already answered by the full narration, including paraphrases, and to preserve the conversation’s intent.

## 0.10.0

### Breaking

- Remove `focusCards` from the built-in catalog and generated source templates, as requested. Existing callers must replace it with narration over `cinemaMedia`, or an appropriate comparison/timeline when supported by their content. Persisted videos using that ID must be regenerated before playback with the new catalog.

### Changed

- Opening narration advances into the first shot and body. Exact repeated introductory sentences are removed without additional model calls or startup waits.
- Prefer relevant footage over repeated graphic scenes; use no more than one explanatory overlay in a typical thirty-second answer. Comparison, key figure, quote and timeline can now use optional host-resolved media with a contrast scrim and soft text shadows. Black remains the fallback; chapter titles stay black.


## 0.9.0

- Continue video playback with subtitles when native browser speech cannot start, without weakening generated-audio readiness or counting paused time toward the fallback.

- Show the spoken opening as a quiet chapter on black when opening media is absent or cannot load. Keep it readable until media or the film is ready, without another generation call.

- Package licensed, self-hosted Roboto fallback fonts for the fixed cinematic typography; remove unused promotional template primitives.


### Breaking changes

- Replace the 28 promotional templates with eight cinematic templates: Full-bleed, Chapter, Focus cards, Timeline, Reach out, Comparison, Quote, and Key figure. Graphics use fixed black backgrounds and white/neutral system typography; only Full-bleed and Reach out accept media.
- Remove configurable `brand` input and persisted `style.brand`, and remove the public `VideoBrand`, `VideoBrandInput`, `VideoBackground`, and `resolveVideoBrand` exports. Persisted schema is now `0.2` and streaming protocol is `0.6`; older payloads are explicitly rejected.
- Source-owned templates declare authored reveal, hold and exit minimums. Quote and figure examples remain authoring fixtures and never become factual runtime defaults.

Before:

```tsx
<VideoChat options={{ endpoint: "/api/video-chat", brand: { background: "twilight" } }} />
```

### Adoption

Remove brand options and regenerate source-owned templates from the new catalog. Re-author or regenerate saved videos from retained source material; do not rename old IDs or change their version field blindly. See [cinematic migration](https://github.com/VanillaSkyAi/video/blob/main/docs/maintainers/cinematic-migration.md).

```tsx
<VideoChat options={{ endpoint: "/api/video-chat" }} />
```


## 0.8.8

- Use equal spacing between Sessions, Settings, and Voice controls on mobile and desktop.

## 0.8.7

- Show a clear request-limit error when a suggested opening cannot receive an answer, instead of presenting the opening as a completed video. Preserve completed scenes when a response is interrupted.

## 0.8.6

- Show poster images on suggestion cards while videos are paused or autoplay is blocked, and use conversation bubbles for the Sessions button.

## 0.8.5

- Align Settings section headings above their option containers with consistent spacing.

- Keep generated follow-up prompts to one concise idea, at most eight words and sixty characters, for readable mobile cards.

- Combine new conversations and history in one Sessions menu, and keep the follow-up input visible after playback ends.

## 0.8.4

- Use a curated cloud timelapse for the default welcome screen, while preserving host-selected welcome searches.

## 0.8.3

- Allow hosts to bound generated-video waiting up to two minutes, describe limited generated-video offerings in Settings, and opt into a dismissible media fallback notice.

## 0.8.2

- Adds Docs and GitHub links plus an inline About section to the default VideoChat Settings, keeping developer discovery within the shared interface.

## 0.8.1

- Gives the default `VideoChat` an immersive video canvas, floating voice and text input, contextual playback controls, readable on-video subtitles, and unified dark settings and history. Controls yield to the first subtitle and return on interaction; the stage adapts across desktop and mobile.

## 0.8.0

- The default chat silently recovers from optional failures. Non-fatal diagnostics remain available to applications without appearing in the viewer interface; actionable errors remain visible.

- Adds `maxGeneratedVideos` (default five attempts per response), aligns AI-video planning with that budget, and keeps stock footage available beyond it. Failed searches can reuse matching completed footage once before falling back to a readable template.
- Improves opening stock footage with documented Pexels video-host support and a planner-supplied broader atmospheric query. Video and photo searches share one three-second deadline; available descriptions screen obvious mismatches without an extra AI call.

- Adds local, content-free playback observations for scene presentation, actual speech onset, and waits for the next scene. Measurements ignore stale callbacks and exclude deliberate pauses from stall duration.

- Runs setup checks automatically after init and supports retrying interrupted
  installation. The baseline needs one text-provider key, packaged templates,
  and browser voice; optional speech and video packages install only through
  `vanillasky providers add speech` or `vanillasky providers add video`.

- Bounds optional video, stock, speech, and narration waits so stalled providers fall back without holding the whole answer. Completed responses no longer wait for follow-up suggestions.

- Preserves playable video-chat openings and completed scenes when planning or
  an optional provider fails. Malformed scene lines no longer discard later
  valid scenes; generated footage can fall back to stock and safe templates.
- Continues narration with scene text and browser voice when generated speech
  fails, keeping non-fatal diagnostics available to applications without
  showing recovery notices to viewers.
- Keeps template rendering failures local to a scene, and lets stock searches
  recover from failed lookups or malformed candidates.

### Breaking changes

The supported generation path is now video chat. Removes `useVideo`,
`createVideoHandler`, `useNarration`, `createSceneTimeline`, their public types,
and generic root input types. Chat handler options no longer expose standalone
soundtrack selection, snapshot-retention overrides, or durable-stream replay.
The old one-shot integration is no longer available:

```tsx
const video = useVideo({ endpoint: "/api/video" });
await video.generate({ input: "Explain the Moon's orbit" });
```

### Adoption

Use `npx @vanillaskyai/video init` for the complete app. Existing custom hosts
mount `createVideoChatHandler` with `streamText` and `generateText`, then render
the packaged chat:

```tsx
import { VideoChat } from "@vanillaskyai/video/react";
import "@vanillaskyai/video/video-chat.css";

export function App() {
  return <VideoChat options={{ endpoint: "/api/video-chat" }} />;
}
```

Use `useVideoChat` for a custom interface, `createVideoChatVoice` for a custom
voice, and `parseVideo` plus `VideoPlayer` for saved completed responses. Pass
custom registries to the chat handler and `VideoChat` options. Persist completed
`chat.turns` video values instead of one-shot `generate()` results. Saved `Video`
JSON, including existing soundtrack data, keeps its current storage contract.

## 0.7.1

- Keeps Full AI video responses running when a text provider repeats narration
  beside a scene that already owns the canonical line. The redundant copy is
  discarded before strict plan validation instead of aborting after the first
  generated clip.

## 0.7.0

- Makes blank-folder onboarding one safe scoped command:
  `npx @vanillaskyai/video init`. Init now pins registry installs to the exact
  SDK version that ran it and preserves an exact local tarball during candidate
  verification instead of silently replacing it with an older npm artifact.

- Keeps video-chat responses running when a text provider labels an ordinary
  scene with an unsupported placement hint. The provider adapter drops that
  harmless hint while preserving `placement: "closer"` and strict protocol
  validation.

- Keeps `VideoChat` hydration stable when voice input exists only in the
  browser, and preserves provider warnings, usage, finish reasons, and model
  IDs while the chat opening is intercepted from the planner stream.

- Removes the duplicate one-shot React, Next.js, and provider examples plus
  their obsolete product guides. The generated video-chat app is now the one
  public setup path, while the internal Next.js provider matrix exercises the
  same chat handler and interface.

- Streams each video-chat opening and scene plan from one model call. The first
  NDJSON object carries a bounded 6-9 word hook and stock keyword; Full AI also
  carries its exact first shot so generation starts while the remaining scenes
  arrive. Welcome suggestions can include a prewritten hook that speaks
  immediately with their loaded media, and `onFirstFrame` reports the measured
  handoff to the first real scene.

- Speeds up both video-chat paths. Concurrent media resolution now releases the
  first finished scene immediately instead of waiting for its queue to fill,
  and the main planner writes narration on each scene instead of paying for a
  second text-model round trip. Breaking (pre-1.0): removes the mixed `some` mode;
  use `templates` for rendered responses or `full` for generated footage.

- Starts each video-chat answer with a short spoken hook over relevant stock
  footage, then holds that opening until the first planned scene is ready.
  Welcome and follow-up cards reuse their already-loaded media immediately;
  typed prompts resolve footage from the hook's bounded media keyword. The
  planner receives the exact spoken hook so the response continues without
  repeating or contradicting it.

- Keeps key-only video chat clean in real browsers: planner catalogs now hide
  templates whose required media cannot be supplied, and unavailable generated
  speech switches to browser voice without repeated 404 responses.

- Removes the obsolete source-owned template copy and transcript probes from
  the video-chat starter. The package, lower-level examples, and remaining
  documentation now consistently present voice-and-video chat as the primary
  path, with packed onboarding as its single clean-room browser gate.

- Makes the complete voice-and-video chat the primary README, getting-started,
  agent, provider, concepts, and architecture path. The one-shot composition
  APIs remain documented as an advanced non-chat integration.

- Adds `vanillasky init` and `vanillasky doctor`. Init creates the canonical
  thin video-chat app, installs its app-owned provider packages, starts with
  packaged templates and browser voice, and requests one server-only text key.
  Doctor checks the generated shell and reports optional speech, media,
  transcription, and generated-video capabilities without calling providers or
  printing secrets. Template ownership commands now live under the breaking
  pre-1.0 `vanillasky templates` namespace.

- Adds the complete default `VideoChat` interface and its explicitly imported,
  fully scoped `video-chat.css`. Applications can now mount the same polished
  voice-and-video chat in one component while retaining `useVideoChat` for
  custom interfaces. The canonical starter no longer duplicates the UI,
  interaction, accessibility, appearance, or voice-input code.

- Adds `useVideoChat` and `createVideoChatVoice` to the React entry. The SDK
  now owns video-chat turns, conversation context, cancellation, retry,
  opening speech, narration pacing, suggestions, replay, history selection,
  and the browser-voice fallback behind one provider-neutral endpoint.

- Adds `VideoPlayer.onPlaybackEnd`, which fires when the visible playhead
  actually reaches the end without changing the existing stream-composition
  meaning of `onComplete`.

- Adds `createVideoChatHandler`, one provider-neutral server endpoint for the
  general-purpose video-chat experience. The SDK now owns the response,
  opening, narration, suggestion, speech, transcription, welcome, capability,
  and server-held generated-video budget contracts; applications supply model
  and media callbacks without exposing providers or keys to the browser.

- Reframes the canonical interactive demo as a general-purpose video chat
  starter for explanations, stories, recommendations, and creative prompts.
  It now runs with one text-model key, falls back to browser speech, and unlocks
  generated speech, stock media, transcription, and generated video only when
  their application-owned provider keys are configured.

- Adds `paused` to `VideoPlayer`: hold the playhead where it is, and release it
  from the same frame. It completes `controls={false}`. Turning the player's own
  controls off hands playback to the application, and until now there was no
  lever to drive it with - a narrated answer could silence its voice but not
  stop its picture, and the two came apart. Leaving the prop undefined keeps the
  player's own behaviour untouched, and a video already at its end is not
  resumed by it, since starting again is a replay rather than a continuation.

- Adds `maxResolvedMedia` to `createVideoHandler`: how many scenes in one
  request may resolve media at all. Unbounded by default, which is right when
  media is searched for and wrong when it is generated - the planner decides the
  scene count and every scene is then a paid clip. Past the ceiling a scene keeps
  its copy on the brand gradient, and a `media_budget_reached` warning reaches
  `onWarning` once, since a spend policy is the application's business rather
  than the browser's.

- Adds `useNarration` to the React entry: say a video's narration as it plays.
  The line belongs to the scene, so it begins when that scene does, stops when
  the picture moves on, and can be interrupted. The provider stays with the
  application - it supplies anything that can `speak(text, { signal })`, whether
  a realtime session, a speech model, or the browser's own synthesiser - so the
  package gains no dependency and the choice of voice sits where the choice of
  model already does.

- Adds `getSceneDuration`, `getSceneDurationBounds` and `getSpokenDuration`.
  Templates already declare `minDuration`, `preferredDuration` and which fields
  hold their content, and the runtime already computed a content-aware readable
  duration from them - but internally, so applications reached for `minDuration`
  instead. That is a compression bound, the least a template survives being
  squeezed to when a video must fit a fixed length: 1 second for `media`, 1.5
  for `bigNumber`. A narrated response built on it flashes past. `getSceneDuration`
  answers the real question, taking a scene's `narration` into account, since
  speech is slower than reading.

- Adds `generatedLook` to the video style and to `VideoInput.style`: the visual
  language generated media is produced in. A style has two halves once media can
  be generated - the brand decides how captions are drawn, this decides what the
  footage behind them looks like - and they have to travel together, or a pale
  illustrated ground ends up under dark documentary footage. It reaches
  `resolveMedia` on the resolver context, so a provider prompt no longer has to
  be threaded with it by hand, and it is stored with the video so a replay keeps
  its look. Nothing is rendered from it.

- Adds `mediaConcurrency` to `createVideoHandler`: how many scenes may resolve
  media at once, defaulting to one. Media resolution ran strictly in turn, which
  is invisible for a stock search and costly for generated video - five clips at
  a few seconds each is half a minute of nothing, and the only way around it was
  to plan the shots and generate them outside the plan stream. Scenes are still
  emitted in the order they were planned; only the waiting overlaps.

- Adds `createSceneTimeline`: compose a playable video from scenes the
  application builds itself, appended through the player's `stream` prop.
  `VideoInput.opening` holds a single line of copy, and replacing the `video`
  prop restarts playback, so an application with its own opening scenes
  previously had to emit protocol envelopes by hand - where the sequence, event
  id, scene position and completion snapshot must all be exact and any mistake
  rejects the whole stream silently. `awaitAudio` covers the related trap that
  `audio.set` is only valid before the first scene, by holding openings until
  the soundtrack is known.

- Adds optional `narration` to `VideoScene`: the line spoken aloud while that
  scene is showing. A narrated video previously had to be carried as scenes plus
  a separate script kept in step by index, which drifts; holding the line on the
  scene keeps the two together through planning, playback, storage and replay,
  so a stored video can be spoken again without the model that wrote it. The
  renderer never draws it. Additive and optional, so existing videos parse
  unchanged.

## 0.6.0

- Adds opt-in native scene-video audio to `VideoPlayer`, mixed with the existing
  continuous soundtrack layer under one master mute control. Applications set
  the embedded clip level with `nativeMediaAudio.volume`; the serialized
  soundtrack retains its independent `audio.volume`.
- Passes `requestId` and the resolving `scene` to the server `resolveMedia`
  callback, so applications can generate, attribute, and cache media per scene.
- Documents a provider-neutral app-owned media generation adapter in
  `examples/server-integrations/src/ai-sdk-media.ts`. Generation stays outside
  the SDK install: the application supplies the AI SDK model and storage.
- Extends the isolated rich-media consumer POC with an adaptive `/channel`
  route: structured scene intent, deterministic stock/image/H3 Max routing,
  manual overrides, explicit character/keyframe continuity, factual-safe
  fallbacks, cancellation, deadline-aware generation, and a bounded
  current-plus-next segment queue without changing the SDK API.
- Adds an isolated AI scene-director proof of concept where VanillaSky's trusted
  planner chooses and explains app-owned generated imagery, varied delay-aware
  GIF stickers, and varied progress-driven Lottie motion without changing the
  stable SDK contract.

## 0.5.8

- Moved the public source to a fresh repository at
  `github.com/VanillaSkyAi/video`. No runtime code changed in this release; the
  package, its public API, and its behaviour are identical to 0.5.7.

## 0.5.7

- Keeps one persistent video backdrop element across consecutive iPhone and
  iPad scenes, cross-fades through the decoded incoming poster during Safari's
  source reset, avoids detached iOS preload decoders, and removes the CSS
  poster workaround introduced in 0.5.6. Desktop retains its decoded
  video-to-video cross-fade.

## 0.5.6

- Keeps a video's warmed poster painted behind its frame so Mobile Safari
  cannot expose the brand gradient while transferring its decoder between
  consecutive media scenes.

## 0.5.5

- Keeps a Mobile Safari video poster visible until the replacement video has
  presented its first frame, preventing a poster-to-gradient-to-video flash
  during consecutive media scenes.

## 0.5.4

- Prevents Mobile Safari from holding outgoing and incoming scene video
  decoders at the same time. Video-to-video cuts use the preloaded matching
  poster on iPhone and iPad, while desktop media preroll and crossfades remain
  unchanged.

## 0.5.3

- Makes `crossfade` the default for generated videos and mounts changed media
  invisibly before every contiguous cut, including templates that own their
  transition. This extends the existing media warm-up window so the browser can
  decode the incoming backdrop and replace its stock poster with the real first
  frame while still hidden, instead of flashing the gradient or visibly swapping
  crops after the cut. Making camera motion opt-in also removes the scale reset
  that could look like a quick pullback during the fade.

## 0.5.2

- Refactors composition state transitions into a deterministic, directly
  tested session engine without changing the public API, event stream,
  checksums, or runtime behavior.

## 0.5.1

- Removes the redundant README version badge. Package registries and release
  pages remain the authoritative source for the current version.

## 0.5.0

### Breaking changes

- Simplifies streaming protocol `0.5` to complete immutable `scene.add` parts
  followed by `plan.complete`. It removes `scene.patch`, `asset.patch`,
  `plan.error`, and scene revision counters. Provider failures now use thrown
  errors, while media resolution finishes before its scene is emitted.
- Raises the supported Node.js floor from 20 to 22. Node 20 reached end of life
  and is no longer exercised by the SDK's tests, builds, or clean-room package
  verification.
- Stops returning the merged built-in template catalog through
  `useVideo().playerProps.templates`. `playerProps` now carries only the
  customer registry passed to `useVideo`, while `VideoPlayer` supplies its
  built-in renderers internally. Existing `<VideoPlayer {...playerProps} />`
  usage is unchanged. This removes planner-only metadata from the initial
  React graph, reducing it from 48,197 to 35,649 gzip bytes.

### Adoption

Custom planners that previously emitted a scene and patched it later:

```ts
yield { type: "scene.add", scene: draftScene };
yield { type: "asset.patch", sceneId: draftScene.id, variables: resolvedMedia };
```

should emit one complete scene instead:

```ts
yield {
  type: "scene.add",
  scene: { ...draftScene, variables: { ...draftScene.variables, ...resolvedMedia } },
};
```

Throw planner failures instead of emitting `plan.error`. Protocol `0.4` replay
logs cannot be mixed into a `0.5` run; completed stored `Video` values remain on
the unchanged `0.1` storage schema.

Update applications that pin Node 20 before installing the next SDK release:

```json
{
  "engines": { "node": "20.x" }
}
```

becomes:

```json
{
  "engines": { "node": "22.x" }
}
```

Code that used the player binding to inspect built-in metadata:

```ts
const templates = video.playerProps.templates.listTemplateMetadata();
```

should import the explicit React-free catalog instead:

```ts
import { builtinTemplates } from "@vanillaskyai/video/templates/catalog";
```

Inspect a customer registry directly when the application created it; it is
still passed through `playerProps` unchanged.

### Maintenance

- Makes React 19 the primary development and example runtime. CI continues to
  verify React 18 with its own runtime and type packages, including typecheck,
  focused component tests, and a production build.
- Shares the replay buffer and identical JSON-validation primitives across
  their call sites, removing duplicate implementations without changing the
  public API.
- Keeps the first install provider-neutral, removes stale version and model
  defaults from public guides, and moves the quality-oriented Anthropic/Sonnet
  choice into the later provider setup step.

## 0.4.1

- Keeps soundtrack audio continuous when a saved `VideoPlayer` uses `loop`.
  A track shorter than the visual timeline now repeats as soon as it ends,
  instead of leaving silence until the video itself wraps.

## 0.4.0

- Adds `loop` to `VideoPlayer` for saved videos. A completed video previously
  painted its replay affordance and stopped, so there was no way to run one
  continuously; with `loop` it restarts from the beginning and keeps its
  soundtrack in step. Streaming playback is unchanged.
- Adds `onSceneChange(scene, index)` to `VideoPlayer`, fired when the scene
  under the playhead changes and again on index `0` each time a loop wraps.
  Nothing previously reported playback position to the host: `onComplete`
  reports the end of a stream, so it never fires for a saved video, and any UI
  that had to stay in step ran a parallel timer that drifted silently.
- Exports `resolveVideoBrand` from the root entry. `parseVideo` requires a
  fully resolved brand, and the resolver already existed internally, so
  hand-authoring a `Video` meant copying a defaults blob into application code.
- Documents live channels — continuously playing, self-refreshing video built
  from your own data rather than generated per viewer — in
  `docs/live-channels.md`, with an example compiled against the packed package.

## 0.3.4

- Mounts a scene that brings a new photo or video 1.2s before it appears,
  instead of 0.3s, so the element has time to decode and the scene arrives
  showing its picture rather than a gradient that pops a beat later. The extra
  time is invisible: the layer stays fully transparent until the existing
  0.3s cross-fade begins, so every rendered frame is unchanged, and the mounted
  element is handed to the incoming scene rather than rebuilt. Scenes that
  reuse the backdrop already on screen are unaffected.

## 0.3.3

- Keeps a soundtrack audible on iPhone Safari when its audio context cannot be
  unlocked. Routing a media element into a context that never reaches
  `running` does not fade it, it silences it, so playback now stays on the
  element unless the context is confirmed running.
- Actually preloads scene backdrops. The warm elements were unreferenced the
  moment they were created, so a browser was free to collect them and cancel
  the request mid-flight; they are now held until they finish. Video streams
  are warmed too, not just their posters, which is what left a gradient
  flashing between two consecutive media scenes. One video warms at a time and
  is released as soon as its first frame lands.

## 0.3.2

- Rebuilds text legibility over photo and video backdrops. Scrims now ramp off
  an eased curve instead of a two-stop linear fade, so they no longer leave a
  visible band across the frame, and they are shaped to where each template's
  copy actually sits rather than washing the whole picture. Type over media
  carries its own halo, which lets the scrims stay lighter: the footage keeps
  its contrast and highlights while the headline stays readable.
- Stops darkening the brand gradient for media that never arrives. A dead,
  blocked, or unresolved `mediaUrl` used to leave the full scrim stack over
  the gradient fallback, so the scene rendered as a muddy, vignetted version
  of the gradient scenes beside it. The fallback is now the clean gradient it
  was always documented to be.
- Holds a media scene's scrim back until the backdrop actually paints, so a
  photo or video that is still loading shows the clean brand gradient instead
  of a gradient wearing an overlay meant for footage. The scrim and the
  picture now arrive on the same frame.
- Preloads scene backdrops as soon as their URL is known — including the
  `asset.patch` that carries a resolved stock lookup — so the loading window
  is usually gone before the scene plays. Video posters are warmed; video
  streams deliberately are not.
- Hides playback controls while a video is playing until the viewer hovers,
  focuses, or taps the player, and keeps paused and completed controls visible.
- Makes fullscreen usable on mobile browsers through prefixed fullscreen APIs
  and a viewport-filling fallback when native fullscreen is unavailable.
- Restores configured soundtrack volume and end-of-video fades on iPhone Safari
  by using a Web Audio gain stage for same-origin audio when element volume is
  device-controlled, while preserving direct playback for cross-origin tracks.

## 0.3.1

- Redesigns player controls for each playback state with responsive circular
  icon controls, a sound-first start action, and a dimmed replay treatment that
  leaves the completed poster frame visible.
- Lets applications pass `opening: false` to omit the deterministic opening
  scene and render their own transient loading UI while the first generated
  scene is planned. This keeps loading state out of completed video JSON and
  does not force `media` into the planner's template capabilities.

## 0.3.0

- Documents closer eligibility: a template may close a video only when its
  `jobs` include `"ask"` or `"payoff"`, with the catalog filter an application
  can use to constrain how its videos end.
- Documents provider reasoning and effort controls for planning: models that
  reason by default add that time directly to the first generated scene, so
  hosts that want a video to start quickly should disable extended reasoning
  and tune effort against `timeToFirstSceneMs` and `rejectedSceneCount`.
- Uses a three-second, gradient-backed `media` opening with
  `Creating your video...` whenever `VideoInput.opening` is omitted, while
  preserving supplied opening copy and keeping body-template selection
  independent from the runtime-owned opening.
- Adds an explicit `knowledgeMode` input: source-grounded `input-only` remains
  the default, while `general` lets chat-style video responses use stable model
  knowledge under bounded safety and factuality rules.

## 0.2.0

- Adds an application-owned `resolveMedia` hook that turns bounded semantic
  media intent into approved image or video backgrounds without exposing
  provider credentials, unresolved queries, or untrusted URLs to clients.
- Requires one grounded closer by default, holds it while body scenes stream,
  and emits it last so complete videos finish on a payoff or supplied call to
  action instead of an arbitrary body scene.
- Improves planning for rich inputs with adaptive scene counts, coherent
  multi-entry sequencing, reusable best-fit templates, and explicit partial
  completion warnings when provider or duration limits truncate the plan.
- Adds `VideoPlaybackMode` with sound-first interaction, repeat-stream
  autoplay, manual, muted-autoplay, and immediate-autoplay policies.
- Renders `VideoInput.opening` as a deterministic, asset-free gradient media
  scene and preserves it as the visible start poster before playback.
- Resets replacement streams as fresh playback sessions, keeps completed end
  frames stable, and provides a replay control instead of replaying exit
  animation at the terminal boundary.

## 0.1.1

No runtime changes: the public API, behavior, and dependencies are identical to
0.1.0. This release replaces the 0.1.1-beta line and moves `latest` onto a
single, current version so the repository, npm, and vanillasky.ai agree.

- Simplified the release process to a version bump, an annotated tag on `main`,
  and an OIDC publish. Changesets, the generated Version Packages branch, and
  the npm-latest compatibility gate are removed; the tag job now packs a commit
  CI has already verified instead of re-running the suite.

## 0.1.0

Initial beta release for `@vanillaskyai/video`.

- Generates validated, editable videos from grounded application input through
  provider-neutral Vercel AI SDK streams.
- Supports OpenAI and Anthropic onboarding, with deterministic compatibility
  coverage for Google Gemini and OpenRouter.
- Provides React playback and generation hooks with typed status, warnings,
  errors, abort behavior, and public duration calculation.
- Enforces deterministic pacing, readable final calls to action, semantic brand
  contrast, and browser/server dependency boundaries.
- Persists versioned video snapshots for safe local replay without another
  model request.
- Includes deterministic test utilities and a source-owned template CLI for
  adding, editing, synchronizing, and checking project templates.
- Requires every HTTP handler to declare an authorization policy explicitly;
  the `"none"` escape hatch is reserved for intentionally private or in-process
  use.
- Keeps private supplied-media URLs out of model prompts, treats supplied media
  as an optional approved pool, and validates completed snapshots for replay.
- Reports proposed, accepted, and rejected scene counts alongside requested and
  actual duration, and uses `gpt-4.1` as the documented OpenAI planning baseline.
- Preserves a readable declared poster at the completed-video boundary and can
  reclaim unused closer reserve when a valid plan intentionally has no closer.

The API is beta. Review the frozen surface in `PUBLIC-API.md` before adopting
it in production.

### Compatibility

The `0.1.x` line preserves the documented public entry points and serialized
video round trips across patch releases. Pre-1.0 minor releases may change the
API with explicit release notes. The complete promise and intentional
exclusions are in [PUBLIC-API.md](https://github.com/VanillaSkyAi/video/blob/428692dba90652a2ab8b36cbbed5b60d6e47a528/PUBLIC-API.md).

### First release

This is the beginning of the fresh `@vanillaskyai/video` release line. Adopt
the package through the pinned quickstart and review
[PUBLIC-API.md](https://github.com/VanillaSkyAi/video/blob/428692dba90652a2ab8b36cbbed5b60d6e47a528/PUBLIC-API.md) before relying on the beta contract.
