import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const kinds = new Set(["docs", "server", "full"]);
const rootDocs = /^(README|CHANGELOG|CONTRIBUTING|CODE_OF_CONDUCT|SECURITY|SUPPORT|AGENTS|CLAUDE)\.md$/;
const isDoc = path => rootDocs.test(path) || /^(docs|tasks)\/.*\.md$/.test(path);

export function classifyChanges(paths) {
  if (!paths.length) return "full";
  if (paths.every(isDoc)) return "docs";
  if (paths.every(path => isDoc(path) || /^(functions|tests\/app-api)\/.*\.mjs$/.test(path))) return "server";
  return "full";
}

export function assertCiResults(kind, jobs) {
  if (!kinds.has(kind)) throw new Error("Missing or invalid verification plan");
  for (const name of ["changes", "verify", "browser-gate", "node-compatibility"]) {
    const expected = kind === "docs" && name !== "changes" ? "skipped" : "success";
    if (jobs[name]?.result !== expected) throw new Error(`${name}: expected ${expected}, got ${jobs[name]?.result ?? "missing"}`);
  }
}

export function deploymentRequired(plan, commit) {
  if (!plan || !kinds.has(plan.kind) || !/^[a-f0-9]{40}$/.test(commit ?? "") || plan.commit !== commit) {
    throw new Error("Missing, stale or invalid CI plan");
  }
  return plan.kind !== "docs";
}

function output(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function createPlan() {
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const base = process.env.GITHUB_EVENT_NAME === "pull_request" ? event.pull_request?.base?.sha : event.before;
  let kind = "full";
  // Manual CI and unavailable history always run the complete suite.
  if (process.env.GITHUB_EVENT_NAME !== "workflow_dispatch" && /^[a-f0-9]{40}$/.test(base ?? "") && !/^0+$/.test(base)) {
    try {
      const paths = execFileSync("git", ["diff", "--name-only", "--no-renames", "-z", base, commit], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).split("\0").filter(Boolean);
      kind = classifyChanges(paths);
    } catch {
      console.warn("Base revision unavailable; running full verification.");
    }
  }
  const matrix = { include: ["chromium", "firefox", "webkit"].flatMap(browser =>
    (kind === "server" ? [1] : [1, 2, 3, 4, 5]).map(shard => ({ browser, shard, app: kind === "server" || shard === 5 }))) };
  mkdirSync(".generated", { recursive: true });
  writeFileSync(".generated/ci-plan.json", JSON.stringify({ kind, commit }) + "\n");
  output("kind", kind);
  output("matrix", JSON.stringify(matrix));
  console.log(`Verification plan: ${kind} (${commit})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  switch (process.argv[2]) {
    case "plan": createPlan(); break;
    case "gate": assertCiResults(process.env.CI_KIND, JSON.parse(process.env.CI_RESULTS ?? "{}")); break;
    case "deployment": {
      const required = deploymentRequired(JSON.parse(readFileSync(".generated/ci-plan.json", "utf8")), process.env.GITHUB_SHA);
      output("deploy", String(required));
      if (!required) {
        const message = "Documentation-only CI: no application deployment needed. To release pending earlier app changes, run CI manually on main, then deploy again.";
        console.log(message);
        if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, message + "\n");
      }
      break;
    }
    default: throw new Error("Use ci-plan.mjs plan, gate or deployment");
  }
}
