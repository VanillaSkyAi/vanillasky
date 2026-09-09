import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
const previous = {
  id: "11111111-1111-4111-8111-111111111111", environment: "production",
  latest_stage: { status: "success" }, deployment_trigger: { metadata: { commit_hash: "a".repeat(40) } },
};

// Run the real release entry point with offline transport/process boundaries.
// Unexpected network requests or child commands fail rather than reaching tools.
function release(fixture: Record<string, unknown>) {
  const root = mkdtempSync(join(tmpdir(), "deployment-bootstrap-"));
  roots.push(root);
  mkdirSync(join(root, "dist"));
  writeFileSync(join(root, "dist/app-build.json"), JSON.stringify({ commit: "b".repeat(40), sourceSha256: "c".repeat(64) }));
  writeFileSync(join(root, "fixture.json"), JSON.stringify(fixture));
  writeFileSync(join(root, "offline.mjs"), `
    import cp from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    import { readFileSync, appendFileSync } from 'node:fs';
    const f = JSON.parse(readFileSync('fixture.json', 'utf8'));
    const record = value => appendFileSync('events.jsonl', JSON.stringify(value) + '\\n');
    globalThis.fetch = async (url, options = {}) => {
      const u = new URL(url);
      record({ request: u.pathname + u.search, method: options.method || 'GET' });
      if (u.origin === 'https://example.test') return new Response('<meta name="build-sha" content="${previous.deployment_trigger.metadata.commit_hash}">');
      if (u.origin !== 'https://api.cloudflare.com') throw new Error('Unexpected network');
      let result;
      if (u.pathname.endsWith('/projects/example')) result = f.project;
      else if (u.pathname.endsWith('/deployments') && u.search === '?env=production') {
        if (f.historyError) return Response.json({success:false}, {status:503});
        result = f.history;
      } else if (u.pathname.endsWith('/${previous.id}/rollback')) result = {};
      else if (u.pathname.endsWith('/${previous.id}')) result = f.project.canonical_deployment;
      else throw new Error('Unexpected API request');
      return Response.json({success:true, result});
    };
    cp.execFileSync = (_executable, args) => {
      if (args[0].endsWith('/node_modules/wrangler/bin/wrangler.js')) {
        record({ deploy: args });
        if (f.failUpload) throw new Error('Upload failed');
        return 'https://123abc.example.pages.dev';
      }
      if (args[0] === 'scripts/verify-app-deployment.mjs') {
        record({ verify: true });
        if (f.failVerification) throw new Error('Verification failed');
        return '';
      }
      throw new Error('Unexpected child command');
    };
    syncBuiltinESMExports();
  `);
  const result = spawnSync(process.execPath, ["--import", join(root, "offline.mjs"), resolve("scripts/deployment-cloudflare.mjs")], {
    cwd: root, encoding: "utf8", env: { PATH: process.env.PATH,
      CLOUDFLARE_ACCOUNT_ID: "example", CLOUDFLARE_PAGES_PROJECT: "example",
      CLOUDFLARE_API_TOKEN: "test-token", PRODUCTION_URL: "https://example.test",
      CONFIRMATION: "DEPLOY", DEPLOYMENT_TARGET: "production" },
  });
  const events = readFileSync(join(root, "events.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
  return { ...result, events };
}

test("first production release requires an explicitly empty production history", () => {
  const result = release({ project: { canonical_deployment: null }, history: [] });
  expect(result.status, result.stderr).toBe(0);
  expect(result.events.filter(event => event.deploy)).toHaveLength(1);
  expect(result.events.filter(event => event.verify)).toHaveLength(2);
  expect(result.events.some(event => event.request?.endsWith('?env=production'))).toBe(true);
});

test.each([
  { project: {} },
  { project: { canonical_deployment: false }, history: [] },
  { project: { canonical_deployment: {} }, history: [] },
  { project: { canonical_deployment: { ...previous, id: "invalid" } } },
  { project: { canonical_deployment: { ...previous, environment: "preview" } } },
  { project: { canonical_deployment: { ...previous, latest_stage: { status: "failure" } } } },
  { project: { canonical_deployment: { ...previous, deployment_trigger: {} } } },
  { project: { canonical_deployment: null }, history: [previous] },
  { project: { canonical_deployment: null }, history: [{ ...previous, latest_stage: { status: "failure" } }] },
  { project: { canonical_deployment: null }, history: {} },
  { project: { canonical_deployment: null }, historyError: true },
])("uncertain or existing unverifiable production blocks before upload: %j", fixture => {
  const result = release(fixture);
  expect(result.status).not.toBe(0);
  expect(result.events.some(event => event.deploy)).toBe(false);
});

test("existing production uses its canonical rollback target, without inferring from history", () => {
  const result = release({ project: { canonical_deployment: previous }, failVerification: true });
  expect(result.status).not.toBe(0);
  expect(result.events.some(event => event.request?.endsWith('?env=production'))).toBe(false);
  expect(result.events).toContainEqual({ request: `/client/v4/accounts/example/pages/projects/example/deployments/${previous.id}/rollback`, method: "POST" });
  expect(result.stdout).toContain("Restored production deployment");
});

test.each([{ failVerification: true }, { failUpload: true }])("failed first release reports no rollback target: %j", failure => {
  const result = release({ project: { canonical_deployment: null }, history: [], ...failure });
  expect(result.status).not.toBe(0);
  expect(result.events.some(event => event.deploy)).toBe(true);
  expect(result.events.some(event => event.method === "POST")).toBe(false);
  expect(result.stderr).toContain("no previous production deployment is available for rollback");
});
