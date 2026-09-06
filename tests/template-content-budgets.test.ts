import { describe, expect, it } from "vitest";
import { createBuiltinTemplateSystemPrompt, getBuiltinTemplateMetadata } from "../src/visual-system/catalog/catalog";

describe("cinematic template content budgets", () => {
  it("bounds the copy fields and omits decorative authoring controls", () => {
    const budgets = { chapterTitle: { title: 65 }, mobileMessage: { message: 120, app: 24 }, comparison: { leftText: 60, rightText: 60, leftLabel: 20, rightLabel: 20 }, quote: { quote: 140, attribution: 60 }, keyFigure: { value: 14, label: 50 } };
    for (const [id, fields] of Object.entries(budgets)) {
      const schema = getBuiltinTemplateMetadata(id)!.schema;
      expect(schema.additionalProperties).toBe(false);
      for (const [field, maxLength] of Object.entries(fields)) expect(schema.properties[field]).toMatchObject({ type: "string", maxLength });
    }
    expect(getBuiltinTemplateMetadata("keyFigure")!.schema.required).toEqual(["value", "label"]);
    expect(Object.keys(getBuiltinTemplateMetadata("chapterTitle")!.schema.properties)).toEqual(["title"]);
  });
  it("bounds repeated phrases and ordered events without inventing dates or emojis", () => {
    expect(getBuiltinTemplateMetadata("editorialTimeline")!.schema.properties.events).toMatchObject({ minItems: 3, maxItems: 5, items: { type: "object", required: ["label"], additionalProperties: false, properties: { label: { maxLength: 45 } } } });
  });
  it("keeps factual examples separate from runtime defaults", () => {
    for (const id of ["quote", "keyFigure"]) for (const field of Object.entries(getBuiltinTemplateMetadata(id)!.schema.properties).filter(([name]) => ["quote","attribution","value","label"].includes(name)).map(([,field])=>field)) {
      expect(field.default).toBeUndefined();
      expect(field.examples?.length).toBeGreaterThan(0);
    }
  });
  it("communicates compact character and repeated-item budgets to the planner", () => {
    const prompt = createBuiltinTemplateSystemPrompt();
    expect(prompt.length).toBeLessThan(18000);
    expect(prompt).toContain("string{1..140}!");
    expect(prompt).toContain("character count");
  });
});
