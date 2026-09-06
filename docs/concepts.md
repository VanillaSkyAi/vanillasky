[← Documentation home](../README.md) · [Previous: Getting started](getting-started.md) · [Next: Streaming protocol →](streaming-protocol.md)

# Core concepts

## Video chat

The default product surface is a conversation whose answers are synchronized
voice-and-video responses. `VideoChat` supplies the complete interface;
`useVideoChat` supplies the same session, turn, suggestion, voice, and playback
lifecycle for custom interfaces; `createVideoChatHandler` connects app-owned
providers and reports their capabilities through one endpoint.

Packaged templates and browser voice are the base mode. A text model makes that
mode answer, while optional provider callbacks progressively add generated
speech, stock media, transcription, and generated video without changing the
client. Visual responses deliberately choose between templates and fully
generated video; there is no mixed mode.

## Video response

A video response is a short, responsive animated experience assembled from
trusted templates. It begins before the full plan is available and ends as an
editable deterministic configuration.

It is not an encoded video stream. The browser renders normal React components
from validated scene instructions. The 0.1 SDK does not include MP4 or WebM
encoding; pass the completed deterministic JSON to an application-owned render
or export pipeline when an encoded file is required.

## Input

The viewer sends a prompt with bounded completed conversation turns. The server
adds trusted application `instructions`, template capabilities, and the selected
cinematic mode. `VideoChat` options control style, orientation, and custom
templates. Exact facts belong in the authorized prompt or conversation; secrets
and provider configuration stay on the server.

See [Prompt and conversation input](prompt-and-input.md) for the request contract.

## Template kit

VanillaSky uses its trusted built-in kit by default. Applications only configure
a kit when they need project-owned templates. Those templates replace matching
built-in IDs and add new IDs while every untouched built-in remains available.
A kit supplies three things together:

1. React components for the player;
2. advertised template capabilities for protocol negotiation;
3. an LLM catalog describing when and how each template may be used.

The planner cannot legitimately select a template outside the active kit.

## Planner

The server-side planner turns the input into complete `scene.add` parts followed
by `plan.complete`. A planner may be
recorded, deterministic, backed by OpenAI or Anthropic, or implemented with
another streaming text model.

The planner does not create public event IDs, checksums, or final
snapshots. The runtime owns those guarantees.

The internal composition pipeline can reserve a validated closing scene and
append it after the body. Planner parts are internal data; applications connect
text callbacks to `createVideoChatHandler` and let the SDK own event envelopes,
sequence IDs, and final snapshots.

## Event stream

The runtime emits ordered protocol events:

```text
response.start
data.video-chat-opening short spoken hook
scene.add             generated body
scene.add             generated body
scene.add             reserved closer
response.complete     exact terminal snapshot
```

Network transport uses SSE. Test utilities can simulate protocol events in process.

## Playback and buffering

The player renders the first committed scene and continues through the known
timeline. The chat holds its current visual during a generation gap. A media-bearing scene should
not be committed until its asset is ready; start generated content with a
typography-led scene so useful playback does not wait on media lookup.

Played scenes cannot be patched. This keeps playback deterministic and avoids a
scene changing after the viewer already saw it.

The same player accepts a completed value directly. After persisting the JSON,
load it through `parseVideo(JSON.parse(storedJson))`, then render
`<VideoPlayer video={savedVideo} />` to replay it without opening a stream or
calling the model again. Supply `templates` only when that video uses
customer-owned templates. See [Persistence and replay](persistence.md) for the
complete storage contract.

## Completion snapshot

`response.complete` contains the exact reduced `Video` plus a
checksum. The chat retains the completed video on its turn for application-owned replay
and storage. A partial playable answer may complete with non-fatal warnings.

Read the complete [Protocol 0.5](reference/protocol.md) and the separate
[persisted Video 0.1 contract](persistence.md).
