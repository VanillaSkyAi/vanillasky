import { getSceneDuration, getSceneDurationBounds } from "../protocol/scene-duration.js";
import type { VideoScene, VideoTemplatePacing } from "../protocol/types.js";
import { CLIP_NARRATION_TAIL_SEC, speechFitsClip } from "../protocol/clip-budget.js";
import { getBuiltinSceneDefinition } from "../visual-system/catalog/builtin-metadata.js";
import { recoverSceneMedia } from "./recover-scene-media.js";

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
    ? Math.max(readable, spokenSeconds! + CLIP_NARRATION_TAIL_SEC)
    : Math.max(readable, getSceneDuration(scene, metadata));
}

/** Prepare one narrated scene without extending generated footage past its budget. */
export function prepareNarratedScene(scene: VideoScene, spokenSeconds: number | undefined): {
  scene: VideoScene; recovered: boolean; clipDurationSec?: number;
} {
  const requested = scene.timing.fixedDuration;
  const actual = scene.variables.mediaDurationSec;
  const durations = [requested, actual].filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
  const clipDurationSec = scene.templateId === "cinemaMedia" && durations.length ? Math.min(...durations) : undefined;
  const recovered = clipDurationSec !== undefined && spokenSeconds !== undefined && !speechFitsClip(spokenSeconds, clipDurationSec);
  const visual = recovered ? recoverSceneMedia(scene)! : scene;
  const duration = preparedSceneDuration(visual, spokenSeconds, getBuiltinSceneDefinition(visual.templateId));
  // Playback assigns the prepared scenes a fresh ordered timeline.
  const { startTime: _start, endTime: _end, beatStart: _beatStart, beatEnd: _beatEnd, ...timing } = visual.timing;
  return { scene: { ...visual, timing: { ...timing, fixedDuration: duration } }, recovered, clipDurationSec };
}
