# VanillaSky Video agent instructions

Work in an isolated worktree and preserve unrelated changes. Trace the real
request path before editing. This SDK supports footage plus chapter
introductions/fallbacks, not template authoring or a general composition product.

## Verify the checkout before gates

```bash
pwd
git rev-parse --show-toplevel
git rev-parse HEAD
git status --short --branch
node --version
npm --version
node -p 'require("./package.json").name + "@" + require("./package.json").version'
```

## Risk-based verification

- Behavior change: add a focused regression and run the affected tests first.
- Ordinary source edit: affected tests, lint, and typecheck. Do not repeat full
  release gates on each small iteration.
- Playback, voice or UI change: run relevant browser scenarios with real media
  fixtures and normal motion. Check the actual completion/cancellation boundary.
- Public exports, CLI/starter or executable docs: build one candidate, install
  that exact tarball in fresh consumers outside the repo, compile strict types,
  and exercise the browser. No workspace links, shared node_modules, copied
  internals, or unpublished dist in consumer verification.
- Release candidate: `npm run verify:release` runs the full gate using one artifact.
  The packed consumer includes API validation; do not repeat `verify:api`.
  Keep fail-closed CI aggregation and exact artifact identity.

Tests should assert behavior, data invariants, or real consumer boundaries.
Do not add prose assertions, source-string policing, template galleries, or
duplicate tool execution merely to increase coverage.

## Public boundaries

`PUBLIC-API.md` and the public API fixture freeze four code entries:
root, server, React, and test. Server must not require React; browser entries
must not load Node built-ins or provider SDKs. All public declaration changes
need an intentional contract decision and packed verification.

Providers and credentials belong to the application. Native async text streams
and AI SDK-shaped results are supported without a provider library dependency
in the core. Preserve cancellation, spend limits, safe errors, and mode isolation.

Persisted Video is untrusted: use `parseVideo` before rendering. Preserve the
storage-version policy, terminal snapshot integrity, and generation-free replay.

## Integration and documentation

Start from the README or [agent integration guide](docs/agent-integration.md).
Use one `VideoChat` and one `createVideoChatHandler`; use `useVideoChat` only
for application-owned UI. Keep the local `dev:chat` harness for HMR.

Quickstarts are executable product surfaces. Compile marked examples against
the installed artifact. Record exact candidate commit, integrity, commands,
failures and results; source, a tarball and npm publication are different artifacts.
Cold-start evaluations follow [their guide](docs/maintainers/cold-start-evaluation.md)
and do not authorize SDK edits or releases.

## Delivery and security

Record customer-visible changes under `## Unreleased` in CHANGELOG. Tooling,
tests and maintainer-doc-only changes need no entry. Public fixtures must use
fictional or role-based identities.

Never merge, auto-merge, tag, publish, deploy, change secrets or move dist-tags
without the owner's explicit approval for that action. A breaking change,
including pre-1.0 minor, requires an approved product decision.
Release mechanics are in [releasing](docs/maintainers/releasing.md).

Never retain credentials, customer data, private media URLs or raw provider
metadata in browser events, logs, fixtures, screenshots or evidence.
Public requests fail closed behind host-owned authentication, tenant policy,
request limits, spending controls and media policy.
