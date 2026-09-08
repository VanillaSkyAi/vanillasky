import type { VideoInput, VideoPlanPart } from "../protocol/types.js";

const SUPPLIED_MEDIA_REFERENCE_BASE = "https://vanillasky.invalid/supplied/";

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

/** Resolve only application-issued opaque media references after provider output is parsed. */
export function resolveSuppliedMediaPlanPart(part: VideoPlanPart, input: VideoInput): VideoPlanPart {
  const references = mediaReferenceMap(input);
  if (references.size === 0) return part;
  if (part.type === "scene.add") {
    return { ...part, scene: { ...part.scene, variables: resolveReferences(part.scene.variables, references) as Record<string, unknown> } };
  }
  return part;
}
