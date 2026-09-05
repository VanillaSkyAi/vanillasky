# Video Response Protocol 0.6

## Transport

The public transport is UTF-8 Server-Sent Events returned from a `POST` request.
Responses use `Content-Type: text/event-stream`,
`x-vanillasky-video-stream: 0.6`, `Cache-Control: no-cache, no-transform`, and
`X-Accel-Buffering: no`. Each block has an SSE `id`, the event name
`video`, and one JSON envelope in `data`. A final `data: [DONE]`
closes the transport after a terminal protocol event. Comment heartbeats do not
change protocol state.

## Envelope

```ts
type VideoEvent<T extends string, D> = {
  protocolVersion: "0.6";
  runId: string;
  sequence: number;
  eventId: string;        // exactly `${runId}:${sequence}`
  type: T;
  data: D;
};
```

Sequences start at zero and increase by exactly one. Unknown fields are
rejected. Replaying the same `eventId` with identical content is idempotent;
replaying it with different content is an error. A run ID cannot change
midstream and events cannot follow a terminal state.

## Lifecycle

1. `response.start` establishes request ID, orientation, style, and negotiated
   templates/extensions.
2. Optional `audio.set` occurs at most once and before the first scene.
3. `scene.add` appends one complete, immutable trusted-template scene.
4. Exactly one terminal event ends the run:
   `response.complete`, terminal `response.error`, or `response.abort`.

`response.complete` carries the complete replayable `Video`, a
finish reason, and a deterministic checksum. The reducer verifies that the
snapshot equals the state produced by all prior events. The checksum detects
accidental drift; it is not a cryptographic signature.

The terminal snapshot carries persisted `schemaVersion: "0.2"`. That storage
version is independent from this streaming protocol version. Load stored
snapshots through the universal `parseVideo` boundary described in the
[persistence guide](../persistence.md).

Recoverable `response.error` events may be followed by more events. Terminal
errors contain a safe public message. Provider details belong only in a private
server callback.

### Duration ceiling

`maxDurationSec` is enforced by the runtime for scene additions. A final scene
may be shortened to the remaining duration. If a later
scene would start at the ceiling, the runtime preserves the partial response
and emits `response.complete` with `finishReason: "length"`; reaching the
declared maximum is normal completion, not a generation error. The value is a
ceiling, not a target: a grounded response may complete below that ceiling when
the source does not support another distinct readable scene.

## Extensions

Extension events use a namespaced `data.*` type, for example
`data.customer.status`. They are accepted only when the exact name was
negotiated in `response.start.capabilities.extensions`. Extensions cannot
change core video state.

## Planning boundary

LLMs do not emit public protocol envelopes. A server-only planner emits
validated `scene.add` or `plan.complete` parts. The runtime assigns sequences,
IDs, terminal snapshots, and checksums. Generated HTML, React, JavaScript, CSS, component
source, audio events, protocol envelopes, and unknown part types are rejected.

A planner may add `placement: "closer"` to exactly one `scene.add`. The
standard handler requires that closer by default, holds it outside the public
event stream while body scenes continue, and commits it as the final scene.
Only templates advertised for `jobs:[ask]` or `jobs:[payoff]` qualify. The
placement marker is not part of `VideoScene` and never enters a replay
snapshot. If the planner completes without a valid closer, the handler emits
`plan_missing_closer` and uses `finishReason: "other"`; provider `length` and
`content-filter` reasons remain unchanged.

## Resume

A resume request repeats the public input and includes:

```json
{"resume":{"runId":"run-123","afterSequence":7}}
```

It also sends `Last-Event-ID: run-123:7`. The server validates that both cursors
match, then calls customer-owned replay storage. Replay begins at sequence `8`
and remains subject to normal run, order, validation, and terminal rules. The
SDK does not prescribe or operate a persistence service.

Validate adapter output and persisted replay logs against this protocol before
accepting them. A replay log must preserve ordering, checksums, and a terminal
event.

## Host-authored narration across cuts

`VideoScene.narrationGroup` optionally joins adjacent shots to one prepared spoken paragraph. A host supplies the shared `id`, `text`, measured `totalSeconds`, and each segment's `offsetSeconds` and `durationSeconds`. Each scene retains its narration fragment and a matching `timing.fixedDuration`; fragments must exactly cover the paragraph in order. The planner cannot emit this field or guess speech timings.

Grouped playback requires prepared speech with `supportsOffsets: true`. The generated-audio voice supports offsets; browser speech synthesis does not. The chat hook prepares and validates a complete group before showing its first scene, including saved replay. Hosts using a standalone player must prepare the paragraph and coordinate narration themselves before starting playback. Unsupported voices and mismatched measured durations fail explicitly. Default planner responses still prepare narration per scene.

For standalone playback, provide a synchronous `narrationReady` callback alongside your `onSceneChange` narration handler. Return false while a new grouped paragraph awaits actual audio onset, then true from the voice's `onStart` callback; also release readiness on completion, failure, or interruption. Abort pending narration from the player's `onError` handler. `VideoChat` wires this automatically through its internal narration hook. For grouped paragraphs, the voice must invoke `onStart` when audio actually begins, not when audio is prepared or `play()` is requested. The first visual cue starts narration, then the playhead waits for that onset without pausing the voice. A missing onset stops the player with an error after eight seconds of active waiting. This aligns the start of each paragraph; it is not a continuously audio-driven clock.

Readiness holds pause narration together with the picture. The same audio continues across adjacent group scenes; replay starts a new playback session. This preserves words through delayed media rather than promising uninterrupted playback on every network.
