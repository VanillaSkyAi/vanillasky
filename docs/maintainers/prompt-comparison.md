# Compact chat prompt comparison

Status: evaluation protocol frozen before implementation; live calls not authorized.

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
