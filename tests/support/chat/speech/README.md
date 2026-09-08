# Offline spoken fixtures

These 18 MP3s speak the exact opening, body and ending in `manifest.json` for the six development intents. The fixture handler uses that same manifest for both planning and speech lookup. Unknown text fails explicitly; it never substitutes a beep or an unrelated line. The `speech-error` scenario still deliberately fails speech preparation.

Generated locally on macOS using the installed Samantha system voice at 170 words per minute; encoded with ffmpeg/libmp3lame as 24 kHz mono, 64 kbit/s MP3. These are synthetic spoken utterances, not human recordings, production captures or an AI-provider quality sample. The waterfall is still generic test footage; matching narration makes playback and timing useful to hear, without claiming visual relevance.

To regenerate after changing the transcripts:

```sh
node dev/chat/speech/generate.mjs
```

Requires macOS `/usr/bin/say` with Samantha already installed and `ffmpeg` on PATH (`FFMPEG` can name its executable). The script makes no network requests and downloads nothing. Checked-in assets require neither tool for ordinary `npm run dev:chat` use.

`tests/browser/fixtures/media-transition/activation-cue.wav` remains a synthetic timing tone for tests that explicitly need it; this development conversation no longer uses it as narration.
