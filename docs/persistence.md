# Persistence and replay

A completed `Video` is ordinary JSON. The app keeps chat history in memory and
does not persist answers; D1 stores quota accounting only, and the optional R2
bucket holds owner recordings of the welcome answers, never viewer data. To add durable
storage, observe `useVideoChat().turns` and save a turn’s
`video` only when `turn.completed` is true and `turn.video` is present. Use
`JSON.stringify(turn.video)` and deduplicate writes by `turn.id`; there is no
special serializer. An interrupted turn can remain visible without qualifying as
completed conversation history. `VideoChat` renders the default interface over
that same hook, so durable storage means owning the hook’s turns.

Every stored video has `schemaVersion: "0.2"`. This storage version is separate
from streaming protocol `0.6`. The chat runtime supports the current storage
schema only: there are no compatibility aliases or implicit coercions.

## Load at the storage boundary

Treat values loaded from a database, object store, API, or file as `unknown`.
Parse them before using them in application code:

```tsx
import { getVideoDuration } from "../src/protocol/timeline";
import { parseVideo } from "../src/protocol/persistence";
import { VideoPlayer } from "../src/react";

export function SavedVideo({ storedJson }: { storedJson: string }) {
  const savedVideo = parseVideo(JSON.parse(storedJson));

  return <>
    <p>{getVideoDuration(savedVideo)} seconds</p>
    <VideoPlayer video={savedVideo} autoPlay={false} />
  </>;
}
```

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
when the deployment's privacy and deletion policy permits it. Saved-video replay does
not rehydrate a chat session or its voice queue.

Renderable scene variables may contain a media URL when that asset is necessary
for replay. Store only approved assets and avoid signed URLs whose lifetime is
shorter than the replay window.

## Storage ownership

Adding storage means owning the database, object storage, authorization,
encryption, deletion schedule, backups, quotas, and media URL expiry. Persist
the final `Video` document atomically with its own record identifier. Do not
use the protocol checksum as an authorization control.

The checksum on `response.complete` is a deterministic, non-cryptographic
drift detector. It is not proof of authenticity and is not a signature. Use
normal authenticated storage and a cryptographic integrity mechanism when
those properties are required.

Saved replay makes zero generation endpoint or model-provider requests. It is
not necessarily zero network traffic: audio, images, videos, and fonts may make separate media network requests.
