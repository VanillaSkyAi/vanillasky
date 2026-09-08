import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? sourceFiles(path)
      : [".ts", ".tsx"].includes(extname(path)) ? [path] : [];
  });
}

describe("standalone package boundary", () => {
  it("does not ship private app, database, skill, or editor implementation residue", () => {
    const forbidden = [
      "studio",
      "db owns",
      "shared_configs",
      "the skill",
      "trigger.dev",
      "savedconfigid",
      "exported_at",
      "chatid?:",
    ];
    const files = [
      ...sourceFiles(join(process.cwd(), "src")),
    ];
    const hits = files.flatMap((path) => {
      const source = readFileSync(path, "utf8").toLowerCase();
      return forbidden.filter((marker) => source.includes(marker)).map((marker) => ({ path, marker }));
    });
    expect(hits).toEqual([]);
  });

  it("contains no VanillaSky service, Supabase, or private-app import dependency", () => {
    const banned = [
      ["vanillasky", ".ai"].join(""),
      ["supa", "base"].join(""),
      ["VITE", "_"].join(""),
      ["@", "/"].join(""),
      ["/Users", "/example-builder"].join(""),
    ];
    const hits = sourceFiles(join(process.cwd(), "src")).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return banned.filter((marker) => source.includes(marker)).map((marker) => ({ path, marker }));
    });
    const manifest = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));

    expect(hits).toEqual([]);
    expect(Object.keys(manifest.dependencies ?? {})).toEqual([]);
    expect(manifest.peerDependencies).not.toHaveProperty("tsx");
  });

  it("packages the focused SDK and executable", async () => {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));

    expect(manifest.bin).toEqual({ vanillasky: "bin/vanillasky.js" });
    expect(manifest.files).toContain("bin");
    expect(manifest.files).not.toContain("registry/items");
    expect(manifest.files).not.toContain("registry");
    expect(Object.keys(manifest.exports).sort()).toEqual([
      ".",
      "./react",
      "./server",
      "./test",
      "./video-chat.css",
    ]);
  });
});
