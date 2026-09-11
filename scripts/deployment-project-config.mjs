import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertAppIdentity } from "./deployment-app-identity.mjs";

export function createDeploymentStage(root = process.cwd(), environment = process.env) {
  const required = (name) => {
    const value = environment[name]?.trim();
    if (!value) throw new Error(`Missing deployment setting: ${name}`);
    return value;
  };
  const target = required("DEPLOYMENT_TARGET");
  if (!["preview", "production"].includes(target)) throw new Error("Invalid deployment target");
  const config = JSON.parse(readFileSync(resolve(root, "wrangler.jsonc"), "utf8"));
  const databaseId = required("CLOUDFLARE_QUOTA_DATABASE_ID");
  if (!/^[0-9a-f-]{36}$/i.test(databaseId) || databaseId === "00000000-0000-0000-0000-000000000000") throw new Error("Invalid deployment quota database");
  config.name = required("CLOUDFLARE_PAGES_PROJECT");
  config.pages_build_output_dir = "./dist";
  config.vars = { ...config.vars, VIDEO_CHAT_PAID_PROVIDERS: target === "production" ? "enabled" : "disabled" };
  config.d1_databases = [{
    binding: "VIDEO_CHAT_QUOTAS",
    database_name: required("CLOUDFLARE_QUOTA_DATABASE_NAME"),
    database_id: databaseId,
    migrations_dir: resolve(root, "migrations"),
  }];
  // The answer cache is optional operator content; the local bucket name never
  // reaches a deployment.
  const bucket = environment.CLOUDFLARE_ANSWER_CACHE_BUCKET?.trim();
  if (bucket) config.r2_buckets = [{ binding: "VIDEO_CHAT_ANSWER_CACHE", bucket_name: bucket }];
  else delete config.r2_buckets;
  config.env = { preview: { vars: config.vars, d1_databases: config.d1_databases, ...(bucket ? { r2_buckets: config.r2_buckets } : {}) } };

  const identity = assertAppIdentity(JSON.parse(readFileSync(resolve(root, "dist/app-build.json"), "utf8")));
  const artifact = JSON.parse(readFileSync(resolve(root, ".generated/app-artifact.json"), "utf8"));
  if (artifact.commit !== identity.commit || artifact.sourceSha256 !== identity.sourceSha256) throw new Error("Deployment artifact is stale");
  const workerPath = ".generated/functions-build/index.js";
  const worker = readFileSync(resolve(root, workerPath));
  const record = artifact.files.find(file => file.path === workerPath);
  if (!record || record.sha256 !== createHash("sha256").update(worker).digest("hex")) throw new Error("Compiled worker differs from the verified artifact");

  // Pages deploy only accepts conventional config filenames. Stage the exact
  // built worker in advanced mode, avoiding source imports or tracked edits.
  const stage = resolve(root, ".generated/deployment");
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  cpSync(resolve(root, "dist"), resolve(stage, "dist"), { recursive: true });
  writeFileSync(resolve(stage, "dist/_worker.js"), worker);
  writeFileSync(resolve(stage, "wrangler.jsonc"), JSON.stringify(config, null, 2) + "\n");
  return stage;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) createDeploymentStage();
