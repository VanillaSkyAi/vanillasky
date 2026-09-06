import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const textExtensions = new Set([".js", ".json", ".md", ".mjs", ".ts", ".tsx", ".yaml", ".yml"]);

function trackedTextFiles(): string[] {
  return execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter(Boolean)
    .filter((path) => existsSync(join(root, path)))
    .filter((path) => path !== "tests/candidate-cleanup.test.ts")
    .filter((path) => textExtensions.has(extname(path)) || [
      "AGENTS.md",
      "CHANGELOG.md",
      "CLAUDE.md",
      "CONTRIBUTING.md",
      "PUBLIC-API.md",
      "README.md",
      "SECURITY.md",
      "SUPPORT.md",
    ].includes(path));
}

function sourceHits(markers: readonly string[]) {
  return trackedTextFiles().flatMap((path) => {
    const source = readFileSync(join(root, path), "utf8");
    return markers
      .filter((marker) => source.includes(marker))
      .map((marker) => ({ path, marker }));
  });
}

function unapprovedSourceHits(markers: readonly string[]) {
  const intentionalCutoverWarnings = new Set([
    "tests/release-workflow.test.ts\0vanillasky-sdk",
    "tests/release-workflow.test.ts\0historical",
    // Contract removal documentation and factual-media guidance are deliberate prose.
    "docs/maintainers/cinematic-migration.md\0legacy",
    "docs/maintainers/cinematic-migration.md\0historical",
    "src/server/video-chat-prompts.ts\0historical",
  ]);
  return sourceHits(markers).filter(({ path, marker }) => !intentionalCutoverWarnings.has(`${path}\0${marker}`));
}

describe("fresh 0.1 candidate cleanup", () => {
  it("uses one new package, repository, and toolchain identity", () => {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

    expect(manifest.name).toBe("@vanillaskyai/video");
    expect(manifest.version).toMatch(/^0\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
    expect(manifest.packageManager).toBe("npm@11.17.0");
    expect(manifest.repository).toEqual({
      type: "git",
      url: "git+https://github.com/VanillaSkyAi/video.git",
    });
    expect(manifest.bugs).toEqual({ url: "https://github.com/VanillaSkyAi/video/issues" });
    expect(manifest.homepage).toBe("https://vanillasky.ai");
  });

  it("contains no old package, repository, or release identity", () => {
    const oldPackage = ["@vanillaskyai", "sdk"].join("/");
    const oldRepository = ["vanillasky", "sdk"].join("-");
    const oldVersion = ["0", "6", "2"].join(".");

    expect(unapprovedSourceHits([oldPackage, oldRepository, oldVersion])).toEqual([]);
  });

  it("contains no bootstrap publishing token path after trusted publishing is configured", () => {
    expect(sourceHits(["NPM_BOOTSTRAP_TOKEN"])).toEqual([]);
  });

  it("deletes pre-launch compatibility aliases and stale internal names", () => {
    const markers = [
      ["bar", "Values"].join(""),
      ["display", "Description"].join(""),
      ["checksumVideo", "Config"].join(""),
      ["Motion", "Response"].join(""),
      ["backward", " compatibility"].join(""),
      ["existing", " callers"].join(""),
      ["leg", "acy"].join(""),
      ["histor", "ical"].join(""),
    ];

    expect(unapprovedSourceHits(markers)).toEqual([]);
  });

  it("removes abandoned experiments and unused onboarding code", () => {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const firstShotSource = readFileSync(join(root, "src/video-chat/first-shot.ts"), "utf8");

    expect(existsSync(join(root, "examples/rich-media-poc"))).toBe(false);
    expect(manifest.devDependencies).not.toHaveProperty("mdast-util-from-markdown");
    expect(firstShotSource).not.toContain("sanitizeVideoChatFirstShot");
  });

  it("keeps one chat-first example path and no one-shot product guides", () => {
    const obsoletePaths = [
      "examples/react-vite",
      "examples/nextjs-quickstart",
      "examples/server-integrations",
      "docs/use-cases.md",
      "docs/live-channels.md",
      "docs/integrate-nextjs.md",
      "docs/input-and-first-scene.md",
    ];

    for (const path of obsoletePaths) {
      expect(existsSync(join(root, path)), path).toBe(false);
    }

    const providerRoute = readFileSync(
      join(root, "tests/fixtures/nextjs-provider-app/src/app/api/video-chat/route.ts"),
      "utf8",
    );
    const providerClient = readFileSync(
      join(root, "tests/fixtures/nextjs-provider-app/src/app/page.tsx"),
      "utf8",
    );
    expect(providerRoute).toContain("createVideoChatHandler");
    expect(providerRoute).not.toContain("createVideoHandler");
    expect(providerClient).toContain("<VideoChat");
    expect(providerClient).not.toMatch(/useVideo\(|<VideoPlayer/);
  });

  it("ships the reviewed docs and examples with only intentional runtime dependencies", () => {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

    expect(manifest.files).toEqual(expect.arrayContaining([
      "PUBLIC-API.md",
      "SUPPORT.md",
      "registry/items",
      "examples/custom-template",
      "starters/video-chat/.env.example",
      "starters/video-chat/README.md",
      "starters/video-chat/package.json",
      "starters/video-chat/server.ts",
      "starters/video-chat/src/main.tsx",
    ]));
    expect(manifest.files).not.toContain("registry");
    expect(manifest.files).not.toContain("examples/nextjs-quickstart");
    expect(manifest.files).not.toContain("CONTRIBUTING.md");
    expect(manifest.dependencies ?? {}).toEqual({});
    expect(manifest.devDependencies).toHaveProperty("tsx", "^4.23.12");
    expect(manifest.peerDependencies).toEqual({
      react: ">=18 <20",
      "react-dom": ">=18 <20",
      tsx: ">=4.19 <5",
    });
    expect(manifest.peerDependenciesMeta).toEqual({
      react: { optional: true },
      "react-dom": { optional: true },
      tsx: { optional: true },
    });
    expect(existsSync(join(root, "SUPPORT.md"))).toBe(true);
  });

  it("keeps the source-registry guide repository-only", () => {
    expect(existsSync(join(root, "registry", "README.md"))).toBe(false);
    expect(existsSync(join(root, "docs", "maintainers", "registry.md"))).toBe(true);

    const guide = readFileSync(join(root, "docs", "maintainers", "registry.md"), "utf8");
    expect(guide).toContain("../../src/visual-system");
    expect(guide).toContain("npm run registry:sync");
    expect(guide).toContain("npm run registry:check");
  });

  it("keeps an Unreleased queue above the current beta release", () => {
    const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const releaseHeadings = [...changelog.matchAll(/^##\s+([^\s]+)$/gm)].map((match) => match[1]);

    expect(releaseHeadings[0]).toBe("Unreleased");
    expect(releaseHeadings).toContain(manifest.version);
    expect(changelog).toMatch(/beta/i);
  });

  it("documents issue support without a response-time SLA", () => {
    const support = readFileSync(join(root, "SUPPORT.md"), "utf8");
    const security = readFileSync(join(root, "SECURITY.md"), "utf8");

    expect(support).toMatch(/GitHub issue/i);
    expect(support).toMatch(/no guaranteed response time/i);
    expect(security).toMatch(/private vulnerability reporting/i);
    expect(security).not.toMatch(/business days|response-time SLA/i);
  });

});
