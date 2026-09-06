import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { describeRegistryTemplate } from "../src/cli/registry";
import { getBuiltinTemplateMetadata, listBuiltinTemplateMetadata } from "../src/visual-system/catalog/catalog";
import {
  createRenderTemplateRegistry,
  createTemplateSystemPrompt,
  defineTemplate,
} from "../src/visual-system/catalog/internal";

describe("unified template JSON Schema contract", () => {
  it("publishes one serializable schema without derived authoring maps", () => {
    const template = defineTemplate({
      id: "metric",
      useWhen: "Show a grounded metric.",
      schema: {
        type: "object",
        properties: {
          value: { type: "number", title: "Metric", default: 42 },
        },
        required: ["value"],
        additionalProperties: false,
      } as const,
      component: () => null,
    });
    const metadata = createRenderTemplateRegistry({ templates: [template] }).listTemplateMetadata()[0];

    expect(metadata.schema).toEqual(template.schema);
    expect(metadata).not.toHaveProperty("variableSchema");
    expect(metadata).not.toHaveProperty("defaultVariables");
    expect(metadata).not.toHaveProperty("requiresStat");
    expect(metadata).not.toHaveProperty("requiresQuote");
    expect(metadata).not.toHaveProperty("requiresScreenshot");
    expect(metadata).not.toHaveProperty("allowsStockMedia");
  });

  it("migrates every built-in to that same schema-only metadata shape", () => {
    const catalog = listBuiltinTemplateMetadata();
    expect(catalog).toHaveLength(8);
    for (const template of catalog) {
      expect(template.schema, template.id).toMatchObject({
        type: "object",
        properties: expect.any(Object),
        additionalProperties: false,
      });
      expect(template, template.id).not.toHaveProperty("variableSchema");
      expect(template, template.id).not.toHaveProperty("defaultVariables");
      expect(template, template.id).not.toHaveProperty("requiresStat");
      expect(template, template.id).not.toHaveProperty("requiresQuote");
      expect(template, template.id).not.toHaveProperty("requiresScreenshot");
      expect(template, template.id).not.toHaveProperty("allowsStockMedia");
    }

    expect(getBuiltinTemplateMetadata("keyFigure")?.schema).toMatchObject({
      properties: { value: { format: "grounded-stat" } },
      required: ["value", "label"],
      "x-vanillasky": { requiresStat: true },
    });
    expect(getBuiltinTemplateMetadata("keyFigure")?.schema.properties.value.default).toBeUndefined();
    expect(getBuiltinTemplateMetadata("quote")?.schema).toMatchObject({
      properties: { quote: { format: "grounded-quote" } },
    });
    expect(getBuiltinTemplateMetadata("cinemaMedia")?.schema).toMatchObject({
      "x-vanillasky": { allowsStockMedia: true, requiredAnyOf: [["mediaKeyword", "mediaUrl"]] },
    });
  });

  it("derives planner notation and gates from schema instead of duplicate metadata", () => {
    const metadata = {
      id: "proof",
      useWhen: "Show two grounded facts.",
      usesGlobalTextEffect: false,
      usesGlobalTransition: false,
      usesGlobalBackgroundEffect: false,
      schema: {
        type: "object",
        properties: {
          facts: {
            type: "array",
            items: { type: "string" },
            minItems: 2,
            maxItems: 2,
          },
          quote: { type: "string", format: "grounded-quote" },
        },
        required: ["facts", "quote"],
        additionalProperties: false,
        "x-vanillasky": { requiresStat: true, allowsStockMedia: true },
      },
    } as const;
    const prompt = createTemplateSystemPrompt({
      kit: { listTemplateMetadata: () => [metadata] },
    });

    expect(prompt).toContain('"facts":"string-array[2]!"');
    expect(prompt).toContain('"quote":"string!"');
    expect(prompt).toContain('"requiresStat":true');
    expect(prompt).toContain('"requiresQuote":true');
    expect(prompt).not.toContain('"stockMedia":true');
    expect(prompt).not.toContain('"variableSchema"');
    expect(prompt).not.toContain('"defaultVariables"');
  });

  it("generates registry metadata and copied templates from the canonical schema", () => {
    const described = describeRegistryTemplate("comparison");
    expect(described?.schema).toEqual(getBuiltinTemplateMetadata("comparison")?.schema);
    expect(described).not.toHaveProperty("variableSchema");

    for (const template of listBuiltinTemplateMetadata()) {
      const registry = JSON.parse(readFileSync(join(process.cwd(), `registry/items/${template.id}.json`), "utf8"));
      expect(registry.meta.vanillasky.schema, template.id).toEqual(template.schema);
      expect(registry.meta.vanillasky, template.id).not.toHaveProperty("variableSchema");
      expect(registry.meta.vanillasky, template.id).not.toHaveProperty("defaultVariables");
      expect(registry.meta.vanillasky, template.id).not.toHaveProperty("gates");
    }
  });
});
