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

For an ordinary edit, run affected tests, lint and typecheck. Build the app and
API before handoff. Run `npm run verify` on the final candidate; it covers
unit/API checks, builds and the application browser journey. Playback/UI changes
also need the relevant `npm run browser:test` media scenarios. Do not repeatedly run the
whole matrix while editing. Keep the candidate and HEAD unchanged during browser
runs so identity checks and media traces refer to one build.

Keep test media: it exercises actual decoder, readiness, speech-clock and replay
boundaries. Keyless provider doubles belong in tests only. Manual provider tests
use the same app with your keys and need an explicitly authorized spending bound.

[Architecture](architecture.md) · [Contributing](../CONTRIBUTING.md)
