import type { VideoFinishReason } from "../protocol/events.js";
import type { VideoWarning } from "../protocol/warnings.js";
import type { VideoAudio } from "../protocol/types.js";

const MAX_RAW_PROVIDER_BYTES = 16_384;
const MAX_RAW_DEPTH = 6;
const MAX_RAW_ENTRIES = 50;
const MAX_RAW_STRING_LENGTH = 2_048;
const MAX_MODEL_ID_LENGTH = 256;
const SENSITIVE_METADATA_KEY = /^(?:authorization|api[_-]?key|secret|password|prompt|input|messages?|content)$/i;

export interface VideoProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  /** Bounded provider-native usage. Present only with includeRawProviderData. */
  raw?: unknown;
}

export interface VideoGenerationSummary {
  finishReason?: VideoFinishReason;
  usage?: VideoProviderUsage;
  /** Bounded provider-native metadata. Present only with includeRawProviderData. */
  providerMetadata?: unknown;
  requestedModelId?: string;
  resolvedModelId?: string;
  timeToFirstSceneMs?: number;
  totalDurationMs: number;
  acceptedSceneCount: number;
  rejectedSceneCount: number;
  /** Duration of the committed deterministic video. maxDurationSec remains a ceiling, not a target. */
  videoDurationSec: number;
  warnings: VideoWarning[];
}

export interface VideoProviderLifecycleResult {
  finishReason?: string;
  rawFinishReason?: string;
  usage?: VideoProviderUsage;
  providerMetadata?: unknown;
  requestedModelId?: string;
  resolvedModelId?: string;
  warnings: VideoWarning[];
}

export interface VideoGenerationLifecycleSink {
  /** Trusted first-brief selection, consumed by composition before its first generated scene. */
  setPlannedAudio?(audio: VideoAudio | undefined): void;
  recoverGeneratedParts?: boolean;
  reportWarning?(warning: VideoWarning): void;
  rejectPart?(error: Error): boolean;
  registerProviderResult(result: Promise<VideoProviderLifecycleResult>): void;
}

const LIFECYCLE_SINKS = new WeakMap<object, VideoGenerationLifecycleSink>();

export function attachGenerationLifecycleSink(context: object, sink: VideoGenerationLifecycleSink): void {
  LIFECYCLE_SINKS.set(context, sink);
}

export function getGenerationLifecycleSink(context: object): VideoGenerationLifecycleSink | undefined {
  return LIFECYCLE_SINKS.get(context);
}

function tokenCount(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value));
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function tokenFrom(value: unknown, ...keys: string[]): number | undefined {
  const source = object(value);
  if (!source) return tokenCount(value);
  for (const key of keys) {
    const count = tokenCount(source[key]);
    if (count != null) return count;
  }
  return undefined;
}

function firstToken(source: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const count = tokenCount(source[key]);
    if (count != null) return count;
  }
  return undefined;
}

function boundedValue(value: unknown, depth = 0, seen = new Set<unknown>()): unknown {
  if (value == null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    return value.length <= MAX_RAW_STRING_LENGTH
      ? value
      : `${value.slice(0, MAX_RAW_STRING_LENGTH - 1)}…`;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object" || depth >= MAX_RAW_DEPTH || seen.has(value)) return "[omitted]";
  seen.add(value);
  let result: unknown;
  if (Array.isArray(value)) {
    result = value.slice(0, MAX_RAW_ENTRIES).map((item) => boundedValue(item, depth + 1, seen));
  } else {
    result = Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .slice(0, MAX_RAW_ENTRIES)
      .map(([key, child]) => [
        key.slice(0, 128),
        SENSITIVE_METADATA_KEY.test(key) ? "[redacted]" : boundedValue(child, depth + 1, seen),
      ]));
  }
  seen.delete(value);
  try {
    if (new TextEncoder().encode(JSON.stringify(result)).byteLength > MAX_RAW_PROVIDER_BYTES) {
      return { truncated: true };
    }
  } catch {
    return { truncated: true };
  }
  return result;
}

export function boundProviderValue(value: unknown): unknown {
  return boundedValue(value);
}

export function normalizeModelId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = Array.from(value, (character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127 ? " " : character;
  }).join("").trim();
  if (!normalized) return undefined;
  return normalized.slice(0, MAX_MODEL_ID_LENGTH);
}

export function normalizeProviderUsage(value: unknown, includeRaw: boolean): VideoProviderUsage | undefined {
  const source = object(value);
  if (!source) return undefined;
  const input = source.inputTokens ?? source.promptTokens ?? source.input_tokens ?? source.prompt_tokens;
  const output = source.outputTokens ?? source.completionTokens ?? source.output_tokens ?? source.completion_tokens;
  const inputDetails = object(source.inputTokenDetails) ?? object(input);
  const outputDetails = object(source.outputTokenDetails) ?? object(output);
  const inputTokens = tokenFrom(input, "total") ?? firstToken(source, ["inputTokenCount", "promptTokenCount"]);
  const outputTokens = tokenFrom(output, "total") ?? firstToken(source, ["outputTokenCount", "completionTokenCount"]);
  const totalTokens = firstToken(source, ["totalTokens", "total_tokens", "totalTokenCount"])
    ?? (inputTokens != null && outputTokens != null ? inputTokens + outputTokens : undefined);
  const cachedInputTokens = inputDetails
    ? firstToken(inputDetails, ["cacheReadTokens", "cachedInputTokens", "cache_read", "cacheRead"])
    : firstToken(source, ["cachedInputTokens", "cacheReadInputTokens", "cache_read_input_tokens"]);
  const cacheWriteTokens = inputDetails
    ? firstToken(inputDetails, ["cacheWriteTokens", "cacheCreationTokens", "cache_write", "cacheWrite"])
    : firstToken(source, ["cacheWriteTokens", "cacheCreationInputTokens", "cache_creation_input_tokens"]);
  const reasoningTokens = outputDetails
    ? firstToken(outputDetails, ["reasoningTokens", "reasoning"])
    : firstToken(source, ["reasoningTokens", "reasoning_tokens"]);
  const normalized: VideoProviderUsage = {
    ...(inputTokens != null ? { inputTokens } : {}),
    ...(outputTokens != null ? { outputTokens } : {}),
    ...(totalTokens != null ? { totalTokens } : {}),
    ...(cachedInputTokens != null ? { cachedInputTokens } : {}),
    ...(cacheWriteTokens != null ? { cacheWriteTokens } : {}),
    ...(reasoningTokens != null ? { reasoningTokens } : {}),
    ...(includeRaw ? { raw: boundProviderValue(value) } : {}),
  };
  return Object.keys(normalized).length ? normalized : undefined;
}
