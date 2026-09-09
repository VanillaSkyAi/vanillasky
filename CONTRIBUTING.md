# Contributing

Help shape AI conversations that answer with video. Feedback on explanations,
pacing, sound and subtitles is welcome alongside code contributions; see the
[starting points in the README](README.md#contribute).

VanillaSky is a runnable AI chat application. Keep its setup and code easy to
understand: one app, one planner, one provider configuration and one release
path. Participation follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Working loop

Use Node 22.12+ (22.23.1 is tested in CI), the locked npm version and an isolated worktree. Run `npm ci`,
configure your ignored `.dev.vars`, then `npm run dev`. This runs the same app
as the website with local API and quota storage. See [setup](docs/getting-started.md).

Add focused regressions for behavior changes. Use affected tests and
`npm run check` while editing; run `npm run verify` before application PR handoff.
Docs-only edits need just `npm run check:docs` and the docs CI gate. Playback and voice changes need real-browser/media scenarios. Keep
HEAD and tracked files fixed during a browser run.

Preserve protocol ordering, parsing, cancellation, complete narration, media
recovery, admission, quota concurrency and browser/server import isolation.
Fixtures and provider doubles are automated test inputs, never a selectable
application mode. Live model calls need an explicitly authorized budget.

## Keep customization simple

Change product guidance in the handler, providers in `functions/_video-chat/`
and branding in the app. Reuse the existing internal modules. Do not introduce a
second client, starter generator, public export contract or package release.
See [architecture](docs/architecture.md) and [provider integration](docs/provider-integration.md).

Keep credentials, private diagnostics and production identifiers out of public
source and browser payloads. Preserve production admission and spending rules.

## Delivery

Record user-visible changes under `## Unreleased` in CHANGELOG. Verify, commit,
push a branch, open a PR and wait for CI. The owner approves merges. Deployment
must verify the exact app commit and retain a working rollback. Do not change
production secrets or archive the previous repository as routine source cleanup.
See [releasing](docs/maintainers/releasing.md).
