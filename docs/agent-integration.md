# Working on VanillaSky with an agent

Read [AGENTS.md](../AGENTS.md), then follow the [setup](getting-started.md).
Clone this repository, run `npm ci`, configure ignored `.dev.vars`, and start
`npm run dev`. Do not generate a second starter or install a published copy of
VanillaSky inside this app.

Use the actual application and provider defaults. Keep AI planning required,
Pexels as the configured fallback when generated video is absent, and browser
speech when generated voice is absent. Never make missing setup look functional
with canned answers. Provider doubles belong only in automated tests.

The application route owns provider admission and spending. Internal modules own
planning, validation, voice timing and playback. Change guidance in the handler,
providers in `functions/_video-chat/`, and branding in the app. Trace the relevant
path in [architecture](architecture.md) before editing.

Preserve cancellation, complete narration, mode isolation and private errors.
Use `resolveAnswer` if an existing assistant supplies the completed answer; do not
invent another client or planning protocol. See [provider integration](provider-integration.md).

Use focused regressions and `npm run check` while editing, then `npm run verify`
for application handoff. Docs-only changes use `npm run check:docs`. Freeze the checkout during browser tests.
Provider quality and latency need explicitly authorized real calls; fixture
results are not live evidence. Delivery is branch, PR, green CI, owner-approved
merge, deployment and production verification.
