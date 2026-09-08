
- Default chat silently recovers from optional provider or scene failures. Keep non-fatal diagnostics for application developers; show a fatal error only when no playable response can be produced.

- Keep iteration checks focused on the observed failure. A poster, ready scene,
  or completed narration does not prove visible moving footage. Observe video
  visibility, advancing media time and presented frames separately; retain
  hidden-video lifecycle evidence when diagnosing readiness. Use the full
  compatibility suite as a release gate, and a few complete live answers to
  judge relevance, pacing and endings. Do not repeat broad suites without a
  changed candidate or a specific unresolved question.

- A patch release updates the root package and lockfile plus the exact SDK pins
  in `starters/video-chat/package.json` and
  `tests/fixtures/nextjs-provider-app/package.json`. Run the unit release checks
  after the bump before starting the full consumer/browser CI matrix; focused
  playback tests do not check these version contracts.

  Watched source changes trigger Vite HMR and invalidate an ongoing playback
  trace; keep the candidate unchanged until the browser run finishes.

- Cached media may load while a Suspense tree is detached. First-frame observation
  must start when the element mounts; a loadeddata handler alone cannot establish
  whether later waiting is initial decoding or a genuine playback stall. Validate
  with actual presented frames, then a frozen decoder and the unchanged recovery bound.

- When a runtime DOM contract changes, audit verification scripts as well as
  tests: exact packed-consumer playback assertions also live under scripts/.
  Replace obsolete architecture assertions with the intended behavior and retain
  real-frame, identity, lifecycle and bounded-resource coverage.

- Welcome and follow-up suggestions share one card treatment. Fix label length or shared responsive sizing instead of introducing a separate oversized ending layout. Show preparation feedback only after the opening voice has finished and the requested quiet interval has elapsed; never extend playback waiting to display it.

- Generalize planner guidance from reported examples. Keep topic-specific cases in evaluation fixtures rather than adding the latest failing user prompt to production system instructions.

- Requests for less caption text may mean progressive display, not shorter narration. Preserve full speech and transcript; disclose approximate timing when provider word timestamps are absent.

- For automatic visual direction, reuse the default chat brief and verify the active shot-planner path. Keep intent separate from appearance, preserve caller overrides, and check downstream provider prompt-length limits before combining style and shot instructions. Do not claim mocked media proves generated visual quality.

- Product deletion is a complete dependency-graph change: remove its CLI, public surface, generated artifacts, fixtures, docs, and tests together. Keep real consumer and playback boundaries for the remaining product.

- A passing longer-duration fixture cannot establish the shorter production
  contract. Exercise the configured duration through handler, provider callback,
  streamed scene and voice preparation. Keep live text/voice quality evidence
  separate from stubbed generation and recorded-media playback; verify the
  actual reported browser session before attributing failures to authentication.

- A narration repair cannot safely squeeze several independent claims into a
  short clip. Give first-pass writing headroom and one idea per beat, with a
  single new payoff instead of a multi-claim closing recap. Keep repair's full
  safe budget for qualifiers; test live output as well as mocked fit checks.

- A narration clock taking over can initially trail the visual clock. Keep
  ordinary clock adoption monotonic; only an actual audio/playhead reset should
  rewind the decoder. A small automatic seek can stall WebKit even with fully
  fitted prerecorded speech. Inspect retained frames and clock telemetry before
  calling a retrying browser failure a flaky assertion.
