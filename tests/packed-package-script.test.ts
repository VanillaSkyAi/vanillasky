import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

describe("packed package verification", () => {
  it("proves the exact packed persistence contract in Node and saved-browser consumers", () => {
    const script = readFileSync(new URL("../scripts/verify-packed-package.mjs", import.meta.url), "utf8");

    expect(script).toContain('join(serverConsumer, "root.mjs")');
    expect(script).toContain("VideoValidationError,getSceneDuration,getSceneDurationBounds,getSpokenDuration,getVideoDuration,parseVideo");
    expect(script).toContain('schemaVersion: "0.2"');
    expect(script).toContain("Packed response omitted its checksum");
    expect(script).toContain("Packed terminal snapshot lost its completed scene");
    expect(script).toContain('pathname === "/api/video"');
    expect(script).toContain("generationRequests !== 0");
    expect(script).toContain("selectedArtifact.integrity");
    expect(script).toContain('join(packageRoot, "docs", "persistence.md")');
    expect(script).toContain('join(consumer, "persistence-example.tsx")');
  });

  it("rejects the immutable old persisted fixture through the packed parser", () => {
    const script = readFileSync(new URL("../scripts/verify-packed-package.mjs", import.meta.url), "utf8");
    const fixture = readFileSync(new URL("fixtures/persisted-video-0.1.0.json", import.meta.url));

    expect(script).toContain('"fixtures", "persisted-video-0.1.0.json"');
    expect(script).toContain("VANILLASKY_PERSISTED_VIDEO_FIXTURE");
    expect(script).toContain("parseVideo(JSON.parse(process.env.VANILLASKY_PERSISTED_VIDEO_FIXTURE))");
    expect(script).toContain("PERSISTED_VIDEO_0_1_0_SHA256");
    expect(createHash("sha256").update(fixture).digest("hex"))
      .toBe("eef80e45cd501c3f29a3636d0a0bb34c10da0bf19e205713cedec2bb709bafc4");
  });

  it("enters cleanup protection before reading fixtures or creating consumer directories", () => {
    const script = readFileSync(new URL("../scripts/verify-packed-package.mjs", import.meta.url), "utf8");
    const cleanupBoundary = script.indexOf("try {");

    expect(cleanupBoundary).toBeGreaterThanOrEqual(0);
    expect(cleanupBoundary).toBeLessThan(script.indexOf("const persistedVideoFixture = readFileSync"));
    expect(cleanupBoundary).toBeLessThan(script.indexOf("mkdirSync(consumer)"));
  });

  it("compiles the exact documented custom-template replay example", () => {
    const script = readFileSync(new URL("../scripts/verify-packed-package.mjs", import.meta.url), "utf8");
    const guide = readFileSync(new URL("../docs/custom-templates.md", import.meta.url), "utf8");

    expect(guide).toContain("<!-- verify:custom-template-preview:start -->");
    expect(guide).toContain('schemaVersion: "0.2"');
    expect(script).toContain('join(packageRoot, "docs", "custom-templates.md")');
    expect(script).toContain('join(consumer, "src", "custom-template-preview.tsx")');
    expect(guide).toContain("<!-- verify:transition-semantic-value:start -->");
    expect(guide).toContain('import type { CSSProperties } from "react"');
    expect(guide).toContain("displayValue !== finalValue");
    expect(guide).toContain('as CSSProperties["visibility"]');
    expect(script).toContain('join(consumer, "src", "transition-semantic-value.tsx")');
    expect(script).toContain("Packed custom-template guide omitted its compilable transition semantic example");
  });

  it("validates every Markdown file that actually ships in the tarball", () => {
    const script = readFileSync(new URL("../scripts/verify-packed-package.mjs", import.meta.url), "utf8");

    expect(script).toContain("verifyPackedMarkdownDocumentation");
    expect(script).toContain("{ packageRoot, repositoryRoot: root }");
    expect(script).not.toContain('const documentation = ["README.md", "SECURITY.md", "CHANGELOG.md"');
  });

  it("runs saved mixed-template playback and safe typed errors in a real consumer browser", () => {
    const script = readFileSync(new URL("../scripts/verify-packed-package.mjs", import.meta.url), "utf8");

    expect(script).toContain('from "playwright"');
    expect(script).toContain('[packedCli, "templates", "create", "customer-health"]');
    expect(script).toContain('data-template-id="minimal-text"');
    expect(script).toContain('data-template-id="keyFigure"');
    expect(script).toContain("new VideoError");
    expect(script).toContain("onPlaybackEnd");
    expect(script).toContain("Packed playback-end callback did not fire");
    expect(script).toContain("useVideoChat");
    expect(script).toContain("Packed video-chat hook did not initialize");
    expect(script).toContain('import "@vanillaskyai/video/video-chat.css"');
    expect(script).toContain("Packed VideoChat welcome did not render");
    expect(script).toContain("Packed VideoChat stylesheet did not apply");
    expect(script).toContain("Packed VideoChat stylesheet leaked into the host page");
    expect(script).toContain("Packed VideoChat increased-contrast glass drifted");
    expect(script).toContain("VideoChatProps");
    expect(script).toContain("provider secret");
    expect(script).toContain('from "@vanillaskyai/video/templates/catalog"');
    expect(script).toContain("builtinTemplates.length !== 7");
    expect(script).toContain("Packed template API accepted the removed duration alias");
    expect(script).toContain('"brand" in startEvent.data.style');
    expect(script).not.toContain("brandKit");
    expect(script).not.toContain("logoDataUrl");
    expect(script).toContain('"react@19.2.8"');
    expect(script).toContain('"react-dom@19.2.8"');
    expect(script).toContain("React 19 transition layer did not retain inert focus isolation");
    expect(script).toContain('hiddenLayer.evaluate((element) => element.hasAttribute("inert"))');
    expect(script).not.toContain('hiddenLayer.getAttribute("inert") !== "inert"');
    expect(script).toContain("React 19 undefined hard-cut motion progress diverged from raw progress");
    expect(script).toContain("React 19 unknown hard-cut motion progress diverged from raw progress");
    expect(script).toContain("React 19 isolated crossfade motion progress diverged from raw progress");
    expect(script).toContain("React 19 terminal poster did not settle at the readable hold frame");
    expect(script).toContain("React 19 transition players did not start synchronously");
    expect(script).toContain("await page.clock.pauseAt(Date.now() + 1_000)");
    expect(script).toContain("React 19 transition did not preserve the outgoing template timeline");
    expect(script).toContain("React 19 transition preview advanced the incoming template timeline");
    expect(script).toContain("incomingProgress.raw !== 0");
    expect(script).toContain("incomingProgress.motion !== 0");
    expect(script).toContain("React 19 shared background incorrectly crossfaded scene layers");
    expect(script).toContain("React 19 shared background did not preserve native template motion");
    expect(script).toContain("await page.clock.runFor(450)");
    expect(script).toContain("await page.clock.runFor(650)");
    expect(script).not.toContain("page.clock.fastForward");
    expect(script).toContain("React 19 settled final scene did not preserve the readable hold frame");
    expect(script).toContain("settledProgress.motion !== 0.7");
    expect(script).toContain("Math.abs(progress.raw - progress.motion)");
    expect(script).toContain("Packed transition exposed transient placeholder semantics");
    expect(script).toContain("--vanillasky-transition-semantic-visibility, visible");
    expect(script).not.toContain('getByRole("region", { name: label })');
    expect(script).not.toContain('incomingProgress.raw !== "0.083"');
    expect(script).not.toContain('progress.raw !== "0.650"');
  });

  it("compiles negative checks for every frozen removed public surface", () => {
    const script = readFileSync(new URL("../scripts/verify-packed-package.mjs", import.meta.url), "utf8");

    expect(script).toContain("VideoState is internal");
    expect(script).toContain("VideoPlayerBinding is internal");
    expect(script).toContain("UseVideoResult is no longer public");
    expect(script).toContain("VideoInput is no longer public");
    expect(script).toContain("chatHandlerOptions.replay");
    expect(script).toContain("chatHandlerOptions.onInvalidPart");
    expect(script).toContain("VideoPlanner is internal");
    expect(script).toContain("VideoPlanPart is internal");
    expect(script).toContain("VideoEvent is internal");
    expect(script).toContain("VideoGenerationContext is internal");
    expect(script).toContain("VideoState is internal to the test entry");
    expect(script).toContain("Undocumented Template alias is not part of 0.1");
    expect(script).toContain("Undocumented TemplateMetadata alias is not part of 0.1");
    expect(script).toContain("Undocumented TemplateProps alias is not part of 0.1");
    expect(script).toContain("AuthoringTemplate is inferred and internal");
    expect(script).toContain("TemplateFamily has one canonical home under templates");
    expect(script).toContain("TemplateTimingMetadata has one canonical home under templates");
    expect(script).toContain("Undocumented manifest-entry name is not part of 0.1");
    expect(script).toContain("TemplateTransitionTiming");
    expect(script).toContain("sceneProps.motionProgress");
  });

  it("installs and runs the exact packed test kit in the React-free NodeNext consumer", () => {
    const script = readFileSync(new URL("../scripts/verify-packed-package.mjs", import.meta.url), "utf8");

    expect(script).toContain('from "@vanillaskyai/video/test"');
    expect(script).toContain("createMockVideoPlanner");
    expect(script).toContain("simulateVideoStream");
    expect(script).toContain("videoFixtures");
    for (const scenario of [
      "success",
      "delayed",
      "truncated",
      "invalidScene",
      "providerFailure",
      "contentFilter",
      "abort",
      "timeout",
    ]) {
      expect(script).toContain(`scenarios.${scenario}`);
    }
    expect(script).toContain('"dist/test.js"');
    expect(script).toContain("Test kit packed consumer unexpectedly installed React");
  });

  it("proves the default packed playback install has no compiler closure", () => {
    const script = readFileSync(new URL("../scripts/verify-packed-package.mjs", import.meta.url), "utf8");

    expect(script).toContain('const playbackOnlyConsumer = join(workspace, "playback-only-consumer")');
    expect(script).toContain('join(playbackOnlyConsumer, "node_modules", "tsx")');
    expect(script).toContain('join(playbackOnlyConsumer, "node_modules", "esbuild")');
    expect(script).toContain("Default playback install unexpectedly included the optional template compiler");
  });

  it("runs template check from the packed CLI against customer-owned source", () => {
    const script = readFileSync(new URL("../scripts/verify-packed-package.mjs", import.meta.url), "utf8");

    expect(script).toContain("Created template: vanillasky/templates/customer-health.tsx");
    expect(script).toContain("Synced 1 template to vanillasky/index.ts and vanillasky/server.ts.");
    expect(script).toContain('"check"');
    expect(script).toContain("12 deterministic renders");
    expect(script).toContain("noUnusedLocals: true");
    expect(script).toContain('"vite", "bin", "vite.js"), "build"');
  });

  it("checks every unchanged built-in copied by the packed add-all command", () => {
    const script = readFileSync(new URL("../scripts/verify-packed-package.mjs", import.meta.url), "utf8");

    expect(script).toContain('[packedCli, "templates", "add", "--all"]');
    expect(script).toContain('[packedCli, "templates", "check"]');
    expect(script).toContain("Checked 7 templates, 7 examples, and 84 deterministic renders.");
  });

  it("copies, syncs, checks, strictly compiles, and previews the packaged custom references", () => {
    const script = readFileSync(new URL("../scripts/verify-packed-package.mjs", import.meta.url), "utf8");

    for (const file of ["minimal-text.tsx", "structured-data.tsx"]) {
      expect(script).toContain(file);
    }
    expect(script).toContain('join(packageRoot, "examples", "custom-template")');
    expect(script).toContain('[packedCli, "templates", "sync"]');
    expect(script).toContain('[packedCli, "templates", "check"]');
    expect(script).toContain("noUnusedLocals: true");
    expect(script).toContain('data-template-id="minimal-text"');
    expect(script).toContain('data-template-id="structured-data"');
    expect(script).not.toContain("supplied-media.tsx");
    expect(script).toContain("36 deterministic renders");
    expect(script).toContain("Guided onboarding helped more users reach value.");
  });

  it("runs every documented template command through the packed CLI", () => {
    const script = readFileSync(new URL("../scripts/verify-packed-package.mjs", import.meta.url), "utf8");

    expect(script).toContain('[packedCli, "templates", "create", "customer-health"]');
    expect(script).toContain('[packedCli, "templates", "add", "keyFigure"]');
    expect(script).toContain('[packedCli, "templates", "add", "keyFigure", "--dry-run"]');
    expect(script).toContain('[packedCli, "templates", "add", "keyFigure", "--diff"]');
    expect(script).toContain('[packedCli, "templates", "list"]');
    expect(script).toContain('[packedCli, "templates", "describe", "customer-health"]');
    expect(script).toContain('[packedCli, "templates", "sync"]');
    expect(script).toContain('[packedCli, "templates", "check"]');
  });

  it("exercises effective list and describe through the packed consumer CLI", () => {
    const script = readFileSync(new URL("../scripts/verify-packed-package.mjs", import.meta.url), "utf8");

    expect(script).toContain('[packedCli, "templates", "list", "--json"]');
    expect(script).toContain('[packedCli, "templates", "list", "--builtin", "--json"]');
    expect(script).toContain('[packedCli, "templates", "describe", "customer-health", "--json"]');
    expect(script).toContain('origin !== "project"');
    expect(script).toContain('current !== true');
    expect(script).not.toContain("customerCatalogEntry.current");
  });
});
