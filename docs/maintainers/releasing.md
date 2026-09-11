# Releasing VanillaSky

A release is one application commit and the frontend/API artifact verified by
CI. No npm publication, package version bump or downstream adoption PR is needed.
Previously published npm versions and Git tags remain available unchanged.
For a new fork or empty Cloudflare project, complete [first deployment](../production.md#first-deployment) first.

## Review and merge

1. Work on an isolated branch. Run focused regressions while editing.
2. For docs-only edits, run `npm run check:docs`. For application changes, run
   `npm run verify` on the final candidate and relevant
   `npm run browser:test` media scenarios for playback changes.
3. Keep the candidate fixed during browser checks. Keyless tests cover setup,
   security and recorded-media playback; live provider evaluation needs an
   explicitly authorized spending bound.
4. Push a PR and wait for `application-checks`. This gate requires the checks
   [selected by change scope](../development.md) to succeed.
5. Merge after the owner's explicit approval. Wait for CI on the resulting
   `main` commit before deploying.

Branch protection requires `application-checks`; its dependencies run in
parallel and fail closed on failure, cancellation or unexpected skips. A
successful docs plan permits application jobs to skip.

## Deploy

Run the **Deploy application** workflow from `main`, choose `preview` or
`production`, and enter `DEPLOY`. With GitHub CLI:

```bash
gh workflow run deploy.yml --ref main -f target=production -f confirmation=DEPLOY
```

Use `target=preview` for an isolated preview. The workflow downloads the
`application-build` artifact from successful push or manually dispatched CI for
that exact main commit, checks source identity and every output checksum, then deploys it. It does not
repeat CI or rebuild the application. A missing successful run or missing
artifact stops deployment. CI retains builds for 30 days; rerun main CI if the
artifact has expired.

Docs-only CI does not create an application artifact. Deployment then reports
that no release is needed and skips installation and deployment steps. If an earlier application change
still needs releasing, run full CI on the current main commit first:

```bash
gh workflow run ci.yml --ref main
```

Wait for that run to succeed, then run deployment. This also regenerates expired
artifacts without changing application source.

The workflow verifies frontend/API identity, configuration and admission on the
immutable deployment URL and, for production, the live domain. If post-deploy
verification fails, it attempts to restore the previously serving production
deployment. A first production release has no rollback target; it is allowed only
when Cloudflare confirms empty production history, and any failure stays explicit.
Report the deployed commit, URL and verification result. Keyless
checks do not establish live model quality or latency.

## Instance configuration

Each GitHub environment (`preview` and `production`) needs:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_PAGES_PROJECT`
- `CLOUDFLARE_QUOTA_DATABASE_ID`
- `CLOUDFLARE_QUOTA_DATABASE_NAME`
- `PRODUCTION_URL` — the URL to verify for that environment
- `CLOUDFLARE_ANSWER_CACHE_BUCKET` — optional; the R2 bucket holding recorded answers
- `CLOUDFLARE_API_TOKEN` — stored as a secret

Provider keys and the stable `VIDEO_CHAT_QUOTA_SALT` are Cloudflare application
secrets. Initialize the remote database with all committed migrations before its
first release; follow [first deployment](../production.md#first-deployment).

Keep actual identifiers and credentials out of public source. Production uses
its existing Pages project, D1 data, domain and provider secrets. Preview uses
a separate database and disables paid providers even if keys are present.
Untrusted PRs receive no provider or production credentials.

Only this repository's release workflow should deploy the application; keep
competing Git-triggered deployments disabled. Changing production secrets or
credentials and archiving an old repository need separate owner authorization.

## Rollback

Run **Roll back application** (`rollback.yml`) from `main` with a known successful
production deployment ID and `ROLLBACK`. It validates the target, restores it
and verifies the served commit. Keep the previous successful deployment ID in
the release evidence. Rollback preserves quota data and DNS.

## Recorded answers

With `npm run dev` running and real provider keys in `.dev.vars`, record the
welcome prompts, their follow-ups and speech into `.generated/answer-cache/`:

```bash
npm run cache:warm -- --orientation both
npm run cache:publish -- --local
```

Review the recordings in the local app, then upload them to the deployment's
bucket and remove them again when they are stale:

```bash
CLOUDFLARE_ANSWER_CACHE_BUCKET=<name> npm run cache:publish -- --remote
CLOUDFLARE_ANSWER_CACHE_BUCKET=<name> npm run cache:clear -- --remote
```

`warm` keeps what is already exported; delete the export directory to record
again after changing the welcome cards or the planning instructions. Recording
uses the owner allowance, so the daily public clip budget is untouched.
