# Photographic footage and illustrated diagrams

10 September 2026. Default each generated clip to photographic live-action with
cinematic framing. Use drawn 2D animation for a clip that needs a diagram,
cutaway or schematic, then return to photographed subjects. Explicit requests
for drawing and caller rendering directions remain supported.

## Prompt evidence

MiniMax's [base prompting guide](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md)
places style and opening composition first. The adapted illustration vocabulary
comes from [h3-max-education's compiler](https://github.com/gokayfem/h3-max-education/blob/ad4c7700ce48860d14d68dd6c16e7f19ca15ec40/packages/domain/src/prompt-compiler.ts),
with its MIT attribution in [third-party notices](../THIRD_PARTY_NOTICES.md).
The application uses H3 Max Turbo at 768P, portrait, balanced expansion, with a
five-second first clip and eight-second later clips. This differs from the
reference project's model, resolution and framing; identical output is not implied.

## Bounded live comparison

Six fixed shots (elephants, forest, abandoned city, music listener, germination,
orbit), two seeds and two prompt variants produced 24 clips. Both arms used
the same authored subject/action, duration, model, resolution and expansion.
Baseline source was `b2feef1`; candidate profiles/compiler were `784e5e0`.
The comparison combines profile changes, treatment-first compilation and removal
of shared illustration wording; it does not isolate their individual effects.

Independent agent reviewers assessed anonymous A/B chronological contact sheets
before the mapping was revealed. Candidate appearance was preferred in 11 of
12 pairs: photographic 7 wins and 1 tie, illustrated 4 wins. Six preferences
were clear and five slight. No pair favored the baseline. Forest and city
results still sometimes looked rendered; uniformly repeated plants and pristine
geometry remain weaknesses. This small sample does not establish universal realism.

All 24 clips were ready and fully decoded (4,336 frames); no automatic submission
retries were made. Median provider return times were 4.711 seconds baseline and
4.720 seconds candidate. These are not browser first-frame times. Contact-sheet
preferences concern appearance, not complete motion or audio quality.

The shared conservative reservation was $4.99 under the $5 cap: $2.25 for the
fixed clips, $0.34 for four planner calls and $2.40 for two complete app answers.
Reservation totals are upper bounds, not invoice spend. Synthetic local media,
compiled inputs, source hashes and derived results were retained outside the
repository; credentials, remote media URLs and raw provider metadata were not.

## Selection and playback scope

Before per-shot selection was introduced, four real planner calls selected
photographic for two Earth runs and the music question, and illustrated for an
explicit drawing request. Two real localhost answers produced five Earth clips
and four germination clips with advancing browser frames and completed playback.
Generated voice requests returned server errors, so no speech completion or
narration-fit claim can be made from these runs. Speech code was unchanged and
the precise upstream failure was not retained.

Those live calls predate the final per-shot selection rule. They support the
unchanged rendering profiles, not the final planner's diagram choices. No
additional paid calls were made after the budget was reserved.

Final routing regressions exercise photographic → illustrated → photographic,
independent missing/invalid defaults, caller precedence, interleaved requests,
stock isolation, ending-only answers and saved-ending recovery. A gated stream
test verifies first footage starts before the ending or later shots arrive.
These tests verify delivery of authored choices; they do not replace a live
assessment of whether the planner chooses the right diagram.
