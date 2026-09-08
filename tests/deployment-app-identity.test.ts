import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
