# Offline creative examples

`creative-answers.json` contains authored examples, not model outputs or recorded
provider results. The comparison uses explicitly supplied fictional products;
the turtle and robot stories are fiction. These are a review aid and protocol
regression set, not an automated score of creative quality.

The test feeds each treatment through the actual chat handler in both modes,
with unavailable-media stubs. It verifies ordered complete narration, meaningful
authored chapter recovery, three finite five-second beats, concise opening/beat
word counts, no additional text call and no cross-mode media call. Word counts
are a writing heuristic: they do not measure speech duration or audible quality.
The existing incremental planner tests cover emission before stream completion.

For a future live sample, review these questions against the actual spoken answer
and footage, not merely its planner JSON:

- Does the opening contribute an answer, starting cue or immediate story situation
  in roughly two to three seconds? Does the body add something new?
- Does an explanation connect cause to result, and a practical answer provide an
  ordered action plus an observable success cue without losing conditions?
- Does a comparison use the same criteria and finish the requested decision with
  its supporting condition, rather than inventing missing differences?
- Does a story turn a choice into a consequence? Does comedy land its payoff
  without explaining the joke? Neither should become a factual lecture.
- Can each beat's action be seen at its framing and spoken naturally in its clip?
  Do subjects stay coherent across cuts, and does the ending finish the request?
- In stock mode, are the essential actor/activity retained and the shot merely
  illustrative where exact fictional action cannot be sourced? A chapter is an
  honest fallback. These generic fixtures do not certify stock availability or
  demonstrate actual generated imagery, actor continuity or voice delivery.

A passing fixture suite establishes contract compatibility only. A future live
sample must still assess relevance, correctness, pacing and entertainment value.
