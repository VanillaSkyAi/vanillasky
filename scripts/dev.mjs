import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createAppIdentity } from "./deployment-app-identity.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const appPort = Number(process.env.APP_PORT ?? 4200);
const apiPort = Number(process.env.APP_API_PORT ?? 8788);
if (![appPort, apiPort].every(port => Number.isInteger(port) && port > 1024 && port <= 65535) || appPort === apiPort) {
  throw new Error("APP_PORT and APP_API_PORT must be different ports between 1025 and 65535");
}
const state = resolve(".wrangler/local");
mkdirSync(state, { recursive: true });
const saltFile = resolve(state, "quota-salt");
if (!existsSync(saltFile)) writeFileSync(saltFile, randomBytes(32).toString("hex"), { mode: 0o600 });
const localSalt = readFileSync(saltFile, "utf8").trim();
// Let Wrangler load the salt as an ignored secret, not a visible CLI binding.
const environmentFile = resolve(".dev.vars");
const environment = existsSync(environmentFile) ? readFileSync(environmentFile, "utf8") : "";
if (!/^\s*(?:export\s+)?VIDEO_CHAT_QUOTA_SALT\s*=/m.test(environment)) {
  writeFileSync(environmentFile, `${environment}\nVIDEO_CHAT_QUOTA_SALT=${localSalt}\n`, { mode: 0o600 });
}
mkdirSync("functions", { recursive: true });
writeFileSync("functions/build-identity.json", JSON.stringify(createAppIdentity(root)) + "\n");
// Pages needs a static directory while Vite owns all browser assets during HMR.
const staticDirectory = resolve(".generated/local-static");
mkdirSync(staticDirectory, { recursive: true });
writeFileSync(resolve(staticDirectory, "index.html"), "<!doctype html><title>VanillaSky API</title>");

const children = new Set();
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill("SIGTERM");
  const timer = setTimeout(() => { for (const child of children) child.kill("SIGKILL"); }, 2500);
  timer.unref();
}
process.once("SIGINT", () => stop(0));
process.once("SIGTERM", () => stop(0));
function launch(script, args, temporary = false) {
  const child = spawn(process.execPath, [resolve(script), ...args], {
    cwd: root, stdio: "inherit", env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  });
  children.add(child);
  child.once("error", () => { console.error("A local development process could not start."); stop(1); });
  child.once("exit", code => {
    children.delete(child);
    if (!temporary && !stopping) stop(code || 1);
  });
  return child;
}
const wrangler = "node_modules/wrangler/bin/wrangler.js";
const migration = launch(wrangler, ["d1", "migrations", "apply", "VIDEO_CHAT_QUOTAS", "--local", "--persist-to", state], true);
const migrated = await new Promise(resolve => {
  migration.once("error", () => resolve(false));
  migration.once("exit", code => resolve(code === 0));
});
if (!migrated || stopping) {
  stop(1);
} else {
  const paidProviders = process.env.VIDEO_CHAT_PAID_PROVIDERS === "disabled" ? "disabled" : "enabled";
  launch(wrangler, ["pages", "dev", staticDirectory, "--ip", "127.0.0.1", "--port", String(apiPort),
    "--persist-to", state,
    "--binding", "VIDEO_CHAT_LOCAL=enabled",
    "--binding", `VIDEO_CHAT_PAID_PROVIDERS=${paidProviders}`,
  ]);
  const deadline = Date.now() + 30_000;
  let ready = false;
  while (!stopping && Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${apiPort}/api/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) { ready = true; break; }
    } catch { /* API compiler is still starting. */ }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  if (!ready || stopping) {
    console.error("The local API did not start. Check the output above.");
    stop(1);
  } else {
    launch("node_modules/vite/bin/vite.js", ["--host", "127.0.0.1", "--port", String(appPort), "--strictPort"]);
  }
}
