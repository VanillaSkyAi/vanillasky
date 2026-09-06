# Develop the chat experience

Run `npm ci --no-audit`, then `npm run dev:chat`. The localhost HMR surface renders the actual SDK `VideoChat`, templates and server handler from source. It never loads provider credentials. Select an intent and fault condition in the development toolbar; use the chat's normal media-mode controls. The prompt box remains the real product UI.

Offline answers are deterministic for explanation, story, comedy, imagination, practical steps and golf. They use local waterfall footage and a recorded timing cue, **not narration that matches the displayed script**. This harness is for loading, playback, controls and recovery. It cannot prove generated answer quality. Conditions cover ready, delayed footage, missing media, decode failure, speech failure, exhausted video allowance and request throttling. Browser speech may be used in the speech-failure condition.

The toolbar labels source and fixture identity and reports first-body-frame time. The normal SDK metrics callbacks remain available for deeper investigation. Local fixtures never fetch external footage or invoke a paid model. Mode boundaries, provider deadlines and host admission remain covered by their dedicated server and host suites.

## Optional live host

Set `VANILLASKY_CHAT_LIVE_ENDPOINT` to an application-owned video-chat endpoint before starting the harness. The toolbar then offers **Connect live endpoint (uses allowance)**. It stays offline until that explicit click. The host must allow the localhost origin and provide its normal authorization; credentials and allowances stay with that application. This tool does not proxy secrets, reset limits, or retry generated answers. Capabilities and welcome requests may run as soon as you connect. Request only the bounded live examples needed to evaluate actual quality.

## Fast checks

`npm run check:chat` runs the harness/unit recovery cases, checks harness TypeScript and runs one Chromium recording with short footage looping under actual audio. Install Chromium once with `npx playwright install chromium`. The target is under a minute on a warm machine; the command reports its measured duration. It does not replace release checks or claim browser-wide/live-provider coverage.

## One candidate for release verification

`npm run verify:release` runs registry, lint, type, unit, acceptance, size, production dependency audit, API, packed-consumer, onboarding, provider and all existing browser checks. It builds and packs once into ignored `artifacts/chat-candidate/`, then sends the exact tarball and integrity to every consumer verifier. Each verifier still uses its independent clean install. Browser and provider compatibility remain independent gates; no paid API calls are enabled by this command.

`candidate.json` records version, source commit, dirty-tree status, SHA-256 and npm integrity. A local candidate may include uncommitted work; it is never called a published artifact. `VANILLASKY_CANDIDATE_DIR` selects a different output directory. The command verifies but never publishes, merges or deploys. CI additionally retains the existing Node and React version checks.

For one targeted consumer check, run `node scripts/chat-candidate.mjs`, then provide `VANILLASKY_PACKED_TARBALL`, `VANILLASKY_EXPECTED_INTEGRITY` and `VANILLASKY_EXPECTED_SHA256` from that manifest to an existing verifier. Do not repack between checks of the same candidate.
