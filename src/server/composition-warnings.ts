import type { CreateVideoOptions, VideoScene } from "../protocol/types.js";
import type { VideoWarning } from "../protocol/warnings.js";
import { getReadableSceneDuration } from "../protocol/pacing.js";

export function cloneWarning(warning: VideoWarning): VideoWarning {
  return {
    code: warning.code,
    category: warning.category,
    message: warning.message,
    ...(warning.sceneId != null ? { sceneId: warning.sceneId } : {}),
    recoverable: warning.recoverable,
  };
}

export function createOmittedForCloserWarning(sceneId: string): VideoWarning {
  return {
    code: "scene_omitted_for_closer",
    category: "readability",
    message: "Scene was omitted because the reserved closer must remain the last scene.",
    sceneId,
    recoverable: true,
  };
}

export function createDuplicateCloserWarning(): VideoWarning {
  return {
    code: "scene_omitted_for_closer",
    category: "readability",
    message: "An additional closer was omitted because the first valid closer is already reserved.",
    recoverable: true,
  };
}

export function createIncompletePlanWarning(): VideoWarning {
  return {
    code: "plan_incomplete",
    category: "provider",
    message: "The planner stopped at a length limit; some requested scenes or the ending may be missing.",
    recoverable: true,
  };
}

export function createMissingCloserWarning(): VideoWarning {
  return {
    code: "plan_missing_closer",
    category: "provider",
    message: "The planner completed without a valid closer; the video may end on a body scene.",
    recoverable: true,
  };
}

export function pendingCloserReserve(
  scene: VideoScene,
  getTemplatePacing: CreateVideoOptions["getTemplatePacing"],
): number {
  const metadata = getTemplatePacing?.(scene.templateId);
  const readableMinimum = getReadableSceneDuration(scene, metadata);
  const explicitRange = scene.timing.startTime != null && scene.timing.endTime != null
    ? Math.max(0, scene.timing.endTime - scene.timing.startTime)
    : undefined;
  const requested = explicitRange ?? scene.timing.fixedDuration ?? metadata?.preferredDuration ?? readableMinimum;
  return Math.max(readableMinimum, requested);
}

export function createSceneQualityWarnings(scene: VideoScene): VideoWarning[] {
  if (scene.templateId !== "barChart" || !Array.isArray(scene.variables.bars)) return [];
  const values = scene.variables.bars.flatMap((bar) => {
    if (!bar || typeof bar !== "object") return [];
    const value = (bar as { value?: unknown }).value;
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? [value] : [];
  });
  if (values.length < 2 || Math.max(...values) / Math.min(...values) <= 20) return [];
  return [{
    code: "chart_scale_imbalance",
    category: "readability",
    message: "Chart values span more than 20×; verify that they use comparable units.",
    sceneId: scene.id,
    recoverable: true,
  }];
}
