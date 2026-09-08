[← Documentation home](../README.md) · [Previous: Core concepts](architecture.md) · [Next: Streaming protocol →](reference/protocol.md)

# Persistence and replay

A completed `Video` is ordinary JSON owned by your application. VanillaSky
does not provide a database or hosted media store. For a custom interface, observe `useVideoChat().turns` and save a turn’s
`video` only when `turn.completed` is true and `turn.video` is present. Use
`JSON.stringify(turn.video)` and deduplicate writes by `turn.id`; there is no
SDK serializer. An interrupted turn can remain visible without qualifying as
completed conversation history. The default `VideoChat` keeps history in memory;
use the headless hook when the application needs durable storage.

Every stored video has `schemaVersion: "0.2"`. This storage version is separate
from streaming protocol `0.6`. The SDK supports the current storage
schema only: there are no compatibility aliases or implicit coercions.

## Load at the storage boundary

Treat values loaded from a database, object store, API, or file as `unknown`.
Parse them before using them in application code:

<!-- verify:persistence-example:start -->
```tsx
import { getVideoDuration, parseVideo } from "@vanillaskyai/video";
import { VideoPlayer } from "@vanillaskyai/video/react";

export function SavedVideo({ storedJson }: { storedJson: string }) {
  const savedVideo = parseVideo(JSON.parse(storedJson));

  return <>
    <p>{getVideoDuration(savedVideo)} seconds</p>
    <VideoPlayer video={savedVideo} autoPlay={false} />
  </>;
}
```
<!-- verify:persistence-example:end -->

The release verifier compiles this exact documented snippet against the packed
SDK artifact, including its root and React subpath imports.

`parseVideo(value: unknown)` validates the complete shape, known fields,
style, audio, metadata, unique scenes, timing, and JSON-safe
template variables. It returns a detached, deeply frozen `Video`, so later
changes to the loaded object cannot mutate player state.

Invalid data throws `VideoValidationError` with `code: "invalid_video"`.
Previous, unknown, or future storage versions throw the same error class with
`code: "unsupported_video_version"`. `<VideoPlayer video={value} />` repeats
this boundary validation and rejects the entire value before any renderer
runs; it never renders a partial future document.

## Retention

Completed snapshots omit raw source, creative instructions, and the supplied-media
URL index. Store an authorized prompt separately with the completed turn only
when the host's privacy and deletion policy permits it. Saved-video replay does
not rehydrate a chat session or its voice queue.

Renderable scene variables may contain a media URL when that asset is necessary
for replay. Store only approved assets and avoid signed URLs whose lifetime is
shorter than the replay window.

## Storage ownership

The host owns the database, object storage, tenant authorization, encryption,
deletion schedule, backups, quotas, and media URL expiry. Persist the final
`Video` document atomically with your own tenant and record identifiers. Do not
use the protocol checksum as an authorization or tenancy control.

The checksum on `response.complete` is a deterministic, non-cryptographic
drift detector. It is not proof of authenticity and is not a signature. Use
normal authenticated storage and a cryptographic integrity mechanism when
those properties are required.

Saved replay makes zero generation endpoint or model-provider requests. It is
not necessarily zero network traffic: audio, images, videos, and fonts may make separate media network requests.
