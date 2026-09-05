import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("final candidate feedback regressions", () => {
  it("ships one chat-first starter configuration owned by the package", () => {
    const manifest = JSON.parse(read("package.json")) as { files: string[] };
    const environment = read("starters/video-chat/.env.example");

    expect(manifest.files).toContain("starters/video-chat/.env.example");
    expect(manifest.files).toContain("starters/video-chat/server.ts");
    expect(manifest.files).toContain("starters/video-chat/src/main.tsx");
    expect(manifest.files).not.toContain("examples/nextjs-quickstart");
    expect(environment).toContain("ANTHROPIC_API_KEY=");
    expect(environment).toContain("XAI_API_KEY=");
    expect(environment).toContain("FAL_KEY=");
    expect(environment).toContain("PEXELS_API_KEY=");
  });

  it("links one generated chat path without embedding a release version", () => {
    for (const path of ["README.md", "docs/getting-started.md", "docs/provider-integration.md"]) {
      expect(read(path), path).toContain("npx @vanillaskyai/video init");
      expect(read(path), path).not.toMatch(/\/tree\/v\d/);
      expect(read(path), path).not.toMatch(/examples\/(?:react-vite|nextjs-quickstart|server-integrations)/);
    }
  });

  it("keeps server prompt construction out of browser and test entry graphs", () => {
    const browserCatalog = read("src/visual-system/catalog/builtin-player.ts");
    const testCatalog = read("src/visual-system/catalog/builtin-server.ts");
    const serverCatalog = read("src/visual-system/catalog/catalog.ts");
    const composer = read("src/server/compose-video.ts");
    const simulator = read("src/test/simulate-video-stream.ts");

    expect(browserCatalog).toContain('from "./builtin-player.generated.js"');
    expect(browserCatalog).not.toContain('from "./builtin-metadata.js"');
    expect(browserCatalog).not.toContain('from "./catalog.js"');
    expect(browserCatalog).not.toContain('from "./prompt.js"');
    expect(testCatalog).toContain('from "./builtin-metadata.js"');
    expect(testCatalog).not.toContain('from "./catalog.js"');
    expect(serverCatalog).toContain('from "./builtin-metadata.js"');
    expect(serverCatalog).toContain('from "./prompt.js"');
    expect(composer).not.toContain('import { DEFAULT_VIDEO_SYSTEM_PROMPT } from "./prompts/system-prompt.js"');
    expect(composer).toContain('await import("./prompts/system-prompt.js")');
    expect(simulator).not.toMatch(/^import \{ createVideo \}/m);
    expect(simulator).not.toMatch(/^import \{ createTextDeltaVideoPlanner \}/m);
    expect(simulator).not.toMatch(/^import \{ BUILTIN_SERVER_TEMPLATE_KIT \}/m);
    expect(simulator).toContain('await import("../server/compose-video.js")');
    expect(simulator).toContain('await import("../visual-system/catalog/builtin-server.js")');
  });

  it("documents the optional compiler only for source-owned templates", () => {
    const loader = read("src/cli/project-templates.ts");

    for (const path of ["README.md", "docs/customization.md", "docs/custom-templates.md"]) {
      const guide = read(path);
      expect(guide, path).toContain("npm install --save-dev tsx");
      expect(guide, path).toMatch(/only.*source-owned template|source-owned templates.*only/is);
    }
    expect(loader).not.toContain("const resolvedTsxLoader =");
    expect(loader).toContain("resolveProjectTsxRuntime");
  });

  it("states that max duration is a ceiling and encoded video export is app-owned", () => {
    const concepts = read("docs/concepts.md");
    const protocol = read("docs/reference/protocol.md");
    const readme = read("README.md");

    expect(protocol).toMatch(/maxDurationSec.*ceiling/is);
    expect(protocol).toMatch(/may complete.*below.*ceiling/is);
    expect(concepts).toMatch(/does not (?:include|provide).*MP4|MP4.*not included/is);
    expect(readme).toMatch(/MP4.*application-owned|application-owned.*MP4/is);
  });
});
