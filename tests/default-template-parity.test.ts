import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  BUILTIN_PLAYER_KIT,
} from "../src/visual-system/catalog/builtin-player";
import { GENERATED_BUILTIN_PLAYER_TEMPLATES } from "../src/visual-system/catalog/builtin-player.generated";
import { BUILTIN_TEMPLATE_CATALOG } from "../src/visual-system/catalog/catalog";
import { getTemplateDefaults } from "../src/visual-system/catalog/schema";

describe("default template registries", () => {
  it("keeps the lean player data and React-free server metadata in exact parity", () => {
    expect(BUILTIN_PLAYER_KIT.templates.map(({ id }) => id)).toEqual(
      BUILTIN_TEMPLATE_CATALOG.map(({ id }) => id),
    );
    expect(GENERATED_BUILTIN_PLAYER_TEMPLATES).toEqual(
      BUILTIN_TEMPLATE_CATALOG.map((template) => ({
        id: template.id,
        defaults: getTemplateDefaults(template.schema),
        usesGlobalTransition: template.usesGlobalTransition,
        ...(template.transitionTiming ? { transitionTiming: template.transitionTiming } : {}),
      })),
    );
    expect(BUILTIN_PLAYER_KIT.templates.every(({ component }) => !Object.isFrozen(component))).toBe(true);
  });

  it("generates a browser player table without planner metadata", () => {
    const path = resolve("src/visual-system/catalog/builtin-player.generated.ts");
    expect(existsSync(path)).toBe(true);
    const source = existsSync(path) ? readFileSync(path, "utf8") : "";

    expect(source).toContain("defaults");
    expect(source).toContain("usesGlobalTransition");
    expect(source).not.toContain("description");
    expect(source).not.toContain("useWhen");
    expect(source).not.toContain("avoidWhen");
    expect(source).not.toMatch(/\bschema\b/);
  });
});
