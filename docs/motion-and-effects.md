[← Documentation home](../README.md) · [Previous: Custom templates](custom-templates.md) · [Next: Production →](production.md)

# Motion and effects

VanillaSky motion is deterministic. The model selects from controlled names;
the SDK calculates the same frame from the same video JSON and playback time.
No generated CSS, animation code, or arbitrary transition is executed.

## Text archetypes

Text archetypes own a complete entrance, hold, and exit lifecycle:

- `subtle` — quiet supporting copy;
- `typewriter` — character-by-character reveal;
- `wordStagger` — sequential word build;
- `slam` — short, high-energy impact;
- `cinematic` — depth-led trailer movement;
- `heroWord` — one dominant word at a time.

Templates declare whether they have a tight or open text canvas. VanillaSky
normalizes incompatible or unknown values to a safe default.

## Background effects

Templates that support background motion can use:

- `static`;
- `slow-zoom-in`;
- `slow-zoom-out`;
- `ken-burns`;
- `drift`;
- `pulse`;
- `breathe`;
- `slow-tilt`;
- `camera-shake`.

`static` is the default, so a media change cannot restart an implicit camera
transform. Apply another effect explicitly when a still image or authored scene
benefits from it; footage keeps its own native motion by default.

## Scene continuity

Generated videos use `crossfade` by default. Persisted or application-authored
`Video` values can set `style.defaultTransition` to `crossfade` or `fade`; an
undefined or unknown value keeps the hard-cut behavior. The player applies a fade
only when two ranges are contiguous (allowing floating-point arithmetic noise)
and both templates declare `usesGlobalTransition: true` with valid
`transitionTiming` metadata. It is also conditional on the effective backdrop:
the 300 ms outer crossfade runs only when the resolved background media changes.
Scenes that share the black base, or the same resolved media backdrop, do
not crossfade. This keeps one stable background visible while each template
plays its own entrance, hold, and exit choreography.

The player owns a fixed black backdrop beneath the scenes. Built-in renderers
preload through the same component state used for playback. A cold custom
renderer reveals this black base while loading. Resolved scene media covers it
only while the media scene is active.

During a changed-media overlap, the current scene continues to its exact end.
The incoming component may be pre-mounted for media readiness, but remains
frozen at its true initial frame (`progress === motionProgress === 0`) until its
declared range begins. The current scene remains interactive and exposed to
assistive technology until the exact timeline boundary; the preview layer
remains inert throughout the overlap.

Templates always receive raw semantic scene time as `progress`. Grounded
numbers, media time, screen sequences, and other content state must use that
clock. An opted-in template also receives `motionProgress`; throughout active
playback it is the same complete `0→1` clock. The player never pre-advances,
caps, rewinds, or skips a template's entrance, internal motion, exit, or
terminal frame. `transitionTiming` records audited entry-ready and readable
checkpoints for verification, but does not remap runtime time. Use
`motionProgress` only for presentation and fall back to `progress` when it is
absent. Templates opt out by default.

An incoming changed-media fade can expose the template's initial frame while
its raw semantic clock is still zero.
Do not show a synthetic `0%`, `0x`, empty total, or another value that could be
mistaken for sourced content. Keep the grounded frame and CTA visible, but mark
only a transient value wrapper with
`visibility: var(--vanillasky-transition-semantic-visibility, visible)`. The
player hides that wrapper for the incoming preview and reveals it as soon as
the same mounted scene becomes active. This guard does not change `progress`,
media time, the component lifecycle, or final values.

As soon as a streamed scene arrives, the player starts warming its template and
backdrop. A changed-media scene is also mounted invisibly before its cut so the
browser can attach and decode the real element in advance. This media preroll
also protects intentional hard cuts; it does not pause or otherwise alter the
visual or soundtrack clocks.

Undefined or unknown transition names preserve a hard cut and unmodified local
motion. Overlapping ranges also hard-cut. A timeline gap renders the fixed black
background instead of replaying an earlier scene.

## Reduced motion

The player respects `prefers-reduced-motion`. Applications should keep a
visible playback control and must not rely on motion alone to communicate a
fact or state.

## Preview the catalog

The public [motion and effects gallery](https://vanillasky.ai/motion/) renders
the real SDK effects with their exact configuration. Use it to choose a
controlled effect, then keep the initial integration on the defaults unless a
specific editorial need calls for an override.

[← Documentation home](../README.md) · [Previous: Custom templates](custom-templates.md) · [Next: Production →](production.md)
