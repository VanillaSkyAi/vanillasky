# Deploy your application

Deploy your fork to Cloudflare Pages with its own D1 database and provider keys.
The same application runs locally and in production. Existing deployments can
skip to [releasing](maintainers/releasing.md).

## First deployment

### 1. Create the project and database

Fork this repository and enable GitHub Actions in your fork. Clone your fork
so GitHub CLI commands target your repository:

```bash
git clone https://github.com/YOUR_ACCOUNT/video.git
cd video
```

Complete [local setup](getting-started.md) starting at `npm ci`; keep using this
fork checkout. From its root, sign in to Cloudflare and choose your own project
and database names:

```bash
npx wrangler login
npx wrangler pages project create my-video-chat --production-branch main
npx wrangler d1 create my-video-chat-quota
```

Keep the returned database UUID. Use a Direct Upload Pages project so the
repository workflow owns deployment. See Cloudflare's [Pages commands](https://developers.cloudflare.com/workers/wrangler/commands/pages/).

### 2. Initialize the remote quota database

Create `.generated/instance/wrangler.jsonc` (ignored by Git) with the database
name and UUID returned above. This separate configuration keeps `npm run dev`
pointing at local data:

```json
{
  "name": "video-chat-setup",
  "compatibility_date": "2026-04-09",
  "d1_databases": [{
    "binding": "VIDEO_CHAT_QUOTAS",
    "database_name": "my-video-chat-quota",
    "database_id": "YOUR_DATABASE_UUID",
    "migrations_dir": "../../migrations"
  }]
}
```

Apply the committed migrations to your new remote database, then confirm none
remain pending:

```bash
npx wrangler d1 migrations apply VIDEO_CHAT_QUOTAS --remote --config .generated/instance/wrangler.jsonc
npx wrangler d1 migrations list VIDEO_CHAT_QUOTAS --remote --config .generated/instance/wrangler.jsonc
```

The application requires all quota tables and spending-limit triggers. A D1
binding alone is not enough: an empty database rejects conversations. Local
migration setup does not initialize a remote database. See Cloudflare's
[migration guide](https://developers.cloudflare.com/d1/reference/migrations/).

Public AI video allows ten lifetime clip attempts per visitor and 200 attempts
per UTC day across public visitors, including failed and cancelled submissions.
There is no separate per-answer credit limit or permanent site-wide cap. Verified
owners retain their separate allowance. Configured Pexels takes over when either
public allowance is exhausted and the app explains the switch in a dismissible
banner. `VIDEO_CHAT_FAL_DAILY_CLIP_LIMIT` can lower the daily pool, never raise it
above 200.

For the quota rollout, first deploy the compatibility update that accepts
positive D1 change counts for successful public clip reservations. D1 includes
trigger writes in that count, so an older app expecting exactly one changed row
cannot remain the rollback target. Keep the verified compatibility deployment as
the rollback target, then apply migrations 0005 and 0006 before deploying the app.
They retain every historical row and guard writes from both old and new Workers.
Existing attempts are backfilled using their recorded reservation day; subsequent
attempts use the database's current UTC day, including answers spanning midnight.
Application rollback keeps this data and these guards in place. Do not remove the
new ledgers or change the quota salt.

### 3. Add the application secrets

In your Cloudflare Pages project's production settings, add these as encrypted
[secrets](https://developers.cloudflare.com/pages/functions/bindings/#secrets):

| Secret | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Required AI planning |
| `FAL_KEY` | Generated video; configure `PEXELS_API_KEY` instead for stock footage |
| `VIDEO_CHAT_QUOTA_SALT` | Required stable random secret, at least 32 characters |
| `XAI_API_KEY` | Optional generated narration; otherwise browser speech |
| `PEXELS_API_KEY` | Stock alternative and fallback when public AI credits run out |

For a new quota salt, generate 32 random bytes in your password manager or with
`openssl rand -hex 32` and save the result as `VIDEO_CHAT_QUOTA_SALT`. Keep it
stable for that instance: changing an existing salt changes viewer identities.
Application secrets belong in Cloudflare, not frontend variables or GitHub's
build environment. `npm run dev` manages a separate local salt.

### 4. Configure GitHub and deploy

In your fork, create a GitHub environment named `production`. Add the variables
and deployment secret listed in [instance configuration](maintainers/releasing.md#instance-configuration).
Use your new Pages project and D1 identifiers. Initially set `PRODUCTION_URL` to
`https://YOUR_PROJECT.pages.dev`; configure your custom domain and update it later.
Update `public/robots.txt` and `public/sitemap.xml` for your domain too.

The GitHub `CLOUDFLARE_API_TOKEN` is a deployment credential, separate from the
application's provider keys. Give it Cloudflare Pages edit access to your account;
see [API tokens](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/).

Install and authenticate the GitHub CLI (`gh auth login`) if needed. Run CI on
your fork's main branch and wait for success, then deploy:

```bash
gh workflow run ci.yml --ref main
# Wait for this CI run to succeed before the next command.
gh workflow run deploy.yml --ref main -f target=production -f confirmation=DEPLOY
```

The workflow uploads the exact verified build and checks the frontend, API,
configuration and served assets. It permits a first production upload only when
Cloudflare confirms there is no previous production deployment. There is no
rollback target on that first upload; failure is reported explicitly. Later
releases retain the existing rollback protection. A project with broken or
unverifiable production history needs that history resolved first.

Open your site, ask a question, and let its speech and moving footage finish.
This final manual check uses your paid providers; automated CI uses test doubles.

## Preview and later releases

For an isolated preview, create a separate Pages project, D1 database and GitHub
`preview` environment using the same setup. Keep its data and secrets separate
from production. The workflow disables paid providers for `target=preview`, so
this shows configuration guidance rather than a canned conversation.

Follow [releasing](maintainers/releasing.md) for subsequent deployments, exact
build verification and rollback. Apply any newly reviewed remote migrations
before a release that needs them; the deployment workflow does not mutate schema.
Docs-only commits need no application deployment.

The API's admission, cancellation and spending controls must remain in place.
See [security](security.md). Provider URLs play directly; add storage only when
retention or your chosen provider requires it. See [persistence](persistence.md).
