
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
