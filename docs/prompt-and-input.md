[← Documentation home](../README.md) · [Next: Generate your first video →](getting-started.md)

# Prompt and conversation input

VanillaSky turns the same things people ask an AI chat into spoken video
answers. The chat runtime owns the video-planning prompt and conversation formatting;
the application owns the model, product guidance, authentication, and data.

## What the viewer sends

`<VideoChat />` and `useVideoChat` send the current prompt plus a bounded set of
earlier turns to one `/api/video-chat` endpoint. Prompts can ask for an
explanation, story, recommendation, ad, recap, or any other general-purpose AI
response. Do not put provider keys, private policy, or unrelated personal data
in the conversation.

When using the custom hook, ask in plain language:

```ts
await chat.ask("Pitch a playful ad for a coffee mug that never spills");
```

A selected welcome or follow-up card can also include a prepared opening line
and already-loaded media:

```ts
await chat.ask(card.prompt, {
  opening: card.opening,
  openingMedia: card.media,
});
```

That path starts immediately. A typed prompt instead receives its short spoken
hook and media keyword from the beginning of the planner stream.

## Application guidance

Use the server handler's `instructions` option for durable product direction:

```ts
createVideoChatHandler({
  authorize: verifySession,
  streamText: planWithYourModel,
  generateText: runSmallTextTask,
  instructions: [
    "Speak like a warm, concise creative partner.",
    "Prefer concrete examples over abstract explanations.",
  ].join(" "),
});
```

This can define a character, audience, subject area, tone, or answer style. It
does not change the protocol, authorize media, or weaken validation. Keep the
viewer prompt separate from these trusted server-side instructions.

## What reaches the model

`createVideoChatHandler` builds the shot-planning instructions, video rules,
conversation context, and application guidance. Your provider adapter receives
two complete strings:

```ts
streamText: ({ systemPrompt, userPrompt, signal }) => streamText({
  model,
  system: systemPrompt,
  prompt: userPrompt,
  abortSignal: signal,
});
```

Pass both strings unchanged. The system prompt describes the internal answer
brief and shot format, pacing, narration, opening contract, and safe media
directions. The user prompt contains the current request, bounded prior turns,
orientation, visual mode, and whether an opening was already spoken.

Provider credentials and raw media URLs never belong in either prompt. Media
callbacks restore approved URLs on the server only after the model's structured
output has been parsed.

## One stream, one answer

The planner streams a compact answer brief containing the opening and creative
direction, then the first developing shot so footage can start. It saves the
ending next, followed by any remaining developing shots. A one-scene answer
emits only the brief and ending. One model request serves both suggested and
typed prompts; a suggestion may already supply its opening. There is no separate
classification or first-shot planning request.

The runtime assigns scene IDs, uses the footage renderer, resolves media, and
finalizes the response when planning ends. The model does not choose body
layouts, media providers, or lifecycle events. Narration and visible action are
planned together: explanations connect causes with visible effects or relevant
human experiences, stories develop consequences,
comedy times its reveal, imaginative requests depict their invented world, and
practical answers demonstrate usable steps. These are directions, not fixed
scene counts or one universal story structure.

Each view should add context, a useful detail, an action or a meaningful reaction.
Realistic footage can carry human emotion; illustration is useful when the
relationship needs a visual explanation that footage cannot provide. Generated
shots describe observable behavior and useful framing, including subtle motion
in quiet moments. Pexels queries name the essential subject and visible action;
an abstract feeling alone is not a useful search query.

Every `scene.add` is validated before the browser receives it. The model never
returns React, HTML, CSS, or executable JavaScript. Invalid planning content
produces safe diagnostics. A media failure does not delete valid narration.

AI mode generates footage within the host allowance. Pexels mode searches
stock without calling the video generator. Each authored beat includes a short
chapter title; missing footage becomes that chapter with its complete narration.

## Grounding

General chat permits stable model knowledge, but it still forbids invented
citations, quotations, URLs, personal details, live facts, and guarantees. If
exact numbers, names, dates, or wording matter, include them in the prompt or
conversation. Use retrieval in the application before calling VanillaSky when
the answer depends on private or current data.

## Debugging weak answers

Check these boundaries in order:

1. Does the prompt contain the exact facts the answer needs?
2. Is `instructions` concise product guidance rather than extra source data?
3. Does the provider pass `systemPrompt` and `userPrompt` unchanged?
4. Is extended reasoning delaying the first streamed object?
5. Do `onWarning` and `onComplete` show rejected scenes or a length limit?
6. Do the planned actions develop the answer, and does its ending resolve the request?
7. Does resolved footage actually play for the spoken duration?

Log request IDs, safe warning codes, provider finish reasons, model IDs, and
token usage. Never log credentials or expose raw provider errors in the video.

[← Documentation home](../README.md) · [Next: Generate your first video →](getting-started.md)
