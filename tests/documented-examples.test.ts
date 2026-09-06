import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const rootPackage = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  version: string;
  scripts: Record<string, string>;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

describe("documented examples", () => {
  it("keeps first command provider-neutral and public guides free of stale release or model defaults", () => {
    const publicFiles = [
      "README.md",
      "docs/getting-started.md",
      "docs/provider-integration.md",
      "docs/custom-templates.md",
      "starters/video-chat/README.md",
      "starters/video-chat/.env.example",
      "starters/video-chat/server.ts",
    ].map((path) => [path, readFileSync(resolve(root, path), "utf8")] as const);
    const readme = publicFiles[0][1];

    expect(readme).toContain("npx @vanillaskyai/video init");
    expect(readme).not.toMatch(/shields\.io|!\[[^\]]*version[^\]]*\]/i);
    expect(readme).not.toMatch(/npm install @vanillaskyai\/video[^\n]*(?:\bai\b|@ai-sdk)/);
    for (const [path, contents] of publicFiles) {
      expect(contents, path).not.toContain("@vanillaskyai/video@0.4.1");
      expect(contents, path).not.toContain("tree/v0.4.1");
      expect(contents, path).not.toContain("gpt-4.1");
    }
  });

  it("gives coding agents one concise public integration path and keeps evaluation guidance maintainer-only", () => {
    const guidePath = resolve(root, "docs/agent-integration.md");
    const evaluationPath = resolve(root, "docs/maintainers/cold-start-evaluation.md");
    const readme = readFileSync(resolve(root, "README.md"), "utf8");
    const agentInstructions = readFileSync(resolve(root, "AGENTS.md"), "utf8");

    expect(existsSync(guidePath)).toBe(true);
    expect(existsSync(evaluationPath)).toBe(true);
    const guide = readFileSync(guidePath, "utf8");
    const evaluation = readFileSync(evaluationPath, "utf8");
    expect(guide).toContain("## Set up the canonical chat");
    expect(guide).toContain("npx @vanillaskyai/video init");
    expect(guide).toContain("npx vanillasky doctor");
    expect(guide).toContain("npm run dev");
    expect(guide).toContain("Never read or print a secret value");
    expect(guide).toContain(".env.local");
    expect(guide).not.toMatch(/createVideoHandler|useVideo\(|<VideoPlayer/);
    expect(guide).not.toMatch(/101 demo|proof of concept|cold-start evaluation/i);
    expect(evaluation).toContain("Do not inspect SDK source");
    expect(evaluation).toContain("npm pack --silent --json");
    expect(readme).toContain("[Agent integration guide](docs/agent-integration.md)");
    expect(agentInstructions).toContain("docs/agent-integration.md");
  });

  it("makes video chat the one primary onboarding path", () => {
    const paths = ["README.md", "docs/getting-started.md", "docs/agent-integration.md"];
    for (const path of paths) {
      const guide = readFileSync(resolve(root, path), "utf8");
      expect(guide, path).toContain("npx @vanillaskyai/video init");
      expect(guide, path).not.toContain("npx vanillasky init");
      expect(guide, path).toContain("npx vanillasky doctor");
      expect(guide, path).toContain("npm run dev");
      expect(guide, path).toMatch(/(?:templates|introduction).*browser voice/is);
      expect(guide, path).not.toMatch(/\btutor|\blearner|\blesson|\beducation/i);
    }

    const gettingStarted = readFileSync(resolve(root, "docs/getting-started.md"), "utf8");
    expect(gettingStarted).toContain("<VideoChat />");
    expect(gettingStarted).not.toMatch(/createVideoHandler|useVideo\(|<VideoPlayer/);
    const providerGuide = readFileSync(resolve(root, "docs/provider-integration.md"), "utf8");
    expect(providerGuide.indexOf("npx @vanillaskyai/video init")).toBeLessThan(providerGuide.indexOf("createVideoChatHandler"));

    for (const path of ["README.md", "docs/getting-started.md", "docs/provider-integration.md"]) {
      const guide = readFileSync(resolve(root, path), "utf8");
      expect(guide, path).not.toMatch(/createVideoHandler|useVideo\(|<VideoPlayer/);
    }
  });

  it("separates low-level soundtrack audio from VideoChat narration", () => {
    const guide = readFileSync(resolve(root, "docs/media-and-audio.md"), "utf8");

    expect(guide).toContain("soundtrack");
    expect(guide).toContain("VideoChat");
    expect(guide).toMatch(/narration.*speech synchronization/is);
    expect(guide).not.toContain("SDK does not provide narration");
  });

  it("documents app-owned stock and generated-video callbacks without adding providers to the core install", () => {
    const guide = readFileSync(resolve(root, "docs/media-and-audio.md"), "utf8");

    expect(guide).toContain("searchMedia");
    expect(guide).toContain("generateVideo");
    expect(guide).toContain('mode: "cinematic"');
    expect(guide).toContain('mode: "pexels"');
    expect(guide).toContain("Each mode uses only its selected media provider");
    expect(guide).toContain("authored chapter with complete narration");
    expect(guide).toMatch(/retains.*narration.*subtitles/is);
    expect(guide).toMatch(/maxRetries:\s*0/);
    // Generation must stay app-owned: neither a runtime nor a peer requirement.
    const coreInstall = { ...rootPackage.dependencies, ...rootPackage.peerDependencies };
    expect(coreInstall).not.toHaveProperty("ai");
    expect(coreInstall).not.toHaveProperty("@ai-sdk/fal");
  });

  it("documents Vitest, route-handler, fake-timer, abort, and timeout testing", () => {
    const guide = readFileSync(new URL("../docs/testing.md", import.meta.url), "utf8");
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

    expect(guide).toContain('from "@vanillaskyai/video/test"');
    expect(guide).toContain("createMockVideoPlanner");
    expect(guide).toContain("simulateVideoStream");
    expect(guide).toContain("vi.useFakeTimers()");
    expect(guide).toContain("createVideoChatHandler");
    expect(guide).toContain("new Request");
    expect(guide).toContain("AbortController");
    expect(guide).toContain("timeoutMs");
    expect(readme).toContain("[Test integrations](docs/testing.md)");
  });

  it("documents which catalog commands execute trusted application code", () => {
    const security = readFileSync(new URL("../docs/security.md", import.meta.url), "utf8");
    expect(security).toContain("trusted application build code");
    expect(security).toMatch(/`vanillasky templates list`[\s\S]*`vanillasky templates describe`/);
    expect(security).toMatch(/`vanillasky templates add`[\s\S]*`--dry-run`[\s\S]*`--diff`/);
    expect(security).toMatch(/`vanillasky templates sync`[\s\S]*`vanillasky templates check`/);
    expect(security).toContain("--builtin");
    expect(security).toContain("does not execute project template modules");
  });

  it("documents that add previews include generated browser and server registries", () => {
    const guide = readFileSync(new URL("../docs/custom-templates.md", import.meta.url), "utf8");

    expect(guide).toMatch(/`--dry-run`[\s\S]*`--diff`[\s\S]*browser and server registries/);
    expect(guide).toMatch(/does not apply\s+any proposed file write/);
    expect(guide).toContain("trusted project source can have its own side effects");
    expect(guide).not.toContain("leave the project byte-identical");
  });

  it("strictly compiles the exact transition semantic value example", () => {
    const guide = readFileSync(resolve(root, "docs/custom-templates.md"), "utf8");
    const source = guide.match(
      /<!-- verify:transition-semantic-value:start -->\s*```tsx\r?\n([\s\S]*?)\r?\n```\s*<!-- verify:transition-semantic-value:end -->/,
    )?.[1];
    expect(source).toBeTruthy();

    const workspace = mkdtempSync(resolve(root, ".transition-semantic-doc-"));
    try {
      writeFileSync(resolve(workspace, "example.tsx"), source!);
      writeFileSync(resolve(workspace, "tsconfig.json"), JSON.stringify({
        compilerOptions: {
          strict: true,
          noUnusedLocals: true,
          noUnusedParameters: true,
          noEmit: true,
          target: "ES2022",
          lib: ["ES2022", "DOM", "DOM.Iterable"],
          module: "ESNext",
          moduleResolution: "Bundler",
          jsx: "react-jsx",
          skipLibCheck: false,
          isolatedModules: true,
        },
        include: ["example.tsx"],
      }));
      execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", "tsconfig.json"], {
        cwd: workspace,
        stdio: "inherit",
      });
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  }, 15_000);
  it("pins the generated video-chat starter to the repository's current protocol version", () => {
    const starter = JSON.parse(readFileSync(resolve(root, "starters/video-chat/package.json"), "utf8"));
    expect(starter.dependencies["@vanillaskyai/video"]).toBe(rootPackage.version);
  });

  it("keeps one generated public starter and an internal Next.js chat fixture", () => {
    expect(existsSync(resolve(root, "starters/video-chat/server.ts"))).toBe(true);
    expect(existsSync(resolve(root, "tests/fixtures/nextjs-provider-app/src/app/api/video-chat/route.ts"))).toBe(true);
    expect(existsSync(resolve(root, "tests/fixtures/nextjs-provider-app/src/app/page.tsx"))).toBe(true);
    expect(rootPackage.scripts["examples:verify-documented"]).toBeUndefined();
    expect(rootPackage.scripts["examples:install-current"]).toBeUndefined();
    expect(rootPackage.scripts["server-examples:typecheck"]).toBeUndefined();
    expect(rootPackage.scripts["verify:nextjs"]).toBe(
      "node scripts/verify-nextjs-onboarding.mjs",
    );
  });

  it("runs the canonical onboarding against the unpublished packed candidate", () => {
    const onboarding = readFileSync(resolve(root, "scripts/verify-onboarding.mjs"), "utf8");
    expect(onboarding).toContain('"pack", "--silent", "--json"');
    expect(onboarding).toContain("installSpec = candidateArtifact.path");
    expect(onboarding).toContain('runCapture("npx", ["--yes", "--package", installSpec, "vanillasky", "init"], app)');
    expect(onboarding).toContain('initialization.output.includes("MISSING  ANTHROPIC_API_KEY")');
    expect(onboarding).toContain('initialization.output.includes("READY    templates + browser voice")');
    expect(onboarding.indexOf('runCapture("npx", ["--yes", "--package", installSpec, "vanillasky", "init"], app)'))
      .toBeLessThan(onboarding.indexOf('const repeatedInit = runCli(["init"])'));
    expect(onboarding).toContain("Repeated init failed to repair installation while preserving environment and providers");
    expect(onboarding).toContain('responds in video, not text');
  });
});
