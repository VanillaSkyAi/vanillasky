import { MAX_RETAINED_MEDIA_URL_LENGTH } from "../protocol/persistence.js";
import {
  VIDEO_PROTOCOL_VERSION,
  type VideoCapabilities,
  type VideoRequest,
} from "../protocol/types.js";
import {
  allowedKeys,
  jsonValue,
  nonNegativeInteger,
  record,
  string,
} from "../protocol/json-validation.js";

/** A visual language for a provider prompt, not a token: longer, still bounded. */
const MAX_GENERATED_LOOK_LENGTH = 1_000;

function boundedString(value: unknown, path: string): string {
  const result = string(value, path);
  if (result.length > MAX_RETAINED_MEDIA_URL_LENGTH) {
    throw new Error(`${path} must be at most ${MAX_RETAINED_MEDIA_URL_LENGTH} characters`);
  }
  return result;
}

function numberBetween(value: unknown, minimum: number, maximum: number, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${path} must be a number between ${minimum} and ${maximum}`);
  }
  return value;
}

function enumValue(
  value: unknown,
  allowed: readonly string[],
  description: string,
  path: string,
): string {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`${path} must be ${description}`);
  }
  return value;
}

function capabilities(value: unknown, path: string): VideoCapabilities {
  const result = record(value, path);
  allowedKeys(result, ["templates", "extensions"], path);
  for (const key of ["templates", "extensions"] as const) {
    const entries = result[key];
    if (entries == null) continue;
    if (!Array.isArray(entries)) throw new Error(`${path}.${key} must be an array`);
    entries.forEach((entry, index) => {
      const item = string(entry, `${path}.${key}[${index}]`);
      if (key === "extensions" && (!item.startsWith("data.") || item === "data.")) {
        throw new Error(`${path}.${key}[${index}] must use the data.* namespace`);
      }
    });
  }
  return result as unknown as VideoCapabilities;
}

/** Parse the server-only HTTP request envelope before generation begins. */
export function parseVideoRequest(value: unknown): VideoRequest {
  const request = record(value, "request");
  allowedKeys(request, ["protocolVersion", "requestId", "input", "capabilities", "resume"], "request");
  if (request.protocolVersion !== VIDEO_PROTOCOL_VERSION) {
    throw new Error(`request.protocolVersion must be ${VIDEO_PROTOCOL_VERSION}`);
  }
  string(request.requestId, "request.requestId");
  const input = record(request.input, "request.input");
  allowedKeys(input, [
    "input",
    "knowledgeMode",
    "instructions",
    "maxDurationSec",
    "orientation",
    "style",
    "opening",
    "personalization",
    "suppliedMedia",
    "audio",
  ], "request.input");
  string(input.input, "request.input.input");
  if (input.knowledgeMode != null) {
    enumValue(
      input.knowledgeMode,
      ["input-only", "general"],
      "input-only or general",
      "request.input.knowledgeMode",
    );
  }
  if (input.instructions != null) string(input.instructions, "request.input.instructions");
  if (input.maxDurationSec != null) {
    numberBetween(input.maxDurationSec, 5, 120, "request.input.maxDurationSec");
  }
  if (input.orientation != null) {
    enumValue(
      input.orientation,
      ["portrait", "landscape"],
      "portrait or landscape",
      "request.input.orientation",
    );
  }
  if (input.opening != null && input.opening !== false) string(input.opening, "request.input.opening");
  if (input.audio != null && input.audio !== false) {
    const soundtrack = record(input.audio, "request.input.audio");
    allowedKeys(soundtrack, ["src"], "request.input.audio");
    boundedString(soundtrack.src, "request.input.audio.src");
  }
  if (input.suppliedMedia != null) {
    if (!Array.isArray(input.suppliedMedia)) throw new Error("request.input.suppliedMedia must be an array");
    input.suppliedMedia.forEach((entry, index) => {
      const path = `request.input.suppliedMedia[${index}]`;
      const media = record(entry, path);
      allowedKeys(media, [
        "id",
        "url",
        "type",
        "description",
        "mimeType",
        "posterUrl",
        "focalPoint",
        "treatment",
        "role",
      ], path);
      string(media.id, `${path}.id`);
      boundedString(media.url, `${path}.url`);
      if (media.posterUrl != null) boundedString(media.posterUrl, `${path}.posterUrl`);
      if (media.type !== "image" && media.type !== "video") {
        throw new Error(`${path}.type must be image or video`);
      }
      for (const field of ["description", "mimeType"] as const) {
        if (media[field] != null) string(media[field], `${path}.${field}`);
      }
      if (media.focalPoint != null) {
        enumValue(
          media.focalPoint,
          ["center", "top", "bottom", "left", "right"],
          "center, top, bottom, left, or right",
          `${path}.focalPoint`,
        );
      }
      if (media.treatment != null) {
        enumValue(
          media.treatment,
          ["subtle", "cinematic", "text-safe"],
          "subtle, cinematic, or text-safe",
          `${path}.treatment`,
        );
      }
      if (media.role != null) {
        enumValue(
          media.role,
          ["product", "proof", "background", "logo"],
          "product, proof, background, or logo",
          `${path}.role`,
        );
      }
    });
  }
  if (input.style != null) {
    const visual = record(input.style, "request.input.style");
    allowedKeys(visual, ["density", "motion", "textArchetype", "backgroundEffect", "generatedLook"], "request.input.style");
    if (visual.generatedLook != null) {
      // Free text rather than an enum: it describes a visual language for a
      // provider prompt. Bounded because it is untrusted request input.
      const look = string(visual.generatedLook, "request.input.style.generatedLook");
      if (look.length > MAX_GENERATED_LOOK_LENGTH) {
        throw new Error(`request.input.style.generatedLook must be at most ${MAX_GENERATED_LOOK_LENGTH} characters`);
      }
    }
    if (visual.density != null) {
      enumValue(visual.density, ["airy", "normal", "packed"], "airy, normal, or packed", "request.input.style.density");
    }
    if (visual.motion != null) {
      enumValue(visual.motion, ["calm", "normal", "punchy"], "calm, normal, or punchy", "request.input.style.motion");
    }
    if (visual.textArchetype != null) {
      enumValue(
        visual.textArchetype,
        ["subtle", "typewriter", "wordStagger", "slam", "cinematic", "heroWord"],
        "subtle, typewriter, wordStagger, slam, cinematic, or heroWord",
        "request.input.style.textArchetype",
      );
    }
    if (visual.backgroundEffect != null) {
      enumValue(
        visual.backgroundEffect,
        ["static", "slow-zoom-in", "slow-zoom-out", "ken-burns", "drift", "pulse", "breathe", "slow-tilt", "camera-shake"],
        "static, slow-zoom-in, slow-zoom-out, ken-burns, drift, pulse, breathe, slow-tilt, or camera-shake",
        "request.input.style.backgroundEffect",
      );
    }
  }
  jsonValue(input, "request.input");
  if (request.capabilities != null) capabilities(request.capabilities, "request.capabilities");
  if (request.resume != null) {
    const resume = record(request.resume, "request.resume");
    allowedKeys(resume, ["runId", "afterSequence"], "request.resume");
    string(resume.runId, "request.resume.runId");
    nonNegativeInteger(resume.afterSequence, "request.resume.afterSequence");
  }
  return request as unknown as VideoRequest;
}
