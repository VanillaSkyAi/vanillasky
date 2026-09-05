import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentType } from "react";
import type { SceneTemplateProps } from "@vanillaskyai/video/templates";
import { describe, expect, it } from "vitest";
import { TEST_VIDEO_STYLE } from "./semantic-brand-fixture";

const root = resolve(import.meta.dirname, "..");
const exampleRoot = join(root, "examples/custom-template");
const exampleFiles = ["minimal-text.tsx", "structured-data.tsx"] as const;

describe("custom template reference journey", () => {
  it("ships source-owned, public-only reference templates in the package", () => {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { files: string[] };

    expect(manifest.files).toContain("examples/custom-template");
    expect(existsSync(join(exampleRoot, "README.md"))).toBe(true);
    for (const file of exampleFiles) {
      const source = readFileSync(join(exampleRoot, file), "utf8");
      expect(source).toContain('from "@vanillaskyai/video/templates"');
      expect(source).not.toMatch(/src\/|visual-system|@vanillaskyai\/video\/internal/);
      expect(source).toContain("defineTemplate({");
      expect(source).toContain("useWhen:");
      expect(source).toContain("avoidWhen:");
      expect(source).toContain("schema:");
      expect(source).toContain("default:");
      expect(source).toContain("examples:");
      expect(source).toContain("progress");
      expect(source).toContain("safeZone");
      expect(source).toContain("height >= width");
    }
  });

  it("documents the literal create-or-copy, edit, sync, and check path without an SDK dev command", () => {
    const guide = readFileSync(join(root, "docs/custom-templates.md"), "utf8");
    const readme = readFileSync(join(root, "README.md"), "utf8");

    expect(guide).toContain("npx vanillasky templates create customer-health");
    expect(guide).toContain("npx vanillasky templates add keyFigure");
    expect(guide).toContain("npx vanillasky templates add keyFigure --dry-run");
    expect(guide).toContain("npx vanillasky templates add keyFigure --diff");
    expect(guide).toContain("npx vanillasky templates list");
    expect(guide).toContain("npx vanillasky templates describe customer-health");
    expect(guide).toContain("vanillasky/templates/customer-health.tsx");
    expect(guide).toContain("npx vanillasky templates sync");
    expect(guide).toContain("npx vanillasky templates check");
    expect(guide).toContain('import { templates } from "../vanillasky/server"');
    expect(guide).toContain('import { templates } from "../vanillasky"');
    expect(guide).toContain("<VideoPlayer video={savedVideo} templates={templates}");
    expect(guide).not.toContain("vanillasky dev");
    expect(guide).not.toMatch(/canonical workbench/i);
    expect(readme).toContain("[Custom templates](docs/custom-templates.md)");
    expect(readme).not.toContain("npx vanillasky templates create customer-health");
  });

  it("documents local authorization as fail-closed outside development", () => {
    const guide = readFileSync(join(root, "docs/custom-templates.md"), "utf8");

    expect(guide).toContain('if (process.env.VANILLASKY_LOCAL_DEMO !== "1") return false;');
    expect(guide).toContain('hostname === "localhost" || hostname === "127.0.0.1"');
    expect(guide).not.toContain(
      'authorize: (request) => new URL(request.url).hostname === "localhost"',
    );
  });

  it("distinguishes optional defaults from complete named scene examples", () => {
    const guide = readFileSync(join(root, "docs/custom-templates.md"), "utf8");
    const normalizedGuide = guide.replace(/\s+/g, " ");

    expect(normalizedGuide).toContain("Property defaults are optional authoring and renderer smoke values");
    expect(normalizedGuide).toContain("Named examples must resolve to complete valid scenes");
    expect(normalizedGuide).toContain("inherit omitted values from property defaults");
    expect(normalizedGuide).toContain("Never invent media URLs or actions just to supply a default");
    expect(guide).not.toContain("Put a `default` on every property");
  });

  it("makes the references discoverable by their intended content shape", () => {
    const reference = readFileSync(join(exampleRoot, "README.md"), "utf8");

    expect(reference).toContain("Minimal text");
    expect(reference).toContain("Structured data");
    expect(reference).toContain("minimal-text.tsx");
    expect(reference).toContain("structured-data.tsx");
  });
});

describe("custom template reference contracts", () => {
  it("renders every example deterministically in portrait and landscape at progress boundaries", async () => {
    const modules = await Promise.all([
      import("../examples/custom-template/minimal-text"),
      import("../examples/custom-template/structured-data"),
    ]);
    const dimensions = [{ width: 1080, height: 1920 }, { width: 1920, height: 1080 }];

    for (const module of modules) {
      const definition = module.template;
      expect(definition.useWhen?.trim()).toBeTruthy();
      expect(definition.avoidWhen?.trim()).toBeTruthy();
      expect(definition.examples).toHaveLength(1);
      const Component = definition.component as ComponentType<SceneTemplateProps>;
      for (const size of dimensions) {
        for (const progress of [0, 0.5, 1]) {
          const props = {
            variables: definition.examples![0].variables,
            style: TEST_VIDEO_STYLE,
            progress,
            beatIntensity: 0,
            ...size,
            safeZone: { top: 80, right: 80, bottom: 80, left: 80 },
          };
          const first = renderToStaticMarkup(<Component {...props} />);
          const second = renderToStaticMarkup(<Component {...props} />);
          expect(first).toBe(second);
          expect(first).not.toContain("NaN");
          expect(first).not.toContain("undefined");
        }
      }
    }
  });

  it("documents exact runtime evidence validation for grounded quantities", () => {
    const guide = readFileSync(join(root, "docs/custom-templates.md"), "utf8");

    expect(guide).toContain("`grounded-stat` accepts numeric or string quantities and requires an exact");
    expect(guide).toContain("quantity in raw input, preserving its unit");
  });
});
