import { getSceneDuration, getSceneDurationBounds } from "../protocol/scene-duration.js";
import type { VideoScene, VideoTemplatePacing } from "../protocol/types.js";

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
