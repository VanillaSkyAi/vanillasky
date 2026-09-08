# Provider onboarding verification

`npm run verify:nextjs` installs the exact candidate in fresh strict Next.js
consumers. Each uses the default footage/chat route and `VideoChat`, with no
customer template registry.

The OpenAI and Anthropic paths exercise official AI SDK providers; Google and
OpenRouter exercise their provider-native stream/result boundaries. Requests
are intercepted with deterministic native payloads: no keys or paid model calls.

The gate checks strict build/type boundaries, provider model selection and finish
reason/usage normalization, private metadata isolation, production authorization,
default footage playback, reload without duplicate generation, and bounded
pre-playback failure recovery. The footage is a local browser media fixture.

`VANILLASKY_PROVIDER` selects one provider for targeted work. CI runs the
provider matrix against one candidate tarball and fails closed if any leg is
missing or fails. The packed Vite consumer separately covers storage replay and
React-free server installation; the init gate covers application scaffold and
optional adapter installation.

Retained evidence records command results and artifact identity, not real
credentials or provider responses. Live provider behavior is a separate,
explicitly authorized check under [acceptance](acceptance.md).
