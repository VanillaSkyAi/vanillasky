# Releasing VanillaSky

A release is an application commit, its frontend/API build and its verified
Cloudflare deployment. The repository is private to npm publication: no tarball,
package version bump, npm tag or downstream SDK-adoption PR is required.
Previously published npm versions and Git tags remain available unchanged.

## Before merging

1. Work on an isolated branch and identify its exact commit.
2. Install the lockfile with `npm ci`; run focused regressions during development.
3. Run `npm run verify` and the relevant `npm run browser:test` media scenarios:
   unit/API security checks, lint, types, frontend/API build and browser playback.
   Verify a fresh checkout clearly
   reports missing setup and never serves test answers.
4. Keep the candidate fixed during browser checks. Record test-only evidence
   separately from any explicitly authorized real-provider testing.
5. Push a branch PR and wait for all required CI and preview checks. The owner
   approves the merge; do not merge on a standing implementation request alone.

Before merging the consolidation, update branch protection to require
`application-checks` instead of retired package-consumer, provider-consumer and
React 18 compatibility jobs. The new gate covers the retained application checks;
Node 24 compatibility still runs against the actual app. This is a repository
settings change, separate from editing workflow files.

## Deployment configuration

The deployment workflow is manual during cutover. Run `deploy.yml` from `main`,
select `preview` or `production`, and enter `DEPLOY`. It runs application CI before
the environment-gated deployment. Do not enable automatic production until the
previous repository's production trigger is disabled and the new path is verified.

Each GitHub environment needs these variables:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_PAGES_PROJECT`
- `CLOUDFLARE_QUOTA_DATABASE_ID`
- `CLOUDFLARE_QUOTA_DATABASE_NAME`
- `PRODUCTION_URL` (the URL to verify for that environment)

It also needs the `CLOUDFLARE_API_TOKEN` secret. These values identify your instance;
never commit actual account, database or credential values. Production reuses the
existing Pages project, D1 database, domain and Pages provider secrets. A preview
uses a separate database and disables paid providers, even if keys are present.

`rollback.yml` also runs from `main`. Supply the known successful deployment ID
and `ROLLBACK`; it validates the target and verifies the restored commit. The
deployment workflow also attempts to restore the previous production deployment
if its post-deploy smoke verification fails.

## Deployment

Deploy the exact approved commit through the application workflow. Instance
configuration must supply its own Cloudflare project, quota data and secrets.
Untrusted PRs get no production/provider credentials and cannot spend money.
A credential-free preview shows setup requirements, never sample responses.

Before an existing-site cutover, record the working deployment and rollback
procedure. Ensure only one repository workflow can deploy production. Configuring
credentials, changing production secrets or archiving the previous repository
requires separate owner authorization; prepare those actions for review instead
of copying private settings into public source.

After deployment, verify the frontend and API build identity, visible app
readiness, configuration and admission behavior. Use the previous known-good
Cloudflare deployment if smoke verification fails. Preserve quota data and DNS.
Keep the old repository available through the rollback window.

There is no npm step after a successful deployment. Report the application
commit, deployment result, checks and any real limitation in live validation.
