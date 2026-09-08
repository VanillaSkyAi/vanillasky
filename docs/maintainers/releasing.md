# Releasing VanillaSky

A release is one application commit and the frontend/API artifact verified by
CI. No npm publication, package version bump or downstream adoption PR is needed.
Previously published npm versions and Git tags remain available unchanged.

## Review and merge

1. Work on an isolated branch. Run focused regressions while editing.
2. Run `npm run verify` on the final candidate and relevant
   `npm run browser:test` media scenarios for playback changes.
3. Keep the candidate fixed during browser checks. Keyless tests cover setup,
   security and recorded-media playback; live provider evaluation needs an
   explicitly authorized spending bound.
4. Push a PR and wait for `application-checks`. This gate requires unit/API,
   build, application/browser playback and Node compatibility checks to succeed.
5. Merge after the owner's explicit approval. Wait for CI on the resulting
   `main` commit before deploying.

Branch protection requires `application-checks`; its dependencies run in
parallel and fail closed if any check fails, is cancelled or is skipped.

## Deploy

Run the **Deploy application** workflow from `main`, choose `preview` or
`production`, and enter `DEPLOY`. With GitHub CLI:

```bash
gh workflow run deploy.yml --ref main -f target=production -f confirmation=DEPLOY
```

Use `target=preview` for an isolated preview. The workflow downloads the
`application-build` artifact from successful push CI for that exact main commit,
checks source identity and every output checksum, then deploys it. It does not
repeat CI or rebuild the application. A missing successful run or missing
artifact stops deployment. CI retains builds for 30 days; rerun main CI if the
artifact has expired.

The workflow verifies frontend/API identity, configuration and admission on the
immutable deployment URL and, for production, the live domain. If post-deploy
verification fails, it attempts to restore the previously serving production
deployment. Report the deployed commit, URL and verification result. Keyless
checks do not establish live model quality or latency.

## Instance configuration

Each GitHub environment (`preview` and `production`) needs:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_PAGES_PROJECT`
- `CLOUDFLARE_QUOTA_DATABASE_ID`
- `CLOUDFLARE_QUOTA_DATABASE_NAME`
- `PRODUCTION_URL` — the URL to verify for that environment
- `CLOUDFLARE_API_TOKEN` — stored as a secret

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
