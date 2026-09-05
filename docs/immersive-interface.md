[← Documentation home](../README.md)

# Immersive video chat

`VideoChat` provides the complete conversation interface over an adaptive video
canvas. Import its stylesheet once; no copied example UI or component setup is
required.

```tsx
import { VideoChat } from "@vanillaskyai/video/react";
import "@vanillaskyai/video/video-chat.css";

export function App() {
  return <VideoChat options={{ endpoint: "/api/video-chat" }} />;
}
```

The [interactive component reference](reference/design-system.html) uses the
same packaged stylesheet. It demonstrates navigation, settings, history,
conversation input, subtitles, suggestions and interaction states without
requesting a microphone or calling a model.

## Watching and asking

The video owns the canvas. The navigation contains the VanillaSky logo, new
session, history, voice and settings. One floating field supports speech and
text; playback, microphone and send controls stay beside the question.

Beginning a question pauses the picture and narration together. Speech becomes
a draft to review. Sending begins the next answer; canceling returns to the
previous playback state. Canceling voice input also discards pending
transcription so a late result cannot replace a new draft.

The first subtitle hides the input unless editing, listening or keyboard focus
requires it. Pointer activity or touch reveals the controls again. They hide
after two seconds of inactivity during playback; paused playback and active
controls remain accessible. A stationary pointer left over Send does not hold
the input open. Settings can keep the input visible.

## Subtitles and transcripts

Subtitles sit on a dark backing over the picture. The complete current cue
remains available without a line clamp or ellipsis. When the input appears,
subtitles move upward; when it disappears, they return to the bottom baseline.
The transition preserves space for both rows instead of abruptly repositioning
the subtitle.

Subtitle actions fade while inactive and return on hover, touch or keyboard
focus. Expand opens the answer transcript in the same surface. Hide removes
subtitles; the Subtitles switch in Settings restores them. The transcript is
part of the video interface rather than a separate modal.

## Settings and history

Settings and history share one dark glass treatment. Watching preferences
control subtitles and input visibility. Video creation and style preferences
apply to the next question; provider capabilities determine available options.
History replays saved answers without generating them again. New session
retains up to ten sessions in memory, preserving completed answers for replay.
This history does not provide server or durable persistence; storage remains
application-owned. See [persistence](persistence.md).

Suggestions appear in a horizontal media-card rail. Pointer hover and keyboard
focus select a card; choosing it begins a follow-up answer. Focus outlines and
hover movement remain inside the rail's available space.

## Layout and access

The foreground video preserves its scene ratio, so diagrams and text remain
visible without cropping or distortion. The surrounding viewport remains black during playback.
Display layout does not rewrite the saved response's orientation. See
[responsive orientation](responsive-orientation.md) for saved videos and custom
players.

Primary control targets are at least 44px. Bottom spacing includes the device
safe area. Keyboard focus stays visible, settings retain native switch and
radio behavior, and popovers support Escape and outside-click dismissal.
Reduced motion removes movement and fades; increased contrast strengthens
surface opacity and borders.

## Customization

Use the existing `welcomeTitle`, `className` and `options` props to customize
copy, scoped CSS properties and generated footage direction. There is no separate
light/dark appearance picker. See [customization](customization.md) for examples.
Use `useVideoChat` when the application needs to own the whole interface.
