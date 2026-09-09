
- Default chat silently recovers from optional provider or scene failures. Keep non-fatal diagnostics for application developers; show a fatal error only when no playable response can be produced.

- Generated clip audio means environmental and action sounds only. Keep every
  voice and all music out of the generated footage; narration and the selected
  soundtrack are independent layers with their own listening controls.

- Keep iteration checks focused on the observed failure. A poster, ready scene,
  or completed narration does not prove visible moving footage. Observe video
  visibility, advancing media time and presented frames separately; retain
  hidden-video lifecycle evidence when diagnosing readiness. Use the full
  compatibility suite as a release gate, and a few complete live answers to
  judge relevance, pacing and endings. Do not repeat broad suites without a
  changed candidate or a specific unresolved question.

- Watched source changes and HEAD changes invalidate an ongoing playback trace;
  keep the candidate unchanged until browser verification finishes.

- Cached media may load while a Suspense tree is detached. First-frame observation
  must start when the element mounts; a loadeddata handler alone cannot establish
  whether later waiting is initial decoding or a genuine playback stall. Validate
  with actual presented frames, then a frozen decoder and the unchanged recovery bound.

- When a runtime DOM contract changes, audit verification scripts as well as
  tests: application playback assertions also live under scripts/.
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

- Every user conversation must use real AI planning. Missing keys must produce
  explicit setup guidance, never canned onboarding or demo responses. Configure
  Pexels when generated video is unavailable and browser speech when generated
  voice is unavailable; keep deterministic responses only in automated tests.

- Deployment speed means the complete application change-to-production loop.
  Measure its slowest required checks and release steps; docs-only shortcuts
  are supplementary, not the primary performance goal.

- When replacing npm/npx test entrypoints with direct Node commands, verify a
  real browser startup too. Test listing cannot catch fixture-server commands
  that depended on npm adding local executables to PATH.

- Subtitle styles must stay visually consistent between speech segments. Hold
  the word phrase through timing gaps; never swap in full Classic captions as a
  fallback. Word by word is the default, and the transcript belongs at the end.
