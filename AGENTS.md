# VanillaSky application instructions

Work in an isolated worktree and preserve unrelated changes. Trace the real
request path before editing: application → Cloudflare API → provider callbacks,
planner and protocol → browser speech, media preparation and playback.

This repository is the runnable video-chat application demonstrated on
vanillasky.ai. It is not a separately released npm SDK. There is one setup,
one set of provider defaults and one application release path.

## Product boundaries

Every conversation uses real AI planning. Missing planning configuration must
be explicit. With no generated-video provider, select configured Pexels; with
no generated voice, use browser speech. Pexels needs its own key. Do not ship
canned conversations, demo modes or development responses powered by fixtures.
Provider doubles belong only in automated tests.

Keep the visual vocabulary small: narrated footage and chapter
introductions/recovery. Preserve useful internal modules and callback boundaries,
including completed-answer integration, without creating a public package API.
fal media URLs play directly; do not introduce a mandatory upload endpoint.

## Development and verification

Before gates, verify the checkout with `pwd`, `git rev-parse --show-toplevel`,
`git rev-parse HEAD` and `git status --short --branch`. Use Node 22.12+ (22.23.1 is tested in CI) and the locked
npm version. Run `npm ci`, configure ignored `.dev.vars`, then `npm run dev`.
Use the actual application for local HMR and manual testing.

- Behavior changes need a focused regression and the affected tests first.
- Use `npm run check` for source feedback: lint, types, unused code and unit/API
  tests. Docs-only edits need `npm run check:docs`; no app build or deployment.
- Playback, voice or UI changes need browser scenarios with real media fixtures
  and normal motion. Verify advancing footage and complete speech separately.
- The final application candidate needs `npm run verify` and the selected CI gate.
  Freeze HEAD and tracked files while browser verification is running.
- Fresh-clone verification installs and runs this app; do not recreate tarball,
  public-export or generated-starter gates for retired package distribution.

Tests must assert behavior, data invariants or actual application boundaries.
Avoid exact prose assertions, source-string policing and duplicate checks.
Keyless CI never proves live provider quality or latency; live evaluation needs
an explicitly authorized budget.

## Runtime and security

Keep browser imports free of Node built-ins and private provider code. Keep
server modules independent of React. Preserve cancellation, provider deadlines,
mode isolation, admission, spend reservations and safe errors.

Persisted Video is untrusted: use `parseVideo` before rendering. Preserve the
storage-version policy, complete snapshot integrity and generation-free replay.
Keep production authentication, request limits and spending controls intact.
Local development uses isolated data, never production quota storage. Its bounded
owner reservation path requires both the explicit local server flag and loopback
URL; production still requires verified owner identity. Preserve public limits.
Configured Pexels may serve a public viewer whose personal or daily AI allowance expires;
failed or late AI clips alone recover to chapters, never a provider switch.

Never retain credentials, customer data, private media URLs or raw provider
metadata in browser events, logs, fixtures, screenshots or evidence. Deployment
identifiers and secrets belong in instance configuration, not public source.

## Delivery

Record user-visible changes under `## Unreleased` in CHANGELOG. Preserve
historical release notes and already-published npm artifacts; do not publish new
package versions. Verify, commit, push a branch, open a PR and wait for CI.
Never merge without the owner's explicit approval. Production-secret changes,
repository archival and destructive infrastructure operations require separate
authorization. See [releasing](docs/maintainers/releasing.md).

Read [development](docs/development.md), [architecture](docs/architecture.md),
[security](docs/security.md) and relevant [lessons](tasks/lessons.md).
