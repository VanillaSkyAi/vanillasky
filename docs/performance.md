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

The initial fallback limits are 15 seconds for generated video and 3 seconds
for stock media, generated speech preparation, and fallback narration. Validate
these against an explicitly authorized, bounded live run before treating them
as tuned provider budgets. Compare first-frame/speech times, stalled duration,
and visual/voice quality together; faster fallback alone does not prove quality.

## Opening and media preparation

The submitted prompt immediately appears in the chapter template; the streamed
opening replaces that topic with an authored spoken beat. The default UI makes
no opening stock request. Each body beat starts speech preparation while its
selected footage source prepares. At most two speech preparations run together.

`first-media-frame` reports the first decoded footage frame presented by the
mounted media surface. It is separate from `first-frame`, which also includes
chapter scenes. Neither callback measures the immediate opening template;
measure that surface separately when checking submit-to-template latency.

AI and Pexels modes remain separate. Missing, late, or unplayable footage uses
the authored chapter and complete narration. Normal clips play once at native
speed; overlong narration recovers to a chapter. See [the local chat harness](development.md) for fixture timing
and explicit live-provider checks.
