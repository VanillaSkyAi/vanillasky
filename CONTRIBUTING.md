# Contributing

VanillaSky is an open-source voice-and-video chat SDK. Changes should preserve
the versioned event protocol and keep external services behind explicit adapters.

## Local checks

Use Node.js 22. Before opening a pull request, run:

```bash
npm ci
npm run lint
npm run typecheck
npm test
```

That is the whole local contract. CI runs the slower gates for you — the packed
package, clean-room onboarding, provider fixtures, Node 24, React 18, and the
Chromium/Firefox/WebKit suites — so you do not need browsers installed to
contribute. Run them locally only when you are changing what they cover:

```bash
npm run acceptance:chat     # deterministic chat quality with mocked providers
npm run verify:package      # the exact packed artifact
npm run verify:onboarding   # npx init in a blank folder
npm run browser:test        # Playwright, needs npm run browser:install first
```

Protocol changes need reducer and stream tests. Runtime code must never import
the built-in registry. Canonical template changes live in `src/visual-system`;
generated installable copies live in `registry/items`. Templates need valid
default variables and must continue to pass the all-template install and render
test. Reusable authoring primitives use the `primitive` registry layer and remain
directly installable with `vanillasky templates add`. The CLI may refresh files marked as
generated, but must not silently overwrite customer-owned template or primitive
source.
Provider credentials and customer secrets must never enter browser bundles,
video inputs, fixtures, or event logs.

## Change notes

Record customer-visible changes under `## Unreleased` in `CHANGELOG.md` as part
of the pull request that makes them. Repository-only tooling, tests, workflows,
governance, and maintainer documentation need no changelog entry. Releases
promote that section into a version heading; see
[Releasing](docs/maintainers/releasing.md).

A breaking change, including a pre-1.0 minor, requires explicit approval from
the repository owner before implementation or merge. Breaking-change notes and migration
evidence are required context, but migration evidence does not count as
approval.

## Maintainer guides

- [Acceptance](docs/maintainers/acceptance.md) defines deterministic chat quality
  and recovery gates.
- [Releasing](docs/maintainers/releasing.md) defines versioning, publishing, verification,
  and the boundary with the separate site-owned adoption process.

## Release checks

The published SDK supports Node 22 and newer. CI runs the full SDK/runtime test
suite and build on Node 22 and 24. The Node 24 job does not omit any SDK/runtime
test file.

React 19 is the primary development runtime. CI also verifies React 18 source
and runtime compatibility, plus Chromium, Firefox, and WebKit.

Before a release candidate, verify the exact packed package and blank-folder
starter. Run `npm run acceptance:chat` with mocked providers, then keep localhost
available for one manual conversation check. Automated checks never use real
provider credentials or spend generation credits. A mocked run proves behavior;
only an explicitly authorized manual provider run measures live-provider latency
and generated-media quality.
