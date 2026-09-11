import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/** Uploads the export directory to a bucket, or removes what a previous upload listed. */
export interface PublishTarget {
  bucket: string;
  /** Local miniflare storage for `wrangler pages dev`, or the remote bucket. */
  remote: boolean;
  persistTo?: string;
}

const WRANGLER = resolve("node_modules/wrangler/bin/wrangler.js");
const CONTENT_TYPES: Record<string, string> = { ".json": "application/json", ".mp4": "video/mp4" };

export function exportedKeys(exportDir: string): string[] {
  const keys: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) walk(path);
      else keys.push(relative(exportDir, path).split("\\").join("/"));
    }
  };
  walk(exportDir);
  return keys.filter((key) => key !== "manifest.json").sort();
}

function wrangler(args: string[], target: PublishTarget): void {
  execFileSync(process.execPath, [WRANGLER, ...args, ...(target.remote ? ["--remote"] : ["--local", "--persist-to", target.persistTo ?? resolve(".wrangler/local")])], {
    stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  });
}

export function publish(exportDir: string, target: PublishTarget, log: (message: string) => void): string[] {
  const keys = exportedKeys(exportDir);
  for (const [index, key] of keys.entries()) {
    const contentType = CONTENT_TYPES[key.slice(key.lastIndexOf("."))] ?? "application/octet-stream";
    wrangler(["r2", "object", "put", `${target.bucket}/${key}`, "--file", join(exportDir, key), "--content-type", contentType], target);
    log(`${index + 1}/${keys.length} ${key}`);
  }
  // The manifest lists what this publish placed so `clear` can remove exactly that.
  const manifest = JSON.stringify({ publishedAt: new Date().toISOString(), keys }, null, 2);
  writeFileSync(join(exportDir, "manifest.json"), manifest);
  wrangler(["r2", "object", "put", `${target.bucket}/manifest.json`, "--file", join(exportDir, "manifest.json"), "--content-type", "application/json"], target);
  return keys;
}

export function clear(exportDir: string, target: PublishTarget, log: (message: string) => void): string[] {
  const manifest = JSON.parse(readFileSync(join(exportDir, "manifest.json"), "utf8")) as { keys?: unknown };
  const keys = Array.isArray(manifest.keys) ? manifest.keys.filter((key): key is string => typeof key === "string") : [];
  for (const key of [...keys, "manifest.json"]) {
    wrangler(["r2", "object", "delete", `${target.bucket}/${key}`], target);
    log(`removed ${key}`);
  }
  return keys;
}
