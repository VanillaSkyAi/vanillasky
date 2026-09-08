import { CLIP_NARRATION_TAIL_SEC } from "../protocol/clip-budget.js";

/** Playback recovery only; planning still has to fit narration inside one clip. */
export function measuredClipPlayback(spokenSeconds: unknown, clipDurationSec: number): { durationSec: number; repeat: boolean } | undefined {
  if (typeof spokenSeconds !== "number" || !Number.isFinite(spokenSeconds) || spokenSeconds <= 0
    || !Number.isFinite(clipDurationSec) || clipDurationSec <= 0) return undefined;
  const overrun = spokenSeconds - clipDurationSec;
  if (overrun <= 0) return { durationSec: Math.min(spokenSeconds + CLIP_NARRATION_TAIL_SEC, clipDurationSec), repeat: false };
  if (overrun <= Math.min(1, clipDurationSec * .25) + 1e-6) return { durationSec: spokenSeconds, repeat: true };
  return undefined;
}
