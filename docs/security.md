[← Documentation home](../README.md) · [Previous: Streaming protocol](reference/protocol.md) · [Next: Errors and recovery →](errors.md)

# Security

The SDK validates protocol shape; your application still owns identity, authorization, data policy, and infrastructure controls.

## Required server controls

- Authenticate the user and tenant before reading the prompt body.
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

Do not log raw source, personalization, authorization headers, provider deltas, or signed media URLs by default. Record request ID, tenant-safe metrics, model ID, timing, event counts, error codes, and token usage.

Treat final configs as customer data. Apply tenant isolation, retention,
encryption, and deletion policy to snapshots and event logs. Report suspected
SDK vulnerabilities through the repository's private process in
[SECURITY.md](../SECURITY.md).
