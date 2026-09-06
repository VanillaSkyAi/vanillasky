import { getSceneDuration, getSceneDurationBounds } from "../protocol/scene-duration.js";
import type { VideoScene, VideoTemplatePacing } from "../protocol/types.js";

/** A bounded startup cushion, not a guarantee that later network jobs will finish. */
const READY_AHEAD_SECONDS = 8;

export function canStartPreparedSequence(
  scenes: readonly (VideoScene | undefined)[],
  complete: boolean,
): boolean {
  let seconds = 0;
  let count = 0;
  for (const scene of scenes) {
    if (!scene) break;
    count += 1;
    seconds += scene.timing.fixedDuration ?? 0;
    if (seconds >= READY_AHEAD_SECONDS) return true;
  }
  return complete && count > 0 && count === scenes.length;
}

/** Measured speech replaces the estimate, but never the template's reading floor. */
export function preparedSceneDuration(
  scene: VideoScene,
  spokenSeconds: number | undefined,
  metadata: VideoTemplatePacing | undefined,
): number {
  const timing = metadata?.timing;
  const authored = (timing?.revealSeconds ?? 0) + (timing?.holdSeconds ?? 0) + (timing?.exitSeconds ?? 0);
  const readable = Math.max(getSceneDurationBounds(scene, metadata).readable, authored);
  return Number.isFinite(spokenSeconds) && spokenSeconds! > 0
    ? Math.max(readable, spokenSeconds! + 0.8)
    : Math.max(readable, getSceneDuration(scene, metadata));
}
