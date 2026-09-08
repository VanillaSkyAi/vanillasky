import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { assertAppIdentity } from "./deployment-app-identity.mjs";

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing deployment setting: ${name}`);
  return value;
};
const account = required("CLOUDFLARE_ACCOUNT_ID");
const project = required("CLOUDFLARE_PAGES_PROJECT");
const token = required("CLOUDFLARE_API_TOKEN");
const productionUrl = required("PRODUCTION_URL");
const api = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/pages/projects/${encodeURIComponent(project)}`;
async function request(path, method = "GET") {
  const response = await fetch(`${api}${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(method === "POST" ? { body: "{}" } : {}), signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json();
  if (!response.ok || body.success !== true) throw new Error(`Cloudflare ${method} failed (${response.status})`);
  return body.result;
}
async function restore(id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid deployment ID");
  const target = await request(`/deployments/${id}`);
  if (target.environment !== "production" || target.latest_stage?.status !== "success") throw new Error("Rollback requires a successful production deployment");
  const expectedCommit = target.deployment_trigger?.metadata?.commit_hash;
  if (!/^[a-f0-9]{40}$/.test(expectedCommit)) throw new Error("Rollback target lacks a verifiable commit");
  await request(`/deployments/${id}/rollback`, "POST");
  for (let attempt = 0; attempt < 24; attempt++) {
    const response = await fetch(productionUrl, { signal: AbortSignal.timeout(15_000), headers: { "cache-control": "no-cache" } });
    if (response.ok && (await response.text()).includes(`name="build-sha" content="${expectedCommit}"`)) {
      console.log(`Restored production deployment ${id} (${expectedCommit})`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error("Rollback requested, but production commit verification failed");
}
if (process.argv[2] === "rollback") {
  if (required("CONFIRMATION") !== "ROLLBACK") throw new Error("Rollback confirmation required");
  await restore(required("DEPLOYMENT_ID"));
} else {
  if (required("CONFIRMATION") !== "DEPLOY") throw new Error("Deployment confirmation required");
  const target = required("DEPLOYMENT_TARGET");
  if (!["preview", "production"].includes(target)) throw new Error("Invalid deployment target");
  const identity = assertAppIdentity(JSON.parse(readFileSync("dist/app-build.json", "utf8")));
  let previous;
  if (target === "production") {
    // The latest successful deployment may differ from the currently serving
    // deployment after a rollback. Preserve the actual canonical deployment.
    previous = (await request("")).canonical_deployment;
    if (!previous || previous.environment !== "production" || previous.latest_stage?.status !== "success"
      || !/^[a-f0-9]{40}$/.test(previous.deployment_trigger?.metadata?.commit_hash)) {
      throw new Error("No verifiable current production deployment available for rollback");
    }
    console.log(`Rollback deployment: ${previous.id}`);
  }
  let deploymentAttempted = false;
  try {
    deploymentAttempted = true;
    const output = execFileSync("npx", ["wrangler", "pages", "deploy", "dist", "--config", "wrangler.deploy.json", "--project-name", project,
      "--branch", target === "production" ? "main" : `preview-${identity.commit.slice(0, 12)}`, "--commit-hash", identity.commit],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 300_000 });
    const immutableUrl = output.match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.pages\.dev/i)?.[0];
    if (!immutableUrl) throw new Error("Deployment did not return an immutable URL");
    execFileSync(process.execPath, ["scripts/verify-app-deployment.mjs"], {
      env: { ...process.env, DEPLOYMENT_URL: immutableUrl }, stdio: "inherit", timeout: 300_000,
    });
    if (target === "production") execFileSync(process.execPath, ["scripts/verify-app-deployment.mjs"], {
      env: { ...process.env, DEPLOYMENT_URL: productionUrl }, stdio: "inherit", timeout: 300_000,
    });
    console.log(`Deployed ${identity.commit} to ${immutableUrl}`);
  } catch {
    if (deploymentAttempted && previous) await restore(previous.id);
    throw new Error("Application deployment failed; inspect verification output and rollback status");
  }
}
