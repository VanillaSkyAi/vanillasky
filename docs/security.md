[← Documentation home](../README.md) · [Previous: Streaming protocol](reference/protocol.md) · [Next: Errors and recovery →](errors.md)

# Security

Internal modules validate protocol shape. Identity, authorization, data policy
and infrastructure controls live in `functions/`, and stay the deployment's
responsibility.

Local development's bounded owner reservation path requires both an explicit
server-owned local flag and a loopback request URL. Public requests retain their
normal quotas; production owner access requires a verified Access identity.
Local development does not change provider account limits or production data.

## Required server controls

- Authenticate the request before reading the prompt body.
- `createVideoChatHandler` requires an
  explicit `authorize` policy. The
  `authorize: "none"` escape hatch is for intentionally non-public in-process
  tests only; do not use it on a billable generation route.
- Allowlist browser origins; CORS is not authentication.
- Bound request bytes, media count, scene count, duration, tokens, concurrency, and cost.
- Keep provider keys, system prompts, tools, signed-URL credentials, and admin tokens server-side.
- Restrict media domains, types, dimensions, bytes, redirects, and fetch timeouts.
- Propagate cancellation and use timeouts for provider, media, persistence, and export work.
- Return safe typed errors while logging private causes only in protected observability.

Do not log raw source, personalization, authorization headers, provider deltas, or signed media URLs by default. Record request ID, viewer-safe metrics, model ID, timing, event counts, error codes, and token usage.

Treat saved answers as viewer data. Apply retention, encryption and deletion
policy to any snapshots and event logs a deployment keeps. Report suspected
vulnerabilities through the repository's private process in
[SECURITY.md](../SECURITY.md).
