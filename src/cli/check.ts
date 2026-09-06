import { createHash } from "node:crypto";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { SceneTemplateMetadata, TemplateJsonSchema, TemplateJsonSchemaProperty } from "../visual-system/catalog/types.js";
import {
  getTemplateDefaults,
  isMeaningfullyPresentTemplateValue,
} from "../visual-system/catalog/schema.js";
import { BUILTIN_TEMPLATE_MANIFEST } from "../visual-system/catalog/builtin-manifest.js";
import { assertTemplateTransitionMetadata } from "../visual-system/catalog/transition-contract.js";
import {
  isTemplatePropertyFormatSupported,
  validateTemplateSchemaValue,
} from "../visual-system/catalog/value-validation.js";
import {
  discoverProjectTemplates,
  resolveProjectTsxRuntime,
  sanitizeTrustedSourceDiagnostic,
  type DiscoveredTemplate,
  type ProjectTsxRuntime,
} from "./project-templates.js";
import { inspectGeneratedTemplateStatus } from "./sync.js";
import { runTrustedSourceProcess } from "./trusted-source-process.js";

export interface CheckTemplatesOptions {
  cwd?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface CheckTemplatesResult {
  templates: number;
  examples: number;
  renders: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const checkRuntimeUrl = new URL("./check-runtime.js", import.meta.url).href;
const JOBS = new Set(BUILTIN_TEMPLATE_MANIFEST.flatMap(({ jobs }) => jobs));
const REGISTERS = new Set(BUILTIN_TEMPLATE_MANIFEST.map(({ register }) => register));
const TEXT_CANVASES = new Set(BUILTIN_TEMPLATE_MANIFEST.map(({ textCanvas }) => textCanvas));
const FAMILIES = new Set(BUILTIN_TEMPLATE_MANIFEST.map(({ family }) => family));
const CONTENT_UNITS = new Set(BUILTIN_TEMPLATE_MANIFEST.map(({ timing }) => timing.contentUnit));
const PROPERTY_KEYS = new Set([
  "type", "format", "enum", "title", "description", "default", "examples", "minItems", "maxItems",
  "minLength", "maxLength", "minimum", "maximum", "items", "properties", "required", "additionalProperties",
]);
const SCHEMA_KEYS = new Set(["type", "properties", "required", "additionalProperties", "x-vanillasky"]);
const SCHEMA_EXTENSION_KEYS = new Set(["requiresStat", "allowsStockMedia", "requiredAnyOf"]);
const METADATA_KEYS = new Set([
  "id", "label", "description", "category", "family", "jobs", "register", "useWhen", "avoidWhen",
  "usesGlobalTextEffect", "usesGlobalTransition", "transitionTiming", "usesGlobalBackgroundEffect", "textCanvas", "schema",
  "minDuration", "preferredDuration", "timing",
]);

function assertJson(value: unknown, path: string, seen = new Set<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return;
    throw new Error(`${path} must contain only finite JSON numbers`);
  }
  if (typeof value !== "object") throw new Error(`${path} contains a non-serializable ${typeof value}`);
  if (seen.has(value)) throw new Error(`${path} contains a circular value`);
  seen.add(value);
  if (Array.isArray(value)) value.forEach((entry, index) => assertJson(entry, `${path}[${index}]`, seen));
  else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error(`${path} contains a non-serializable object`);
    for (const [key, entry] of Object.entries(value)) assertJson(entry, `${path}.${key}`, seen);
  }
  seen.delete(value);
}

function validateRequired(required: readonly string[] | undefined, properties: Readonly<Record<string, unknown>>, path: string): void {
  const seen = new Set<string>();
  for (const key of required ?? []) {
    if (typeof key !== "string" || !Object.hasOwn(properties, key)) throw new Error(`${path} references undeclared property ${JSON.stringify(key)}`);
    if (seen.has(key)) throw new Error(`${path} contains duplicate property ${JSON.stringify(key)}`);
    seen.add(key);
  }
}

function validateProperty(property: TemplateJsonSchemaProperty, path: string, optional: boolean): void {
  if (!property || typeof property !== "object" || Array.isArray(property)) throw new Error(`${path} must be an object`);
  for (const key of Object.keys(property)) if (!PROPERTY_KEYS.has(key)) throw new Error(`${path}.${key} is not supported`);
  if (!property.type || !["string", "number", "integer", "boolean", "array", "object"].includes(property.type)) {
    throw new Error(`${path}.type must be a supported JSON Schema type`);
  }
  if (property.format !== undefined && !isTemplatePropertyFormatSupported(property.format, property.type)) {
    throw new Error(`${path}.format is not supported`);
  }
  for (const key of ["title", "description"] as const) {
    if (property[key] !== undefined && typeof property[key] !== "string") throw new Error(`${path}.${key} must be string`);
  }
  if (property.examples !== undefined && !Array.isArray(property.examples)) throw new Error(`${path}.examples must be an array`);
  if (property.type !== "string") {
    for (const key of ["enum", "minLength", "maxLength"] as const) if (property[key] !== undefined) throw new Error(`${path}.${key} is only supported for strings`);
  }
  if (property.type !== "number" && property.type !== "integer") {
    for (const key of ["minimum", "maximum"] as const) if (property[key] !== undefined) throw new Error(`${path}.${key} is only supported for numbers`);
  }
  if (property.type !== "array") {
    for (const key of ["minItems", "maxItems"] as const) if (property[key] !== undefined) throw new Error(`${path}.${key} is only supported for arrays`);
  }
  if (property.enum !== undefined && (!Array.isArray(property.enum) || property.enum.length === 0 || property.enum.some((value) => typeof value !== "string"))) {
    throw new Error(`${path}.enum must contain one or more strings`);
  }
  for (const key of ["minItems", "maxItems", "minLength", "maxLength"] as const) {
    const value = property[key];
    if (value !== undefined && (!Number.isInteger(value) || value < 0)) throw new Error(`${path}.${key} must be a non-negative integer`);
  }
  for (const key of ["minimum", "maximum"] as const) {
    const value = property[key];
    if (value !== undefined && !Number.isFinite(value)) throw new Error(`${path}.${key} must be finite`);
  }
  if (property.minItems != null && property.maxItems != null && property.minItems > property.maxItems) throw new Error(`${path}.minItems must not exceed maxItems`);
  if (property.minLength != null && property.maxLength != null && property.minLength > property.maxLength) throw new Error(`${path}.minLength must not exceed maxLength`);
  if (property.minimum != null && property.maximum != null && property.minimum > property.maximum) throw new Error(`${path}.minimum must not exceed maximum`);
  if (property.type === "array") {
    if (!property.items) throw new Error(`${path}.items is required for arrays`);
    validateProperty(property.items, `${path}.items`, false);
  } else if (property.items !== undefined) throw new Error(`${path}.items is only supported for arrays`);
  if (property.type === "object") {
    if (!property.properties || typeof property.properties !== "object" || Array.isArray(property.properties)) throw new Error(`${path}.properties must be an object`);
    if (property.required !== undefined && !Array.isArray(property.required)) throw new Error(`${path}.required must be an array`);
    if (property.additionalProperties !== undefined && typeof property.additionalProperties !== "boolean") throw new Error(`${path}.additionalProperties must be boolean`);
    validateRequired(property.required, property.properties, `${path}.required`);
    const required = new Set(property.required ?? []);
    for (const [name, child] of Object.entries(property.properties)) validateProperty(child, `${path}.properties.${name}`, !required.has(name));
  } else if (property.properties !== undefined || property.required !== undefined || property.additionalProperties !== undefined) {
    throw new Error(`${path} object keywords require type object`);
  }
  if (property.default !== undefined) {
    assertJson(property.default, `${path}.default`);
    validateTemplateSchemaValue(property, property.default, `${path}.default`, {
      allowEmptyOptionalMedia: true,
      optional,
    });
  }
  for (const [index, example] of (property.examples ?? []).entries()) {
    assertJson(example, `${path}.examples[${index}]`);
    validateTemplateSchemaValue(property, example, `${path}.examples[${index}]`, {
      allowEmptyOptionalMedia: true,
      optional,
    });
  }
}

function validateSchema(schema: TemplateJsonSchema): void {
  for (const key of Object.keys(schema)) if (!SCHEMA_KEYS.has(key)) throw new Error(`schema.${key} is not supported`);
  if (schema.type !== "object" || !schema.properties || typeof schema.properties !== "object" || Array.isArray(schema.properties)) {
    throw new Error("schema must describe an object with properties");
  }
  if (schema.required !== undefined && !Array.isArray(schema.required)) throw new Error("schema.required must be an array");
  validateRequired(schema.required, schema.properties, "schema.required");
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== "boolean") throw new Error("schema.additionalProperties must be boolean");
  const extension = schema["x-vanillasky"];
  if (extension !== undefined) {
    if (!extension || typeof extension !== "object" || Array.isArray(extension)) throw new Error("schema.x-vanillasky must be an object");
    for (const key of Object.keys(extension)) if (!SCHEMA_EXTENSION_KEYS.has(key)) throw new Error(`schema.x-vanillasky.${key} is not supported`);
    for (const key of ["requiresStat", "allowsStockMedia"] as const) {
      if (extension[key] !== undefined && typeof extension[key] !== "boolean") throw new Error(`schema.x-vanillasky.${key} must be boolean`);
    }
    if (extension.requiredAnyOf !== undefined) {
      if (!Array.isArray(extension.requiredAnyOf)) throw new Error("schema.x-vanillasky.requiredAnyOf must be an array");
      for (const [groupIndex, group] of extension.requiredAnyOf.entries()) {
        const path = `schema.x-vanillasky.requiredAnyOf[${groupIndex}]`;
        if (!Array.isArray(group) || group.length === 0) throw new Error(`${path} must contain at least one property`);
        for (const field of group) {
          if (typeof field !== "string" || !Object.hasOwn(schema.properties, field)) {
            throw new Error(`${path} references undeclared property ${JSON.stringify(field)}`);
          }
        }
      }
    }
  }
  const required = new Set(schema.required ?? []);
  for (const [name, property] of Object.entries(schema.properties)) validateProperty(property, `schema.properties.${name}`, !required.has(name));
}

function validateVariables(
  schema: TemplateJsonSchema,
  variables: Record<string, unknown>,
  path: string,
  enforceRequiredAnyOf: boolean,
): void {
  assertJson(variables, path);
  for (const required of schema.required ?? []) if (!Object.hasOwn(variables, required)) throw new Error(`${path}.${required} is required`);
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(variables)) if (!Object.hasOwn(schema.properties, key)) throw new Error(`${path}.${key} is not declared`);
  }
  const required = new Set(schema.required ?? []);
  for (const [key, property] of Object.entries(schema.properties)) {
    if (Object.hasOwn(variables, key)) validateTemplateSchemaValue(property, variables[key], `${path}.${key}`, {
      allowEmptyOptionalMedia: true,
      optional: !required.has(key),
    });
  }
  if (enforceRequiredAnyOf) {
    for (const group of schema["x-vanillasky"]?.requiredAnyOf ?? []) {
      if (group.some((field) => Object.hasOwn(variables, field) && isMeaningfullyPresentTemplateValue(variables[field]))) continue;
      throw new Error(`${path} requires a non-empty value for ${group.join(" or ")}`);
    }
  }
}

interface MaterializedExample {
  name: string;
  variables: Record<string, unknown>;
  /** Defaults-only fixtures smoke-test rendering; named author examples model committed scenes. */
  enforceRequiredAnyOf: boolean;
}

/** @internal Validates already-isolated project metadata without executing source. */
export function validateDiscoveredTemplate(template: DiscoveredTemplate, cwd: string): MaterializedExample[] {
  const metadata = template.metadata;
  const file = relative(cwd, template.filePath);
  const fail = (message: string): never => { throw new Error(`${file}: ${message}`); };
  try {
    for (const key of Object.keys(metadata)) if (!METADATA_KEYS.has(key)) throw new Error(`metadata.${key} is not supported`);
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(metadata.id)) throw new Error(`invalid template id ${JSON.stringify(metadata.id)}`);
    if (typeof metadata.useWhen !== "string" || !metadata.useWhen.trim()) throw new Error("useWhen must be a non-empty string");
    for (const key of ["label", "description", "avoidWhen"] as const) if (metadata[key] !== undefined && typeof metadata[key] !== "string") throw new Error(`${key} must be string`);
    if (metadata.category !== undefined && metadata.category !== null && typeof metadata.category !== "string") throw new Error("category must be string or null");
    for (const key of ["usesGlobalTextEffect", "usesGlobalTransition", "usesGlobalBackgroundEffect"] as const) {
      if (typeof metadata[key] !== "boolean") throw new Error(`${key} must be boolean`);
    }
    assertTemplateTransitionMetadata(metadata);
    if (metadata.jobs !== undefined) {
      if (!Array.isArray(metadata.jobs) || metadata.jobs.some((job) => !JOBS.has(job))) throw new Error("jobs contains an unsupported value");
      const jobs = new Set<string>();
      for (const job of metadata.jobs) {
        if (jobs.has(job)) throw new Error(`jobs contains duplicate value ${JSON.stringify(job)}`);
        jobs.add(job);
      }
    }
    if (metadata.register !== undefined && !REGISTERS.has(metadata.register)) throw new Error("register contains an unsupported value");
    if (metadata.textCanvas !== undefined && !TEXT_CANVASES.has(metadata.textCanvas)) throw new Error("textCanvas contains an unsupported value");
    if (metadata.family !== undefined && !FAMILIES.has(metadata.family)) throw new Error("family contains an unsupported value");
    for (const key of ["minDuration", "preferredDuration"] as const) {
      const duration = metadata[key];
      if (duration !== undefined && (!Number.isFinite(duration) || duration <= 0)) throw new Error(`${key} must be finite and positive`);
    }
    if (metadata.minDuration != null && metadata.preferredDuration != null && metadata.minDuration > metadata.preferredDuration) {
      throw new Error("minDuration must not exceed preferredDuration");
    }
    validateSchema(metadata.schema);
    if (metadata.timing !== undefined) {
      if (!metadata.timing || typeof metadata.timing !== "object" || Array.isArray(metadata.timing)) throw new Error("timing must be an object");
      for (const key of Object.keys(metadata.timing)) if (!new Set(["contentFields", "contentUnit", "revealSeconds", "holdSeconds", "exitSeconds"]).has(key)) throw new Error(`timing.${key} is not supported`);
      if (!Array.isArray(metadata.timing.contentFields)) throw new Error("timing.contentFields must be an array of schema properties");
      for (const key of ["revealSeconds", "holdSeconds", "exitSeconds"] as const) {
        const value = metadata.timing[key];
        if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) throw new Error(`timing.${key} must be a finite non-negative number`);
      }
      const timingFields = new Set<string>();
      for (const field of metadata.timing.contentFields) {
        if (typeof field !== "string" || !Object.hasOwn(metadata.schema.properties, field)) throw new Error(`timing.contentFields references undeclared property ${JSON.stringify(field)}`);
        if (timingFields.has(field)) throw new Error(`timing.contentFields contains duplicate property ${JSON.stringify(field)}`);
        timingFields.add(field);
      }
      if (!CONTENT_UNITS.has(metadata.timing.contentUnit)) throw new Error("timing.contentUnit contains an unsupported value");
    }
    const defaults = getTemplateDefaults(metadata.schema);
    // Schema examples are authoring fixtures, never production defaults.
    const smokeVariables = { ...defaults };
    for (const field of metadata.schema.required ?? []) {
      const example = metadata.schema.properties[field]?.examples?.[0];
      if (!(field in smokeVariables) && example !== undefined) smokeVariables[field] = example;
    }
    if (template.examples !== undefined && !Array.isArray(template.examples)) throw new Error("examples must be an array");
    const supplied = template.examples ?? [];
    for (const [index, value] of supplied.entries()) {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`examples[${index}] must be a plain object`);
      for (const key of Object.keys(value)) if (!new Set(["name", "variables"]).has(key)) throw new Error(`examples[${index}].${key} is not supported`);
      const candidate = value as { name?: unknown; variables?: unknown };
      if (!candidate.variables || typeof candidate.variables !== "object" || Array.isArray(candidate.variables)) {
        throw new Error(`example ${JSON.stringify(candidate.name)} variables must be a plain object`);
      }
    }
    const examples: MaterializedExample[] = supplied.length > 0
      ? (supplied as Array<{ name: string; variables: Record<string, unknown> }>).map(({ name, variables }) => ({
          name,
          variables: { ...defaults, ...variables },
          enforceRequiredAnyOf: true,
        }))
      : [{ name: "defaults", variables: smokeVariables, enforceRequiredAnyOf: false }];
    const names = new Set<string>();
    for (const example of examples) {
      if (typeof example.name !== "string" || !example.name.trim()) throw new Error("example names must be non-empty strings");
      if (names.has(example.name)) throw new Error(`duplicate example name ${JSON.stringify(example.name)}`);
      names.add(example.name);
      validateVariables(
        metadata.schema,
        example.variables,
        `example ${JSON.stringify(example.name)}`,
        example.enforceRequiredAnyOf,
      );
    }
    return examples;
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

const RENDER_LOADER = String.raw`
const [runtimeUrl, payload] = process.argv.slice(1);
const { writeSync } = await import("node:fs");
for (const method of ["log", "info", "warn", "error", "debug", "dir", "trace"]) console[method] = () => undefined;
const { renderTemplateChecks } = await import(runtimeUrl);
const result = await renderTemplateChecks(JSON.parse(payload));
writeSync(3, JSON.stringify(result));
`;

async function renderExample(
  template: DiscoveredTemplate,
  example: MaterializedExample,
  cwd: string,
  timeoutMs: number,
  maxOutputBytes: number | undefined,
  runtime: ProjectTsxRuntime,
): Promise<number> {
  try {
    const payload = JSON.stringify({
      sourceUrl: pathToFileURL(template.filePath).href,
      exportName: template.exportName,
      templateId: template.metadata.id,
      exampleName: example.name,
      variables: example.variables,
      duration: template.metadata.preferredDuration ?? template.metadata.minDuration ?? 5,
      timeoutMs,
    });
    const output = await runTrustedSourceProcess([
      "--import", runtime.loader,
      "--input-type=module",
      "--eval", RENDER_LOADER,
      checkRuntimeUrl,
      payload,
    ], { cwd, timeoutMs, maxOutputBytes, operation: "template rendering" });
    return (JSON.parse(output) as { renders: number }).renders;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not render ${relative(cwd, template.filePath)}: ${sanitizeTrustedSourceDiagnostic(detail, cwd, runtime.dependencyRoot)}`);
  }
}

const REGISTRY_LOADER = String.raw`
const [browserUrl, serverUrl] = process.argv.slice(1);
const { writeSync } = await import("node:fs");
for (const method of ["log", "info", "warn", "error", "debug", "dir", "trace"]) console[method] = () => undefined;
const browser = await import(browserUrl + "?check=" + Date.now());
const server = await import(serverUrl + "?check=" + Date.now());
writeSync(3, JSON.stringify({
  browser: browser.templates.listTemplateMetadata(),
  server: server.templates.listTemplateMetadata(),
}));
`;

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`).join(",")}}`;
}

async function verifyGeneratedParity(
  cwd: string,
  expected: readonly SceneTemplateMetadata[],
  timeoutMs: number,
  maxOutputBytes: number | undefined,
  runtime: ProjectTsxRuntime,
): Promise<void> {
  try {
    const output = await runTrustedSourceProcess([
      "--import", runtime.loader,
      "--input-type=module",
      "--eval", REGISTRY_LOADER,
      pathToFileURL(join(cwd, "vanillasky/index.ts")).href,
      pathToFileURL(join(cwd, "vanillasky/server.ts")).href,
    ], { cwd, timeoutMs, maxOutputBytes, operation: "generated registry parity" });
    const loaded = JSON.parse(output) as { browser: SceneTemplateMetadata[]; server: SceneTemplateMetadata[] };
    const expectedFingerprint = createHash("sha256").update(stable(expected)).digest("hex");
    for (const [entrypoint, metadata] of Object.entries(loaded)) {
      const fingerprint = createHash("sha256").update(stable(metadata)).digest("hex");
      if (fingerprint !== expectedFingerprint) {
        throw new Error(`${entrypoint} registry metadata/IDs/order fingerprint differs from template sources`);
      }
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Generated registry parity failed: ${sanitizeTrustedSourceDiagnostic(detail, cwd, runtime.dependencyRoot)}`);
  }
}

export async function checkTemplates(options: CheckTemplatesOptions = {}): Promise<CheckTemplatesResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const templates = await discoverProjectTemplates(cwd, {
    timeoutMs,
    maxOutputBytes: options.maxOutputBytes,
  });
  if (templates.length === 0) throw new Error("No templates found in vanillasky/templates.");
  const runtime = resolveProjectTsxRuntime();
  const examples = templates.map((template) => ({
    template,
    examples: validateDiscoveredTemplate(template, cwd),
  }));
  const generated = await inspectGeneratedTemplateStatus(cwd, templates);
  if (!generated.current) {
    throw new Error(`Generated template files are out of date: ${generated.stale.join(", ")}. Run \`vanillasky templates sync\`.`);
  }
  let renders = 0;
  for (const item of examples) {
    for (const example of item.examples) {
      renders += await renderExample(item.template, example, cwd, timeoutMs, options.maxOutputBytes, runtime);
    }
  }
  await verifyGeneratedParity(cwd, templates.map(({ metadata }) => metadata), timeoutMs, options.maxOutputBytes, runtime);
  return {
    templates: templates.length,
    examples: examples.reduce((count, item) => count + item.examples.length, 0),
    renders,
  };
}
