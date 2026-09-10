# Errors and recovery

`VideoChat` preserves the opening and accepted scenes when an optional scene,
provider, or stream fails. It recovers silently and keeps the answer playable. A fatal error is shown only when no playable response can
be produced. Never put provider details or stack traces in the interface.

## Recovery by boundary

| Failure | Result |
| --- | --- |
| Invalid planner scene | Skip the part and accept later valid scenes |
| Generated footage | Use a narrated chapter; never silently switch to stock |
| Stock lookup or candidate | Continue with another stock candidate or narrated chapter |
| Scene renderer | Isolate the failed scene with a safe visual |
| Missing narration | Continue with scene text |
| Generated speech | Continue silently and keep the transcript |
| Late stream failure | Keep playable opening and completed scenes |
| Unauthorized or invalid request without playable output | Show a safe error |

Keep non-fatal `chat.warnings` as application diagnostics; they are also
retained on the corresponding `VideoChatTurn.warnings`. Render `chat.error`
when the response cannot play, and keep `chat.playerProps` mounted during recovery.
Check `turn.completed` before persisting it as completed conversation context;
a cancelled or partial visible turn is not automatically a completed turn.

`VideoError` exposes actionable public fields: `code`, `message`, optional HTTP
`status`, `requestId`, `runId`, and `recoverable`. Log only safe codes and IDs
from the client. The server's `onError` observer receives internal diagnostics;
redact credentials, source data, provider payloads, and signed URLs before logging.
Observer failures are isolated from response generation.

## Cancellation and retries

`chat.cancel()` cancels the current work while preserving available output.
Replacing a prompt aborts its old providers and speech. The host must forward
`signal` to every provider callback and own deadlines, quotas, and retry budgets.
The chat retries once only before playback. Never silently restart generation
after the viewer has begun watching, and do not replay paid generation requests
without a deliberate idempotency and spend policy.

The server drops invalid generated parts by default. `invalidPartBehavior: "fail"`
is an explicit strict policy; ordinary chat should retain the resilient default.
`onComplete` runs after a `response.complete`, including a recovered playable
response. Fatal errors, disconnects, and explicit aborts do not call it.

Automated regression and acceptance tests use mocked providers. See
[Testing](testing.md) and the [chat acceptance gate](maintainers/acceptance.md).

## Slow optional providers

Generated video starts with a 15-second preparation budget; later deadlines account for the scene's position. Stock media and fallback
scene narration have 3-second deadlines. Generated speech has a 10-second server
deadline and a 12-second browser deadline to include transfer and decoding.
A deadline uses the same safe fallback as a failed provider; completed scenes
and scene order are preserved. Providers receive cancellation, and late results
are ignored even when a provider does not cooperate. These initial limits bound
waiting; they are not claims about measured live-provider performance.

A completed turn and its saved video are available before follow-up suggestions.
Suggestions load separately and may be omitted after a short deadline. Starting
another turn or cancelling discards outstanding suggestions.
