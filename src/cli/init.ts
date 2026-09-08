import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { safeProjectPath } from "./safe-path.js";
import { effectivelyIgnoresLocalEnvironment } from "./gitignore.js";

const SCAFFOLD_FILES = [
  ".env.example",
  "README.md",
  "index.html",
  "server.ts",
  "src/main.tsx",
  "stock.ts",
  "tsconfig.json",
  "vite.config.ts",
] as const;

const DEFAULT_GITIGNORE = ["node_modules", "dist", ".env.local", ""].join("\n");

type JsonObject = Record<string, unknown>;

export interface InitVideoChatOptions {
  cwd: string;
  /** Use editable Gemini REST callbacks instead of the optional Vercel AI SDK adapter. */
  native?: boolean;
  starterRoot?: string;
  /** Package spec supplied by npx so blank-folder init preserves its exact artifact. */
  sdkSpec?: string;
  installDependencies?: (cwd: string) => void | Promise<void>;
}

export interface InitVideoChatResult {
  initialized: boolean;
  installed: boolean;
}

export function locateStarterRoot(): string {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(moduleDirectory, "../../starters/video-chat"),
    resolve(moduleDirectory, "../starters/video-chat"),
  ];
  const found = candidates.find((candidate) => existsSync(join(candidate, "package.json")));
  if (!found) throw new Error("The packaged video-chat starter is missing. Reinstall @vanillaskyai/video.");
  return found;
}

function readJson(path: string): JsonObject {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("expected an object");
    return value as JsonObject;
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Cannot read ${basename(path)}: ${detail}`);
  }
}

function stringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function resolvedSdkSpec(starterRoot: string, invokedSpec: string | undefined): string | undefined {
  const spec = invokedSpec?.trim();
  if (!spec) return undefined;
  if (spec === "@vanillaskyai/video" || spec.startsWith("@vanillaskyai/video@")) {
    const packageManifest = readJson(resolve(starterRoot, "../..", "package.json"));
    return typeof packageManifest.version === "string" ? packageManifest.version : undefined;
  }
  if (spec.startsWith("file:")) return spec;
  return isAbsolute(spec) ? `file:${spec}` : undefined;
}

function mergedManifest(cwd: string, starterRoot: string, invokedSpec: string | undefined, native: boolean): string {
  const destination = join(cwd, "package.json");
  const existing = existsSync(destination) ? readJson(destination) : {};
  const starter = readJson(join(starterRoot, "package.json"));
  const packageName = typeof existing.name === "string" && existing.name.trim()
    ? existing.name
    : basename(cwd).toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  const existingDependencies = stringMap(existing.dependencies);
  const starterDependencies = stringMap(starter.dependencies);
  if (native || (existing.vanillasky as JsonObject | undefined)?.textProvider === "custom") {
    delete starterDependencies.ai;
    delete starterDependencies["@ai-sdk/anthropic"];
  }
  const existingScripts = stringMap(existing.scripts);
  const starterScripts = stringMap(starter.scripts);
  for (const [name, command] of Object.entries(starterScripts)) {
    if (Object.prototype.hasOwnProperty.call(existingScripts, name) && existingScripts[name] !== command) {
      throw new Error(`package.json script ${name} already exists with a different command. Run init in a new npm project.`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(existing, "type") && existing.type !== "module") {
    throw new Error(`package.json type ${String(existing.type)} is incompatible with the video-chat starter. Run init in a new npm project.`);
  }
  const sdkVersion = existingDependencies["@vanillaskyai/video"]
    ?? resolvedSdkSpec(starterRoot, invokedSpec)
    ?? starterDependencies["@vanillaskyai/video"];
  if (!sdkVersion) throw new Error("Install @vanillaskyai/video before running vanillasky init.");
  const dependencies = {
    ...starterDependencies,
    ...existingDependencies,
    "@vanillaskyai/video": sdkVersion,
  };
  const devDependencies = {
    ...stringMap(starter.devDependencies),
    ...stringMap(existing.devDependencies),
  };
  const manifest = {
    ...starter,
    ...existing,
    name: packageName,
    private: true,
    type: "module",
    scripts: { ...existingScripts, ...starterScripts },
    dependencies,
    devDependencies,
    vanillasky: { ...(existing.vanillasky as JsonObject | undefined), textProvider: (existing.vanillasky as JsonObject | undefined)?.textProvider ?? (native ? "native" : "vercel") },
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function mergeGitignore(existing: string | undefined): string {
  if (existing == null) return DEFAULT_GITIGNORE;
  const lines = existing.replaceAll("\r\n", "\n").split("\n");
  for (const entry of ["node_modules", "dist"]) {
    if (!lines.includes(entry)) lines.push(entry);
  }
  if (!effectivelyIgnoresLocalEnvironment(lines.join("\n"))) lines.push(".env.local");
  return `${lines.filter((line, index) => line !== "" || index < lines.length - 1).join("\n")}\n`;
}

function atomicWrite(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.vanillasky-${process.pid}-${Math.random().toString(16).slice(2)}.tmp`;
  try {
    writeFileSync(temporary, contents, { encoding: "utf8", flag: "wx", mode: 0o644 });
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

export function defaultInstall(cwd: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("npm", ["install", "--no-audit", "--no-fund"], {
      cwd,
      shell: false,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`npm install failed${signal ? ` (${signal})` : code == null ? "" : ` with exit code ${code}`}`));
    });
  });
}

/** Create the app-owned provider shell; playback and the chat UI stay in the SDK. */
export async function initVideoChatApp(options: InitVideoChatOptions): Promise<InitVideoChatResult> {
  const cwd = resolve(options.cwd);
  const starterRoot = resolve(options.starterRoot ?? locateStarterRoot());
  const manifestPath = safeProjectPath(cwd, "package.json");
  const existing = existsSync(manifestPath) ? readJson(manifestPath) : {};
  if (options.native && (existing.vanillasky as JsonObject | undefined)?.textProvider === "vercel") throw new Error("Text provider already configured. Edit providers/text.ts and vanillasky.textProvider manually to switch.");
  const native = options.native ?? (existing.vanillasky as JsonObject | undefined)?.textProvider === "native";
  const planned = new Map<string, string>();
  for (const path of SCAFFOLD_FILES) {
    planned.set(path, readFileSync(join(starterRoot, path), "utf8"));
  }
  if (native) planned.set(".env.example", readFileSync(join(starterRoot, ".env.native.example"), "utf8"));
  const textPath = safeProjectPath(cwd, "providers/text.ts");
  if (!existsSync(textPath)) planned.set("providers/text.ts", readFileSync(join(starterRoot, native ? "providers/text-native.ts" : "providers/text.ts"), "utf8"));
  // Application-owned registry is extended by providers add and may be edited.
  const providersPath = safeProjectPath(cwd, "providers.ts");
  if (!existsSync(providersPath)) {
    planned.set("providers.ts", readFileSync(join(starterRoot, "providers.ts"), "utf8"));
  }
  planned.set("package.json", mergedManifest(cwd, starterRoot, options.sdkSpec, native));
  planned.set(".gitignore", mergeGitignore(
    existsSync(join(cwd, ".gitignore")) ? readFileSync(join(cwd, ".gitignore"), "utf8") : undefined,
  ));
  if (!existsSync(join(cwd, ".env.local"))) {
    planned.set(".env.local", planned.get(".env.example")!);
  }

  let changed = false;
  for (const [path, contents] of planned) {
    const destination = safeProjectPath(cwd, path);
    if (!existsSync(destination)) {
      changed = true;
      continue;
    }
    const current = readFileSync(destination, "utf8");
    if (current === contents) continue;
    if (path === "package.json" || path === ".gitignore") {
      changed = true;
      continue;
    }
    throw new Error(`${path} already exists with different content. Run init in a new npm project.`);
  }

  for (const [path, contents] of planned) {
    const destination = safeProjectPath(cwd, path);
    if (!existsSync(destination) || readFileSync(destination, "utf8") !== contents) atomicWrite(destination, contents);
  }

  try {
    await (options.installDependencies ?? defaultInstall)(cwd);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`${detail}. The app files are ready; run npm install to finish setup.`);
  }
  return { initialized: changed, installed: true };
}
