import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function createAppIdentity(root = process.cwd()) {
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("Application build requires a Git commit");
  const paths = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: root, encoding: "utf8",
  }).split("\0").filter(Boolean).sort();
  const hash = createHash("sha256");
  for (const path of paths) {
    hash.update(`${path}\0`);
    hash.update(existsSync(resolve(root, path)) ? readFileSync(resolve(root, path)) : "deleted");
    hash.update("\0");
  }
  return { commit, sourceSha256: hash.digest("hex") };
}

export function assertAppIdentity(identity) {
  if (!/^[a-f0-9]{40}$/.test(identity?.commit) || !/^[a-f0-9]{64}$/.test(identity?.sourceSha256)) {
    throw new Error("Invalid application build identity");
  }
  return identity;
}

export function renderAppMetaTags(identity) {
  assertAppIdentity(identity);
  return `<meta name="build-sha" content="${identity.commit}" /><meta name="app-source-sha256" content="${identity.sourceSha256}" />`;
}

export function assertAppMarkup(markup, expected) {
  assertAppIdentity(expected);
  for (const [name, value] of [["build-sha", expected.commit], ["app-source-sha256", expected.sourceSha256]]) {
    const tags = [...markup.matchAll(/<meta\b[^>]*>/gi)].map(([tag]) => tag)
      .filter((tag) => tag.match(/\bname=["']([^"']+)["']/)?.[1] === name);
    if (tags.length !== 1 || tags[0].match(/\bcontent=["']([^"']+)["']/)?.[1] !== value) {
      throw new Error(`Application ${name} does not match the verified build`);
    }
  }
}
