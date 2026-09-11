# Development

[Getting started](getting-started.md) covers Node, `npm ci`, `.dev.vars` and the
first run. This page is the everyday loop.

```bash
npm run dev
```

`npm run dev` starts the actual application at [localhost:4200](http://localhost:4200),
with source HMR and a local Cloudflare API. The command initializes isolated
local D1 quota data and a local salt. Exiting stops both processes. Missing
provider keys show setup requirements; no fake answer path is enabled.

Own-key localhost uses up to five generated clips per answer through the existing
owner reservation path, without the public pilot's permanent personal allowance.
The first generated clip is five seconds and subsequent clips are eight seconds,
so five scenes use 37 seconds of generated footage.
It requires both the local server flag and a loopback URL. The API stays bound
to loopback, request admission remains active, and production still requires
verified owner identity for that path.

For an ordinary edit, run affected tests and `npm run check`. This checks lint,
types, unused code, unit tests and API tests without starting browsers or builds.
Docs-only edits use `npm run check:docs`, which needs Node and Git but no install.
It checks tracked Markdown structure, local links and heading anchors offline.

Before your first browser run, install the browsers with `npm run browser:install`.
On Linux, `npx playwright install --with-deps` also installs required OS libraries.
Run `npm run verify` on the final application candidate; it adds docs checks,
builds, preview checks and the application browser journey. The unit tests already
include the chat acceptance journey; `npm run acceptance:chat` remains available
for its standalone report.
Playback/UI changes also need relevant `npm run browser:test` media scenarios.
Keep the candidate and HEAD unchanged during browser runs.

To play the welcome prompts from recordings instead of live generation, see
[recorded answers](maintainers/releasing.md#recorded-answers); `npm run cache:publish -- --local`
loads them into the development bucket.

CI selects checks conservatively:

- Docs-only changes to root documentation or Markdown under `docs/` and `tasks/`
  run the offline docs check. They do not build or deploy the application.
- Changes limited to `.mjs` files under `functions/` and `tests/app-api/`, or to
  repository tooling under `scripts/` and its own tests, run all application
  checks and setup journeys in Chromium, Firefox and WebKit.
- Shared source, UI, playback, dependencies, workflows, fixtures and unknown
  paths run the full media browser matrix as well. Missing history runs it too.

`application-checks` requires every selected job to pass. Only a successful docs
plan permits skipped application jobs. Manually running CI always selects the
full suite. Browser setup journeys share the existing browser containers. The full media
suite uses five standard Playwright shards per browser, keeping one media worker
per runner. This shortens the required playback wait without speeding up footage
or dropping scenarios.

Linux CI starts a virtual audio output before both the application journeys and
the media scenarios. Both exercise native speech clocks; a headless browser
without an audio output cannot establish complete narration playback.

`npm run check:unused` runs Knip without a baseline or blanket ignores. Keep its
entrypoints limited to real runtime boundaries that static imports cannot show,
such as Cloudflare routes and modules loaded by HTML fixtures.

Keep test media: it exercises actual decoder, readiness, speech-clock and replay
boundaries. Keyless provider doubles belong in tests only. Manual provider tests
use the same app with your keys and need an explicitly authorized spending bound.
