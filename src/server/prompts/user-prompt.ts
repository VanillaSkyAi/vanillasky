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
      "Never use media, ctaMedia, or reaction as the first generated body template, even with mediaType=gradient. Choose a non-media template first.",
      "Add that scene before resolving any stock or supplied asset. Resolve media as part of each complete later body scene.",
    ]),
    "Use only claims supported by the factual basis permitted by the trusted system prompt.",
    "Select the most decision-relevant grounded takeaways that fit the duration; represent each selected takeaway once before completing the response.",
    "For a long source, summarize instead of attempting to represent every fact, unless the creative instructions explicitly request complete fact coverage that fits the duration.",
    "When selecting claims from the raw input, preserve their exact wording and numbers. Preserve qualifiers, units, denominators, ranges, and comparison direction; for example, do not shorten 4.8 out of 5 to 4.8.",
    "Choose the scene count from the distinct grounded material and the duration budget. Use fewer scenes for sparse input; continue beyond five when rich input warrants it and timing allows.",
    "If the creative instructions explicitly require one separate scene per named item, release, section, or list entry, do not merge, group, or omit those required items. Keep related required scenes adjacent in a coherent progression while preserving each item as its own scene.",
    "Before emitting, verify that the explicitly requested structure can fit readably within the maximum duration. If it cannot, preserve readability and the requested separation for the scenes that fit, then finish with plan.complete using finishReason length rather than silently changing the structure.",
    "For ordinary multi-fact input, form at least three distinct beats: hook, comprehension, and payoff. Use only one or two beats when the source genuinely contains no more than two independent grounded takeaways. This is a narrative guideline, never permission to repeat facts or add filler.",
    "After the first playable body scene, emit exactly one scene.add with placement closer. Generate a short grounded conclusion that answers the story's so-what; it must not repeat hook language or imply another scene follows.",
    "Use a different suitable template for each body scene when the catalog supports it.",
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
