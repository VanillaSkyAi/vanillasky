import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { VideoStyle } from "../src";
import { BUILTIN_TEMPLATE_SCHEMAS } from "../src/visual-system/scene-templates/schemas";

const style: VideoStyle = {
  brand: {
    name: "Acme",
    logoUrl: "https://cdn.example.com/acme.svg",
    font: "Geist",
    scriptFont: "Caveat",
    background: { type: "solid", color: "#102030" },
    colors: {
      primary: "#FF3366",
      secondary: "#33CCAA",
      foreground: "#F8FAFC",
      surface: "#101827",
      surfaceElevated: "#1E293B",
      muted: "#94A3B8",
    },
  },
};

describe("semantic brand flow", () => {
  it("maps the already-resolved brand to semantic template tokens without deriving another palette", async () => {
    const { resolveTokens } = await import("../src/visual-system/scene-templates/tokens");

    expect(resolveTokens(style)).toMatchObject({
      primary: "#FF3366",
      secondary: "#33CCAA",
      foreground: "#F8FAFC",
      surface: "#101827",
      surfaceElevated: "#1E293B",
      muted: "#94A3B8",
      font: 'Geist, -apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif',
      scriptFont: "Caveat",
      logoUrl: "https://cdn.example.com/acme.svg",
      name: "Acme",
      background: { type: "solid", color: "#102030" },
    });
  });

  it("removes raw visual styling and duplicated identity from every planner-facing built-in schema", () => {
    const forbidden = [
      "textColor",
      "chartColor",
      "badgeColor",
      "starColor",
      "avatarColor",
      "pillBg",
      "pillTextColor",
    ];
    for (const [id, schema] of Object.entries(BUILTIN_TEMPLATE_SCHEMAS)) {
      for (const field of forbidden) {
        expect(schema.properties, `${id} should not expose ${field}`).not.toHaveProperty(field);
      }
    }

  });

  it("keeps generated metadata and planner prompts free of removed styling fields", async () => {
    const [{ GENERATED_BUILTIN_TEMPLATE_CATALOG }, { createTemplateSystemPrompt }, { loadAcceptanceKit }] = await Promise.all([
      import("../src/visual-system/catalog/catalog.generated"),
      import("../src/visual-system/catalog/prompt"),
      import("../scripts/acceptance/catalog"),
    ]);
    const serialized = JSON.stringify(GENERATED_BUILTIN_TEMPLATE_CATALOG);
    const prompt = createTemplateSystemPrompt({ kit: loadAcceptanceKit() });
    for (const field of [
      "textColor",
      "chartColor",
      "badgeColor",
      "starColor",
      "avatarColor",
      "pillBg",
      "pillTextColor",
    ]) {
      expect(serialized).not.toContain(`"${field}"`);
      expect(prompt).not.toContain(`"${field}"`);
    }
  });

  it("has no obsolete brand API in the protocol, composition, player, template context, or docs", () => {
    const files = [
      "src/protocol/types.ts",
      "src/protocol/background.ts",
      "src/protocol/validation.ts",
      "src/server/compose-video.ts",
      "src/player/video-frame.tsx",
      "src/player/video-player.tsx",
      "src/visual-system/template-context.ts",
      "src/visual-system/scene-templates/tokens.ts",
      "docs/customization.md",
      "scripts/acceptance/fixtures.ts",
      "scripts/verify-packed-package.mjs",
    ];
    const source = files.map((file) => readFileSync(file, "utf8")).join("\n");
    for (const obsolete of [
      "brandKit",
      "logoDataUrl",
      "surface_elevated",
      "script_font",
      "backgroundOverride",
      "brand.kit",
    ]) {
      expect(source).not.toContain(obsolete);
    }
    const contract = [
      readFileSync("src/protocol/types.ts", "utf8"),
      readFileSync("src/protocol/background.ts", "utf8"),
      readFileSync("src/visual-system/template-context.ts", "utf8"),
    ].join("\n");
    for (const obsolete of ["accent", "vibe", "sourceUrl"]) {
      expect(contract).not.toMatch(new RegExp(`\\b${obsolete}\\b`));
    }
  });
});
