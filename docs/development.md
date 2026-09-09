# Development

Use Node 22+ and the npm version in `package.json`. Run `npm ci`, copy
`.dev.vars.example` to ignored `.dev.vars`, and add your provider keys.

```bash
npm run dev
```

This starts the actual application at [localhost:4200](http://localhost:4200),
with source HMR and a local Cloudflare API. The command initializes isolated
local D1 quota data and a local salt. Exiting stops both processes. Missing
provider keys show setup requirements; no fake answer path is enabled.

Own-key localhost uses up to five generated clips per answer through the existing
owner reservation path, without the public pilot's permanent personal allowance.
It requires both the local server flag and a loopback URL. The API stays bound
to loopback, request admission remains active, and production still requires
verified owner identity for that path.

For an ordinary edit, run affected tests and `npm run check`. This checks lint,
types, unused code, unit tests and API tests without starting browsers or builds.
Docs-only edits use `npm run check:docs`, which needs Node and Git but no install.
It checks tracked Markdown structure, local links and heading anchors offline.

Run `npm run verify` on the final application candidate; it adds docs checks,
chat acceptance, builds, preview checks and the application browser journey.
Playback/UI changes also need relevant `npm run browser:test` media scenarios.
Keep the candidate and HEAD unchanged during browser runs.

CI selects checks conservatively:

- Docs-only changes to root documentation or Markdown under `docs/` and `tasks/`
  run the offline docs check. They do not build or deploy the application.
- Changes limited to `.mjs` files under `functions/` and `tests/app-api/` run all
  application checks and setup journeys in Chromium, Firefox and WebKit.
- Shared source, UI, playback, dependencies, workflows, fixtures and unknown
  paths run the full media browser matrix as well. Missing history runs it too.

`application-checks` requires every selected job to pass. Only a successful docs
plan permits skipped application jobs. Manually running CI always selects the
full suite. Browser setup journeys share the existing browser containers. The full media
suite spreads neighboring cases across three groups per browser, keeping one
media worker per runner and covering each discovered test exactly once.

`npm run check:unused` runs Knip without a baseline or blanket ignores. Keep its
entrypoints limited to real runtime boundaries that static imports cannot show,
such as Cloudflare routes and modules loaded by HTML fixtures.

Keep test media: it exercises actual decoder, readiness, speech-clock and replay
boundaries. Keyless provider doubles belong in tests only. Manual provider tests
use the same app with your keys and need an explicitly authorized spending bound.

[Architecture](architecture.md) · [Contributing](../CONTRIBUTING.md)
