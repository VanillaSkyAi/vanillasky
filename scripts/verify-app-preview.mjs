import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, openSync, closeSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { createDeploymentStage } from "./deployment-project-config.mjs";
import { assertAppMarkup } from "./deployment-app-identity.mjs";
import { assertBuiltHostingPolicy, assertResponseHeaders } from "./deployment-hosting-policy.mjs";

const port = Number(process.env.APP_BUILD_TEST_PORT || 8844);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid built application test port");
const probe = createServer();
probe.listen(port, "127.0.0.1");
await once(probe, "listening");
await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
const policy = assertBuiltHostingPolicy();
const identity = JSON.parse(readFileSync("dist/app-build.json", "utf8"));
mkdirSync(".generated", { recursive: true });
// Explicit env-file prevents loading a developer's provider keys. The binding
// override additionally disables paid calls regardless of shell configuration.
writeFileSync(".generated/preview-empty.vars", "VIDEO_CHAT_PAID_PROVIDERS=disabled\n");
const stage = createDeploymentStage(process.cwd(), {
  DEPLOYMENT_TARGET: "preview", CLOUDFLARE_PAGES_PROJECT: "local-verification",
  CLOUDFLARE_QUOTA_DATABASE_ID: "11111111-1111-4111-8111-111111111111", CLOUDFLARE_QUOTA_DATABASE_NAME: "local-verification",
});
const log = openSync(".generated/app-preview.log", "w");
const processGroup = process.platform !== "win32";
const child = spawn(process.execPath, [resolve("node_modules/wrangler/bin/wrangler.js"),
  "--cwd", stage, "pages", "dev", "dist", "--ip", "127.0.0.1", "--port", String(port),
  "--env-file", resolve(".generated/preview-empty.vars"), "--persist-to", resolve(".generated/preview-state"),
  "--binding", "VIDEO_CHAT_PAID_PROVIDERS=disabled"], {
  stdio: ["ignore", log, log], detached: processGroup,
  env: { ...process.env, WRANGLER_SEND_METRICS: "false", VIDEO_CHAT_PAID_PROVIDERS: "disabled" },
});
const exited = once(child, "exit");
const url = `http://127.0.0.1:${port}`;
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) throw new Error("Built application server exited; see .generated/app-preview.log");
    try {
      const health = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(500) });
      if (health.ok) { ready = true; break; }
    } catch { /* Wait for the local worker compiler. */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error("Built application did not start; see .generated/app-preview.log");
  const [page, health, status] = await Promise.all([
    fetch(url, { signal: AbortSignal.timeout(5000) }),
    fetch(`${url}/api/health`, { signal: AbortSignal.timeout(5000) }),
    fetch(`${url}/api/video-chat?action=status`, { signal: AbortSignal.timeout(5000) }),
  ]);
  if (!page.ok || !health.ok || !status.ok) throw new Error("Built application returned an unsuccessful response");
  assertResponseHeaders(page.headers, policy);
  assertAppMarkup(await page.text(), identity);
  const observed = await health.json();
  if (observed.commit !== identity.commit || observed.sourceSha256 !== identity.sourceSha256) throw new Error("Built API identity differs from the frontend");
  const capabilities = await status.json();
  if (capabilities.ready !== false || !capabilities.missing?.includes("VIDEO_CHAT_PAID_PROVIDERS")) throw new Error("Built smoke must disable paid providers");
  const workerResponse = await fetch(`${url}/_worker.js`, { signal: AbortSignal.timeout(5000) });
  const workerBody = await workerResponse.text();
  if (workerResponse.ok) {
    if (!workerResponse.headers.get("content-type")?.includes("text/html")) throw new Error("Compiled worker route was publicly served");
    assertAppMarkup(workerBody, identity);
  }
  console.log(`Verified staged application HTTP headers, API identity and missing setup at ${url}: ${identity.commit}`);
} finally {
  if (child.exitCode === null) {
    if (processGroup) process.kill(-child.pid, "SIGTERM");
    else child.kill("SIGTERM");
    const force = setTimeout(() => {
      if (child.exitCode === null) {
        if (processGroup) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      }
    }, 2500);
    await exited;
    clearTimeout(force);
  }
  closeSync(log);
}
