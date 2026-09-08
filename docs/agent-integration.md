# Agent integration

Build the supported chat path first. The optional integration skill is installed
with `npx skills add VanillaSkyAi/video@vanillasky`.

In an empty app, run `npx @vanillaskyai/video init`, use
`npx vanillasky doctor` to identify missing setup, and start `npm run dev`.
For an existing app, keep its framework and connect `VideoChat` to one
`createVideoChatHandler` using the [provider guide](provider-integration.md).
Do not copy SDK internals or invent a second generation client.

The host adds credentials to ignored server-only environment files. Never read,
print, screenshot, or send secret values. Doctor exposes key names only.

Verify in a real browser: a complete answer, its ending, a follow-up, pause/mute,
and console/network failures. Test moving footage when a video adapter is
configured. Report the localhost URL and ready capabilities, not just scaffold
completion.

The SDK owns chat, shot planning, streaming, voice timing, and the two renderers.
The application owns providers, keys, auth, persistence, copy, and spending.
Use `useVideoChat` only when the host needs a custom UI; use `parseVideo` and
`VideoPlayer` for saved responses. Renderer plugins and template authoring are
not supported.

Chat planning uses a shared answer contract plus the selected AI-video or stock
mode instructions. Application `instructions` guide the answer within that
contract. With `resolveAnswer`, the completed answer is the sole factual source;
user and conversation content cannot replace the planning contract. Narration
budgets come from the configured generated clip duration, while stock footage
uses its available duration.

Automatic generated style follows the content: realistic for observable action,
illustrated for mechanisms or abstract relationships, cinematic for fiction or
atmosphere. Missing or invalid model styles fall back to realistic. A caller
`style.generatedLook` takes precedence; stock searches remain literal footage
selection and cannot apply a generated rendering style.

[Getting started](getting-started.md) · [Documentation home](../README.md)
