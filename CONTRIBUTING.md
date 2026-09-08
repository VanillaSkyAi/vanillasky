# Contributing

VanillaSky turns AI chat answers into narrated footage with a short chapter
introduction and chapter fallback. Keep the implementation easy for developers
and agents to understand. Delete dead paths instead of preserving unused
frameworks or compatibility layers in this pre-launch product.

Participation follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Working loop

Use Node 22+, the locked npm version, and an isolated worktree. Run `npm ci`,
then `npm run dev:chat` for source-level HMR. Follow the checkout preflight in
[AGENTS.md](AGENTS.md) before gates.

For a behavior change, add a focused regression and run affected test files.
Run lint and typecheck before handoff. Playback or voice changes also need the
relevant real-browser/media scenarios. Do not repeatedly run the entire release
matrix while making local edits.

Export, CLI, starter and executable-example changes need a strict consumer of
one identified packed artifact, installed outside the repo. Keep those consumers
isolated: no links to local source or shared dependencies.
`verify:package` includes public API verification; use `verify:api` only as a
shorter targeted check. The full `npm run chat:verify` gate builds one candidate
for all consumers and is run once at the final handoff.

Keep tests for protocol ordering, parsing, cancellation, narration/media timing,
provider policy, and browser/server boundaries. Avoid prose/source-string tests,
duplicate API runs, and gallery/authoring suites for unsupported features.

## Ownership

The four public entries are root, `/server`, `/react`, and `/test`, plus
`/video-chat.css`. [PUBLIC-API.md](PUBLIC-API.md) defines the contract.
Provider dependencies, credentials, auth, billing and persistent media belong
to the application. Preserve safe errors and browser/server separation.
The [architecture guide](docs/architecture.md) points at the actual request path.

## Delivery

Record customer-visible changes under `## Unreleased` in CHANGELOG.
Repository-only tests, tooling, workflows and maintainer docs need no entry.
Breaking pre-1.0 changes require the owner's explicit approval.

Verify, commit, open a branch PR, and wait for CI. Never merge or release without
the owner's explicit approval. Maintainer instructions:

- [Acceptance](docs/maintainers/acceptance.md)
- [Provider onboarding](docs/maintainers/provider-onboarding.md)
- [Releasing](docs/maintainers/releasing.md)
