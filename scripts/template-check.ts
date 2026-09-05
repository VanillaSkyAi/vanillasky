#!/usr/bin/env tsx

import { existsSync, readFileSync } from "node:fs";
import { isDeepStrictEqual, types as utilTypes } from "node:util";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

type JsonRecord = Record<string, unknown>;
type TemplateMetadata = JsonRecord & {
  id: string;
  label?: string;
  description?: string;
  schema?: TemplateSchema;
};
type TemplateSchema = JsonRecord & {
  properties?: Record<string, JsonRecord>;
  required?: readonly string[];
};
type TemplateWithComponent = TemplateMetadata & { component?: unknown };
type TemplateLoader = () => Promise<{ default?: unknown }>;

export interface TemplateCheckSurfaces {
  manifest: readonly TemplateMetadata[];
  schemas: Record<string, TemplateSchema>;
  sourceTemplates: readonly TemplateWithComponent[];
  generatedCatalog: readonly TemplateMetadata[];
  generatedLoaders: Record<string, TemplateLoader>;
  promptIds: readonly string[];
}

export interface ArtifactCheckResult {
  ok: boolean;
  output: string;
}

export interface TemplateCheckIssue {
  id?: string;
  code: string;
  message: string;
  path: string;
  action: string;
}

export interface TemplateCheckResult {
  ok: boolean;
  checkedIds: string[];
  issues: TemplateCheckIssue[];
  artifactOutput: string;
}

export interface TemplateCheckOptions {
  root: string;
  ids?: readonly string[];
  surfaces: TemplateCheckSurfaces;
  artifactCheck: () => Promise<ArtifactCheckResult>;
}

const CAMEL_CASE_ID = /^[a-z][A-Za-z0-9]*$/;

function issue(
  issues: TemplateCheckIssue[],
  id: string | undefined,
  code: string,
  message: string,
  path: string,
  action: string,
): void {
  issues.push({ id, code, message, path, action });
}

type MetadataSurfaceName = "manifest" | "source" | "generated";

const METADATA_SURFACE_DETAILS: Record<MetadataSurfaceName, {
  code: string;
  label: string;
  path: string;
  action: string;
}> = {
  manifest: {
    code: "manifest-metadata-unsupported",
    label: "Canonical manifest",
    path: "src/visual-system/catalog/builtin-manifest.ts",
    action: "Replace the entry with a plain metadata object whose id is an own data property.",
  },
  source: {
    code: "source-metadata-unsupported",
    label: "Source renderer registry",
    path: "src/visual-system/scene-templates/registry.ts",
    action: "Replace the entry with a plain metadata object whose id is an own data property.",
  },
  generated: {
    code: "generated-metadata-unsupported",
    label: "Generated catalog",
    path: "src/visual-system/catalog/catalog.generated.ts",
    action: "Run npm run registry:sync and commit a plain generated metadata object.",
  },
};

function ownDataProperty(value: object, key: PropertyKey): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function collectMetadataEntries<T extends TemplateMetadata>(
  entries: readonly T[],
  surface: MetadataSurfaceName,
  issues: TemplateCheckIssue[],
): Map<string, T> {
  const result = new Map<string, T>();
  const details = METADATA_SURFACE_DETAILS[surface];

  if (utilTypes.isProxy(entries) || !Array.isArray(entries) ||
      Object.getPrototypeOf(entries) !== Array.prototype) {
    issue(issues, undefined, details.code,
      `${details.label} collection is not a supported ordinary array.`,
      details.path, details.action);
    return result;
  }

  const length = ownDataProperty(entries, "length");
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) {
    issue(issues, undefined, details.code,
      `${details.label} collection has no supported length data property.`,
      details.path, details.action);
    return result;
  }

  for (let index = 0; index < length; index += 1) {
    const entryDescriptor = Object.getOwnPropertyDescriptor(entries, index);
    if (!entryDescriptor || !("value" in entryDescriptor)) {
      issue(issues, undefined, details.code,
        `${details.label} entry at index ${index} is not an own data property.`,
        details.path, details.action);
      continue;
    }
    const entry: unknown = entryDescriptor.value;
    if (entry === null || typeof entry !== "object" || utilTypes.isProxy(entry)) {
      issue(issues, undefined, details.code,
        `${details.label} entry at index ${index} is not a supported plain metadata object.`,
        details.path, details.action);
      continue;
    }
    const prototype = Object.getPrototypeOf(entry);
    if (prototype !== Object.prototype && prototype !== null) {
      issue(issues, undefined, details.code,
        `${details.label} entry at index ${index} is not a supported plain metadata object.`,
        details.path, details.action);
      continue;
    }
    const id = ownDataProperty(entry, "id");
    if (typeof id !== "string") {
      issue(issues, undefined, details.code,
        `${details.label} entry at index ${index} has no string id data property.`,
        details.path, details.action);
      continue;
    }
    result.set(id, entry as T);
  }

  return result;
}

function metadataFromRegistry(item: JsonRecord): TemplateMetadata | undefined {
  const name = item.name;
  const meta = item.meta;
  if (typeof name !== "string" || !meta || typeof meta !== "object") return undefined;
  const vanillasky = (meta as JsonRecord).vanillasky;
  if (!vanillasky || typeof vanillasky !== "object") return undefined;
  const { layer: _layer, tier: _tier, ...metadata } = vanillasky as JsonRecord;
  return { id: name, ...metadata } as TemplateMetadata;
}

const ACCESSOR_DESCRIPTOR = Symbol("vanillasky.template-check.accessor");
const proxyIdentities = new WeakMap<object, symbol>();
const opaqueValueIdentities = new WeakMap<object, symbol>();

function proxyIdentity(value: object): symbol {
  const existing = proxyIdentities.get(value);
  if (existing) return existing;
  const identity = Symbol("vanillasky.template-check.proxy");
  proxyIdentities.set(value, identity);
  return identity;
}

function opaqueValueIdentity(value: object): symbol {
  const existing = opaqueValueIdentities.get(value);
  if (existing) return existing;
  const identity = Symbol("vanillasky.template-check.opaque-value");
  opaqueValueIdentities.set(value, identity);
  return identity;
}

interface MetadataNormalizationState {
  containsProxy: boolean;
  seen: WeakMap<object, unknown>;
}

/**
 * Match generated object semantics without serializing. Plain-record fields
 * explicitly set to undefined are omitted, while array slots and every other
 * value retain their type. Accessors and proxies are represented without
 * executing application code.
 */
function stripUndefinedObjectProperties(
  value: unknown,
  state: MetadataNormalizationState,
): unknown {
  if (utilTypes.isProxy(value)) {
    state.containsProxy = true;
    return proxyIdentity(value as object);
  }
  if (value === null || typeof value !== "object") return value;

  const existing = state.seen.get(value);
  if (existing !== undefined) return existing;
  const isArray = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (isArray && prototype !== Array.prototype) return opaqueValueIdentity(value);
  if (!isArray && prototype !== Object.prototype && prototype !== null) {
    return opaqueValueIdentity(value);
  }

  const clone: object = isArray ? [] : Object.create(prototype);
  state.seen.set(value, clone);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) continue;
    if ("value" in descriptor) {
      if (!isArray && descriptor.value === undefined) continue;
      Object.defineProperty(clone, key, {
        ...descriptor,
        value: stripUndefinedObjectProperties(descriptor.value, state),
      });
      continue;
    }
    Object.defineProperty(clone, key, {
      configurable: descriptor.configurable,
      enumerable: descriptor.enumerable,
      writable: false,
      value: {
        [ACCESSOR_DESCRIPTOR]: true,
        configurable: descriptor.configurable,
        enumerable: descriptor.enumerable,
        get: descriptor.get,
        set: descriptor.set,
      },
    });
  }
  return clone;
}

function normalizeMetadata(value: TemplateMetadata): {
  containsProxy: boolean;
  value: unknown;
} {
  const state: MetadataNormalizationState = {
    containsProxy: false,
    seen: new WeakMap<object, unknown>(),
  };
  const normalized = stripUndefinedObjectProperties(value, state);
  return { containsProxy: state.containsProxy, value: normalized };
}

function metadataMatchesGeneratedContract(left: TemplateMetadata, right: TemplateMetadata): boolean {
  const normalizedLeft = normalizeMetadata(left);
  const normalizedRight = normalizeMetadata(right);
  if (normalizedLeft.containsProxy || normalizedRight.containsProxy) return false;
  return isDeepStrictEqual(normalizedLeft.value, normalizedRight.value);
}

export async function checkTemplateIntegrity(options: TemplateCheckOptions): Promise<TemplateCheckResult> {
  const { root, surfaces } = options;
  const issues: TemplateCheckIssue[] = [];
  const manifests = collectMetadataEntries(surfaces.manifest, "manifest", issues);
  const sourceTemplates = collectMetadataEntries(surfaces.sourceTemplates, "source", issues);
  const generatedCatalog = collectMetadataEntries(surfaces.generatedCatalog, "generated", issues);
  const checkedIds = [...new Set(options.ids ?? manifests.keys())];
  const promptIds = new Set(surfaces.promptIds);

  for (const id of checkedIds) {
    if (!CAMEL_CASE_ID.test(id)) {
      issue(issues, id, "invalid-id", `Template ID ${JSON.stringify(id)} is not camelCase.`,
        "src/visual-system/catalog/builtin-manifest.ts", "Use an ID such as productWalkthrough (letters and digits, starting lowercase)."
      );
    }

    const manifest = manifests.get(id);
    if (!manifest) {
      issue(issues, id, "manifest-missing", "Canonical manifest entry is missing.",
        "src/visual-system/catalog/builtin-manifest.ts", `Add the complete ${id} metadata entry and BuiltinTemplateId member.`);
    }

    const schema = surfaces.schemas[id];
    if (!schema) {
      issue(issues, id, "schema-missing", "Canonical variable schema is missing.",
        "src/visual-system/scene-templates/schemas.ts", `Add BUILTIN_TEMPLATE_SCHEMAS.${id}.`);
    } else {
      for (const field of schema.required ?? []) {
        if (!schema.properties?.[field] || (schema.properties[field].default === undefined && !schema.properties[field].examples?.length)) {
          issue(issues, id, "required-default-missing", `Required schema field ${JSON.stringify(field)} has no default or example.`,
            "src/visual-system/scene-templates/schemas.ts", `Add a representative example to ${id}.${field}; use defaults only for non-factual presentation settings.`);
        }
      }
    }

    const sourceTemplate = sourceTemplates.get(id);
    if (!sourceTemplate) {
      issue(issues, id, "source-registry-missing", "Source renderer registry entry is missing.",
        "src/visual-system/scene-templates/registry.ts", `Import the renderer and add ${id} to the components map.`);
    } else if (typeof ownDataProperty(sourceTemplate, "component") !== "function") {
      issue(issues, id, "source-renderer-invalid", "Source registry component is not callable.",
        "src/visual-system/scene-templates/registry.ts", `Point ${id} at an exported React component.`);
    }

    const generated = generatedCatalog.get(id);
    if (!generated) {
      issue(issues, id, "generated-catalog-missing", "Generated catalog entry is missing.",
        "src/visual-system/catalog/catalog.generated.ts", "Add the module mapping, then run npm run registry:sync.");
    } else if (manifest && !metadataMatchesGeneratedContract(generated, manifest)) {
      issue(issues, id, "generated-metadata-mismatch", "Generated catalog metadata differs from the manifest.",
        "src/visual-system/catalog/catalog.generated.ts", "Run npm run registry:sync and commit the generated output.");
    }

    const loader = surfaces.generatedLoaders[id];
    if (!loader) {
      issue(issues, id, "generated-loader-missing", "Generated renderer loader entry is missing.",
        "src/visual-system/catalog/builtin-loaders.generated.ts", `Add ${id} to templateModules in scripts/generate-builtin-catalog.ts, then run npm run registry:sync.`);
    } else {
      try {
        const loaded = await loader();
        if (typeof loaded.default !== "function") throw new Error("module has no callable default renderer");
      } catch (error) {
        issue(issues, id, "renderer-load-failed", `Generated renderer failed to load: ${error instanceof Error ? error.message : String(error)}.`,
          "scripts/generate-builtin-catalog.ts", `Fix the ${id} file/component mapping and exported component.`);
      }
    }

    const registryRelativePath = `registry/items/${id}.json`;
    const registryPath = join(root, registryRelativePath);
    if (!existsSync(registryPath)) {
      issue(issues, id, "registry-item-missing", "Public registry item is missing.", registryRelativePath,
        `Create the template registry item, then run npm run registry:sync.`);
    } else {
      try {
        const registryItem = JSON.parse(readFileSync(registryPath, "utf8")) as JsonRecord;
        const vanillasky = ((registryItem.meta as JsonRecord | undefined)?.vanillasky) as JsonRecord | undefined;
        if (vanillasky?.layer !== "template") {
          issue(issues, id, "registry-layer-invalid", "Registry item is not marked as a template layer.", registryRelativePath,
            "Set meta.vanillasky.layer to template.");
        }
        if (manifest) {
          const registryMetadata = metadataFromRegistry(registryItem);
          if (!registryMetadata || registryItem.title !== ownDataProperty(manifest, "label") ||
              registryItem.description !== ownDataProperty(manifest, "description") ||
              !metadataMatchesGeneratedContract(registryMetadata, manifest)) {
            issue(issues, id, "registry-metadata-mismatch", "Registry metadata differs from the canonical manifest.", registryRelativePath,
              "Run npm run registry:sync and commit the synchronized item.");
          }
        }
        if (!Array.isArray(registryItem.files) || registryItem.files.length === 0) {
          issue(issues, id, "registry-files-missing", "Registry item contains no customer-owned source files.", registryRelativePath,
            "Add the renderer and its public dependency files, then run npm run registry:sync.");
        }
      } catch (error) {
        issue(issues, id, "registry-item-invalid", `Registry item cannot be parsed: ${error instanceof Error ? error.message : String(error)}.`,
          registryRelativePath, "Repair the JSON, then run npm run registry:sync.");
      }
    }

    if (!promptIds.has(id)) {
      issue(issues, id, "prompt-missing", "Model-facing prompt catalog does not include this ID.",
        "src/visual-system/catalog/prompt.ts", "Ensure the generated catalog includes the ID and rerun npm run registry:sync.");
    }
  }

  const artifactResult = await options.artifactCheck();
  if (!artifactResult.ok) {
    issue(issues, undefined, "generated-artifacts-stale", "Generated catalog or public registry artifacts are stale.",
      "scripts/generate-builtin-catalog.ts", "Run npm run registry:sync, review the diff, and rerun this checker.");
  }

  return { ok: issues.length === 0, checkedIds, issues, artifactOutput: artifactResult.output };
}

export function formatTemplateCheckReport(result: TemplateCheckResult): string {
  if (result.ok) {
    const scope = result.checkedIds.length === 1 ? `${result.checkedIds[0]}: complete` : `${result.checkedIds.length} built-ins: complete`;
    return `Template check passed — ${scope}.`;
  }
  const lines = [`Template check failed with ${result.issues.length} issue${result.issues.length === 1 ? "" : "s"}:`];
  for (const entry of result.issues) {
    lines.push(`- ${entry.id ? `[${entry.id}] ` : ""}${entry.message}`);
    lines.push(`  Path: ${entry.path}`);
    lines.push(`  Fix: ${entry.action}`);
  }
  if (result.artifactOutput.trim()) lines.push(`\nArtifact check output:\n${result.artifactOutput.trim()}`);
  return lines.join("\n");
}

async function loadRepositorySurfaces(): Promise<TemplateCheckSurfaces> {
  const [manifestModule, schemasModule, sourceModule, generatedModule, loadersModule, catalogModule] = await Promise.all([
    import("../src/visual-system/catalog/builtin-manifest.js"),
    import("../src/visual-system/scene-templates/schemas.js"),
    import("../src/visual-system/scene-templates/registry.js"),
    import("../src/visual-system/catalog/catalog.generated.js"),
    import("../src/visual-system/catalog/builtin-loaders.generated.js"),
    import("../src/visual-system/catalog/catalog.js"),
  ]);
  const prompt = catalogModule.createBuiltinTemplateSystemPrompt();
  const promptCatalog = JSON.parse(prompt.trim().split("\n").at(-1) ?? "[]") as Array<{ id?: unknown }>;
  return {
    manifest: manifestModule.BUILTIN_TEMPLATE_MANIFEST as unknown as readonly TemplateMetadata[],
    schemas: schemasModule.BUILTIN_TEMPLATE_SCHEMAS as Record<string, TemplateSchema>,
    sourceTemplates: sourceModule.listTemplates() as unknown as readonly TemplateWithComponent[],
    generatedCatalog: generatedModule.GENERATED_BUILTIN_TEMPLATE_CATALOG as readonly TemplateMetadata[],
    generatedLoaders: loadersModule.GENERATED_BUILTIN_TEMPLATE_LOADERS as Record<string, TemplateLoader>,
    promptIds: promptCatalog.flatMap(({ id }) => typeof id === "string" ? [id] : []),
  };
}

function checkGeneratedArtifacts(root: string): ArtifactCheckResult {
  const run = spawnSync("npm", ["run", "registry:check", "--silent"], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`.trim();
  return { ok: run.status === 0, output };
}

export async function runTemplateCheckCli(ids: readonly string[] = process.argv.slice(2)): Promise<number> {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const surfaces = await loadRepositorySurfaces();
  const result = await checkTemplateIntegrity({
    root,
    ids: ids.length > 0 ? ids : undefined,
    surfaces,
    artifactCheck: async () => checkGeneratedArtifacts(root),
  });
  const output = formatTemplateCheckReport(result);
  (result.ok ? console.log : console.error)(output);
  return result.ok ? 0 : 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  process.exitCode = await runTemplateCheckCli();
}
