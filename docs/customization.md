# Customization

The default interface places footage behind a floating conversation field,
with on-video subtitles, pause/mute controls, suggestions, settings, and history.
Keep that interface unless your application needs to own it.

```tsx
<VideoChat
  className="acme-chat"
  welcomeTitle={<>Ask Acme<br />See the answer</>}
/>
```

Import `@vanillaskyai/video/video-chat.css` once. Override its scoped variables
on the instance class, not global element selectors:

```css
.acme-chat {
  --vs-media-glass: rgb(18 24 40 / 80%);
  --vs-media-text: #f8f8fc;
  --vs-voice: #e11d74;
  --vs-font: "Inter", sans-serif;
}
```

`welcomeTitle` changes the heading, not the navigation logo. The chapter
introduction uses black with neutral system typography. The supported scenes
are chapters and footage; there is no renderer-extension or brand-kit API.

Use `options` for endpoint, request headers, orientation, and voice.
Capabilities are discovered from the server. `useVideoChat` provides the same
conversation/playback lifecycle for application-owned controls.

## Visual direction

Use server `instructions` for trusted audience, tone, or domain guidance.
A shared `style.generatedLook` can guide generated footage; the planner carries
consistent response-specific subjects and setting into each shot.
[Media and voice](media-and-audio.md) explains the look and adapter contract.
Style prompts cannot restyle stock assets.

## Opening and layout

A selected suggestion can start its prepared opening immediately:

```ts
await chat.ask(card.prompt, { opening: card.opening, openingMedia: card.media });
```

Typed prompts receive their opening from the same model stream as the answer.
The opening holds until its narration completes and the first scene is ready.

`portrait` reserves a 9:16 response frame; `landscape` reserves 16:9.
The saved orientation stays stable. For responsive display without changing the
saved response, `<VideoPlayer orientation="auto" />` follows container width.
Keep the player in a container with a usable width and height.

History in `VideoChat` is in memory. Durable storage belongs to the host;
see [persistence](persistence.md).

[Documentation home](../README.md)
