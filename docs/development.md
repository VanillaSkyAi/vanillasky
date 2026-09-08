# Development

Use Node 22+ and the locked npm version. Run `npm ci` once in your worktree.

```bash
npm run dev:chat
```

The local chat harness imports source directly for HMR. Keep media fixtures:
they exercise real decoder, readiness, audio-clock, and replay boundaries.
There is no catalog generation or registry synchronization step.

For an ordinary edit, run the affected test files, lint, and typecheck. Add a
focused regression for a behavior change. Run browser tests when playback or UI
behavior changes; use the packed-consumer gates when exports, starter code, or
public examples change. Do not run the complete release matrix repeatedly during
the edit loop.

`npm run verify:release` is the final candidate gate: it builds one artifact and
reuses it for clean-room consumers. `verify:package` already verifies public API
declarations/runtime boundaries; `verify:api` is a targeted shortcut, not an
additional full-release pass.

[Architecture](architecture.md) · [Contributing](https://github.com/VanillaSkyAi/video/blob/main/CONTRIBUTING.md)
