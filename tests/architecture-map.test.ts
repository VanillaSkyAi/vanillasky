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

    expect(paths.length).toBeGreaterThan(10);
    for (const path of paths) {
      expect(existsSync(join(root, path)), `docs/architecture.md names ${path}`).toBe(true);
    }
  });

  it("lists every visual-system directory", async () => {
    const guide = await readFile(join(root, "docs/architecture.md"), "utf8");
    const { readdir } = await import("node:fs/promises");
    const directories = (await readdir(join(root, "src/visual-system"), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => `src/visual-system/${entry.name}/`);

    for (const directory of directories) {
      expect(guide, `docs/architecture.md omits ${directory}`).toContain(directory);
    }
  });

  it("keeps the reading path pointing at real files", async () => {
    const guide = await readFile(join(root, "docs/architecture.md"), "utf8");
    const startHere = guide.split("## Start here")[1]?.split("## Repository map")[0] ?? "";

    const files = [...new Set([...startHere.matchAll(repositoryPath)].map((match) => match[1]))];
    expect(files.length).toBeGreaterThanOrEqual(6);
    for (const file of files) {
      expect(existsSync(join(root, file)), `reading path names ${file}`).toBe(true);
    }
  });
});
