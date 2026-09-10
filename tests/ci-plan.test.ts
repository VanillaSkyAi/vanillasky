import { describe, expect, it } from "vitest";
import { assertCiResults, classifyChanges, deploymentRequired } from "../scripts/ci-plan.mjs";

describe("change-aware verification", () => {
  it("keeps prose-only edits on the docs path", () => {
    expect(classifyChanges(["README.md", "docs/getting-started.md", "CHANGELOG.md", "tasks/lessons.md"])).toBe("docs");
  });
  it("checks isolated edge changes with the real app setup browsers", () => {
    expect(classifyChanges(["functions/_video-chat/fal.mjs", "tests/app-api/fal.test.mjs", "README.md"])).toBe("server");
  });
  it("checks repository tooling and its own tests without the media matrix", () => {
    expect(classifyChanges(["scripts/ci-plan.mjs", "scripts/check-docs.mjs", "scripts/acceptance/prompt-cases.json", "tests/ci-plan.test.ts", "tests/check-docs.test.ts", "CHANGELOG.md"])).toBe("server");
  });
  it("keeps tooling changes on the full path when they arrive with application source", () => {
    expect(classifyChanges(["scripts/ci-plan.mjs", "src/player/video-player.tsx"])).toBe("full");
  });
  it.each(["src/player/VideoPlayer.tsx", "src/server/chat-shot-planner.ts", "app/home.css", "styles/video-chat.css", "package-lock.json", ".github/workflows/ci.yml", "playwright.config.ts", ".dev.vars.example", "tests/fixtures/creative-answers.md", "docs/example.ts", "new-feature/file.md"])(
    "requires full checks for shared, executable, fixture or unknown path %s", (file) => {
      expect(classifyChanges(["README.md", file])).toBe("full");
    },
  );
  it("defaults to full verification when the change list is empty", () => {
    expect(classifyChanges([])).toBe("full");
  });
  it("a rename out of docs stays full when old and new paths are supplied", () => {
    expect(classifyChanges(["docs/example.md", "tests/fixtures/example.md"])).toBe("full");
  });
});

const jobs = (application: string) => ({
  changes: { result: "success" }, verify: { result: application },
  "browser-gate": { result: application }, "node-compatibility": { result: application },
});

describe("required application gate", () => {
  it("accepts only the skips selected by a successful docs plan", () => {
    expect(() => assertCiResults("docs", jobs("skipped"))).not.toThrow();
    expect(() => assertCiResults("full", jobs("skipped"))).toThrow();
    expect(() => assertCiResults("server", jobs("skipped"))).toThrow();
  });
  it.each(["server", "full"])("requires successful jobs for %s", (kind) => {
    expect(() => assertCiResults(kind, jobs("success"))).not.toThrow();
    for (const status of ["failure", "cancelled", "skipped", ""]) {
      const results = jobs("success");
      results["browser-gate"].result = status;
      expect(() => assertCiResults(kind, results)).toThrow();
    }
  });
  it("cannot hide a failed classifier or a missing/unknown plan", () => {
    expect(() => assertCiResults("docs", { ...jobs("skipped"), changes: { result: "failure" } })).toThrow();
    expect(() => assertCiResults("", jobs("skipped"))).toThrow();
    expect(() => assertCiResults("typo", jobs("success"))).toThrow();
    expect(() => assertCiResults("full", {})).toThrow();
  });
});

describe("deployment plan", () => {
  const commit = "a".repeat(40);
  it("skips docs deployments but permits exact-commit application artifacts", () => {
    expect(deploymentRequired({ kind: "docs", commit }, commit)).toBe(false);
    expect(deploymentRequired({ kind: "server", commit }, commit)).toBe(true);
    expect(deploymentRequired({ kind: "full", commit }, commit)).toBe(true);
  });
  it("rejects stale, absent or malformed CI plans", () => {
    for (const plan of [null, {}, { kind: "docs", commit: "b".repeat(40) }, { kind: "unknown", commit }]) {
      expect(() => deploymentRequired(plan, commit)).toThrow();
    }
  });
});

// Exercise real Git history and the CLI contract consumed by GitHub Actions.
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

it("plans actual changes, handles renames and fails safe without usable history", () => {
  const root = mkdtempSync(join(tmpdir(), "video-ci-plan-"));
  const script = resolve("scripts/ci-plan.mjs");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const commit = () => { git("add", "."); git("-c", "user.name=CI test", "-c", "user.email=ci@example.invalid", "commit", "-qm", "fixture"); return git("rev-parse", "HEAD"); };
  const plan = (eventName: string, event: object) => {
    const eventPath = join(root, ".event.json"), outputPath = join(root, ".output");
    writeFileSync(eventPath, JSON.stringify(event));
    writeFileSync(outputPath, "");
    execFileSync(process.execPath, [script, "plan"], { cwd: root, encoding: "utf8", env: { ...process.env, GITHUB_EVENT_NAME: eventName, GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: outputPath } });
    const artifact = JSON.parse(readFileSync(join(root, ".generated/ci-plan.json"), "utf8"));
    const outputs = Object.fromEntries(readFileSync(outputPath, "utf8").trim().split("\n").map(line => { const equal = line.indexOf("="); return [line.slice(0, equal), line.slice(equal + 1)]; }));
    expect(artifact.commit).toBe(git("rev-parse", "HEAD"));
    expect(outputs.kind).toBe(artifact.kind);
    return { kind: artifact.kind, matrix: JSON.parse(outputs.matrix).include as { browser: string; shard: number; app: boolean }[] };
  };
  try {
    git("init", "-q");
    writeFileSync(join(root, ".gitignore"), ".generated/\n.event.json\n.output\n");
    writeFileSync(join(root, "README.md"), "# First\n");
    const base = commit();
    writeFileSync(join(root, "README.md"), "# Updated\n");
    const docsCommit = commit();
    expect(plan("push", { before: base }).kind).toBe("docs");
    expect(plan("pull_request", { pull_request: { base: { sha: base } } }).kind).toBe("docs");
    for (const [name, event] of [["workflow_dispatch", { before: base }], ["push", {}], ["push", { before: "0".repeat(40) }], ["push", { before: "f".repeat(40) }]] as const) {
      const result = plan(name, event);
      expect(result.kind).toBe("full");
      expect(result.matrix).toHaveLength(15);
      expect(result.matrix.filter(job => job.app)).toHaveLength(3);
    }
    mkdirSync(join(root, "functions"));
    writeFileSync(join(root, "functions/route.mjs"), "export const onRequest = () => {};\n");
    const serverCommit = commit();
    const server = plan("push", { before: docsCommit });
    expect(server.kind).toBe("server");
    expect(server.matrix.map(job => job.browser)).toEqual(["chromium", "firefox", "webkit"]);
    expect(server.matrix.every(job => job.app)).toBe(true);
    mkdirSync(join(root, "tests/fixtures"), { recursive: true });
    git("mv", "README.md", "tests/fixtures/input.md");
    commit();
    expect(plan("push", { before: serverCommit }).kind).toBe("full");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
