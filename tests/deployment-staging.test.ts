import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { createDeploymentStage } from "../scripts/deployment-project-config.mjs";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
function application() {
  const root = mkdtempSync(join(tmpdir(), "deploy-stage-"));
  roots.push(root);
  mkdirSync(join(root, "dist"));
  mkdirSync(join(root, ".generated/functions-build"), { recursive: true });
  writeFileSync(join(root, "wrangler.jsonc"), JSON.stringify({ name: "local", compatibility_date: "2026-04-09", vars: { VIDEO_CHAT_FAL_DAILY_LIMIT: "10" } }));
  writeFileSync(join(root, "dist/index.html"), "verified frontend");
  writeFileSync(join(root, "dist/_headers"), "/*\n X-Frame-Options: DENY\n");
  writeFileSync(join(root, ".generated/functions-build/index.js"), "export default {fetch:()=>new Response('verified API')};");
  const identity = { commit: "a".repeat(40), sourceSha256: "b".repeat(64) };
  writeFileSync(join(root, "dist/app-build.json"), JSON.stringify(identity));
  const workerPath = ".generated/functions-build/index.js";
  writeFileSync(join(root, ".generated/app-artifact.json"), JSON.stringify({ ...identity, files: [{ path: workerPath, sha256: createHash("sha256").update(readFileSync(join(root, workerPath))).digest("hex") }] }));
  return root;
}
const settings = {
  DEPLOYMENT_TARGET: "preview", CLOUDFLARE_PAGES_PROJECT: "example-project",
  CLOUDFLARE_QUOTA_DATABASE_ID: "11111111-1111-4111-8111-111111111111", CLOUDFLARE_QUOTA_DATABASE_NAME: "example-preview",
};

test("staging uses conventional config and exact prebuilt frontend/API without changing tracked config", () => {
  const root = application();
  const original = readFileSync(join(root, "wrangler.jsonc"), "utf8");
  const stage = createDeploymentStage(root, settings);
  const config = JSON.parse(readFileSync(join(stage, "wrangler.jsonc"), "utf8"));
  expect(config.pages_build_output_dir).toBe("./dist");
  expect(config.vars.VIDEO_CHAT_PAID_PROVIDERS).toBe("disabled");
  expect(config.env.preview.d1_databases[0].database_id).toBe(settings.CLOUDFLARE_QUOTA_DATABASE_ID);
  expect(readFileSync(join(stage, "dist/index.html"))).toEqual(readFileSync(join(root, "dist/index.html")));
  expect(readFileSync(join(stage, "dist/_worker.js"))).toEqual(readFileSync(join(root, ".generated/functions-build/index.js")));
  expect(readFileSync(join(root, "wrangler.jsonc"), "utf8")).toBe(original);
  writeFileSync(join(stage, "dist/stale.js"), "old output");
  createDeploymentStage(root, { ...settings, DEPLOYMENT_TARGET: "production" });
  expect(() => readFileSync(join(stage, "dist/stale.js"))).toThrow();
  expect(JSON.parse(readFileSync(join(stage, "wrangler.jsonc"), "utf8")).vars.VIDEO_CHAT_PAID_PROVIDERS).toBe("enabled");
});

test("staging refuses a worker that changed after build verification", () => {
  const root = application();
  writeFileSync(join(root, ".generated/functions-build/index.js"), "unverified worker");
  expect(() => createDeploymentStage(root, settings)).toThrow("Compiled worker differs");
});
