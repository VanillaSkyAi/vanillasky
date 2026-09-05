import { validateNarrationGroup, validateNarrationGroups } from "./narration-group.js";
import {
  VIDEO_SCHEMA_VERSION,
  type VideoAudio,
  type Video,
  type VideoScene,
  type VideoStyle,
  type VideoTiming,
} from "./types.js";

export const MAX_RETAINED_SOURCE_LENGTH = 16_384;
export const MAX_RETAINED_INSTRUCTIONS_LENGTH = 4_096;
export const MAX_RETAINED_MEDIA_URLS = 16;
export const MAX_RETAINED_MEDIA_URL_LENGTH = 2_048;

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_JSON_DEPTH = 50;

export type VideoValidationErrorCode =
  | "invalid_video"
  | "unsupported_video_version";

export class VideoValidationError extends Error {
  readonly code: VideoValidationErrorCode;

  constructor(message: string, code: VideoValidationErrorCode = "invalid_video") {
    super(message);
    this.name = "VideoValidationError";
    this.code = code;
  }
}

function fail(message: string): never {
  throw new VideoValidationError(message);
}

type OwnField =
  | { present: false }
  | { present: true; value: unknown };

function ownField(value: object, key: string, path: string): OwnField {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) return { present: false };
  if (!descriptor.enumerable || !("value" in descriptor)) {
    fail(`${path} must be an enumerable data field`);
  }
  return { present: true, value: descriptor.value };
}

function requiredField(value: object, key: string, path: string): unknown {
  const field = ownField(value, key, path);
  if (!field.present) fail(`${path} is required`);
  return field.value;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fail(`${path} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return fail(`${path} must be a plain JSON object`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    return fail(`${path} contains symbol fields`);
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    ownField(value, key, `${path}.${key}`);
  }
  return value as Record<string, unknown>;
}

function allowedKeys(value: object, allowed: readonly string[], path: string): void {
  const permitted = new Set(allowed);
  for (const key of Object.getOwnPropertyNames(value)) {
    if (!permitted.has(key)) fail(`${path} contains unsupported field ${key}`);
  }
}

function arrayItems(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(`${path} must be an array`);
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    fail(`${path} must be a standard JSON array`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    fail(`${path} contains symbol fields`);
  }

  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (!lengthDescriptor || !("value" in lengthDescriptor) || lengthDescriptor.enumerable ||
    typeof lengthDescriptor.value !== "number" || !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0) {
    fail(`${path}.length must be a standard array length`);
  }
  const length = lengthDescriptor.value;
  const names = Object.getOwnPropertyNames(value);
  for (const name of names) {
    if (name === "length") continue;
    if (!/^(?:0|[1-9]\d*)$/.test(name)) {
      fail(`${path} contains unsupported array field ${name}`);
    }
    const index = Number(name);
    if (!Number.isSafeInteger(index) || index < 0 || index >= length) {
      fail(`${path} contains unsupported array field ${name}`);
    }
  }
  if (names.length !== length + 1) fail(`${path} must not contain sparse holes`);

  const items: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor) fail(`${path}[${index}] must not be a sparse hole`);
    if (!descriptor.enumerable || !("value" in descriptor)) {
      fail(`${path}[${index}] must be an enumerable data field`);
    }
    items[index] = descriptor.value;
  }
  return items;
}

function createDetachedSnapshot(
  value: unknown,
  path: string,
  seen = new Set<object>(),
  depth = 0,
): unknown {
  if (depth > MAX_JSON_DEPTH) fail(`${path} exceeds the maximum JSON depth`);
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(`${path} must be finite`);
    return value;
  }
  if (!value || typeof value !== "object") fail(`${path} must be JSON-safe`);
  if (seen.has(value)) fail(`${path} must be JSON-safe`);
  seen.add(value);

  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      fail(`${path} must be a standard JSON array`);
    }
    const keys = Reflect.ownKeys(value);
    const descriptors = new Map<string, PropertyDescriptor>();
    const names: string[] = [];
    for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
      const key = keys[keyIndex];
      if (typeof key !== "string") fail(`${path} contains symbol fields`);
      names[names.length] = key;
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (!descriptor) fail(`${path}.${key} changed while creating the snapshot`);
      descriptors.set(key, descriptor);
    }

    const lengthDescriptor = descriptors.get("length");
    if (!lengthDescriptor || !("value" in lengthDescriptor) || lengthDescriptor.enumerable ||
      typeof lengthDescriptor.value !== "number" || !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0) {
      fail(`${path}.length must be a standard array length`);
    }
    const length = lengthDescriptor.value;
    for (let nameIndex = 0; nameIndex < names.length; nameIndex += 1) {
      const name = names[nameIndex];
      if (name === "length") continue;
      if (!/^(?:0|[1-9]\d*)$/.test(name)) {
        fail(`${path} contains unsupported array field ${name}`);
      }
      const index = Number(name);
      if (!Number.isSafeInteger(index) || index < 0 || index >= length) {
        fail(`${path} contains unsupported array field ${name}`);
      }
    }
    if (names.length !== length + 1) fail(`${path} must not contain sparse holes`);

    const snapshot: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors.get(String(index));
      if (!descriptor) fail(`${path}[${index}] must not be a sparse hole`);
      if (!descriptor.enumerable || !("value" in descriptor)) {
        fail(`${path}[${index}] must be an enumerable data field`);
      }
      snapshot[index] = createDetachedSnapshot(
        descriptor.value,
        `${path}[${index}]`,
        seen,
        depth + 1,
      );
    }
    seen.delete(value);
    return Object.freeze(snapshot);
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(`${path} must be a plain JSON object`);
  }
  const keys = Reflect.ownKeys(value);
  const snapshot: Record<string, unknown> = {};
  for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
    const key = keys[keyIndex];
    if (typeof key !== "string") fail(`${path} contains symbol fields`);
    if (DANGEROUS_KEYS.has(key)) fail(`${path} contains unsupported field ${key}`);
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (!descriptor) fail(`${path}.${key} changed while creating the snapshot`);
    if (!descriptor.enumerable || !("value" in descriptor)) {
      fail(`${path}.${key} must be an enumerable data field`);
    }
    snapshot[key] = createDetachedSnapshot(
      descriptor.value,
      `${path}.${key}`,
      seen,
      depth + 1,
    );
  }
  seen.delete(value);
  return Object.freeze(snapshot);
}

function nonEmptyString(value: unknown, path: string, maxLength?: number): string {
  if (typeof value !== "string" || !value.trim()) fail(`${path} must be a non-empty string`);
  if (maxLength != null && value.length > maxLength) {
    fail(`${path} must be at most ${maxLength} characters`);
  }
  return value;
}

function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${path} must be finite`);
  return value;
}

function validateSchemaVersion(value: unknown): void {
  if (typeof value !== "string" || !/^\d+\.\d+$/.test(value)) {
    fail("video.schemaVersion must be a version string");
  }
  if (value !== VIDEO_SCHEMA_VERSION) {
    throw new VideoValidationError(
      `video.schemaVersion ${value} is unsupported`,
      "unsupported_video_version",
    );
  }
}

function jsonValue(value: unknown, path: string, seen = new Set<unknown>(), depth = 0): void {
  if (depth > MAX_JSON_DEPTH) fail(`${path} exceeds the maximum JSON depth`);
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    finite(value, path);
    return;
  }
  if (!value || typeof value !== "object" || seen.has(value)) {
    fail(`${path} must be JSON-safe`);
  }
  seen.add(value);
  if (Array.isArray(value)) {
    const items = arrayItems(value, path);
    for (let index = 0; index < items.length; index += 1) {
      jsonValue(items[index], `${path}[${index}]`, seen, depth + 1);
    }
  } else {
    const result = record(value, path);
    for (const key of Object.getOwnPropertyNames(result)) {
      if (DANGEROUS_KEYS.has(key)) fail(`${path} contains unsupported field ${key}`);
      jsonValue(requiredField(result, key, `${path}.${key}`), `${path}.${key}`, seen, depth + 1);
    }
  }
  seen.delete(value);
}

function validateTiming(value: unknown, path: string): VideoTiming {
  const result = record(value, path);
  allowedKeys(result, [
    "beatStart",
    "beatEnd",
    "startTime",
    "endTime",
    "fixedDuration",
    "durationWeight",
  ], path);

  const numbers = new Map<string, number>();
  for (const key of ["beatStart", "beatEnd"] as const) {
    const field = ownField(result, key, `${path}.${key}`);
    if (!field.present) continue;
    const beat = finite(field.value, `${path}.${key}`);
    if (!Number.isInteger(beat) || beat < 0) fail(`${path}.${key} must be a non-negative integer`);
    numbers.set(key, beat);
  }
  for (const key of ["startTime", "endTime"] as const) {
    const field = ownField(result, key, `${path}.${key}`);
    if (!field.present) continue;
    const time = finite(field.value, `${path}.${key}`);
    if (time < 0) fail(`${path}.${key} must be non-negative`);
    numbers.set(key, time);
  }
  for (const key of ["fixedDuration", "durationWeight"] as const) {
    const field = ownField(result, key, `${path}.${key}`);
    if (!field.present) continue;
    const amount = finite(field.value, `${path}.${key}`);
    if (amount <= 0) fail(`${path}.${key} must be positive`);
    numbers.set(key, amount);
  }
  if (numbers.has("startTime") && numbers.has("endTime") &&
    numbers.get("endTime")! <= numbers.get("startTime")!) {
    fail(`${path}.endTime must be after ${path}.startTime`);
  }
  if (numbers.has("beatStart") && numbers.has("beatEnd") &&
    numbers.get("beatEnd")! <= numbers.get("beatStart")!) {
    fail(`${path}.beatEnd must be after ${path}.beatStart`);
  }
  return result as VideoTiming;
}

function validateScene(value: unknown, path: string): VideoScene {
  const result = record(value, path);
  allowedKeys(result, [
    "id",
    "templateId",
    "variables",
    "textArchetype",
    "backgroundEffect",
    "timing",
    "narration",
    "narrationGroup",
  ], path);
  nonEmptyString(requiredField(result, "id", `${path}.id`), `${path}.id`, 128);
  nonEmptyString(requiredField(result, "templateId", `${path}.templateId`), `${path}.templateId`, 128);
  const variables = requiredField(result, "variables", `${path}.variables`);
  record(variables, `${path}.variables`);
  jsonValue(variables, `${path}.variables`);
  validateTiming(requiredField(result, "timing", `${path}.timing`), `${path}.timing`);
  for (const key of ["textArchetype", "backgroundEffect"] as const) {
    const field = ownField(result, key, `${path}.${key}`);
    if (field.present) nonEmptyString(field.value, `${path}.${key}`, 128);
  }
  // A spoken line, not a document: long enough for a paragraph, bounded because
  // this is untrusted input that a voice will be asked to read.
  const narration = ownField(result, "narration", `${path}.narration`);
  if (narration.present) nonEmptyString(narration.value, `${path}.narration`, 4_000);
  if (result.narrationGroup !== undefined) validateNarrationGroup(result.narrationGroup);
  return result as unknown as VideoScene;
}

function validateStyle(value: unknown, path: string): VideoStyle {
  const result = record(value, path);
  allowedKeys(result, [
    "preset",
    "defaultBackgroundEffect",
    "defaultTextArchetype",
    "defaultTransition",
    "density",
    "motion",
    "generatedLook",
  ], path);

  // A description of a visual language, so longer than the token-like fields
  // beside it, and bounded because it is untrusted input that reaches a
  // provider prompt.
  const look = ownField(result, "generatedLook", `${path}.generatedLook`);
  if (look.present) nonEmptyString(look.value, `${path}.generatedLook`, 1_000);

  for (const key of [
    "preset",
    "defaultBackgroundEffect",
    "defaultTextArchetype",
    "defaultTransition",
  ] as const) {
    const field = ownField(result, key, `${path}.${key}`);
    if (field.present) nonEmptyString(field.value, `${path}.${key}`, 128);
  }
  const density = ownField(result, "density", `${path}.density`);
  if (density.present &&
    density.value !== "airy" && density.value !== "normal" && density.value !== "packed") {
    fail(`${path}.density is unsupported`);
  }
  const motion = ownField(result, "motion", `${path}.motion`);
  if (motion.present &&
    motion.value !== "calm" && motion.value !== "normal" && motion.value !== "punchy") {
    fail(`${path}.motion is unsupported`);
  }
  return result as unknown as VideoStyle;
}

function validateAudio(value: unknown, path: string): VideoAudio {
  const result = record(value, path);
  allowedKeys(result, [
    "trackId",
    "audioUrl",
    "sourceDuration",
    "duration",
    "beatDetection",
    "beatMarkers",
    "volume",
    "fadeOutMs",
  ], path);
  nonEmptyString(requiredField(result, "trackId", `${path}.trackId`), `${path}.trackId`, 128);
  nonEmptyString(
    requiredField(result, "audioUrl", `${path}.audioUrl`),
    `${path}.audioUrl`,
    MAX_RETAINED_MEDIA_URL_LENGTH,
  );
  if (finite(requiredField(result, "duration", `${path}.duration`), `${path}.duration`) <= 0) {
    fail(`${path}.duration must be positive`);
  }
  const sourceDuration = ownField(result, "sourceDuration", `${path}.sourceDuration`);
  if (sourceDuration.present && finite(sourceDuration.value, `${path}.sourceDuration`) <= 0) {
    fail(`${path}.sourceDuration must be positive`);
  }

  const detection = record(
    requiredField(result, "beatDetection", `${path}.beatDetection`),
    `${path}.beatDetection`,
  );
  allowedKeys(detection, ["sensitivity", "targetBeats", "minInterval"], `${path}.beatDetection`);
  const sensitivity = finite(
    requiredField(detection, "sensitivity", `${path}.beatDetection.sensitivity`),
    `${path}.beatDetection.sensitivity`,
  );
  if (sensitivity < 0 || sensitivity > 1) fail(`${path}.beatDetection.sensitivity must be 0–1`);
  const targetBeats = ownField(detection, "targetBeats", `${path}.beatDetection.targetBeats`);
  if (targetBeats.present) {
    const target = finite(targetBeats.value, `${path}.beatDetection.targetBeats`);
    if (!Number.isInteger(target) || target <= 0) {
      fail(`${path}.beatDetection.targetBeats must be a positive integer`);
    }
  }
  const minInterval = ownField(detection, "minInterval", `${path}.beatDetection.minInterval`);
  if (minInterval.present &&
    finite(minInterval.value, `${path}.beatDetection.minInterval`) <= 0) {
    fail(`${path}.beatDetection.minInterval must be positive`);
  }

  const markers = arrayItems(
    requiredField(result, "beatMarkers", `${path}.beatMarkers`),
    `${path}.beatMarkers`,
  );
  let previousTime = -1;
  for (let index = 0; index < markers.length; index += 1) {
    const markerPath = `${path}.beatMarkers[${index}]`;
    const marker = record(markers[index], markerPath);
    allowedKeys(marker, ["time", "manual", "energy"], markerPath);
    const time = finite(requiredField(marker, "time", `${markerPath}.time`), `${markerPath}.time`);
    if (time < 0) fail(`${markerPath}.time must be non-negative`);
    if (time <= previousTime) fail(`${markerPath}.time must be strictly increasing`);
    previousTime = time;
    const manual = ownField(marker, "manual", `${markerPath}.manual`);
    if (manual.present && typeof manual.value !== "boolean") {
      fail(`${markerPath}.manual must be boolean`);
    }
    const energy = ownField(marker, "energy", `${markerPath}.energy`);
    if (energy.present &&
      energy.value !== "high" && energy.value !== "medium" && energy.value !== "low") {
      fail(`${markerPath}.energy is unsupported`);
    }
  }

  const volume = ownField(result, "volume", `${path}.volume`);
  if (volume.present) {
    const amount = finite(volume.value, `${path}.volume`);
    if (amount < 0 || amount > 1) fail(`${path}.volume must be 0–1`);
  }
  const fadeOutMs = ownField(result, "fadeOutMs", `${path}.fadeOutMs`);
  if (fadeOutMs.present && finite(fadeOutMs.value, `${path}.fadeOutMs`) < 0) {
    fail(`${path}.fadeOutMs must be non-negative`);
  }
  return result as unknown as VideoAudio;
}

function validateMeta(value: unknown, path: string): void {
  const result = record(value, path);
  allowedKeys(result, ["name", "prompt", "source", "uploadedMediaUrls"], path);
  const name = ownField(result, "name", `${path}.name`);
  if (name.present) nonEmptyString(name.value, `${path}.name`, 256);
  const prompt = ownField(result, "prompt", `${path}.prompt`);
  if (prompt.present) {
    nonEmptyString(prompt.value, `${path}.prompt`, MAX_RETAINED_INSTRUCTIONS_LENGTH);
  }
  const source = ownField(result, "source", `${path}.source`);
  if (source.present) {
    nonEmptyString(source.value, `${path}.source`, MAX_RETAINED_SOURCE_LENGTH);
  }
  const uploadedMediaUrls = ownField(result, "uploadedMediaUrls", `${path}.uploadedMediaUrls`);
  if (uploadedMediaUrls.present) {
    const urls = arrayItems(uploadedMediaUrls.value, `${path}.uploadedMediaUrls`);
    if (urls.length > MAX_RETAINED_MEDIA_URLS) {
      fail(`${path}.uploadedMediaUrls must contain at most ${MAX_RETAINED_MEDIA_URLS} entries`);
    }
    for (let index = 0; index < urls.length; index += 1) {
      nonEmptyString(urls[index], `${path}.uploadedMediaUrls[${index}]`, MAX_RETAINED_MEDIA_URL_LENGTH);
    }
  }
}

function validateCurrentVideo(value: unknown): Video {
  const result = record(value, "video");
  allowedKeys(result, ["schemaVersion", "orientation", "audio", "scenes", "style", "meta"], "video");
  validateSchemaVersion(requiredField(result, "schemaVersion", "video.schemaVersion"));
  jsonValue(result, "video");

  const orientation = ownField(result, "orientation", "video.orientation");
  if (orientation.present && orientation.value !== "portrait" && orientation.value !== "landscape") {
    fail("video.orientation is unsupported");
  }
  const audioField = ownField(result, "audio", "video.audio");
  const audio = audioField.present ? validateAudio(audioField.value, "video.audio") : undefined;

  const sceneItems = arrayItems(requiredField(result, "scenes", "video.scenes"), "video.scenes");
  if (sceneItems.length === 0) fail("video.scenes must contain at least one completed scene");
  const scenes: VideoScene[] = [];
  for (let index = 0; index < sceneItems.length; index += 1) {
    scenes[index] = validateScene(sceneItems[index], `video.scenes[${index}]`);
  }
  try { validateNarrationGroups(scenes); } catch (error) { fail(error instanceof Error ? error.message : "Invalid narration groups"); }

  const ids = new Set<string>();
  let cursor = 0;
  for (let index = 0; index < scenes.length; index += 1) {
    const scene = scenes[index];
    if (ids.has(scene.id)) fail(`video.scenes[${index}].id must be unique`);
    ids.add(scene.id);
    const timing = scene.timing;
    const beatStart = timing.beatStart == null
      ? undefined
      : audio?.beatMarkers[timing.beatStart]?.time;
    const beatEnd = timing.beatEnd == null
      ? undefined
      : audio?.beatMarkers[timing.beatEnd]?.time;
    if (timing.beatStart != null && beatStart == null) {
      fail(`video.scenes[${index}].timing.beatStart does not reference an audio beat`);
    }
    if (timing.beatEnd != null && beatEnd == null) {
      fail(`video.scenes[${index}].timing.beatEnd does not reference an audio beat`);
    }
    const start = timing.startTime ?? beatStart ?? cursor;
    const end = timing.endTime ?? beatEnd ?? start + (timing.fixedDuration ?? 5);
    if (start < cursor) fail(`video.scenes[${index}] overlaps the previous scene`);
    if (end <= start) fail(`video.scenes[${index}] must have positive resolved duration`);
    cursor = end;
  }

  validateStyle(requiredField(result, "style", "video.style"), "video.style");
  const meta = ownField(result, "meta", "video.meta");
  if (meta.present) validateMeta(meta.value, "video.meta");
  return result as unknown as Video;
}

function asValidationError(error: unknown): VideoValidationError | undefined {
  try {
    return error instanceof VideoValidationError ? error : undefined;
  } catch {
    return undefined;
  }
}

/** Parse a persisted Video using the current-only 0.2 schema policy. */
export function parseVideo(value: unknown): Video {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      fail("video must be an object");
    }
    const versionField = ownField(value, "schemaVersion", "video.schemaVersion");
    if (!versionField.present) fail("video.schemaVersion is required");
    validateSchemaVersion(versionField.value);
    const snapshot = createDetachedSnapshot(value, "video");
    return validateCurrentVideo(snapshot);
  } catch (error) {
    const validationError = asValidationError(error);
    if (validationError) throw validationError;
    throw new VideoValidationError("video is invalid");
  }
}
