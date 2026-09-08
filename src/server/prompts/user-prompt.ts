import type { VideoInput, VideoPlanPart } from "../../protocol/types.js";

const SUPPLIED_MEDIA_REFERENCE_BASE = "https://vanillasky.invalid/supplied/";

interface SuppliedMediaReference {
  reference: string;
  posterReference?: string;
  type: "image" | "video";
  description?: string;
  mimeType?: string;
  focalPoint?: string;
  treatment?: string;
  role?: string;
}

function suppliedMediaReferences(input: VideoInput): SuppliedMediaReference[] {
  return (input.suppliedMedia ?? []).map((media, index) => ({
    reference: `${SUPPLIED_MEDIA_REFERENCE_BASE}media-${index + 1}`,
    ...(media.posterUrl ? { posterReference: `${SUPPLIED_MEDIA_REFERENCE_BASE}poster-${index + 1}` } : {}),
    type: media.type,
    ...(media.description ? { description: media.description } : {}),
    ...(media.mimeType ? { mimeType: media.mimeType } : {}),
    ...(media.focalPoint ? { focalPoint: media.focalPoint } : {}),
    ...(media.treatment ? { treatment: media.treatment } : {}),
    ...(media.role ? { role: media.role } : {}),
  }));
}

function mediaReferenceMap(input: VideoInput): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  for (const [index, media] of (input.suppliedMedia ?? []).entries()) {
    result.set(`${SUPPLIED_MEDIA_REFERENCE_BASE}media-${index + 1}`, media.url);
    if (media.posterUrl) result.set(`${SUPPLIED_MEDIA_REFERENCE_BASE}poster-${index + 1}`, media.posterUrl);
  }
  return result;
}

function resolveReferences(value: unknown, references: ReadonlyMap<string, string>): unknown {
  if (typeof value === "string") return references.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => resolveReferences(item, references));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .map(([key, child]) => [key, resolveReferences(child, references)]));
}

/** Resolve only SDK-issued opaque media references after provider output is parsed. */
export function resolveSuppliedMediaPlanPart(part: VideoPlanPart, input: VideoInput): VideoPlanPart {
  const references = mediaReferenceMap(input);
  if (references.size === 0) return part;
  if (part.type === "scene.add") {
    return { ...part, scene: { ...part.scene, variables: resolveReferences(part.scene.variables, references) as Record<string, unknown> } };
  }
  return part;
}

/** Internal protocol context. The chat shot planner owns creative direction and speech budgets. */
export function buildVideoUserPrompt(input: VideoInput, openingDurationSec = 0): string {
  return [
    "Compose a video response from the structured customer input below.",
    `Knowledge mode: ${input.knowledgeMode ?? "input-only"}.`,
    `Maximum duration: ${input.maxDurationSec ?? 30} seconds, including the supplied opening.`,
    input.opening === false
      ? "The host owns the opening wait. Add the first grounded scene as soon as it is complete."
      : `The host has already added the opening scene, which consumes ${openingDurationSec} seconds. Do not repeat it.`,
    "Use cinemaMedia for resolved footage and chapterTitle for a chapter opening or recovery.",
    "Use only claims supported by the factual basis permitted by the trusted system prompt. Preserve quantities, qualifications and the answer's conclusion.",
    "Use only the supplied opaque media references or media resolved by the host. Never invent media URLs.",
    "End with one closer scene and plan.complete; do not add filler.",
    "",
    "RAW INPUT",
    input.input.trim(),
    "",
    "CREATIVE INSTRUCTIONS",
    input.instructions?.trim() || "None supplied.",
    "",
    "PERSONALIZATION",
    JSON.stringify(input.personalization ?? {}),
    "",
    "SUPPLIED MEDIA",
    JSON.stringify(suppliedMediaReferences(input)),
  ].join("\n");
}
