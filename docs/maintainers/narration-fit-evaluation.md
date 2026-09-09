# One-time narration fit evaluation

Measured September 9–10, 2026. Runtime candidate: `423d6e8`.

## Result and scope

The final prompt produced **301 of 301 measured original narrations fitting
their clip budget with at least 0.8 seconds remaining**. All accepted narrations
also fit. The sample contained 80 first scenes with five-second budgets and
221 later scenes with eight-second budgets, across 80 answers. No measurements
were missing in this final sample.

The estimator requested 17 shortening attempts (5.6%): six replacements were
accepted and eleven still exceeded the estimate, retaining the original line.
The actual original audio fit in all seventeen cases. This distinguishes repair
frequency from audible overruns; an estimated mismatch is not a failed video.

This meets the observed 99% timing target for these cases and this voice. It
does not establish a production-wide guarantee, independent success probabilities
for each language, or browser-synthesis timing. Repeated prompts and scenes
within an answer are not independent samples. Existing speech-completion and
footage-repetition recovery remains in place.

## Method and iterations

The one-time local harness used the actual chat handler, Anthropic Haiku 4.5
planner and repair adapter, and xAI Eve speech adapter. Only footage was replaced
with test placeholders. It decoded returned MP3 audio to PCM without playing or
saving it, then compared decoded seconds plus the tail with the assigned budget.
Original and accepted text were measured separately when they differed.

The initial comparison used ten synthetic questions, two baseline runs and three
candidate runs each. Both arms used five/eight-second durations and identical
silent-footage guidance. This differs from the application's ambient-footage
guidance, so it is a controlled prompt comparison, not an exact app benchmark.

| Stage | Answers | Measured scenes | Original fit with tail | Accepted fit with tail | Shortening attempts |
| --- | ---: | ---: | ---: | ---: | ---: |
| Previous wording with longer clips | 20 | 63 | 15 | 51 | 56 |
| One-sentence and nearby schema limits | 30 | 113 | 112 | 113 | 12 |
| Intermediate app-configured check | 66 | 248 | 243 | 246 | 27 |
| Final app-configured check | 80 | 301 | 301 | 301 | 17 |

The intermediate check also emitted one unmeasured recovery scene; two further
requests were stopped when revising the prompt and retain their spend reservation.
They are not counted as successful measurements. The final check used the app's
ambient-audio prompt setting, the ten regression questions and twenty additional
fixed cases, including numbers, supplied instructions and seven other languages.
It stopped after exceeding 300 measured scenes. The final answer averaged 3.76
scenes; count alone does not establish complete or accurate coverage.

The final wording repeats the applicable spoken-word/character limits in the
writing request, emphasizes extra room for numbers and pauses, and preserves
supplied facts and ordered actions across the answer. It adds no model call or
serial dependency before footage submission.

## Real footage and playback

Five additional localhost answers generated footage and completed their native
speech. An instrumentation failure prevented their video measurements, so they
are not counted as fully verified playback runs. The observer was fixed and
checked offline before one additional complete answer was generated.

That confirmation used four fal clips: 5.184, 8, 8 and 8 seconds. Their measured
voices were 3.24, 4.536, 4.368 and 4.368 seconds. All retained the tail, showed
advancing decoded frames through speech completion, and had no observed repeat.
The opening and four scene voices completed. First moving footage appeared at
9.54 seconds in this single cold-browser run, not a matched latency comparison.
Container padding made the first file longer than its five-second request;
the provider request's exact five/eight values have separate boundary tests.
The browser was muted: this verifies mechanical playback, not listening quality.

Eight seconds is the available source length, not a mandatory display time.
Playback already cuts after measured narration and its tail/readability floor.
This fits filmmaking guidance to choose shot length for purpose and pace, and
to trim source footage to its useful interval. See [Wistia on B-roll timing](https://wistia.com/blog/b-roll)
and [Adobe on trimming clips](https://www.adobe.com/learn/premiere-pro/web/remove-trim-extend-clips).

## Limits and cost accounting

Content review found factual and instruction-fidelity errors in some original
plans, including a reversed gear relationship and altered objects or quantities
in supplied examples. These were present before narration repair. This change
does not establish factual accuracy or a semantic quality pass; those remain
separate risks despite the successful timing result.

The text/voice harness submitted 198 planning, 112 repair and 806 speech requests.
Its conservative accounting upper bound was $4.71 under a $5 stop. Completed
plans with known token usage released unused reservations; unknown/failed calls
retained them. The six real-app answers were additional, bounded calls through
the application's existing admission and provider controls. No account spending
limits or production configuration were changed.

Prices used for text/voice accounting were checked against [Anthropic's Haiku pricing](https://www.anthropic.com/claude/haiku)
and [xAI's speech pricing](https://docs.x.ai/developers/models/text-to-speech).
The one-time scripts, source fingerprints and synthetic results remain with the
local task artifacts; no evaluation mode or test credentials were added to the app.
