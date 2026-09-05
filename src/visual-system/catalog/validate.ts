import type {
  VideoInput,
  VideoScene,
  VideoSceneValidationContext,
  VideoSceneValidator,
} from "../../protocol/types.js";
import type { ServerTemplateRegistry } from "./server-kit.js";
import type { TemplateJsonSchema, TemplateJsonSchemaProperty } from "./types.js";
import { getTemplateSchemaGates, isMeaningfullyPresentTemplateValue } from "./schema.js";
import { validateTemplateSchemaValue } from "./value-validation.js";

interface TemplateSchemaValue {
  property: TemplateJsonSchemaProperty;
  value: unknown;
  path: string;
}

function* walkSchemaValue(
  property: TemplateJsonSchemaProperty,
  value: unknown,
  path: string,
): Generator<TemplateSchemaValue> {
  yield { property, value, path };
  if (property.type === "array" && property.items && Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      yield* walkSchemaValue(property.items, item, `${path}.${index}`);
    }
  }
  if (property.type === "object" && value && typeof value === "object" && !Array.isArray(value)) {
    for (const [name, child] of Object.entries(property.properties ?? {})) {
      if (Object.hasOwn(value, name)) {
        yield* walkSchemaValue(child, (value as Record<string, unknown>)[name], `${path}.${name}`);
      }
    }
  }
}

function schemaValues(schema: TemplateJsonSchema, variables: Record<string, unknown>): TemplateSchemaValue[] {
  const values: TemplateSchemaValue[] = [];
  for (const [name, property] of Object.entries(schema.properties)) {
    if (Object.hasOwn(variables, name)) values.push(...walkSchemaValue(property, variables[name], name));
  }
  return values;
}

export function validateTemplateSceneStructure(schema: TemplateJsonSchema, value: unknown, deferMediaUrls = false): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Template variable variables must be object");
  }
  const object = value as Record<string, unknown>;
  const requiredFields = new Set(schema.required ?? []);
  for (const required of schema.required ?? []) {
    if (!Object.hasOwn(object, required)) throw new Error(`Template variable ${required} is required`);
  }
  if (schema.additionalProperties === false) {
    for (const name of Object.keys(object)) {
      if (!Object.hasOwn(schema.properties, name)) throw new Error(`Template variable ${name} is not declared`);
    }
  }
  for (const [name, property] of Object.entries(schema.properties)) {
    if (Object.hasOwn(object, name)) validateTemplateSchemaValue(property, object[name], name, {
      deferMediaUrls,
      errorPrefix: "Template variable ",
      includeTypeArticle: true,
      allowEmptyOptionalMedia: property.default === "",
      optional: !requiredFields.has(name),
    });
  }
}

function validateConditionalPresence(
  templateId: string,
  groups: readonly (readonly string[])[],
  variables: Record<string, unknown>,
): void {
  for (const group of groups) {
    if (group.some((field) => Object.hasOwn(variables, field) && isMeaningfullyPresentTemplateValue(variables[field]))) continue;
    throw new Error(`Template ${templateId} requires a non-empty value for ${group.join(" or ")}`);
  }
}

function suppliedUrls(input: VideoInput): Set<string> {
  const urls = new Set<string>();
  for (const media of input.suppliedMedia ?? []) {
    urls.add(media.url);
    if (media.posterUrl) urls.add(media.posterUrl);
  }
  return urls;
}

/** Exact quantity matching: normalize typography, never convert units or magnitudes. */
function containsSuppliedQuantity(input: string, value: unknown): boolean {
  if (typeof value !== "string" && typeof value !== "number") return false;
  const normalize = (text: string) => text.normalize("NFKC").replace(/\u2212/g, "-")
    .replace(/\s+/gu, " ").replace(/([\p{Sc}]) (?=[+−-]?\d)/gu, "$1")
    .replace(/(\d) (?=[%‰])/gu, "$1").trim();
  const quantity = normalize(String(value));
  if (!/\d/u.test(quantity)) return false;
  const source = normalize(input);
  let offset = source.indexOf(quantity);
  while (offset !== -1) {
    const before = source.slice(0, offset);
    const after = source.slice(offset + quantity.length);
    // Neither a digit within a larger number nor a number stripped of its currency/unit.
    const beginsInside = /[\p{L}\p{N}\p{Sc}%‰+−-]$/u.test(before) || /\d[.,]$/u.test(before);
    const endsInside = /^[\p{L}\p{N}\p{Sc}%‰]/u.test(after) || /^[.,]\d/u.test(after);
    const dropsUnit = /\d$/u.test(quantity) && /^ (?:%|‰|percent\b|per cent\b|thousand\b|million\b|billion\b|trillion\b|usd\b|eur\b|gbp\b|dollars?\b|euros?\b|pounds?\b)/iu.test(after);
    if (!beginsInside && !endsInside && !dropsUnit) return true;
    offset = source.indexOf(quantity, offset + 1);
  }
  return false;
}

export function createTemplateSceneValidator(options: {
  kit: ServerTemplateRegistry;
  /** Authorize an app-approved URL in addition to URLs supplied with the request. */
  allowMediaUrl?: (
    url: string,
    context: VideoSceneValidationContext & { scene: VideoScene; variable: string },
  ) => boolean;
}): VideoSceneValidator {
  return (scene, context) => {
    const template = options.kit.getTemplateMetadata(scene.templateId);
    if (!template) throw new Error(`Template ${scene.templateId} is not installed`);
    const schema = template.schema;
    const gates = getTemplateSchemaGates(schema);
    validateConditionalPresence(scene.templateId, gates.requiredAnyOf, scene.variables);
    validateTemplateSceneStructure(schema, scene.variables);
    const values = schemaValues(schema, scene.variables);

    const allowedUrls = suppliedUrls(context.input);
    const suppliedImageUrls = new Set((context.input.suppliedMedia ?? [])
      .filter(({ type }) => type === "image")
      .map(({ url }) => url));
    if (gates.requiresScreenshot) {
      const screenshots = values
        .filter(({ property }) => property.format === "supplied-image")
        .map(({ value }) => value)
        .filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
      if (!screenshots.length || screenshots.some((url) => !suppliedImageUrls.has(url))) {
        throw new Error(`Template ${scene.templateId} requires a supplied screenshot image`);
      }
    }
    for (const { path, property, value } of values) {
      const isMedia = property.format === "uri" || property.format === "supplied-image";
      if (!isMedia || typeof value !== "string" || !value.trim()) continue;
      const permitted = allowedUrls.has(value) || options.allowMediaUrl?.(value, {
        ...context,
        scene,
        variable: path,
      });
      if (!permitted) throw new Error(`Template variable ${path} must use supplied media`);
    }

    if (gates.requiresStat) {
      const quantities = values.filter(({ property }) => property.format === "grounded-stat");
      if (!quantities.length || quantities.some(({ value }) => !containsSuppliedQuantity(context.input.input, value))) {
        throw new Error(`Template ${scene.templateId} requires an exact supplied quantity, preserving its unit`);
      }
    }

    if (gates.requiresQuote) {
      const quoteValues = values
        .filter(({ property, value }) => property.format === "grounded-quote" &&
          typeof value === "string" && value.trim())
        .map(({ value }) => String(value).trim());
      if (!quoteValues.length || quoteValues.some((quote) => !context.input.input.includes(quote))) {
        throw new Error(`Template ${scene.templateId} requires an exact quote from the raw input`);
      }
    }
  };
}
