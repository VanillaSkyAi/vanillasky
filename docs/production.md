# Deploying the application

The frontend and Cloudflare Pages Functions build from this repository. Local
development, preview and production use the same application.

Docs-only changes need no deployment. After merging an approved application PR
and waiting for main CI, run:

```bash
gh workflow run deploy.yml --ref main -f target=production -f confirmation=DEPLOY
```

The workflow deploys the exact verified CI artifact, checks the live frontend
and API, and attempts rollback if verification fails. Use `target=preview` for
a separate, non-billable preview. See the [release procedure](maintainers/releasing.md)
for initial environment configuration, artifact retention and manual rollback.

## Instance configuration

Use the committed Wrangler configuration as the shape of your deployment, with
your own Cloudflare project and D1 binding. Keep account/database identifiers in
instance configuration and credentials in the deployment secret store. Never
commit `.dev.vars` or copy production credentials into a preview.

Configure `ANTHROPIC_API_KEY` for planning and `FAL_KEY` for generated video.
The committed configuration enables fal with `VIDEO_CHAT_FAL_PREVIEW=enabled`.
Add `XAI_API_KEY` for generated speech and optionally `PEXELS_API_KEY` for the
stock alternative and the personal-allowance fallback described below.
The server also needs its quota database and private quota salt. Local development
initializes separate local state; it must never point at production data.

Missing planning or footage setup must be visible. A credential-free preview is
a setup preview, never a canned conversation. Untrusted PRs must receive no
provider or production secrets and make no paid calls.

## Preserve the admission boundary

The API owns request admission, origin policy, bounded bodies, provider budgets
and quota reservations. Keep those controls before billable work. A UI setting
cannot authorize spending. Preserve the distinction between unavailable footage
configuration and a recoverable failure during an admitted turn. A public viewer's
exhausted personal AI-video allowance can use configured Pexels, including for
remaining footage; a failed or late clip alone uses chapter recovery.

Forward cancellation to every provider. Retain uncertain accepted attempts;
network cancellation does not prove a provider cancelled billing. Keep raw
provider errors and credentials private and expose only safe typed failures.

When customizing for a multi-user application, preserve the application's
identity and tenant boundary, request limits, concurrency and spending policy.
CORS is not authentication. Local development can use the bounded owner
reservation path only with an explicit local server flag and loopback URL. Public
production limits stay active; production owner access requires verified identity.
See [security](security.md).

## Release and rollback

Verify the application and API before merging. Deploy only a reviewed commit
through the repository workflow. Compare the deployed frontend and API identity
with that exact commit, and verify UI readiness and configuration after rollout.
Retain the previous working Cloudflare deployment for rollback.

When moving an existing deployment to this repository, only one workflow may
own production deployment. Coordinate the previous trigger's retirement with
the new trigger, preserve the existing data/domain, and do not archive the prior
repository until the replacement is verified and the owner approves archival.
Changing secrets or deployment credentials needs separate authorization.
See [release procedure](maintainers/releasing.md).

## Playback, data and evidence

Let ready scenes stream while upcoming media prepares. Preserve the opening,
full ending and chapter recovery; do not wait for every generated clip before
starting playback. Measure speech availability, first planned scene, first ready
media and first moving frame separately.

The default fal adapter returns playable provider URLs directly. Add storage only
when retention or a different provider requires it. Validate saved `Video`
objects with `parseVideo`, apply tenant retention rules and keep media URLs valid
for the required replay window. See [persistence](persistence.md).

Keyless tests cover API security and actual browser playback using recorded media.
They do not establish live model accuracy, visual relevance or provider latency.
Real-provider evaluation requires an explicitly authorized budget and evidence
from the configured application.
