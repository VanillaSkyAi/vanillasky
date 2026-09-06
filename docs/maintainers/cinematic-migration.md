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

## Render fonts

The cinematic templates use `-apple-system, BlinkMacSystemFont, "Helvetica Neue", Roboto, Arial, sans-serif` at regular and medium weights. Apple devices keep native system typography. The existing `@vanillaskyai/video/video-chat.css` entry registers packaged Roboto v51 WOFF2 subsets as the fallback for environments without those fonts. Standalone player and source-owned template integrations should also import that stylesheet. No font is fetched from Google at runtime; browsers fetch local packaged subsets only when Roboto is selected for the rendered glyphs. The font assets include the SIL Open Font License and a source/hash manifest.

Live native fonts and a Linux renderer’s Roboto have slightly different metrics. For repeatable exports, keep the browser, installed fonts, viewport and package version fixed, and await `document.fonts.ready` after mounting the final scene before capturing frames. This is a host export responsibility; the SDK does not add a separate export API or force downloaded fonts onto Apple devices.

## Media-led follow-up

The owner requested removing `focusCards`. Regenerate persisted videos using that ID; migrate parallel explanations to narration over footage rather than another bullet layout. The remaining seven templates retain their IDs. Comparison, quote, key figure and timeline accept optional standard media variables and remain readable on black when assets are absent. No provider callback signatures or host limits change.
