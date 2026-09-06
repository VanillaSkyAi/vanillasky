import { describe, expect, it } from "vitest";

import { ACCEPTANCE_FIXTURES, replayParts } from "../scripts/acceptance/fixtures";
import { getTemplate } from "../src/visual-system/scene-templates/registry";

describe("acceptance fixture template contract", () => {
  it("never uses optional preview content as a runtime fallback", async () => {
    const { BUILTIN_TEMPLATE_CATALOG } = await import("../src/visual-system/catalog/catalog");
    const presentationFieldsWithRuntimeDefaults = new Set([
      "app", "acceptLabel", "appIcon", "badgeEmoji",
      "declineLabel", "filename", "frame", "mediaPosition", "mediaTreatment", "mediaType",
      "problemLabel", "promptPrefix", "screenCalloutX", "screenCalloutY", "screenFit",
      "screenFocusX", "screenFocusY", "screenMotion", "showEmojis", "solutionLabel",
      "subtitle", "theme", "unit",
    ]);

    expect(BUILTIN_TEMPLATE_CATALOG).toHaveLength(8);
    for (const template of BUILTIN_TEMPLATE_CATALOG) {
      const required = new Set(template.schema.required ?? []);
      for (const [name, field] of Object.entries(template.schema.properties)) {
        if (required.has(name)) continue;
        const hasRuntimeDefault = !(
          field.default == null || field.default === "" || field.default === false || field.default === 0 ||
          (Array.isArray(field.default) && field.default.length === 0)
        );
        if (hasRuntimeDefault) {
          expect(
            presentationFieldsWithRuntimeDefaults.has(name),
            `${template.id}.${name} has an unclassified optional runtime default`,
          ).toBe(true);
          continue;
        }
        if (field.examples === undefined) continue;
        expect(
          field.default,
          `${template.id}.${name} schema default must be empty at runtime`,
        ).toSatisfy((value: unknown) => value == null || value === "" || value === false || value === 0 || (Array.isArray(value) && value.length === 0));
        expect(
          field.default,
          `${template.id}.${name} must be empty at runtime`,
        ).toSatisfy((value: unknown) => value == null || value === "" || value === false || value === 0 || (Array.isArray(value) && value.length === 0));
      }
    }
  });

  it("provides every required variable declared by each bundled template", () => {
    for (const fixture of ACCEPTANCE_FIXTURES) {
      for (const part of replayParts(fixture)) {
        if (part.type !== "scene.add") continue;

        const template = getTemplate(part.scene.templateId);
        expect(template, `${fixture.id}: unknown template ${part.scene.templateId}`).toBeDefined();
        if (!template) continue;

        for (const name of template.schema.required ?? []) {
          expect(
            part.scene.variables[name],
            `${fixture.id}/${part.scene.id}: missing required ${template.id}.${name}`,
          ).not.toBeUndefined();
          expect(
            part.scene.variables[name],
            `${fixture.id}/${part.scene.id}: empty required ${template.id}.${name}`,
          ).not.toBe("");
        }
      }
    }
  });

  it("lets the list templates carry the count the evidence supports", () => {
    // A host with two supported facts must not be forced to invent a third:
    // The maintainer acceptance guide treats any factual invention as a release blocker.
    const cards = getTemplate("focusCards")?.schema;
    expect(cards?.properties.items).toMatchObject({ minItems: 2, maxItems: 4 });
    expect(Object.keys(cards?.properties ?? {})).toEqual(["items"]);
    // Timeline requires three ordered events. Two supported points belong in cards.
    const timeline = getTemplate("editorialTimeline")?.schema;
    expect(timeline?.properties.events).toMatchObject({ minItems: 3, maxItems: 5 });
    expect(Object.keys(timeline?.properties ?? {})).toEqual(["events"]);
  });
});
