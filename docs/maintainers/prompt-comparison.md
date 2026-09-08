# Compact chat prompt comparison

Status: owner approved release on 2026-09-08 and chose to test live quality
personally. The proposed paid comparison was not run ($0 spent); blind output
preference and live quality remain unverified. Preparing SDK 0.11.3.

## Baseline and configuration

Remote main checked 2026-09-08: `428692dba90652a2ab8b36cbbed5b60d6e47a528`,
SDK 0.11.2. No remote changes beyond the supplied baseline. New isolated branch:
`feat/compact-chat-prompts`. No website changes or release bump are included.

The complete request path is `createVideoChatHandler` → `createVideoStreamHandler`
→ `createChatShotPlanner` → application `streamText`. The generic composition user
prompt is replaced by the chat planner. Capture the actual callback context, not
just `createVideoChatResponseInstructions`. Application instructions are appended
to the system prompt; completed-assistant grounding is appended by the planner;
overall duration, orientation, duplicate speech budget and caller direction are
prepended to user content. Narration repair uses a separate system prompt and the
shared `clipNarrationBudget` JSON. Suggestions and optional per-scene narration
prompts are separate tasks and outside this compression.

Offline callback capture (UTF-16 characters, not billed tokens), with the website's
119-character application guidance, three clips and five-second duration:

| Configuration | System | User, including case content | Repair system |
| --- | ---: | ---: | ---: |
| Waves, AI | 8274 | 559 | 873 |
| Waves, stock | 8754 | 323 | not invoked by null stock |
| Source fidelity / units, AI 10s | 8770 | 753 | 873 |
| Caller look, AI | 8274 | 818 | 873 |
| One clip, AI | 8392 | 543 | 873 |
| No video provider, AI | 6647 | 572 | not invoked |

Baseline duplication: speech targets appear in the main prompt and planner JSON;
scene counts and ending accounting recur; stock subject/equipment, feasibility
and illustrative provenance recur in three paragraphs; grounding and preservation
recur across creative categories. Intent-based style defaults appear in both the
prompt and compiler. Zero-video instructions conflict with the planner's generated
speech budget; stock record examples inherit the generated duration despite prose
saying otherwise. Internal generation attempts and fallback mechanics consume
instruction space without helping author the answer.

Website source configuration: `claude-haiku-4-5`, Anthropic Messages API version
2023-06-01, streamed output ceiling 4096; repair ceiling 256 and existing 2500ms
repair deadline. Temperature/top-p are omitted (provider defaults). SDK is model
agnostic. Live evaluation must record response model IDs and actual token usage;
source inspection is not proof of current deployed provider behavior.

## Frozen evaluation

`scripts/acceptance/prompt-cases.json` contains 20 fixed inputs/configurations in
each mode, 40 total. Each includes case-specific success criteria. All have the
existing 40-second answer ceiling and landscape orientation. Stock cases retain
the configured AI duration deliberately to detect accidental coupling. Source
answers are synthetic; no credentials or private user content are fixtures.

Compare baseline with baseline defaults; compact prompt with baseline style
policy; compact prompt with proposed style policy. Separate commits identify the
latter two artifacts; no production experiment switch. Policy includes model
selection guidance and the missing/invalid-style compiler fallback.

Most runs use real text only, no paid media or speech. Capture complete planner
records and callback timestamps, replay those records through the real handler
with in-memory media doubles, and reuse acceptance utilities for events/recovery.
Keep authored fixtures, live text, replayed transport, and viewed media evidence
separate. Mock results never establish factual or visual quality.

Blind evaluator receives case/configuration, randomly ordered opaque output IDs,
records and measurements, without prompts/variant identities. Lock scores before
revealing mapping. For each output, score 0–4 (absent/invalid, mostly fails,
material repair, minor issue, fully satisfies) on fidelity, completion/opening/
progression/ending, narration fit, visual relevance, and stock feasibility where
applicable. Record concrete defects and tradeoffs; report per-category and mode
wins/ties/losses, not only an aggregate. Generated treatments must improve the
predefined mechanism, spatial, observable-action, fiction and caller-style cases;
choosing realistic more frequently is not a quality metric.

Measure strict schema/record ordering separately from runtime recovery. Use shared
`estimateNarrationSeconds`, `narrationFitsClip` and clip budgets, counting numbers
as spoken; report first-pass fit, rewrite demand/outcomes and original meaning
retained after repair. Stock fit depends on selected footage, so text-only stock
fit against a generated duration is not assessable. Record recovery reasons and
completion from handler replay. First-valid-brief latency starts at request dispatch
and ends at a complete structurally valid brief with its ending; first token and
runtime's tolerant opening acceptance are not substitutes. Compare paired median
and p95 latency; investigate consistent regressions rather than applying mocked
250ms thresholds to live providers.

Second-model subset: waves, evaporation, units, comparison, caller and injection,
both modes (12 combinations × 3 arms). Repeat at most four uncertain combinations
across all three arms. Allow one targeted revision and rerun at most those four
combinations. Do not retry provider failures automatically. Every repair request
counts toward the approved bound, including failed and timed-out requests.

Acceptance: contract/isolation checks pass; no lost essential facts, units,
negation, conditions or uncertainty in critical cases; completion and fit do not
regress; blind preference favors the candidate with significant category losses
exposed; predefined visual-sensitive cases improve and caller styles survive.
Unresolved latency regressions block acceptance. Retain compression alone if style
policy fails. Live quality acceptance remains unverified until authorized runs.

## Spending and release boundary

No paid calls authorized or made. Finish code/offline verification before requesting
one bounded live budget covering primary planning, second-model subset, limited
repeats/revision, narration repairs and selected actual footage. No automatic paid
retries, raised limits or stored keys. Stop for owner merge/release approval.

## Candidate changes and offline evidence

Compression artifact: `35173ca` (baseline style policy retained).
Style artifact: `c4a824c` (content-led choice plus realistic compiler fallback).
All remain unreleased SDK 0.11.2 source candidates, not npm publications.

Callback capture over all 40 frozen configurations completed for all three arms,
using authored records and null media only. No text provider was called. Typical
waves request sizes, including the same application guidance and user content:

| Arm | AI system + user | Stock system + user | Repair system |
| --- | ---: | ---: | ---: |
| Baseline | 8833 | 9077 | 873 |
| Compact / baseline style | 4363 | 5276 | 612 |
| Compact / proposed style | 4483 | 5396 | 612 |

Final text reduction: 49.2% AI and 40.6% stock for this case. These are character
counts, not a prompt-length gate, token billing estimate or model quality result.
Stock uses a five-second planning slot independent of AI duration; no unavailable
AI provider speech limit is injected. Narration repair retains its shared JSON,
256-output-token ceiling and single 2500ms attempt. No playback code, provider
callbacks, dependencies or public declarations were edited.

Removed two exact-prose prompt tests; retained creative fixtures exercising the
real handler and media adapter. Focused checks: 113 existing behavior tests passed
for compression, lint/typecheck/build passed, then 23 visual-direction tests passed
for style policy including malformed styles, independent intent validation and
explicitly distinct styles under interleaving. Fixture criteria for three stock
controls were clarified before any model assessment: AI allowance, availability
and duration must not constrain stock. Inputs/configurations did not change.

## Proposed live budget (approval required)

One bounded run, at most **252 text requests, 6 generated clips and 12 stock
searches**, with a **US$12 total hard stop** and no automatic retries:

- 120 primary Haiku 4.5 plans (40 combinations × three arms).
- 36 Sonnet 4.5 plans (12 fixed combinations × three arms).
- At most 12 Haiku repeats and 12 Haiku plans after one targeted revision.
- At most 72 narration-rewrite requests total, with 256 output tokens each;
  use the planning model for that arm. Stop and report unmeasured repairs if
  this ceiling is reached, rather than silently treating them as successful.
- Six five-second 768p `minimax/h3-max-turbo/text-to-video` clips: baseline and
  candidate for waves, evaporation, and caller clay direction. Evaluate the
  relevant first developing beat (or ending when no developing beat exists).
  If text acceptance rejects style policy, compare compression alone instead.
- At most 12 stock searches: baseline and candidate first relevant beats for
  equipment, historical, comedy, units, followup and waves. Preserve actual
  search-result evidence separately from text-only feasibility judgments.

Settings match website text defaults: Messages API 2023-06-01, 4096 output tokens,
no temperature/top-p override, no cache/batch discount assumed. Reserve each call's
maximum possible cost before dispatch; cap planning input at 12000 UTF-8 bytes and
repair input at 4000 bytes (conservatively priced as tokens). Recheck prices before
calling if approval is delayed. Do not change account/provider spending limits.
Typical expected cost is roughly $3–5; the conservative token-ceiling estimate is
$9.33 for text plus $1.20 for video at nonpromotional rates. Existing account caps
remain authoritative; failures/timeouts consume their reservation without retry.
No paid TTS; this evaluates estimated narration fit, with prerecorded/local speech
playback checks reported separately from live voice fit.

Prices checked 2026-09-08: [Haiku 4.5](https://www.anthropic.com/claude/haiku)
$1/$5 per million input/output tokens; [Sonnet 4.5](https://www.anthropic.com/news/claude-sonnet-4-5)
$3/$15; [FAL model](https://fal.ai/models/minimax/h3-max-turbo/text-to-video)
768p $0.01/second promotional, $0.04/second regular. Budget uses regular rates.
Pexels search has no per-call charge assumed; remain within existing account limits.

Spend so far: **$0**. Live schemas, fidelity, completion/fit deltas, rewrite demand,
latency, blind quality preference and actual generated/selected footage are all
**unverified**. A green CI run cannot replace these acceptance gates.

## Independent review and gate corrections

A separate Sol agent inspected baseline fixtures before candidate code, then
performed read-only implementation review. It found no concrete runtime or public
API regression beyond the intended fallback. It identified stale prompt-prose
assertions in three additional test files as a merge blocker. The first release
check found the same nine failures (986 tests passed); it stopped before packing.
Removed the obsolete prose assertions while retaining checks for generation caps,
complete authored beats/endings, provider isolation and conversation/opening
forwarding. All 49 tests in those files then passed. No production wording was
changed to satisfy a test. The reviewer also clarified the stock caller-style
rubric: literal stock cannot render clay. No model outputs have been assessed.

This reviewer has now seen implementation identity. A fresh read-only evaluator
must score randomized outputs after spending approval; code review is not blind
quality preference. No more than one evaluator owns scoring at a time.

## Release decision and completed verification

The owner requested release and will test the deployed prompts personally, replacing
this task's proposed paid evaluation gate. No paid text, video, stock or voice calls
were made for the comparison. This does not establish blind quality acceptance.

Final implementation head before the version-only release preparation: `56b7fd7`.
All 23 CI checks passed. Local verification passed 995 unit tests, seven acceptance
turns, lint, types, build, packed consumers, all four Next.js provider integrations
and the development-chat smoke test. The local browser suite finished 203 passed,
32 skipped and two WebKit Settings-focus return failures. Both failures reproduced
in isolation on candidate and fresh baseline `428692d`; unchanged frontend code
and the mocked-welcome test never invoke the prompt planner. The full local gate
remains red on that pre-existing issue; no unrelated UI change was introduced.
Sol's final independent code review approved the implementation after the stale
prose assertions were removed, with live quality explicitly outside that signoff.

The version preparation changes package identity, starter pin and release notes,
not runtime behavior. Its new identified artifact is verified by the normal PR
and trusted-publisher release workflows before website adoption.
