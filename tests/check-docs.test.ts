import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkDocs } from "../scripts/check-docs.mjs";

const roots: string[] = [];
function fixture(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "docs-check-"));
  roots.push(root);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return { root, tracked: Object.keys(files) };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("documentation validation", () => {
  it("resolves relative, repository-root, encoded, image and directory links", () => {
    const { root, tracked } = fixture({ "docs/start.md": "[root](/README.md) [guide](<Guide%20(one).md#hello-world>) ![art](../assets/a.svg) [folder](../assets)",
      "README.md": "# Home", "docs/Guide (one).md": "# Hello, world!", "assets/a.svg": "<svg/>" });
    expect(checkDocs(root, tracked)).toEqual([]);
  });
  it("reports missing local paths and anchors with source locations", () => {
    const { root, tracked } = fixture({ "README.md": "# Home\n[missing](gone.md)\n[anchor](guide.md#missing)", "guide.md": "# Present" });
    expect(checkDocs(root, tracked)).toEqual([
      { file: "README.md", line: 2, message: expect.stringContaining("gone.md") },
      { file: "README.md", line: 3, message: expect.stringContaining("#missing") },
    ]);
  });
  it("handles formatted, Unicode, duplicate and setext headings and explicit anchors", () => {
    const { root, tracked } = fixture({ "README.md": "[one](#c--api) [two](#c--api-1) [unicode](#中文-café) [setext](#another-heading) [html](#custom)\n# `C++` & API\n# C++ & API\n## 中文 Café\nAnother *heading*\n---\n<a id=\"custom\"></a>" });
    expect(checkDocs(root, tracked)).toEqual([]);
  });
  it("resolves case-insensitive reference links, collapsed links and shortcut links", () => {
    const { root, tracked } = fixture({ "README.md": "[guide][Getting   Started] [Guide][] [Guide]\n\n[getting started]: guide.md#start \"Optional title\"\n[guide]: <guide.md#start>\n", "guide.md": "# Start" });
    expect(checkDocs(root, tracked)).toEqual([]);
  });
  it("rejects missing explicit references and validates unused local definitions", () => {
    const { root, tracked } = fixture({ "README.md": "[guide][unknown]\n\n[unused]: missing.md" });
    const errors = checkDocs(root, tracked);
    expect(errors).toHaveLength(2);
    expect(errors.map(error => error.message).join(" ")).toContain("unknown");
    expect(errors.map(error => error.message).join(" ")).toContain("missing.md");
  });
  it("ignores fenced/inline/indented examples and remote URLs without network access", () => {
    const { root, tracked } = fixture({ "README.md": "```md\n[bad](missing.md)\n# Fake\n```\n~~~\n[bad][unknown]\n~~~\n`[bad](missing.md)`\n\n    [bad](missing.md)\n[web](https://does-not-exist.invalid/nope) [email](mailto:a@example.invalid)\n<!-- [bad](missing.md) -->" });
    expect(checkDocs(root, tracked)).toEqual([]);
  });
  it("does not treat headings inside code fences as anchor targets", () => {
    const { root, tracked } = fixture({ "README.md": "[bad](#fake)\n```\n# Fake\n```" });
    expect(checkDocs(root, tracked)).toEqual([{ file: "README.md", line: 1, message: expect.stringContaining("#fake") }]);
  });
  it("accepts balanced parentheses, query strings and escaped link paths", () => {
    const { root, tracked } = fixture({ "README.md": "[guide](guide(one).md?view=1#intro) [other](guide\\(one\\).md#intro)", "guide(one).md": "# Intro" });
    expect(checkDocs(root, tracked)).toEqual([]);
  });
  it("reports unterminated fences and conflict markers", () => {
    const { root, tracked } = fixture({ "README.md": "<<<<<<< HEAD\ntext\n=======\nother\n>>>>>>> branch\n```ts\nconst x = 1;" });
    const errors = checkDocs(root, tracked);
    expect(errors.some(error => error.line === 1 && error.message.includes("conflict"))).toBe(true);
    expect(errors.some(error => error.line === 6 && error.message.includes("fence"))).toBe(true);
  });
  it("uses Git-tracked files and rejects links to ignored/untracked local files", () => {
    const { root } = fixture({ "README.md": "[bad](untracked.md)", "untracked.md": "# Not committed" });
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    execFileSync("git", ["add", "README.md"], { cwd: root });
    expect(checkDocs(root)).toEqual([{ file: "README.md", line: 1, message: expect.stringContaining("untracked.md") }]);
    const command = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/check-docs.mjs", import.meta.url))], { cwd: root, encoding: "utf8" });
    expect(command.status).toBe(1);
    expect(command.stderr).toContain("README.md:1:");
  });
  it("accepts reference destinations on the following line and fenced blockquotes", () => {
    const { root, tracked } = fixture({ "README.md": "[guide][start]\n\n[start]:\n    <guide.md#intro>\n\n> ```md\n> [bad](gone.md)\n> ```", "guide.md": "# Intro" });
    expect(checkDocs(root, tracked)).toEqual([]);
  });
  it("does not accept an unclosed angle-bracket inline link", () => {
    const { root, tracked } = fixture({ "README.md": "[guide](<guide.md>\n", "guide.md": "# Intro" });
    expect(checkDocs(root, tracked)).toEqual([{ file: "README.md", line: 1, message: expect.stringContaining("Unclosed") }]);
  });
  it("rejects invalid encoding and targets outside the repository", () => {
    const { root, tracked } = fixture({ "README.md": "[bad](bad%ZZ.md) [outside](../outside.md)" });
    expect(checkDocs(root, tracked)).toHaveLength(2);
  });
  it("accepts links to the repository root", () => {
    const { root, tracked } = fixture({ "README.md": "[root](/) [same](./)" });
    expect(checkDocs(root, tracked)).toEqual([]);
  });

  it("checks local destinations continued below reference definitions", () => {
    const { root, tracked } = fixture({ "README.md": "[guide][start]\n\n[start]:\n    <missing.md>" });
    expect(checkDocs(root, tracked).some(error => error.message.includes("missing.md"))).toBe(true);
  });

  it("checks HTML links and headings containing reference links", () => {
    const { root, tracked } = fixture({ "README.md": "[heading](#guide)\n# [Guide][guide]\n[guide]: guide.md\n<a href=\"guide.md#intro\">Open</a>\n<img src=\"missing.svg\">", "guide.md": "# Intro" });
    expect(checkDocs(root, tracked)).toEqual([{ file: "README.md", line: 5, message: expect.stringContaining("missing.svg") }]);
  });

});
