import type {
  VideoAudio,
  VideoScene,
  VideoTemplatePacing,
} from "../protocol/types.js";
import type { VideoWarning } from "../protocol/warnings.js";

export const DEFAULT_SCENE_DURATION_SEC = 5;
export const MINIMUM_OPENING_DURATION_SEC = 3;
export const MINIMUM_CLOSER_RESERVE_SEC = 3;
export const PACING_PLANNER_RULES = [
  "Use each template's preferredDuration when no explicit duration is needed, and never request less than minDuration.",
  `Give the first scene at least ${MINIMUM_OPENING_DURATION_SEC} seconds so the opening has time to register.`,
  "Track the cumulative duration budget before emitting every scene; the runtime omits scenes that cannot remain readable.",
  `Reserve at least ${MINIMUM_CLOSER_RESERVE_SEC} seconds for the final closer when the catalog includes jobs:[ask] or jobs:[payoff].`,
] as const;

const WORDS_PER_SECOND = 4.5;
const CHARACTERS_PER_SECOND = 12.5;
const ITEM_BASE_SECONDS = 2;
const SECONDS_PER_ITEM = 1;
const DURATION_QUANTUM_SEC = 0.25;

function roundDuration(value: number): number {
  return Math.ceil(value / DURATION_QUANTUM_SEC) * DURATION_QUANTUM_SEC;
}

function mergeSchemaDefaults(
  variables: Readonly<Record<string, unknown>>,
  metadata: VideoTemplatePacing | undefined,
): Record<string, unknown> {
  const merged = { ...variables };
  for (const [name, property] of Object.entries(metadata?.schema?.properties ?? {})) {
    if (merged[name] === undefined && property.default !== undefined) merged[name] = property.default;
  }
  return merged;
}

function fieldValue(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[segment];
  }, value);
}

function stringsIn(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value && typeof value === "object") return Object.values(value).flatMap(stringsIn);
  return [];
}

function itemCount(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") return Object.keys(value).length;
  return value == null || value === "" ? 0 : 1;
}

export function getReadableSceneDuration(
  scene: Pick<VideoScene, "variables">,
  metadata: VideoTemplatePacing | undefined,
): number {
  const minimum = Math.max(0.001, metadata?.minDuration ?? 1);
  const timing = metadata?.timing;
  if (!timing) return roundDuration(minimum);
  const variables = mergeSchemaDefaults(scene.variables, metadata);
  const values = timing.contentFields.map((field) => fieldValue(variables, field));
  let estimate: number;
  if (timing.contentUnit === "items") {
    estimate = ITEM_BASE_SECONDS + values.reduce<number>(
      (total, value) => total + itemCount(value),
      0,
    ) * SECONDS_PER_ITEM;
  } else {
    const content = values.flatMap(stringsIn);
    const units = timing.contentUnit === "words"
      ? content.reduce((total, value) => total + (value.match(/\S+/gu)?.length ?? 0), 0)
      : content.reduce((total, value) => total + [...value].length, 0);
    estimate = 1 + units / (timing.contentUnit === "words" ? WORDS_PER_SECOND : CHARACTERS_PER_SECOND);
  }
  return roundDuration(Math.max(minimum, estimate));
}

export function getCloserReserve(
  templateIds: readonly string[] | undefined,
  getTemplatePacing: ((templateId: string) => VideoTemplatePacing | undefined) | undefined,
): number {
  if (!templateIds || !getTemplatePacing) return 0;
  const closerDurations = templateIds
    .map((id) => getTemplatePacing(id))
    .filter((metadata) => metadata?.jobs?.some((job) => job === "ask" || job === "payoff"))
    .map((metadata) => Math.max(
      metadata?.minDuration ?? MINIMUM_CLOSER_RESERVE_SEC,
      metadata?.preferredDuration ?? 0,
    ));
  return closerDurations.length === 0
    ? 0
    : Math.max(MINIMUM_CLOSER_RESERVE_SEC, ...closerDurations);
}

function requestedStart(
  scene: VideoScene,
  audio: VideoAudio | undefined,
  priorEnd: number,
): number {
  const beatStart = scene.timing.beatStart == null
    ? undefined
    : audio?.beatMarkers[scene.timing.beatStart]?.time;
  return scene.timing.startTime ?? beatStart ?? priorEnd;
}

function requestedDuration(
  scene: VideoScene,
  metadata: VideoTemplatePacing | undefined,
  audio: VideoAudio | undefined,
  priorEnd: number,
): number {
  const beatEnd = scene.timing.beatEnd == null
    ? undefined
    : audio?.beatMarkers[scene.timing.beatEnd]?.time;
  const statedStart = requestedStart(scene, audio, priorEnd);
  const statedEnd = scene.timing.endTime ?? beatEnd;
  if (statedEnd != null) return Math.max(0.001, statedEnd - statedStart);
  return Math.max(0.001, scene.timing.fixedDuration ?? metadata?.preferredDuration ?? DEFAULT_SCENE_DURATION_SEC);
}

function warning(
  code: VideoWarning["code"],
  message: string,
  sceneId: string,
): VideoWarning {
  return { code, category: "readability", message, sceneId, recoverable: true };
}

export interface PaceSceneOptions {
  previousScenes: readonly VideoScene[];
  audio?: VideoAudio;
  maxDurationSec: number;
  closerReserveSec: number;
  getTemplatePacing?: (templateId: string) => VideoTemplatePacing | undefined;
}

export interface PaceSceneResult {
  scene?: VideoScene;
  warnings: VideoWarning[];
}

export function paceScene(scene: VideoScene, options: PaceSceneOptions): PaceSceneResult {
  const metadata = options.getTemplatePacing?.(scene.templateId);
  const isAsk = metadata?.jobs?.includes("ask") === true;
  const priorEnd = options.previousScenes.at(-1)?.timing.endTime ?? 0;
  const ceiling = isAsk
    ? options.maxDurationSec
    : Math.max(0, options.maxDurationSec - options.closerReserveSec);
  const remaining = Math.max(0, ceiling - priorEnd);
  const footageBudget = scene.templateId === "cinemaMedia" && scene.variables.mediaType === "video"
    && Number.isFinite(scene.timing.fixedDuration) && scene.timing.fixedDuration! > 0 ? scene.timing.fixedDuration : undefined;
  const contentMinimum = Math.min(getReadableSceneDuration(scene, metadata), footageBudget ?? Infinity);
  const readableMinimum = footageBudget === undefined && options.previousScenes.length === 0 && remaining >= MINIMUM_OPENING_DURATION_SEC
    ? Math.max(contentMinimum, MINIMUM_OPENING_DURATION_SEC)
    : contentMinimum;
  if (remaining < readableMinimum) {
    const reservedForCloser = !isAsk && options.closerReserveSec > 0 &&
      options.maxDurationSec - priorEnd >= readableMinimum;
    return {
      warnings: [warning(
        reservedForCloser ? "scene_omitted_for_closer" : "scene_omitted_unreadable",
        reservedForCloser
          ? "Scene was omitted to preserve room for a readable final action."
          : "Scene was omitted because it could not fit at a readable duration.",
        scene.id,
      )],
    };
  }
  const requested = requestedDuration(scene, metadata, options.audio, priorEnd);
  const duration = Math.min(Math.max(requested, readableMinimum), remaining);
  const adjusted = Math.abs(duration - requested) > 0.000_001 ||
    Math.abs(requestedStart(scene, options.audio, priorEnd) - priorEnd) > 0.000_001;
  return {
    scene: {
      ...scene,
      timing: {
        ...scene.timing,
        startTime: priorEnd,
        endTime: priorEnd + duration,
        ...(scene.timing.fixedDuration != null ? { fixedDuration: duration } : {}),
      },
    },
    warnings: adjusted
      ? [warning(
          "scene_duration_adjusted",
          "Scene duration was adjusted to preserve readable pacing.",
          scene.id,
        )]
      : [],
  };
}
