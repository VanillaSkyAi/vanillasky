import { describe, expect, it } from "vitest";
import { assertCiResults, classifyChanges, deploymentRequired } from "../scripts/ci-plan.mjs";

describe("change-aware verification", () => {
  it("keeps prose-only edits on the docs path", () => {
    expect(classifyChanges(["README.md", "docs/getting-started.md", "CHANGELOG.md", "tasks/lessons.md"])).toBe("docs");
  });
  it("checks isolated edge changes with the real app setup browsers", () => {
    expect(classifyChanges(["functions/_video-chat/fal.mjs", "tests/app-api/fal.test.mjs", "README.md"])).toBe("server");
  });
  it.each(["src/player/VideoPlayer.tsx", "src/server/chat-shot-planner.ts", "app/home.css", "styles/video-chat.css", "package-lock.json", ".github/workflows/ci.yml", "scripts/ci-plan.mjs", ".dev.vars.example", "tests/fixtures/creative-answers.md", "docs/example.ts", "new-feature/file.md"])(
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
