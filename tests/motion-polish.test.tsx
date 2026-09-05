import { describe, expect, it } from "vitest";
import { renderArchetype, TEXT_ARCHETYPES } from "../src/visual-system/scene-templates/text-archetypes";

describe("global transition hold contract", () => {
  it.each(TEXT_ARCHETYPES)("makes %s recognizable at an incoming transition boundary", (archetype) => {
    const rendered = renderArchetype(archetype, 0, 1, "Readable transition copy", 5, 1, 0.2);
    const visible = rendered.kind === "block"
      ? rendered.block.opacity
      : rendered.kind === "typewriter"
        ? rendered.visibleChars > 0 && rendered.opacity > 0
        : rendered.kind === "words"
          ? Math.max(...rendered.words.map(({ style }) => style.opacity))
          : rendered.opacity;
    expect(visible, `${archetype} should be recognizable at its incoming motion point`).toBeTruthy();
  });

  it.each(TEXT_ARCHETYPES)("keeps %s text readable at transition entry and hold", (archetype) => {
    for (const progress of [0.2, 0.7]) {
      const rendered = renderArchetype(archetype, progress, 1, "Readable transition copy", 5);
      const visible = rendered.kind === "block"
        ? rendered.block.opacity
        : rendered.kind === "typewriter"
          ? rendered.visibleChars > 0 && rendered.opacity > 0
          : rendered.kind === "words"
            ? Math.max(...rendered.words.map(({ style }) => style.opacity))
            : rendered.opacity;
      expect(visible, `${archetype} should be visible at ${progress}`).toBeTruthy();
    }
  });

  it.each(TEXT_ARCHETYPES)("keeps %s semantic content final while its exit motion is held", (archetype) => {
    const text = "First second final";
    const rendered = renderArchetype(archetype, 1, 1, text, 5, 1, 0.7);
    if (rendered.kind === "typewriter") {
      expect(rendered.visibleChars).toBe(text.length);
      expect(rendered.charExits).toBeUndefined();
    } else if (rendered.kind === "words") {
      expect(rendered.words.map(({ text: word }) => word)).toEqual(["First", "second", "final"]);
      expect(Math.max(...rendered.words.map(({ style }) => style.opacity))).toBeGreaterThan(0);
    } else if (rendered.kind === "hero") {
      expect(rendered.word).toBe("final");
      expect(rendered.opacity).toBeGreaterThan(0);
    } else {
      expect(rendered.text).toBe(text);
      expect(rendered.block.opacity).toBeGreaterThan(0);
    }
  });
});

