import {
  MAX_RETAINED_INSTRUCTIONS_LENGTH,
  MAX_RETAINED_MEDIA_URL_LENGTH,
  MAX_RETAINED_MEDIA_URLS,
  MAX_RETAINED_SOURCE_LENGTH,
} from "../protocol/persistence.js";
import {
  VIDEO_SCHEMA_VERSION,
  type CreateVideoOptions,
  type Video,
  type VideoAudio,
  type VideoInput,
  type VideoScene,
} from "../protocol/types.js";
import type { VideoWarning } from "../protocol/warnings.js";
import { getReadableSceneDuration, paceScene } from "./pacing.js";

const DEFAULT_OPENING_TEXT = "Creating your video...";

export function normalizeVideoInput(input: VideoInput): VideoInput {
  return {
    ...input,
    opening: input.opening === false
      ? false
      : input.opening?.trim() || DEFAULT_OPENING_TEXT,
  };
}

export function resolveStreamCapabilities(
  capabilities: CreateVideoOptions["capabilities"],
  hasRuntimeOpening: boolean,
): CreateVideoOptions["capabilities"] {
  if (!hasRuntimeOpening || capabilities?.templates == null) return capabilities;
  return {
    ...capabilities,
    templates: [...new Set(["chapterTitle", ...capabilities.templates])],
  };
}

export function validateVideoInput(input: VideoInput): void {
  if (!input.input.trim()) throw new Error("Video response input is required");
  if (input.knowledgeMode != null && input.knowledgeMode !== "input-only" && input.knowledgeMode !== "general") {
    throw new Error("Video response knowledge mode must be input-only or general");
  }
  if (input.maxDurationSec != null &&
    (!Number.isFinite(input.maxDurationSec) || input.maxDurationSec < 5 || input.maxDurationSec > 120)) {
    throw new Error("Video response maximum duration must be between 5 and 120 seconds");
  }
  if (input.opening !== false && input.opening != null && !input.opening.trim()) {
    throw new Error("Video response opening must be a non-empty string");
  }
  if (input.audio && !input.audio.src.trim()) {
    throw new Error("Video response audio src must be a non-empty string");
  }
  if (input.audio && input.audio.src.length > MAX_RETAINED_MEDIA_URL_LENGTH) {
    throw new Error(`Video response audio src must be at most ${MAX_RETAINED_MEDIA_URL_LENGTH} characters`);
  }
  for (const [index, media] of (input.suppliedMedia ?? []).entries()) {
    if (media.url.length > MAX_RETAINED_MEDIA_URL_LENGTH) {
      throw new Error(`Video response supplied media ${index} URL must be at most ${MAX_RETAINED_MEDIA_URL_LENGTH} characters`);
    }
    if (media.posterUrl && media.posterUrl.length > MAX_RETAINED_MEDIA_URL_LENGTH) {
      throw new Error(`Video response supplied media ${index} poster URL must be at most ${MAX_RETAINED_MEDIA_URL_LENGTH} characters`);
    }
  }
}

export function buildInitialComposition(
  input: VideoInput,
  audio: VideoAudio | undefined,
  snapshotRetention: CreateVideoOptions["snapshotRetention"],
  closerReserveSec: number,
  getTemplatePacing: CreateVideoOptions["getTemplatePacing"],
): { config: Video; warnings: VideoWarning[] } {
  const openingText = typeof input.opening === "string" ? input.opening.trim() : undefined;
  const openingScenes: VideoScene[] = openingText
    ? [{
        id: "supplied-opening",
        templateId: "chapterTitle",
        variables: {
          title: openingText,
        },
        timing: { fixedDuration: 3 },
      }]
    : [];
  const scenes: VideoScene[] = [];
  const warnings: VideoWarning[] = [];
  for (const scene of openingScenes) {
    const maxDurationSec = input.maxDurationSec ?? 30;
    const readableMinimum = getReadableSceneDuration(scene, getTemplatePacing?.(scene.templateId));
    if (maxDurationSec < readableMinimum) {
      throw new Error("Video response maximum duration cannot fit the supplied opening readably");
    }
    const paced = paceScene(scene, {
      previousScenes: scenes,
      audio,
      maxDurationSec,
      closerReserveSec: Math.min(closerReserveSec, maxDurationSec - readableMinimum),
      getTemplatePacing,
    });
    if (!paced.scene) throw new Error("Video response maximum duration cannot fit the supplied opening readably");
    scenes.push(paced.scene);
    warnings.push(...paced.warnings);
  }

  const meta: NonNullable<Video["meta"]> = {
    name: "Video response",
  };
  if (snapshotRetention?.source) {
    meta.source = input.input.trim().slice(0, MAX_RETAINED_SOURCE_LENGTH);
  }
  if (snapshotRetention?.instructions && input.instructions?.trim()) {
    meta.prompt = input.instructions.trim().slice(0, MAX_RETAINED_INSTRUCTIONS_LENGTH);
  }
  if (snapshotRetention?.suppliedMediaUrls && input.suppliedMedia?.length) {
    meta.uploadedMediaUrls = input.suppliedMedia
      .slice(0, MAX_RETAINED_MEDIA_URLS)
      .map((item) => item.url);
  }

  return {
    config: {
      schemaVersion: VIDEO_SCHEMA_VERSION,
      orientation: input.orientation ?? "portrait",
      scenes,
      ...(audio ? { audio } : {}),
      style: {
        density: input.style?.density ?? "normal",
        motion: input.style?.motion ?? "normal",
        defaultBackgroundEffect: input.style?.backgroundEffect ?? "static",
        defaultTextArchetype: input.style?.textArchetype ?? "subtle",
        defaultTransition: "crossfade",
        ...(input.style?.generatedLook ? { generatedLook: input.style.generatedLook } : {}),
      },
      meta,
    },
    warnings,
  };
}
