import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { effectivelyIgnoresLocalEnvironment } from "./gitignore.js";

const REQUIRED_FILES = [
  ".env.local",
  "index.html",
  "server.ts",
  "providers.ts",
  "providers/text.ts",
  "src/main.tsx",
  "stock.ts",
  "tsconfig.json",
  "vite.config.ts",
] as const;

const REQUIRED_DEPENDENCIES = [
  "@vanillaskyai/video",
  "react",
  "react-dom",
  "@types/node",
  "@types/react",
  "@types/react-dom",
  "@vitejs/plugin-react",
  "typescript",
  "vite",
] as const;

const PROVIDER_KEYS = new Set(["ANTHROPIC_API_KEY", "GEMINI_API_KEY", "RUNWAY_API_KEY", "XAI_API_KEY", "FAL_KEY", "PEXELS_API_KEY", "VIDEO_STORAGE_TOKEN"]);
const CLIENT_ENV_PREFIXES = ["VITE", "NEXT_PUBLIC"].map((prefix) => `${prefix}_`);

export interface VideoChatDoctorResult {
  ok: boolean;
  lines: readonly string[];
}

function parseEnvironment(source: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const rawLine of source.replaceAll("\r\n", "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    result.set(match[1], value);
  }
  return result;
}

function stringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/** Inspect the generated app without running source, builds, providers, or network requests. */
export function doctorVideoChatApp(cwdInput: string): VideoChatDoctorResult {
  const cwd = resolve(cwdInput);
  const lines: string[] = [];
  let ok = true;
  for (const path of REQUIRED_FILES) {
    if (!existsSync(join(cwd, path))) {
      ok = false;
      lines.push(`MISSING  ${path}`);
    }
  }

  let manifest: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) as unknown;
    if (!isJsonObject(parsed)) throw new Error("expected an object");
    manifest = parsed;
  } catch {
    ok = false;
    lines.push("MISSING  valid package.json");
  }
  const dependencies = { ...stringMap(manifest.dependencies), ...stringMap(manifest.devDependencies) };
  const configuration = isJsonObject(manifest.vanillasky) ? manifest.vanillasky : {};
  const textProvider = configuration.textProvider ?? "vercel";
  const requiredDependencies = [...REQUIRED_DEPENDENCIES, ...(textProvider === "vercel" ? ["ai", "@ai-sdk/anthropic"] : [])];
  const missingDependencies = requiredDependencies.filter((name) => !dependencies[name]);
  for (const name of missingDependencies) {
    ok = false;
    lines.push(`MISSING  dependency ${name}`);
  }
  const installed = (name: string) => existsSync(join(cwd, "node_modules", name, "package.json"));
  for (const name of requiredDependencies.filter((name) => dependencies[name] && !installed(name))) {
    ok = false;
    lines.push(`NOT INSTALLED  ${name} — run npm install`);
  }
  const scripts = stringMap(manifest.scripts);
  if (scripts.dev !== "vite" || scripts.build !== "tsc && vite build") {
    ok = false;
    lines.push("MISSING  video-chat dev/build scripts");
  }

  const ignore = existsSync(join(cwd, ".gitignore")) ? readFileSync(join(cwd, ".gitignore"), "utf8") : "";
  if (!effectivelyIgnoresLocalEnvironment(ignore)) {
    ok = false;
    lines.push("UNSAFE   .env.local is not ignored");
  }

  const environment = existsSync(join(cwd, ".env.local"))
    ? parseEnvironment(readFileSync(join(cwd, ".env.local"), "utf8"))
    : new Map<string, string>();
  const privateKeys = new Set([...PROVIDER_KEYS, ...(Array.isArray(configuration.requiredEnv) ? configuration.requiredEnv.filter((value): value is string => typeof value === "string") : [])]);
  for (const name of environment.keys()) {
    if (CLIENT_ENV_PREFIXES.some((prefix) => name.startsWith(prefix) && privateKeys.has(name.slice(prefix.length)))) {
      ok = false;
      lines.push(`UNSAFE   ${name} exposes a provider key to the browser`);
    }
  }

  lines.push("READY    video chat + browser voice");
  const requiredEnv = Array.isArray(configuration.requiredEnv)
    ? configuration.requiredEnv.filter((key): key is string => typeof key === "string" && /^[A-Z][A-Z0-9_]*$/.test(key))
    : textProvider === "native" ? ["GEMINI_API_KEY"] : textProvider === "vercel" ? ["ANTHROPIC_API_KEY"] : [];
  for (const key of requiredEnv) {
    if (environment.get(key)) lines.push(`READY    ${key}`);
    else { ok = false; lines.push(`MISSING  ${key} in .env.local`); }
  }
  if (textProvider !== "native" && textProvider !== "vercel") lines.push("CHECK    app-owned text callbacks and vanillasky.requiredEnv");
  const enabled = Array.isArray(configuration.providers) ? configuration.providers : [];
  const videoVendor = typeof configuration.videoVendor === "string" ? configuration.videoVendor : "fal";
  const videoKey = ({ fal: "FAL_KEY", google: "GEMINI_API_KEY", runway: "RUNWAY_API_KEY" } as Record<string, string>)[videoVendor];
  for (const provider of [
    { id: "speech", label: "generated speech", dependencies: ["@ai-sdk/xai", "ai"], key: "XAI_API_KEY" },
    { id: "video", label: "generated video", dependencies: [], key: videoKey },
    { id: "transcription", label: "transcription", dependencies: [], key: "FAL_KEY" },
  ]) {
    const configured = enabled.includes(provider.id)
      && existsSync(join(cwd, "providers.ts"))
      && existsSync(join(cwd, "providers", `${provider.id}.ts`))
      && provider.dependencies.every((name) => dependencies[name] && installed(name));
    if (!configured) {
      lines.push(`OPTIONAL ${provider.label} — run npx vanillasky providers add ${provider.id}`);
    } else if (provider.id === "video" && !videoKey) {
      lines.push("CHECK    generated video — verify your custom callback, model policy and delivery in providers/video.ts");
    } else if (provider.key && !environment.get(provider.key)) {
      lines.push(`OPTIONAL ${provider.label} — add ${provider.key} to .env.local`);
    } else if (provider.id === "video" && (!validUploadUrl(environment.get("VIDEO_UPLOAD_URL")) || !environment.get("VIDEO_STORAGE_TOKEN"))) {
      lines.push("CHECK    generated video — configure VIDEO_UPLOAD_URL + VIDEO_STORAGE_TOKEN or your app-owned delivery callback");
    } else {
      lines.push(`READY    ${provider.label}${provider.id === "video" ? ` (${videoVendor}; configuration only, no paid probe)` : ""}`);
    }
  }
  lines.push(environment.get("PEXELS_API_KEY")
    ? "READY    stock media"
    : "OPTIONAL stock media — add PEXELS_API_KEY");
  return { ok, lines };
}

function validUploadUrl(value: string | undefined): boolean {
  try { const url = new URL(value ?? ""); return url.protocol === "https:" && !url.username && !url.password; }
  catch { return false; }
}
