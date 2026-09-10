# Video-chat performance

## Generating ahead of playback

The app is built around a useful property of fast video providers: a scene can
be generated in less time than it takes to watch it. [fal's H3 Max benchmarks](https://fal.ai/learn/devs/introducing-h3-max-by-fal)
inspired this approach. The included adapter uses H3 Max Turbo with five-second
clips; upcoming footage can prepare while an earlier scene plays.

Provider generation time and prompt-to-playback time measure different things.
Queueing, answer planning, narration preparation, transfer and decoding can still
leave the viewer waiting. Measure the first audible speech and first moving
footage separately, then track gaps between scenes. A provider benchmark alone
does not establish smooth end-to-end playback.

## Observe the application

Measure the moment the response becomes visible and audible, and any wait for
its next scene. Attach local observations without changing the default UI:

```tsx
import { VideoChat } from "../src/react";
import "../styles/video-chat.css";

export function App() {
  return <VideoChat options={{
    onPlaybackMetric(metric) {
      console.info(metric.type, metric.elapsedMs);
    },
  }} />;
}
```

The chat runtime sends nothing to a telemetry service. Events contain only an opaque
turn ID, mode, relative timing, and fixed event categories. Keep custom turn IDs
opaque; do not put prompts or customer information into them.

The handler's optional `onDiagnostic(event)` observes accepted requests,
authored openings and shots, and media start/end/skip timings on the host.
Fixed reasons distinguish allowance, deadline, timeout, provider error, empty
results, cancellation and absent configuration. These records contain no
prompt, narration, query, media URL or provider response. They are never sent
to the browser automatically, and callback failures cannot stop an answer.

The application's planner summary also includes `provider.firstTextMs` when
nonempty text was observed, and `provider.durationMs` for the consumed stream.
These begin at the provider request, not browser submission. Stream duration
includes consumer backpressure; it is not pure model processing time. Missing
first-text observations are omitted. `shot-authored` marks the accepted narration
being announced for preparation; with concurrent shortening, media can start
before that event. Use `narration-rewrite.durationMs` to identify repair time.

First-shot planning no longer waits for an authored ending inside the initial
brief. The compact brief establishes the unchanged opening and visual direction;
the first shot starts while the provider writes the saved ending and remaining
shots. This preserves a closing scene when later planning is interrupted, but
cannot recover an ending that was never authored. Whole-array responses still
wait for complete validation.

Generated footage and narration shortening run concurrently. Fal completion
arrives through its status stream, with status checks on the same job if updates
are idle or unavailable. The adapter never resubmits that paid job. Its
`statusStreamMs` measures the stream's open duration and overlaps generation and
any watchdog status checks; do not add it to polling HTTP time as an end-to-end
latency breakdown. Model, resolution, prompt expansion and the spoken opening
are unchanged by these scheduling improvements.

## What the measurements mean

`first-frame` is the first committed active scene reaching an animation-frame
opportunity. It excludes the generation cover and idle poster. It is not proof
of physical screen paint or decoded footage. The existing `onFirstFrame`
callback observes this same point.

`first-speech` comes from actual browser utterance start or generated audio
playback. It is not the time a speech request finishes. Custom voices must call
`onStart()` when sound begins; otherwise this measurement remains unavailable.
Muted responses do not produce a speech-start event.

`stall` measures a completed wait interval with `durationMs` and a fixed reason:
`scene-generation`, `speech`, or `media-decoding`. Deliberate pauses are excluded.
Custom player owners must not pause voice for a `speech` wait.

`scene-duration` compares prepared speech and clip seconds and records chapter
recovery. `media-playback` reports the actual decoded clip duration, scene duration
and observed repeat count. `buffer` samples ready buffered seconds across the
active and next mounted media elements, not total downloaded bytes. The local
development chat displays these measurements without retaining response content.

Elapsed times start at prompt submission and can include user pauses. Compare
unpaused runs with the same mode and voice configuration. Treat missing speech
observations as missing data rather than zero milliseconds.

## Reproducible checks

Run `npm run browser:test -- tests/browser/video-chat-performance.spec.ts` for
controlled local scenarios. They delay scene delivery, report speech onset from
a mock voice, verify pause exclusion, and attach the observed metrics as JSON.
These checks detect sequencing regressions. Their results are not live-provider
benchmarks and do not predict generated-video latency.

The initial fallback limits are 15 seconds for generated video, 3 seconds for
stock media, and 12 seconds for generated speech preparation. Unavailable speech
continues silently. Validate these against an explicitly authorized, bounded live
run before treating them as tuned provider budgets. Compare first-frame/speech
times, stalled duration, and visual/voice quality together; faster fallback alone
does not prove quality.

## Opening and media preparation

The submitted prompt immediately appears in the chapter template; the streamed
opening replaces that topic with an authored spoken beat. The default UI makes
no opening stock request. Each body beat starts speech preparation while its
selected footage source prepares. At most two speech preparations run together.

The shared footage renderer starts loading when the turn begins, overlapping
planning and provider work. Ordered scene preparation joins that cached load;
warming code does not create a scene, allocate a decoder, or interrupt the intro.
The recorded-media application startup check delays the renderer download and
holds scene delivery to verify this overlap, complete speech and moving footage.
That controlled delay is not a production latency estimate.

`first-media-frame` reports the first decoded footage frame presented by the
mounted media surface. It is separate from `first-frame`, which also includes
chapter scenes. Neither callback measures the immediate opening template;
measure that surface separately when checking submit-to-template latency.

AI and Pexels modes remain separate. Missing, late, or unplayable footage uses
the authored chapter and complete narration. Normal clips play once at native
speed and repeat on the same decoder when narration runs longer. See [the local chat harness](development.md) for fixture timing
and explicit live-provider checks.
