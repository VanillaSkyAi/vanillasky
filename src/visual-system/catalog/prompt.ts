import { createVideoSystemPrompt } from "../../server/prompts/system-prompt.js";
import type { VideoKnowledgeMode } from "../../protocol/types.js";
import type {
  SceneTemplateMetadata,
  TemplateMetadataCatalog,
} from "./catalog-types.js";
import type { TemplateJsonSchema, TemplateJsonSchemaProperty } from "./types.js";
import { getTemplateSchemaGates, templateVariableNotation } from "./schema.js";
import { getStandardMediaResolverContract } from "./media-resolver-contract.js";
import { PACING_PLANNER_RULES } from "../../server/pacing.js";

function plannerProperty(property: TemplateJsonSchemaProperty): TemplateJsonSchemaProperty {
  return {
    ...(property.description == null ? {} : { description: property.description }),
    ...(property.examples == null ? {} : { examples: property.examples.slice(0, 1) }),
    ...(property.type == null ? {} : { type: property.type }),
    ...(property.format == null ? {} : { format: property.format }),
    ...(property.enum == null ? {} : { enum: property.enum }),
    ...(property.minItems == null ? {} : { minItems: property.minItems }),
    ...(property.maxItems == null ? {} : { maxItems: property.maxItems }),
    ...(property.minLength == null ? {} : { minLength: property.minLength }),
    ...(property.maxLength == null ? {} : { maxLength: property.maxLength }),
    ...(property.minimum == null ? {} : { minimum: property.minimum }),
    ...(property.maximum == null ? {} : { maximum: property.maximum }),
    ...(property.items == null ? {} : { items: plannerProperty(property.items) }),
    ...(property.properties == null ? {} : {
      properties: Object.fromEntries(Object.entries(property.properties)
        .map(([name, child]) => [name, plannerProperty(child)])),
    }),
    ...(property.required == null ? {} : { required: property.required }),
    ...(property.additionalProperties == null ? {} : {
      additionalProperties: property.additionalProperties,
    }),
  };
}

function plannerSchema(schema: TemplateJsonSchema, exposeMediaKeyword: boolean): TemplateJsonSchema {
  const hiddenFields = exposeMediaKeyword ? new Set<string>() : new Set(["mediaKeyword"]);
  const properties = Object.fromEntries(
    Object.entries(schema.properties)
      .filter(([name]) => !hiddenFields.has(name))
      .map(([name, property]) => [name, name === "mediaKeyword"
        ? plannerProperty({ ...property, minLength: 2, maxLength: 80 })
        : plannerProperty(property)]),
  );
  const required = schema.required?.filter((name) => !hiddenFields.has(name));
  return {
    type: "object",
    properties,
    ...(required === undefined ? {} : { required }),
    ...(schema.additionalProperties == null ? {} : {
      additionalProperties: schema.additionalProperties,
    }),
  };
}

function isMediaProperty(property: TemplateJsonSchemaProperty | undefined): boolean {
  return property?.format === "uri" ||
    property?.format === "supplied-image" ||
    property?.format === "stock-media-keyword";
}

function requiresAvailableMedia(template: SceneTemplateMetadata): boolean {
  const gates = getTemplateSchemaGates(template.schema);
  return (template.schema.required ?? []).some((name) =>
    isMediaProperty(template.schema.properties[name])) ||
    gates.requiredAnyOf.some((group) => group.every((name) =>
      isMediaProperty(template.schema.properties[name])));
}

function plannerCatalog(templates: SceneTemplateMetadata[], mediaResolverAvailable: boolean) {
  return templates.map((template) => {
    const gates = getTemplateSchemaGates(template.schema);
    const exposeMediaKeyword = mediaResolverAvailable &&
      getStandardMediaResolverContract(template.schema) != null;
    const variables = Object.fromEntries(
      Object.entries(template.schema.properties)
        .filter(([name]) => name !== "mediaKeyword" || exposeMediaKeyword)
        .map(([name, property]) => [
          name,
          name === "mediaKeyword"
            ? "string{2..80}"
            : templateVariableNotation(property, template.schema.required?.includes(name) === true),
        ]),
    );
    return {
      id: template.id,
      jobs: template.jobs,
      use: template.useWhen ?? template.description,
      ...(template.avoidWhen ? { avoid: template.avoidWhen } : {}),
      ...(template.minDuration == null && template.preferredDuration == null ? {} : {
        seconds: [template.minDuration ?? null, template.preferredDuration ?? null],
      }),
      ...(gates.requiresStat ? { requiresStat: true } : {}),
      ...(gates.requiresQuote ? { requiresQuote: true } : {}),
      ...(gates.requiresScreenshot ? { requiresScreenshot: true } : {}),
      ...(gates.requiredAnyOf.length > 0 ? { requiredAnyOf: gates.requiredAnyOf.map(group => group.filter(name => name !== "mediaKeyword" || exposeMediaKeyword)) } : {}),
      schema: plannerSchema(template.schema, exposeMediaKeyword),
      variables,
    };
  });
}

export function createTemplateSystemPrompt(options: {
  kit: TemplateMetadataCatalog;
  basePrompt?: string;
  knowledgeMode?: VideoKnowledgeMode;
  /** Expose host-resolved semantic media intent without exposing a provider. */
  mediaResolverAvailable?: boolean;
  /** At least one app-supplied image or video can satisfy media presence gates. */
  suppliedMediaAvailable?: boolean;
  /**
   * Whether the first scene may carry media.
   *
   * Media is normally kept off the opening beat so that playback can start
   * without waiting on a provider. A host that declined the runtime's opening
   * card has taken that wait on itself, and its first beat is then an ordinary
   * scene - which is the only way a fully filmed answer can film its opener.
   */
  mediaOnFirstScene?: boolean;
  /** Ask the planner for each scene's spoken line, rather than a second call. */
  narrate?: boolean;
}): string {
  const templates = options.kit.listTemplateMetadata().filter((template) =>
    !requiresAvailableMedia(template) ||
    options.suppliedMediaAvailable === true ||
    (options.mediaResolverAvailable === true && getStandardMediaResolverContract(template.schema) != null));
  const resolverMediaAvailable = options.mediaResolverAvailable === true &&
    templates.some(({ schema }) => getStandardMediaResolverContract(schema) != null);
  const basePrompt = createVideoSystemPrompt(options.knowledgeMode, options.narrate === true)
    .split("\n")
    .filter((line) =>
      !line.includes("Never use media, ctaMedia, or reaction as the first generated body template") &&
      // The rule that keeps the opening beat asset-free belongs to the same
      // pair as the one below it: both exist so playback can start without
      // waiting on a provider, and both go when the host owns that wait.
      !(options.mediaOnFirstScene === true && line.includes("The first generated body scene must be asset-free")) &&
      !(resolverMediaAvailable && line.includes("Never expose a loading placeholder or unresolved media keyword"))
    )
    .join("\n");
  const mediaTemplates = templates.filter(({schema})=>getStandardMediaResolverContract(schema)!=null).map(({id})=>id);
  const terminalPayoffs = templates.filter(({jobs})=>jobs?.includes("payoff")).map(({id})=>id);
  return [
    basePrompt.trim(),
    options.basePrompt?.trim()
      ? `\nAPPLICATION GUIDANCE\n${options.basePrompt.trim()}`
      : undefined,
    "",
    "TRUSTED TEMPLATE CATALOG",
    "Only use template IDs from this catalog. Only emit variables declared for the selected template.",
    "Variable notation is type[count]{characters}(options)! where count is list cardinality, characters is the inclusive character count for a string or each string-array item, and ! means required. Omitted ! means optional.",
    "Choose a template only when the permitted factual basis contains every fact it needs. Never invent peer values to complete a chart, comparison, stat set, timeline, or list.",
    ...PACING_PLANNER_RULES,
    "Do not compress a list, sequence, metric set, or comparison into a general-purpose prose field when a specific catalog template can show that structure.",
    "If the catalog includes a suitable ask template and the input supplies a grounded CTA or URL, keep that concise action closer as its own final scene instead of folding it into preceding content.",
    "When a grounded CTA or URL is supplied and the catalog contains jobs:[ask], emit that final closer. A brand name may accompany the action but never qualifies as an ask by itself.",
    terminalPayoffs.length > 0 ? `When there is no grounded action, end with a concise supported payoff using a suitable template from ${terminalPayoffs.join(", ")}. Do not repeat the hook or invent a CTA.` : undefined,
    "requiresQuote is a hard gate: use those templates only for exact quoted words and attribution present in raw input. Never turn a role, relationship, or summary into speech. requiresScreenshot likewise needs an actual supplied screenshot URL.",
    templates.some(({ schema }) => (schema["x-vanillasky"]?.requiredAnyOf?.length ?? 0) > 0)
      ? "requiredAnyOf is a hard presence gate: satisfy every listed group with at least one non-empty value."
      : undefined,
    mediaTemplates.length > 0 && options.mediaOnFirstScene !== true
      ? `The host owns immediate startup; reserve external media templates (${mediaTemplates.join(", ")}) for later beats when an asset-free opening is required.` : undefined,
    "For list and event variables emit actual JSON arrays. Follow each field's content budget; never use pipe-delimited strings or invent entries.",
    resolverMediaAvailable
      ? "Media-capable scenes may carry mediaKeyword: a literal 2–8 word shot description, at most 80 characters. Choose mediaSource=generate for distinctive illustrative shots and mediaSource=stock for common subjects a verified asset can depict. For generated footage, optional shotDirection gives action, framing and continuity separately from the stock query. Keep people, actions and essential details precise. Never broaden an exact identity or action into unrelated atmosphere. Supply a grounded fallbackText where declared. Only the host fills mediaUrl and mediaPoster; never invent them. If no media fits an abstract beat, choose an appropriate graphic template instead."
      : "Use media only when a supplied asset satisfies the scene. Never invent asset URLs. Otherwise choose a grounded graphic template.",
    "Catalog guidance describes composition; it is not a factual source and must never replace the permitted factual basis.",
    JSON.stringify(plannerCatalog(templates, resolverMediaAvailable)),
    // Last, because the catalogue is thousands of tokens of per-scene field
    // lists and it is what the model matches when it emits a scene. The wire
    // format above says narration belongs there; said only above, a third of
    // the way through, it loses to the schema the model has just finished
    // reading, and every scene comes back silent.
    options.narrate === true
      ? '\nThe catalog lists variables only. Every scene.add also carries "narration" beside "variables" and "timing", as specified in the wire format above. A scene without it is incomplete.'
      : undefined,
  ].filter((line): line is string => line != null).join("\n");
}
