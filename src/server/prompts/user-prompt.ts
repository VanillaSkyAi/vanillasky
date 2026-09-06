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

export function buildVideoUserPrompt(input: VideoInput, openingDurationSec = 0): string {
  return [
    "Compose a video response from the structured customer input below.",
    `Knowledge mode: ${input.knowledgeMode ?? "input-only"}.`,
    `Maximum duration: ${input.maxDurationSec ?? 30} seconds, including the supplied opening.`,
    input.opening === false
      ? "The host owns the opening wait. Add the first grounded scene as soon as it is complete; it may use host-resolved media."
      : typeof input.opening === "string" && input.opening.trim()
      ? `The host has already added the opening scene, which consumes ${openingDurationSec} seconds. Continue after it and do not repeat or rewrite it.`
      : "Add the first grounded scene as soon as it is complete.",
    ...(input.opening === false ? [] : [
      "The first generated body scene must be fully playable without external media. Use a content-fit text, data, comparison, list, or device-free template with no media URL or keyword.",
      "Add that scene before resolving any stock or supplied asset. Resolve media as part of each complete later body scene.",
    ]),
    "Use only claims supported by the factual basis permitted by the trusted system prompt.",
    "Develop the requested answer within the duration: preserve its mechanism, essential actions, story resolution or punchline. A short prompt can need several distinct visual beats; input length is not the answer length.",
    "For a long source, summarize instead of attempting to represent every fact, unless the creative instructions explicitly request complete fact coverage that fits the duration.",
    "When selecting claims from the raw input, preserve their exact wording and numbers. Preserve qualifiers, units, denominators, ranges, and comparison direction; for example, do not shorten 4.8 out of 5 to 4.8.",
    "Choose the scene count from the requested intent, visual progression and duration budget. A joke can be brief; a practical sequence or imaginative story may need more development. Do not stop while an essential step or payoff is missing.",
    "If the creative instructions explicitly require one separate scene per named item, release, section, or list entry, do not merge, group, or omit those required items. Keep related required scenes adjacent in a coherent progression while preserving each item as its own scene.",
    "Before emitting, verify that the explicitly requested structure can fit readably within the maximum duration. If it cannot, preserve readability and the requested separation for the scenes that fit, then finish with plan.complete using finishReason length rather than silently changing the structure.",
    "Before plan.complete, check that the answer fulfills the actual request. Do not mistake a hook and a single supporting statement for a complete explanation, or explain a joke after its punchline.",
    "Emit exactly one final scene.add with placement closer. Land the requested ending without repeating the opening or implying another scene follows.",
    "Reuse the same suitable template when it serves successive beats. Vary the subject action, shot scale, perspective or purposeful detail, not the template merely for variety.",
    "Never add filler to satisfy a count or diversity target.",
    input.suppliedMedia?.length
      ? input.opening === false
        ? "Select zero or more relevant opaque supplied-media references for visible scenes. Never invent or transform a reference. Only emit mediaKeyword when the trusted system catalog explicitly exposes it. Never invent mediaUrl or mediaPoster."
        : "Select zero or more relevant opaque supplied-media references for visible later scenes. Never invent or transform a reference. Only emit mediaKeyword when the trusted system catalog explicitly exposes it, and only on later scenes. Never invent mediaUrl or mediaPoster."
      : input.opening === false
        ? "No supplied media URL is available. Use asset-free templates unless the trusted system catalog explicitly permits host-resolved media intent, which may begin on the first scene. Only emit mediaKeyword when the trusted system catalog explicitly exposes it. Never invent mediaUrl or mediaPoster."
        : "No supplied media URL is available. Use asset-free templates unless the trusted system catalog explicitly permits host-resolved media intent. Only emit mediaKeyword when the trusted system catalog explicitly exposes it, and only on later scenes. Never invent mediaUrl or mediaPoster.",
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
