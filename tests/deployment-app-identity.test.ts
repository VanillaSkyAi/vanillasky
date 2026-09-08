import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { assertAppMarkup, createAppIdentity, renderAppMetaTags } from "../scripts/deployment-app-identity.mjs";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
function repository() {
  const root = mkdtempSync(join(tmpdir(), "app-identity-"));
  roots.push(root);
  execFileSync("git", ["init", "--quiet", root]);
  writeFileSync(join(root, ".gitignore"), "dist/\n.generated/\n");
  writeFileSync(join(root, "app.ts"), "export const answer = 1;\n");
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-m", "initial"], { cwd: root });
  return root;
}

test("identity binds both committed and uncommitted application source", () => {
  const root = repository();
  const before = createAppIdentity(root);
  expect(createAppIdentity(root)).toEqual(before);
  writeFileSync(join(root, "app.ts"), "export const answer = 2;\n");
  const changed = createAppIdentity(root);
  expect(changed.commit).toBe(before.commit);
  expect(changed.sourceSha256).not.toBe(before.sourceSha256);
  writeFileSync(join(root, "new.ts"), "export const newFeature = true;\n");
  expect(createAppIdentity(root).sourceSha256).not.toBe(changed.sourceSha256);
});

test("deployment validation rejects stale, absent and duplicate identities", () => {
  const identity = createAppIdentity(repository());
  const tags = renderAppMetaTags(identity);
  expect(() => assertAppMarkup(`<head>${tags}</head>`, identity)).not.toThrow();
  expect(() => assertAppMarkup("<head></head>", identity)).toThrow();
  expect(() => assertAppMarkup(tags + tags, identity)).toThrow();
  expect(() => assertAppMarkup(tags, { ...identity, commit: "0".repeat(40) })).toThrow();
  expect(() => renderAppMetaTags({ ...identity, commit: '<script>' })).toThrow();
});

function builtApplication() {
  const root = repository();
  mkdirSync(join(root, "dist"));
  mkdirSync(join(root, ".generated/functions-build"), { recursive: true });
  mkdirSync(join(root, "public"));
  for (const name of ["_headers", "_routes.json"]) {
    cpSync(new URL(`../public/${name}`, import.meta.url), join(root, `public/${name}`));
    cpSync(join(root, `public/${name}`), join(root, `dist/${name}`));
  }
  const identity = createAppIdentity(root);
  writeFileSync(join(root, "dist/index.html"), `<head>${renderAppMetaTags(identity)}</head>`);
  writeFileSync(join(root, "dist/app-build.json"), JSON.stringify(identity));
  writeFileSync(join(root, ".generated/functions-build/index.js"), "export default {};\n");
  return root;
}
function verifyBuild(root: string, check = false) {
  return execFileSync(process.execPath, [new URL("../scripts/verify-app-build.mjs", import.meta.url).pathname, ...(check ? ["--check"] : [])], {
    cwd: root, stdio: "pipe",
  });
}

test("release verifies the existing CI manifest without rebuilding or rewriting it", () => {
  const root = builtApplication();
  verifyBuild(root);
  const manifest = readFileSync(join(root, ".generated/app-artifact.json"));
  expect(() => verifyBuild(root, true)).not.toThrow();
  expect(readFileSync(join(root, ".generated/app-artifact.json"))).toEqual(manifest);
});

test.each(["frontend", "worker", "extra file", "missing file", "source", "manifest identity"])(
  "release rejects changed %s and preserves the CI manifest",
  (change) => {
    const root = builtApplication();
    verifyBuild(root);
    if (change === "frontend") writeFileSync(join(root, "dist/index.html"), readFileSync(join(root, "dist/index.html"), "utf8") + "tampered");
    if (change === "worker") writeFileSync(join(root, ".generated/functions-build/index.js"), "unverified worker");
    if (change === "extra file") writeFileSync(join(root, "dist/unverified.js"), "extra script");
    if (change === "missing file") rmSync(join(root, ".generated/functions-build/index.js"));
    if (change === "source") writeFileSync(join(root, "app.ts"), "changed source");
    const path = join(root, ".generated/app-artifact.json");
    if (change === "manifest identity") {
      const artifact = JSON.parse(readFileSync(path, "utf8"));
      artifact.commit = "0".repeat(40);
      writeFileSync(path, JSON.stringify(artifact));
    }
    const manifest = readFileSync(path);
    expect(() => verifyBuild(root, true)).toThrow();
    expect(readFileSync(path)).toEqual(manifest);
  },
);
