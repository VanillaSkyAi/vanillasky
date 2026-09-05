import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("public package surface", () => {
  it("labels the package as a beta voice-and-video chat SDK", () => {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const readme = readFileSync(join(root, "README.md"), "utf8");

    expect(manifest.version).toMatch(/^0\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
    expect(manifest.description).toMatch(/voice-and-video chat SDK/i);
    expect(manifest.keywords).toEqual(expect.arrayContaining(["video-chat", "voice-chat"]));
    expect(manifest.keywords).not.toEqual(expect.arrayContaining(["personalized-video", "contextual-ai"]));
    expect(readme).toMatch(/Status: Beta/);
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

  it("keeps the website in its standalone repository and ships documentation only", () => {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const workflow = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
    const releasing = readFileSync(join(root, "docs/maintainers/releasing.md"), "utf8");
    const addingTemplate = readFileSync(join(root, "docs/maintainers/adding-template.md"), "utf8");
    const contributing = readFileSync(join(root, "CONTRIBUTING.md"), "utf8");
    const eslintConfig = readFileSync(join(root, "eslint.config.js"), "utf8");
    const gitignore = readFileSync(join(root, ".gitignore"), "utf8");

    expect(existsSync(join(root, "site"))).toBe(false);
    expect(existsSync(join(root, "wrangler.toml"))).toBe(false);
    expect(Object.keys(manifest.scripts).filter((name) => name.startsWith("site:"))).toEqual([]);
    expect(manifest.scripts["release:build"]).not.toContain("site:");
    for (const maintainerFile of [
      "docs/maintainers/acceptance.md",
      "AGENTS.md",
      "CLAUDE.md",
      "docs/maintainers/releasing.md",
      "llms.txt",
    ]) {
      expect(manifest.files).not.toContain(maintainerFile);
    }
    expect(existsSync(join(root, "llms.txt"))).toBe(false);
    expect(workflow).not.toMatch(/site:(?:install|build)/);
    expect(eslintConfig).not.toContain("site/");
    expect(gitignore).not.toContain("site/");
    expect(existsSync(join(root, "docs/studio-handoff.md"))).toBe(false);
    expect(releasing).toContain("vanillasky.ai adopts stable npm releases separately");
    expect(releasing).not.toContain("VanillaSkyAi/vanillasky-site");
    expect(releasing).not.toContain("verify:sdk-latest");
    expect(addingTemplate).toContain("site-owned process");
    expect(contributing).toContain("site-owned adoption process");
    expect(contributing).not.toContain("required website handoff");
    for (const privateSiteDetail of [
      "`vanillasky-site`",
      "VANILLASKY_SDK_SOURCE",
      "verify:sdk-latest",
      "sync:docs",
      "public/template-thumbnails",
    ]) {
      expect(addingTemplate).not.toContain(privateSiteDetail);
    }
  });
});
