# Getting started

Use Node 22.12+ (22.23.1 is tested in CI) and the npm version recorded in `package.json`.

```bash
git clone https://github.com/VanillaSkyAi/video.git
cd video
npm ci
cp .dev.vars.example .dev.vars
```

Start with generated video. Add your server-side provider keys to `.dev.vars`:

```dotenv
ANTHROPIC_API_KEY=your-anthropic-key
FAL_KEY=your-fal-key
```

This gives real Haiku planning, fal-generated footage and browser speech. The
committed configuration already enables fal; no extra local flag is needed.
Add `XAI_API_KEY` for generated voice. `PEXELS_API_KEY` is optional for stock
footage as an alternative or when generated video is not configured.
Never commit `.dev.vars` or put these keys in frontend environment variables.

```bash
npm run dev
```

Open [localhost:4200](http://localhost:4200). One command starts the Vite frontend
and local Cloudflare API, initializes the local D1 database and local quota salt,
and stops both processes when you exit. Its local database is separate from
production. With your keys, localhost uses the same bounded allowance as the
website owner: up to five generated clips per answer, without the public pilot's
permanent personal limit. Request admission and per-answer spending bounds remain
active. Restart after changing provider keys.

## What happens with missing keys

- Without an Anthropic key, the app explains that planning must be configured.
- Without fal, footage uses Pexels. Pexels requires its own key.
- Without either footage provider, the app reports the missing setup.
- Without xAI, speech uses the browser. If browser speech is unavailable,
  subtitles remain available.

The actual footage mode is visible in the app. With both footage providers,
you can deliberately select Pexels or generated video. On a public deployment,
exhausting the personal AI-video allowance can resolve remaining footage to
configured Pexels. It never selects Pexels without its key. Failed or late AI
clips use chapter recovery; that failure itself does not trigger stock search.
All submitted conversations use the real planner. Test doubles exist only in
automated tests, never as a development or production mode.

## The files you will change

The app mounts `VideoChat` from the repository's own source. The
`functions/api/video-chat.mjs` route connects it to provider functions in
`functions/_video-chat/`. The existing planner, protocol and player live under
`src/`. [Architecture](architecture.md) maps the request path.

The generated-video path matches the website: Haiku 4.5, fal MiniMax H3 Max
Turbo at five seconds/768P, and optional xAI Eve. fal returns browser-playable
URLs directly. You only need your own storage if your retention requirements or
chosen provider require it.

Ask a question and a follow-up. Let the whole answer finish, check moving
footage and complete speech, and try pause/mute. Real provider calls incur
charges; keyless automated tests establish behavior, not live answer quality.

See [customization](customization.md) before changing the interface and
[production](production.md) before exposing your deployment publicly.
