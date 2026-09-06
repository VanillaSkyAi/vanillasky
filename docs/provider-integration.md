[← Documentation home](../README.md) · [Previous: Getting started](getting-started.md) · [Next: Customization →](customization.md)

# Provider integration

Start from the generated chat so provider work stays confined to the
application-owned server:

```bash
npx @vanillaskyai/video init
npx vanillasky doctor
npm run dev
```

Init runs doctor automatically. The generated `server.ts` starts with one
`ANTHROPIC_API_KEY`, a template introduction, and browser voice; it installs no
optional speech or video packages.

Use `npx vanillasky providers add speech` to install xAI speech, or
`npx vanillasky providers add video` to install FAL video and transcription.
Add `XAI_API_KEY` or `FAL_KEY` to `.env.local` and restart the server. Stock media
needs only `PEXELS_API_KEY`, with no extra installation. These app-owned
adapters advertise their capabilities automatically; `src/main.tsx` does not
change. Rerun an interrupted setup command to finish installation.

For the full chat experience, mount one `createVideoChatHandler` and keep every
provider choice in its callbacks:

```ts
import "server-only";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText, streamText } from "ai";
import { createVideoChatHandler } from "@vanillaskyai/video/server";

export const handler = createVideoChatHandler({
  authorize: verifySession,
  streamText: ({ systemPrompt, userPrompt, signal }) => streamText({
    model: anthropic(process.env.TEXT_MODEL ?? "claude-sonnet-5"),
    system: systemPrompt,
    prompt: userPrompt,
    abortSignal: signal,
  }),
  generateText: async ({ systemPrompt, userPrompt, maxOutputTokens, signal }) => {
    const result = await generateText({
      model: anthropic(process.env.TEXT_MODEL ?? "claude-sonnet-5"),
      system: systemPrompt,
      prompt: userPrompt,
      maxOutputTokens,
      abortSignal: signal,
    });
    return result.text;
  },
});
```

That one text provider gives the browser templated video responses and local
browser speech. Supplying `generateSpeech`, `transcribe`, `searchMedia`, or
`generateVideo` enables those capabilities automatically. The callbacks are
structural and provider-neutral; their SDKs and credentials remain application
dependencies and never enter the browser bundle.

The planner emits a short spoken opening, then continues the answer in the same
stream. The default UI shows a chapter immediately. A welcome card can carry a
prewritten `opening`, whose narration starts without waiting for the model.
Each authored body beat prepares speech and selected footage together. Playback
starts after its contiguous preparation cushion, without requiring the entire
plan or a second model call for narration.

The matching complete React interface is one component and one scoped style
import:

```tsx
import { VideoChat } from "@vanillaskyai/video/react";
import "@vanillaskyai/video/video-chat.css";

export function App() {
  return <VideoChat />;
}
```

## Custom interface

For a custom interface, use `useVideoChat` and render its `turns`, `welcome`,
`suggestions`, `caption`, and `status`; the hook owns their network and playback
lifecycle. Pass a selected card through
`chat.ask(card.prompt, { opening: card.opening })` to start its hook immediately.
Custom interfaces can still pass and render `openingMedia`; the default UI uses
the chapter. Typed prompts receive their authored opening through the stream.

Any AI SDK `LanguageModel` works in both `streamText` and `generateText`. Keep
selection in one server-only module when an application supports several text
providers. The chat route and React component stay unchanged; only the model
passed to those callbacks changes. The AI SDK result can be returned directly:
its text stream, finish reason, usage, warnings, and response metadata match the
structural callback contract. See the
[provider adapter reference](reference/provider-adapters.md) for native provider
alternatives.

## Planning effort and reasoning modes

Planning is a structured emit against a trusted catalog, not a reasoning task.
Where a provider exposes a reasoning or effort control, a host that wants a
video to start quickly should turn extended reasoning off and keep effort low
to moderate. The default matters: several current models reason by default, and
that reasoning happens before the first plan part is emitted, so it is added
directly to time to first generated scene.

With the Vercel AI SDK and a current Anthropic model, that is one option object:

```ts
streamText: ({ systemPrompt, userPrompt, signal }) => streamText({
  model,
  system: systemPrompt,
  prompt: userPrompt,
  abortSignal: signal,
  providerOptions: {
    anthropic: { thinking: { type: "disabled" }, effort: "medium" },
  },
}),
```

Reasoning settings can substantially affect startup latency. Measure them with
your installed catalog and representative requests. Compare first-scene timing,
rejected scenes and factual accuracy; the fastest token stream is not useful if
its scenes cannot be rendered. Keep these settings in the provider adapter.

VanillaSky never sets these controls. Provider selection, sampling parameters,
and credentials stay with the application.

## Completion and usage

Use `onComplete` for server-side cost and completion measurement:

```ts
createVideoChatHandler({
  authorize: verifySession,
  streamText: ({ systemPrompt, userPrompt, signal }) => streamText({
    model,
    system: systemPrompt,
    prompt: userPrompt,
    abortSignal: signal,
  }),
  generateText: runSmallTextTask,
  onWarning: (warning) => logSafeWarning(warning.code, warning.category),
  onComplete: (summary) => recordGeneration({
    finishReason: summary.finishReason,
    usage: summary.usage,
    requestedModelId: summary.requestedModelId,
    resolvedModelId: summary.resolvedModelId,
    totalDurationMs: summary.totalDurationMs,
  }),
  onError: (error) => recordPrivateFailure(error),
});
```

`onComplete` fires once only after `response.complete`. It does not fire for a
terminal error, abort, disconnect, or timeout. Callback failures are isolated
from the event stream. Normalized token usage and model IDs remain server-only;
they never enter SSE or the persisted `Video`. Set `includeRawProviderData:
true` only when the host deliberately needs bounded provider-native usage and
metadata and has an appropriate retention policy.

`acceptedSceneCount`, `rejectedSceneCount`, and `timeToFirstSceneMs` describe
model-generated scene additions; the streamed opening hook is not counted.
Their sum is the proposed scene count. `videoDurationSec` is the duration
actually committed. These fields provide a server-side quality signal without
exposing model metadata in the browser.
Warnings include the same bounded typed warnings emitted to the client.
`plan_incomplete` identifies a playable partial response whose planner reported
a length limit; applications should show that result as incomplete and may
offer a bounded retry with a larger output or duration budget.
`plan_missing_closer` identifies a playable answer that ended without its
explicit final scene. For non-interactive evaluation, define an application
threshold and retry a bounded number of times. Keep the best accepted result
rather than treating `finishReason: "stop"` alone as a quality score.

The generated system prompt includes the selected trusted-template catalog and
is intentionally substantial. It is stable for the same SDK version, template
kit, media policy, and base prompt. Record input-token usage, keep the selected
kit no broader than the product needs, and enable provider-side prompt caching
where the chosen provider/model supports it. VanillaSky does not assume one
provider's cache controls in its provider-neutral adapter. Default chat streams an answer brief and shot directions rather than the template catalog; use provider-reported token
usage as the authoritative measurement rather than a character estimate.

Provider finish reasons `error` and `tool-calls` are terminal failures.
`length` and `content-filter` may complete with already accepted scenes; a
truncation before the first generated scene fails instead of returning an empty
success. The request signal is forwarded to the provider. Configure route and
provider timeouts with that signal, and keep retries host-owned and within the
same explicit request budget.

## Product-level planner guidance

`createVideoChatHandler` constructs the planner prompt from the trusted template
registry. Normal integrations do not build prompts or capabilities. Use the
handler's `instructions` option for durable product-level direction such as a
character, audience, domain, or answer style. The current user prompt and
bounded prior turns are supplied separately by the SDK.
