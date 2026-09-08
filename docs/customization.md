# Customization

The default interface places footage behind a floating conversation field,
with on-video subtitles, pause/mute controls, suggestions, settings, and history.
Keep that interface unless your application needs to own it.

```tsx
<VideoChat
  className="acme-chat"
  welcomeTitle={<>Ask Acme<br />See the answer</>}
  branding={{
    name: "Acme",
    logo: <img src="/acme-logo.svg" alt="" width={120} height={30} />,
    homeUrl: "/app",
    showDeveloperLinks: false,
  }}
/>
```

Import `styles/video-chat.css` once. Override its scoped variables
on the instance class, not global element selectors:

```css
.acme-chat {
  --vs-media-glass: rgb(18 24 40 / 80%);
  --vs-media-text: #f8f8fc;
  --vs-voice: #e11d74;
  --vs-font: "Inter", sans-serif;
}
```

`welcomeTitle` changes the heading. `branding` changes only the navigation
identity: `name` supplies the accessible home-link label and becomes the visible
wordmark when `logo` is omitted. Size an app-owned image or React logo explicitly
to fit the header (about 120–144px wide and 30–36px high). Keep it non-interactive:
the surrounding home link already handles navigation.

Omit `branding` for the unchanged VanillaSky logo and interface. Omit `homeUrl`
even with custom branding to keep the existing Home behavior: at `/`, an ordinary
click starts a new session; elsewhere it navigates to `/`. An explicit `homeUrl`
navigates normally and never resets the current session first. Only root-relative
paths and HTTP(S) links without embedded credentials are accepted; other values
fall back to the existing Home behavior.

`showDeveloperLinks` defaults to true. It controls the chat runtime's Docs/About/GitHub
section in Settings, not an About page for your application. This is a small UI
option, not a theme system; it does not affect narration, providers or history.

The chapter
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
When subtitles are enabled, the spoken opening also appears in the standard
subtitle line. The full transcript includes that opening once, followed by the
scene narration, including on replay and when restoring an in-memory session.
At the end, the "Ask next" label stays directly above its follow-up cards.

`portrait` reserves a 9:16 response frame; `landscape` reserves 16:9.
The saved orientation stays stable. For responsive display without changing the
saved response, `<VideoPlayer orientation="auto" />` follows container width.
Keep the player in a container with a usable width and height.

History in `VideoChat` is in memory. Durable storage belongs to the host;
see [persistence](persistence.md).

[Documentation home](../README.md)

## Hosting policy

When changing video providers, add only their approved media CDN origins to
`public/_headers`. The deployed content security policy must permit the clips
you intend to play. Keep the existing script, frame and credential boundaries.
For your own deployment domain, update `public/robots.txt` and
`public/sitemap.xml` too.
