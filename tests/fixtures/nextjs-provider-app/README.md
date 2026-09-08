# Packed Next.js consumer

This fixture installs the candidate SDK and connects its default video-chat
handler to an app-owned provider module. The client uses `VideoChat` with no
renderer registry. The verifier supplies deterministic native provider streams
and a local footage response, then checks strict builds, authentication,
metadata isolation, playback, and failure recovery.

Run `npm run verify:nextjs` from the SDK checkout. Do not install dependencies
in this source fixture or add real keys.
