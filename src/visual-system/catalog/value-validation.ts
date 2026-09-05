import type { TemplateJsonSchemaProperty } from "./types.js";

const STRING_FORMATS = new Set(["uri", "supplied-image", "grounded-quote", "stock-media-keyword", "emoji"]);

export function isTemplatePropertyFormatSupported(format: string, type: string): boolean {
  return format === "grounded-stat"
    ? type === "string" || type === "number" || type === "integer"
    : STRING_FORMATS.has(format) && type === "string";
}

function validUrl(value: string): boolean {
  try {
    return ["https:", "http:", "data:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function validSingleEmoji(value: string): boolean {
  const text = value.trim();
  const graphemes = Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text));
  return graphemes.length === 1 && /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(text);
}

export interface TemplateValueValidationOptions {
  errorPrefix?: string;
  /** Authoring schemas use an empty optional media value as a render-time no-media sentinel. */
  allowEmptyOptionalMedia?: boolean;
  optional?: boolean;
  includeTypeArticle?: boolean;
  /** Pending model media references are resolved and authorized downstream. */
  deferMediaUrls?: boolean;
}

export function validateTemplateSchemaValue(
  schema: TemplateJsonSchemaProperty,
  value: unknown,
  path: string,
  options: TemplateValueValidationOptions = {},
): void {
  const fail = (message: string): never => { throw new Error(`${options.errorPrefix ?? ""}${path} ${message}`); };
  if (schema.enum && (typeof value !== "string" || !schema.enum.includes(value))) fail("must match an allowed value");
  if (schema.type === "string") {
    if (typeof value !== "string") fail("must be string");
    const text = value as string;
    if (schema.minLength != null && text.length < schema.minLength) fail(`must contain at least ${schema.minLength} characters`);
    if (schema.maxLength != null && text.length > schema.maxLength) fail(`must contain at most ${schema.maxLength} characters`);
    if (!options.deferMediaUrls && (schema.format === "uri" || schema.format === "supplied-image")) {
      const emptySentinel = options.allowEmptyOptionalMedia && options.optional && text === "";
      if (!emptySentinel && !validUrl(text)) fail("must be a valid URL");
    }
    if (schema.format === "emoji" && !validSingleEmoji(text)) fail("must be a single emoji");
  } else if (schema.type === "number" || schema.type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      fail(`must be ${options.includeTypeArticle ? "a " : ""}${schema.type}`);
    }
    const number = value as number;
    if (schema.type === "integer" && !Number.isInteger(number)) fail("must be integer");
    if (schema.minimum != null && number < schema.minimum) fail(`must be at least ${schema.minimum}`);
    if (schema.maximum != null && number > schema.maximum) fail(`must be at most ${schema.maximum}`);
  } else if (schema.type === "boolean") {
    if (typeof value !== "boolean") fail("must be boolean");
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) fail("must be array");
    const items = value as unknown[];
    if (schema.minItems === schema.maxItems && schema.minItems != null && items.length !== schema.minItems) {
      fail(`must contain exactly ${schema.minItems} items`);
    }
    if (schema.minItems != null && items.length < schema.minItems) fail(`must contain at least ${schema.minItems} items`);
    if (schema.maxItems != null && items.length > schema.maxItems) fail(`must contain at most ${schema.maxItems} items`);
    if (schema.items) items.forEach((item, index) => validateTemplateSchemaValue(schema.items!, item, `${path}.${index}`, {
      ...options,
      optional: false,
    }));
  } else if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail("must be object");
    const object = value as Record<string, unknown>;
    for (const required of schema.required ?? []) {
      if (!Object.hasOwn(object, required)) fail(`requires ${required}`);
    }
    const properties = schema.properties ?? {};
    if (schema.additionalProperties === false) {
      for (const name of Object.keys(object)) {
        if (!Object.hasOwn(properties, name)) {
          throw new Error(`${options.errorPrefix ?? ""}${path}.${name} is not declared`);
        }
      }
    }
    const required = new Set(schema.required ?? []);
    for (const [name, property] of Object.entries(properties)) {
      if (Object.hasOwn(object, name)) validateTemplateSchemaValue(property, object[name], `${path}.${name}`, {
        ...options,
        allowEmptyOptionalMedia: property.default === "",
        optional: !required.has(name),
      });
    }
  }
}
