import { CLIP_NARRATION_TAIL_SEC } from "../protocol/clip-budget.js";

const clipPasses = new WeakMap<HTMLMediaElement, number>();

/** Runtime decoder evidence; persisted scene variables cannot authorize a cut. */
export function setClipRepeatCount(media: HTMLMediaElement, count: number): void {
  clipPasses.set(media, count);
}
export function getClipRepeatCount(media: HTMLMediaElement): number {
  return clipPasses.get(media) ?? 0;
}

/** Fresh measured speech determines how many normal-speed clip passes are needed. */
export function measuredClipPlayback(spokenSeconds: unknown, clipDurationSec: number): { durationSec: number; repeatCount: number } | undefined {
  if (typeof spokenSeconds !== "number" || !Number.isFinite(spokenSeconds) || spokenSeconds <= 0
    || !Number.isFinite(clipDurationSec) || clipDurationSec <= 0) return undefined;
  if (spokenSeconds <= clipDurationSec) return { durationSec: Math.min(spokenSeconds + CLIP_NARRATION_TAIL_SEC, clipDurationSec), repeatCount: 0 };
  const repeatCount = Math.ceil(spokenSeconds / clipDurationSec) - 1;
  if (!Number.isSafeInteger(repeatCount)) return undefined;
  return { durationSec: spokenSeconds, repeatCount };
}
