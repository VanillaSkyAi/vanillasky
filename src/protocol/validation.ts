import { validateNarrationGroup, validateNarrationGroups } from "./narration-group.js";
import {
  type VideoCoreEventType,
  type VideoEvent,
} from "./events.js";
import {
  VIDEO_PROTOCOL_VERSION,
  VIDEO_SCHEMA_VERSION,
  type VideoAudio,
  type VideoCapabilities,
  type Video,
  type VideoPlanPart,
  type VideoScene,
  type VideoStyle,
  type VideoTiming,
} from "./types.js";
import {
  MAX_PUBLIC_DIAGNOSTIC_LENGTH,
  VIDEO_WARNING_CATEGORIES,
  type VideoWarningCode,
} from "./warnings.js";
import {
  allowedKeys,
  finite,
  jsonValue,
  nonNegativeInteger,
  record,
  string,
} from "./json-validation.js";

const CORE_EVENT_TYPES = new Set<VideoCoreEventType>([
  "response.start",
  "audio.set",
  "scene.add",
  "response.warning",
  "response.complete",
  "response.error",
  "response.abort",
]);
function publicDiagnostic(value: unknown, path: string): string {
  const result = string(value, path);
  if (result.length > MAX_PUBLIC_DIAGNOSTIC_LENGTH) {
    throw new Error(`${path} must be at most ${MAX_PUBLIC_DIAGNOSTIC_LENGTH} characters`);
  }
  if (Array.from(result).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  })) throw new Error(`${path} contains control characters`);
  return result;
}

function timing(value: unknown, path: string): VideoTiming {
  const result = record(value, path);
  allowedKeys(result, [
    "beatStart",
    "beatEnd",
    "startTime",
    "endTime",
    "fixedDuration",
    "durationWeight",
  ], path);
  for (const [key, child] of Object.entries(result)) finite(child, `${path}.${key}`);
  if (result.fixedDuration != null && Number(result.fixedDuration) <= 0) {
    throw new Error(`${path}.fixedDuration must be positive`);
  }
  return result as VideoTiming;
}

function scene(value: unknown, path: string): VideoScene {
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
  string(result.id, `${path}.id`);
  string(result.templateId, `${path}.templateId`);
  record(result.variables, `${path}.variables`);
  jsonValue(result.variables, `${path}.variables`);
  timing(result.timing, `${path}.timing`);
  if (result.textArchetype != null) string(result.textArchetype, `${path}.textArchetype`);
  if (result.backgroundEffect != null) string(result.backgroundEffect, `${path}.backgroundEffect`);
  if (result.narration != null) string(result.narration, `${path}.narration`);
  if (result.narrationGroup !== undefined) validateNarrationGroup(result.narrationGroup);
  return result as unknown as VideoScene;
}

function capabilities(value: unknown, path: string): VideoCapabilities {
  const result = record(value, path);
  allowedKeys(result, ["templates", "extensions"], path);
  for (const key of ["templates", "extensions"] as const) {
    const entries = result[key];
    if (entries == null) continue;
    if (!Array.isArray(entries)) throw new Error(`${path}.${key} must be an array`);
    entries.forEach((entry, index) => {
      const value = string(entry, `${path}.${key}[${index}]`);
      if (key === "extensions" && (!value.startsWith("data.") || value === "data.")) {
        throw new Error(`${path}.${key}[${index}] must use the data.* namespace`);
      }
    });
  }
  return result as unknown as VideoCapabilities;
}

function style(value: unknown, path: string): VideoStyle {
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
  if (result.generatedLook != null) string(result.generatedLook, `${path}.generatedLook`);
  return result as unknown as VideoStyle;
}

function audio(value: unknown, path: string): VideoAudio {
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
  string(result.trackId, `${path}.trackId`);
  string(result.audioUrl, `${path}.audioUrl`);
  if (finite(result.duration, `${path}.duration`) <= 0) throw new Error(`${path}.duration must be positive`);
  const detection = record(result.beatDetection, `${path}.beatDetection`);
  allowedKeys(detection, ["sensitivity", "targetBeats", "minInterval"], `${path}.beatDetection`);
  const sensitivity = finite(detection.sensitivity, `${path}.beatDetection.sensitivity`);
  if (sensitivity < 0 || sensitivity > 1) throw new Error(`${path}.beatDetection.sensitivity must be 0–1`);
  if (detection.targetBeats != null &&
    (!Number.isInteger(detection.targetBeats) || Number(detection.targetBeats) <= 0)) {
    throw new Error(`${path}.beatDetection.targetBeats must be a positive integer`);
  }
  if (detection.minInterval != null && finite(detection.minInterval, `${path}.beatDetection.minInterval`) <= 0) {
    throw new Error(`${path}.beatDetection.minInterval must be positive`);
  }
  if (!Array.isArray(result.beatMarkers)) throw new Error(`${path}.beatMarkers must be an array`);
  result.beatMarkers.forEach((value, index) => {
    const marker = record(value, `${path}.beatMarkers[${index}]`);
    allowedKeys(marker, ["time", "manual", "energy"], `${path}.beatMarkers[${index}]`);
    if (finite(marker.time, `${path}.beatMarkers[${index}].time`) < 0) {
      throw new Error(`${path}.beatMarkers[${index}].time must be non-negative`);
    }
    if (marker.manual != null && typeof marker.manual !== "boolean") {
      throw new Error(`${path}.beatMarkers[${index}].manual must be boolean`);
    }
    if (marker.energy != null && !["high", "medium", "low"].includes(String(marker.energy))) {
      throw new Error(`${path}.beatMarkers[${index}].energy is unsupported`);
    }
  });
  if (result.sourceDuration != null && finite(result.sourceDuration, `${path}.sourceDuration`) <= 0) {
    throw new Error(`${path}.sourceDuration must be positive`);
  }
  if (result.volume != null) {
    const volume = finite(result.volume, `${path}.volume`);
    if (volume < 0 || volume > 1) throw new Error(`${path}.volume must be 0–1`);
  }
  if (result.fadeOutMs != null && finite(result.fadeOutMs, `${path}.fadeOutMs`) < 0) {
    throw new Error(`${path}.fadeOutMs must be non-negative`);
  }
  return result as unknown as VideoAudio;
}

function config(value: unknown, path: string): Video {
  const result = record(value, path);
  allowedKeys(result, ["schemaVersion", "orientation", "audio", "scenes", "style", "meta"], path);
  if (result.schemaVersion !== VIDEO_SCHEMA_VERSION) {
    throw new Error(`${path}.schemaVersion must be ${VIDEO_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(result.scenes)) throw new Error(`${path}.scenes must be an array`);
  result.scenes.forEach((item, index) => scene(item, `${path}.scenes[${index}]`));
  validateNarrationGroups(result.scenes as VideoScene[]);
  style(result.style, `${path}.style`);
  if (result.orientation != null && result.orientation !== "portrait" && result.orientation !== "landscape") {
    throw new Error(`${path}.orientation is unsupported`);
  }
  if (result.audio != null) audio(result.audio, `${path}.audio`);
  if (result.meta != null) jsonValue(record(result.meta, `${path}.meta`), `${path}.meta`);
  return result as unknown as Video;
}

function validateCoreData(type: VideoCoreEventType, value: unknown): void {
  const data = record(value, "event.data");
  if (type === "response.start") {
    allowedKeys(data, ["requestId", "format", "style", "meta", "capabilities"], "event.data");
    string(data.requestId, "event.data.requestId");
    const format = record(data.format, "event.data.format");
    allowedKeys(format, ["orientation"], "event.data.format");
    if (format.orientation !== "portrait" && format.orientation !== "landscape") {
      throw new Error("event.data.format.orientation is unsupported");
    }
    style(data.style, "event.data.style");
    if (data.meta != null) jsonValue(record(data.meta, "event.data.meta"), "event.data.meta");
    if (data.capabilities != null) capabilities(data.capabilities, "event.data.capabilities");
  } else if (type === "audio.set") {
    allowedKeys(data, ["audio"], "event.data");
    audio(data.audio, "event.data.audio");
  } else if (type === "scene.add") {
    allowedKeys(data, ["scene", "position"], "event.data");
    scene(data.scene, "event.data.scene");
    nonNegativeInteger(data.position, "event.data.position");
  } else if (type === "response.complete") {
    allowedKeys(data, ["finishReason", "snapshot", "checksum"], "event.data");
    if (!["stop", "length", "content-filter", "error", "other"].includes(String(data.finishReason))) {
      throw new Error("event.data.finishReason is unsupported");
    }
    config(data.snapshot, "event.data.snapshot");
    string(data.checksum, "event.data.checksum");
  } else if (type === "response.warning") {
    allowedKeys(data, ["warning"], "event.data");
    const warning = record(data.warning, "event.data.warning");
    allowedKeys(warning, ["code", "category", "message", "sceneId", "recoverable"], "event.data.warning");
    if (!(String(warning.code) in VIDEO_WARNING_CATEGORIES)) {
      throw new Error("event.data.warning.code is unsupported");
    }
    const expectedCategory = VIDEO_WARNING_CATEGORIES[warning.code as VideoWarningCode];
    if (warning.category !== expectedCategory) {
      throw new Error(`event.data.warning.category must be ${expectedCategory} for ${String(warning.code)}`);
    }
    publicDiagnostic(warning.message, "event.data.warning.message");
    if (warning.sceneId != null) {
      const sceneId = string(warning.sceneId, "event.data.warning.sceneId");
      if (sceneId.length > 128) throw new Error("event.data.warning.sceneId must be at most 128 characters");
    }
    if (typeof warning.recoverable !== "boolean") throw new Error("event.data.warning.recoverable must be boolean");
  } else if (type === "response.error") {
    allowedKeys(data, ["error", "terminal", "snapshot"], "event.data");
    const error = record(data.error, "event.data.error");
    allowedKeys(error, ["code", "message", "recoverable"], "event.data.error");
    if (!["generation_failed", "invalid_generated_part"].includes(String(error.code))) {
      throw new Error("event.data.error.code is unsupported");
    }
    publicDiagnostic(error.message, "event.data.error.message");
    if (typeof error.recoverable !== "boolean") throw new Error("event.data.error.recoverable must be boolean");
    if (typeof data.terminal !== "boolean") throw new Error("event.data.terminal must be boolean");
    if (data.snapshot != null) config(data.snapshot, "event.data.snapshot");
  } else if (type === "response.abort") {
    allowedKeys(data, ["reason", "snapshot"], "event.data");
    publicDiagnostic(data.reason, "event.data.reason");
    if (data.snapshot != null) config(data.snapshot, "event.data.snapshot");
  }
}

export function parseVideoEvent(value: unknown): VideoEvent {
  const event = record(value, "event");
  allowedKeys(event, ["protocolVersion", "runId", "sequence", "eventId", "type", "data"], "event");
  if (event.protocolVersion !== VIDEO_PROTOCOL_VERSION) {
    throw new Error(`event.protocolVersion must be ${VIDEO_PROTOCOL_VERSION}`);
  }
  const runId = string(event.runId, "event.runId");
  const sequence = nonNegativeInteger(event.sequence, "event.sequence");
  const eventId = string(event.eventId, "event.eventId");
  if (eventId !== `${runId}:${sequence}`) {
    throw new Error("event.eventId must equal `${runId}:${sequence}`");
  }
  const type = string(event.type, "event.type");
  if (CORE_EVENT_TYPES.has(type as VideoCoreEventType)) {
    validateCoreData(type as VideoCoreEventType, event.data);
  } else if (type.startsWith("data.") && type.length > "data.".length) {
    jsonValue(event.data, "event.data");
  } else {
    throw new Error(`event.type ${type} is unsupported`);
  }
  return event as unknown as VideoEvent;
}

export function parseVideoPlanPart(value: unknown): VideoPlanPart {
  const part = record(value, "plan part");
  const type = string(part.type, "plan part.type");
  if (type === "scene.add") {
    allowedKeys(part, ["type", "placement", "scene"], "plan part");
    if (part.placement != null && part.placement !== "closer") {
      throw new Error("plan part.placement is unsupported");
    }
    scene(part.scene, "plan part.scene");
    if ((part.scene as VideoScene).narrationGroup !== undefined) throw new Error("narrationGroup is host-authored and cannot be emitted by a planner");
  } else if (type === "plan.complete") {
    allowedKeys(part, ["type", "finishReason"], "plan part");
    if (part.finishReason != null &&
      !["stop", "length", "content-filter", "other"].includes(String(part.finishReason))) {
      throw new Error("plan part.finishReason is unsupported");
    }
  } else {
    throw new Error(`plan part.type ${type} is unsupported`);
  }
  return part as unknown as VideoPlanPart;
}
