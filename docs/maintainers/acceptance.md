# Video chat acceptance

Run the deterministic chat journey with:

```bash
npm run acceptance:chat
```

It calls `createVideoChatHandler` with in-memory provider doubles, sends requests,
and decodes the actual response stream. It requires no credentials, makes no
provider calls, and spends no FAL credits. The seven turns cover an explanation,
a follow-up carrying the previous answer, a creative story, Pexels search,
AI-video and Pexels failures recovering to authored chapters, and exhausted
AI-video allowance recovering to chapters without a generation request. Each
turn checks that only the selected footage provider is called: AI video never
falls back to stock, and Pexels mode never calls AI-video generation.

The checks require an opening before body scenes (within 250 ms), a ready first
scene within one second, completion within three seconds, preservation of every
completed scene, resolved media, and redacted recovery warnings. These timing
budgets detect regressions in the local mocked path; they do not measure live
model latency. Grounding and readability checks preserve the planned short copy
and narration with readable durations. No template diversity or background music
requirement forces an answer to become longer than needed. The journey also checks
follow-up context reaches the planner and absent or failed speech returns the
redacted response that the browser uses to select local voice.

Automated acceptance makes no claim about human visual quality and assigns no
human score. For an authorized live check, use the actual app on localhost to ask an
explanation, follow up, and request a creative response. Watch the opening and
completed scenes, check text readability and voice synchronization, and verify
that browser voice continues when generated speech is unavailable. Browser
playback and speech recovery have separate automated integration coverage;
this server journey does not simulate a human watching or listening.

Use live providers only for an explicitly authorized manual test. Keep credentials
in the application's server environment and never store provider errors or raw
metadata in browser-visible evidence.
