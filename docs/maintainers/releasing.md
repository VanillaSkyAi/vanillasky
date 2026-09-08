# Releasing VanillaSky Video

Releases are immutable npm packages backed by an annotated Git tag and npm
provenance. Only repository maintainers publish releases.

Publishing uses GitHub's short-lived OIDC identity. The publish job needs
`id-token: write`; verification jobs need no write permission and no npm token.

Release automation uses Node `22.23.1` and the repository-locked `npm@11.17.0`.
The SDK runtime remains supported on Node 22 and newer.

Signing is deferred until signing-key ownership is established. Until then, an
annotated tag is mandatory, but a cryptographically signed tag is not.

A release is three steps: bump the version on a branch, merge it, then tag the
merged commit. CI has already run lint, types, tests, and the consumer gates on
that commit, so the tag workflow packs it rather than verifying it again.

## Prepare the version bump

On a branch off current `main`:

1. Move the pending notes from `## Unreleased` into a new `## X.Y.Z` section in
   `CHANGELOG.md`. The tag workflow reads its release notes from that section
   and fails if it is missing or empty.
2. Set the version in `package.json`, then run `npm install --package-lock-only`
   to match `package-lock.json`.
3. Update the exact `@vanillaskyai/video` dependency in each executable
   `examples/*/package.json`, `starters/video-chat/package.json`, and
   `tests/fixtures/nextjs-provider-app/package.json`. Tests and
   the release builder assert these pins, so the reviewed consumers and packed artifact cannot drift apart. Public
   human and agent guides intentionally keep an unversioned install command and
   package-relative example links; do not rewrite onboarding copy for a release.

   Searching specifically for an old SDK dependency pin should return nothing
   outside `CHANGELOG.md`, which keeps its history:

   ```bash
   grep -rn '"@vanillaskyai/video": "'$PREVIOUS_VERSION'"' \
     --exclude-dir=node_modules --exclude-dir=.git .
   ```

Open a pull request and merge it once CI is green, like any other change.

## Tag and publish

`VanillaSkyAi/video` is the canonical repository. npm publishing uses the
trusted publisher bound to `.github/workflows/release.yml`, this repository,
and the `npm` GitHub environment.

Before creating a tag, confirm the merged commit is current `main`, is green,
and has no existing tag for its version:

```bash
git fetch origin main --tags
git log --oneline -1 origin/main
git tag -l "v$(node -p "require('./package.json').version")"
```

Then create an annotated tag that exactly matches `package.json` and push it:

```bash
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin vX.Y.Z
```

The tag name must be exactly `v${package.version}`, and `git cat-file` must
identify it as an annotated tag object. The workflow verifies that the tag
commit exactly equals approved `origin/main`, builds and packs exactly once,
computes SHA-512 and SHA-256, and hands that one immutable tarball to the
publish and GitHub release jobs.

Verification, npm publishing, published-package verification, and GitHub
release creation run as separate jobs with only the permissions each needs.
GitHub assets are never uploaded with `--clobber`; a rerun verifies existing
bytes instead of replacing them. An existing release must retain the exact
release body, non-draft state, stable/prerelease classification, approved
`main` target, annotated tag, and candidate asset bytes. A missing asset fails
closed on rerun; automation never repairs or mutates an existing release.

A version with a SemVer prerelease suffix publishes under npm's `beta`
dist-tag and must be strictly newer than `latest`; every other version
publishes under `latest`.

Published npm versions and release assets are immutable. Never overwrite an
asset or reuse a version for different bytes; fix forward with a new version.

Publish the exact workflow-produced tarball and verify its registry integrity.
vanillasky.ai adopts stable npm releases separately through its site-owned
release process. Site automation, credentials, deployment checks, and adoption
instructions stay in that private workspace rather than this public SDK.

To pack and inspect a candidate locally without touching any remote, run
`npm run release:build` on a clean tree; it makes no tag, registry, GitHub
release, or site change.

### Verify from outside the repository

```bash
npm view @vanillaskyai/video version dist.integrity dist.tarball
mkdir /tmp/vanillasky-consumer && cd /tmp/vanillasky-consumer
npm init -y
npm install @vanillaskyai/video@latest
npm ls @vanillaskyai/video --depth=0
node -e "import('@vanillaskyai/video/react').then(m => { if (!m.useVideoChat || !m.VideoChat || !m.VideoPlayer) process.exit(1); console.log('React runtime exports verified') })"
```

Confirm the installed artifact contains its reviewed README, public API,
support/security policies, docs, starter source, license, and declarations.
