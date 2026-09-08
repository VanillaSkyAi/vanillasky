import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The architecture guide is the first file a new reader opens. A path in it
// that no longer exists costs more than no guide at all, so the paths are
// checked against the filesystem. Nothing here asserts prose.

const root = process.cwd();
const repositoryPath = /`((?:src|registry|scripts|tests|docs|styles|dev|examples)\/[A-Za-z0-9._/-]+)`/g;

describe("architecture guide", () => {
  it("names only paths that exist", async () => {
    const guide = await readFile(join(root, "docs/architecture.md"), "utf8");
    const paths = [...new Set([...guide.matchAll(repositoryPath)].map((match) => match[1]))];

    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(existsSync(join(root, path)), `docs/architecture.md names ${path}`).toBe(true);
    }
  });


});
