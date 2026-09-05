# Cinematic contract migration

The eight-template replacement is an approved breaking pre-1.0 change. Persisted Video schema is now `0.2`; event protocol is `0.6`.

## Breaking changes

- Removed `VideoInput.brand`, `VideoStyle.brand`, `VideoBrand`, `VideoBrandInput`, `VideoBackground`, and `resolveVideoBrand`. Graphics use black, white/neutral text and system typography. Naturally colored media is unaffected.
- Removed all 28 old built-in IDs. Eight new IDs describe different schemas: `cinemaMedia`, `chapterTitle`, `focusCards`, `editorialTimeline`, `mobileMessage`, `comparison`, `quote`, `keyFigure`.
- `parseVideo` rejects the old persisted `0.1` fixture with `unsupported_video_version`. The parser also rejects `style.brand` if a caller merely stamps the new version onto an old object.
- Scene source intent uses `mediaKeyword` (up to 80 characters) and optional `mediaSource`. The host owns `mediaUrl`, `mediaPoster` and resolved `mediaType`. No gradient fallback mode. Full-bleed requires a resolvable intent or asset; Reach out can remain on black when media is unavailable.

## Adoption

Regenerate videos from the retained source and narration using the new catalog. Do not automatically relabel old IDs: before/after emojis, count-ups and factual quote/stat schemas have different meanings. Retain an older published SDK in a separate legacy playback boundary if historical exports must continue to render; do not pass those payloads into the new parser.

Before (old persisted format):

```json
{"schemaVersion":"0.1","scenes":[{"id":"one","templateId":"media","variables":{"texts":"A new perspective","mediaType":"gradient"},"timing":{"fixedDuration":4}}],"style":{"brand":{"font":"Inter"}}}
```

After re-authoring that title as a chapter:

```json
{"schemaVersion":"0.2","scenes":[{"id":"one","templateId":"chapterTitle","variables":{"title":"A new perspective"},"timing":{"fixedDuration":4}}],"style":{}}
```

Evidence: persistence tests preserve the untouched old release fixture and assert rejection, accept current-style round trips, reject hidden/non-JSON input as before, and pin new checksums. Template tests cover both orientations, deterministic seeking, exact evidence text and single-decoder backdrop ownership. Final packed consumer and mobile playback checks remain release gates.
