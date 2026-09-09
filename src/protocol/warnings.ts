export type VideoWarningCategory =
  | "validation"
  | "readability"
  | "grounding"
  | "provider"
  | "media"
  | "protocol";

export type VideoWarningCode =
  | "scene_duration_adjusted"
  | "scene_omitted_unreadable"
  | "scene_omitted_for_closer"
  | "scene_variable_clipped"
  | "chart_scale_imbalance"
  | "plan_incomplete"
  | "plan_missing_closer"
  | "provider_warning"
  | "provider_diagnostics_unavailable"
  | "media_budget_reached";

export const VIDEO_WARNING_CATEGORIES: Readonly<Record<VideoWarningCode, VideoWarningCategory>> = {
  scene_duration_adjusted: "readability",
  scene_omitted_unreadable: "readability",
  scene_omitted_for_closer: "readability",
  scene_variable_clipped: "readability",
  chart_scale_imbalance: "readability",
  plan_incomplete: "provider",
  plan_missing_closer: "provider",
  provider_warning: "provider",
  provider_diagnostics_unavailable: "provider",
  media_budget_reached: "media",
};

export const MAX_PUBLIC_DIAGNOSTIC_LENGTH = 160;

const SECRET_ASSIGNMENT = /\b(?:api[_-]?key|authorization|secret|token|password)\s*[:=]\s*\S+/gi;
const BEARER_TOKEN = /\bBearer\s+\S+/gi;
const URL = /https?:\/\/\S+/gi;

/** Bound a host-supplied browser diagnostic without retaining common secrets or URLs. */
export function safePublicDiagnostic(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const withoutControls = Array.from(value, (character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127 ? " " : character;
  }).join("");
  const redacted = withoutControls
    .replace(SECRET_ASSIGNMENT, "[redacted]")
    .replace(BEARER_TOKEN, "[redacted]")
    .replace(URL, "[redacted url]")
    .replace(/\s+/g, " ")
    .trim();
  if (!redacted) return fallback;
  if (redacted.length <= MAX_PUBLIC_DIAGNOSTIC_LENGTH) return redacted;
  return `${redacted.slice(0, MAX_PUBLIC_DIAGNOSTIC_LENGTH - 1).trimEnd()}…`;
}

/** A bounded, client-safe diagnostic that never includes provider payloads. */
export interface VideoWarning {
  code: VideoWarningCode;
  category: VideoWarningCategory;
  message: string;
  sceneId?: string;
  recoverable: boolean;
}
