import { getSceneDurationBounds, getSpokenDuration } from "../protocol/scene-duration.js";
import type { VideoScene, VideoTemplatePacing } from "../protocol/types.js";
import { CLIP_NARRATION_TAIL_SEC, speechFitsClip } from "../protocol/clip-budget.js";
import { getBuiltinSceneDefinition } from "../visual-system/catalog/builtin-metadata.js";
import { recoverSceneMedia } from "./recover-scene-media.js";

/** Measured speech replaces the estimate; footage's display floor can fit a shorter clip. */
export function preparedSceneDuration(
  scene: VideoScene,
  spokenSeconds: number | undefined,
  metadata: VideoTemplatePacing | undefined,
  clipDurationSec?: number,
): number {
  const timing = metadata?.timing;
  const authored = (timing?.revealSeconds ?? 0) + (timing?.holdSeconds ?? 0) + (timing?.exitSeconds ?? 0);
  const readable = Math.max(getSceneDurationBounds(scene, metadata).readable, authored);
  const floor = scene.templateId === "cinemaMedia" && clipDurationSec !== undefined && Number.isFinite(clipDurationSec) && clipDurationSec > 0
    ? Math.min(readable, clipDurationSec) : readable;
  const speech = Number.isFinite(spokenSeconds) && spokenSeconds! > 0
    ? spokenSeconds! + CLIP_NARRATION_TAIL_SEC
    : scene.narration ? getSpokenDuration(scene.narration) : 0;
  return Math.max(floor, speech);
}

/** Prepare one narrated scene against delivered footage, or its requested budget when unknown. */
export function prepareNarratedScene(scene: VideoScene, spokenSeconds: number | undefined): {
  scene: VideoScene; recovered: boolean; clipDurationSec?: number;
} {
  const requested = scene.timing.fixedDuration;
  const actual = scene.variables.mediaDurationSec;
  const clipDurationSec = scene.templateId === "cinemaMedia"
    ? [actual, requested].find((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0)
    : undefined;
  const recovered = clipDurationSec !== undefined && spokenSeconds !== undefined && !speechFitsClip(spokenSeconds, clipDurationSec);
  const visual = recovered ? recoverSceneMedia(scene)! : scene;
  const duration = preparedSceneDuration(visual, spokenSeconds, getBuiltinSceneDefinition(visual.templateId), clipDurationSec);
  // Playback assigns the prepared scenes a fresh ordered timeline.
  const { startTime: _start, endTime: _end, beatStart: _beatStart, beatEnd: _beatEnd, ...timing } = visual.timing;
  return { scene: { ...visual, timing: { ...timing, fixedDuration: duration } }, recovered, clipDurationSec };
}
