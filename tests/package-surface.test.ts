import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("public package surface", () => {
  it("stays on a pre-1.0 version while the API is beta", () => {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

    expect(manifest.version).toMatch(/^0\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  });

  it("installs no runtime dependencies", () => {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

    expect(manifest.dependencies ?? {}).toEqual({});
    expect(manifest.peerDependenciesMeta.react.optional).toBe(true);
    expect(manifest.peerDependenciesMeta["react-dom"].optional).toBe(true);
    expect(manifest.peerDependenciesMeta.tsx.optional).toBe(true);
  });

  it("publishes only the supported entry points", () => {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const architecture = readFileSync(join(root, "docs/architecture.md"), "utf8");

    expect(Object.keys(manifest.exports).sort()).toEqual([
      ".",
      "./react",
      "./server",
      "./templates",
      "./templates/catalog",
      "./test",
      "./video-chat.css",
    ]);
    expect(manifest.exports["./video-chat.css"]).toBe("./styles/video-chat.css");
    expect(manifest.files).toContain("styles/video-chat.css");
    expect(manifest.files).toContain("starters/video-chat/src/main.tsx");
    expect(manifest.files).not.toContain("starters/video-chat/vanillasky");
    expect(manifest.sideEffects).toEqual(["./styles/video-chat.css", "./styles/fonts/roboto.css"]);
    expect(manifest.bin).toEqual({ vanillasky: "bin/vanillasky.js" });
    expect(architecture).toContain("`vanillasky init`, `doctor`, and `providers add`, plus `vanillasky templates create`, `add`, `sync`, `check`, `list`, and `describe`");
    expect(architecture).toContain("six small code entry points and one scoped stylesheet");
  });

  it("does not advertise install-time build scripts in the published manifest", () => {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

    expect(manifest.scripts.prepack).toBe("npm run build");
    expect(manifest.scripts).not.toHaveProperty("prepare");
    expect(manifest.scripts).not.toHaveProperty("verify:github-install");
    expect(existsSync(join(root, "scripts/verify-github-install.mjs"))).toBe(false);
  });

  it("does not ship the removed bundled-audio payload or obsolete entry modules", () => {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

    expect(manifest.files).not.toContain("audio");
    expect(existsSync(join(root, "audio"))).toBe(false);
    expect(existsSync(join(root, "src/audio"))).toBe(false);
    for (const path of [
      "src/acceptance.ts",
      "src/config.ts",
      "src/host.ts",
      "src/server-node.ts",
      "src/template-authoring.ts",
    ]) {
      expect(existsSync(join(root, path)), path).toBe(false);
    }
  });

  it("keeps repository-only files out of the published package", () => {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

    for (const repositoryOnly of [
      "AGENTS.md",
      "CLAUDE.md",
      "CODE_OF_CONDUCT.md",
      "CONTRIBUTING.md",
      "docs/maintainers",
    ]) {
      expect(manifest.files, repositoryOnly).not.toContain(repositoryOnly);
    }
    expect(manifest.files.filter((entry: string) => entry.startsWith("docs/maintainers/"))).toEqual([]);
  });
});
