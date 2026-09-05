import { describe, expect, it } from "vitest";
import {
  createRenderTemplateRegistry,
  createServerTemplateRegistry,
  createTemplateSceneValidator,
  defineTemplate,
} from "../src/visual-system/catalog/internal";
import { BUILTIN_TEMPLATE_CATALOG } from "../src/visual-system/catalog/catalog";

const kit = createRenderTemplateRegistry({
  templates: [
    defineTemplate({
      id: "message",
      schema: {
        type: "object",
        properties: {
          headline: { type: "string" },
          mediaUrl: { type: "string", format: "uri" },
        },
        required: ["headline"],
        additionalProperties: false,
      },
      component: () => null,
    }),
    defineTemplate({
      id: "testimonial",
      schema: {
        type: "object",
        properties: {
          quote: { type: "string", format: "grounded-quote" },
          authorName: { type: "string" },
        },
        required: ["quote", "authorName"],
        additionalProperties: false,
      },
      component: () => null,
    }),
    defineTemplate({
      id: "threeItems",
      schema: {
        type: "object",
        properties: { items: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 3 } },
        required: ["items"],
        additionalProperties: false,
      },
      component: () => null,
    }),
    defineTemplate({
      id: "rangeItems",
      schema: {
        type: "object",
        properties: { items: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 3 } },
        required: ["items"],
        additionalProperties: false,
      },
      component: () => null,
    }),
    defineTemplate({
      id: "nestedCard",
      schema: {
        type: "object",
        properties: {
          card: {
            type: "object",
            properties: {
              imageUrl: { type: "string", format: "uri" },
              quote: { type: "string", format: "grounded-quote" },
              gallery: {
                type: "array",
                items: {
                  type: "object",
                  properties: { url: { type: "string", format: "uri" } },
                  required: ["url"],
                  additionalProperties: false,
                },
              },
            },
            required: ["imageUrl", "quote"],
            additionalProperties: false,
          },
        },
        required: ["card"],
        additionalProperties: false,
      } as const,
      component: () => null,
    }),
    defineTemplate({
      id: "conditional",
      schema: {
        type: "object",
        properties: {
          action: { type: "string" },
          url: { type: "string" },
          mediaUrl: { type: "string", format: "uri" },
          items: { type: "array", items: { type: "string" } },
        },
        additionalProperties: false,
        "x-vanillasky": {
          requiredAnyOf: [["action", "url"], ["mediaUrl"], ["items"]],
        },
      } as const,
      component: () => null,
    }),
  ],
});

const scene = (templateId: string, variables: Record<string, unknown>) => ({
  id: "scene-1",
  templateId,
  variables,
  timing: { fixedDuration: 4 },
});

describe("template scene validator", () => {
  it("validates schema templates without runtime code generation", () => {
    const schemaKit = createRenderTemplateRegistry({ templates: [defineTemplate({
      id: "edgeSafe",
      schema: {
        type: "object",
        properties: {
          title: { type: "string", minLength: 2, maxLength: 12 },
          score: { type: "integer", format: "grounded-stat", minimum: 0, maximum: 100 },
          tags: { type: "array", minItems: 2, maxItems: 3, items: { type: "string" } },
        },
        required: ["title", "score", "tags"],
        additionalProperties: false,
      } as const,
      component: () => null,
    })] });
    const validate = createTemplateSceneValidator({ kit: schemaKit });
    const context = { input: { input: "A grounded result." }, previousScenes: [] };
    const OriginalFunction = globalThis.Function;
    globalThis.Function = (() => { throw new Error("Code generation disallowed"); }) as unknown as FunctionConstructor;
    try {
      expect(() => validate(scene("edgeSafe", { title: "Result", score: 58, tags: ["fast", "safe"] }), context)).not.toThrow();
      expect(() => validate(scene("edgeSafe", { title: "Result", score: 58.5, tags: ["fast", "safe"] }), context)).toThrow(/integer/);
      expect(() => validate(scene("edgeSafe", { title: "Result", score: 58, tags: ["fast"], extra: true }), context)).toThrow(/extra/);
    } finally {
      globalThis.Function = OriginalFunction;
    }
  });

  it("enforces installed templates, declared fields, and required values", () => {
    const validate = createTemplateSceneValidator({ kit });
    const context = { input: { input: "A grounded launch." }, previousScenes: [] };

    expect(() => validate(scene("unknown", {}), context)).toThrow(/not installed/);
    expect(() => validate(scene("message", {}), context)).toThrow(/headline/);
    expect(() => validate(scene("message", { headline: "Launch", invented: true }), context))
      .toThrow(/invented/);
    expect(() => validate(scene("message", { headline: "Launch" }), context)).not.toThrow();
  });

  it("rejects undeclared top-level keys inherited by the schema properties object", () => {
    const validate = createTemplateSceneValidator({ kit });
    const context = { input: { input: "A grounded launch." }, previousScenes: [] };
    const variables = JSON.parse('{"headline":"Launch","constructor":{"mediaUrl":"https://evil.example/hero.png"}}');

    expect(() => validate(scene("message", variables), context)).toThrow(/constructor.*not declared/);
  });

  it("rejects undeclared nested keys inherited by the schema properties object", () => {
    const validate = createTemplateSceneValidator({ kit });
    const context = {
      input: {
        input: 'Maya said, "The launch was clear."',
        suppliedMedia: [{ id: "hero", url: "https://cdn.example/hero.png", type: "image" as const }],
      },
      previousScenes: [],
    };
    const variables = JSON.parse(`{
      "card": {
        "imageUrl": "https://cdn.example/hero.png",
        "quote": "The launch was clear.",
        "toString": { "url": "https://evil.example/gallery.png" }
      }
    }`);

    expect(() => validate(scene("nestedCard", variables), context)).toThrow(/card\.toString.*not declared/);
  });

  it("rejects fabricated quotes and accepts an exact attributed quote", () => {
    const validate = createTemplateSceneValidator({ kit });
    const context = {
      input: { input: 'Maya said, "I am here to help."' },
      previousScenes: [],
    };

    expect(() => validate(scene("testimonial", {
      quote: "I will help you hit every milestone.",
      authorName: "Maya",
    }), context)).toThrow(/exact quote/);
    expect(() => validate(scene("testimonial", {
      quote: "I am here to help.",
      authorName: "Maya",
    }), context)).not.toThrow();
  });

  it("allows only supplied media URLs by default", () => {
    const validate = createTemplateSceneValidator({ kit });
    const context = {
      input: {
        input: "A grounded launch.",
        suppliedMedia: [{ id: "hero", url: "https://cdn.example/hero.png", type: "image" as const }],
      },
      previousScenes: [],
    };

    expect(() => validate(scene("message", {
      headline: "Launch",
      mediaUrl: "https://other.example/hero.png",
    }), context)).toThrow(/supplied media/);
    expect(() => validate(scene("message", {
      headline: "Launch",
      mediaUrl: "https://cdn.example/hero.png",
    }), context)).not.toThrow();
    expect(() => validate(scene("message", {
      headline: "Launch",
      mediaUrl: "",
    }), context)).toThrow(/valid URL/);
  });

  it("recursively enforces nested schema fields, media authorization, and quote grounding", () => {
    const validate = createTemplateSceneValidator({ kit });
    const context = {
      input: {
        input: 'Maya said, "The launch was clear."',
        suppliedMedia: [{ id: "hero", url: "https://cdn.example/hero.png", type: "image" as const }],
      },
      previousScenes: [],
    };

    expect(() => validate(scene("nestedCard", {
      card: { imageUrl: "https://evil.example/hero.png", quote: "The launch was clear." },
    }), context)).toThrow(/card\.imageUrl.*supplied media/);
    expect(() => validate(scene("nestedCard", {
      card: {
        imageUrl: "https://cdn.example/hero.png",
        quote: "The launch was clear.",
        gallery: [{ url: "https://evil.example/gallery.png" }],
      },
    }), context)).toThrow(/card\.gallery\.0\.url.*supplied media/);
    expect(() => validate(scene("nestedCard", {
      card: { imageUrl: "https://cdn.example/hero.png", quote: "Invented quote" },
    }), context)).toThrow(/exact quote/);
    expect(() => validate(scene("nestedCard", {
      card: {
        imageUrl: "https://cdn.example/hero.png",
        quote: "The launch was clear.",
        undeclared: true,
      },
    }), context)).toThrow(/card\.undeclared/);
    expect(() => validate(scene("nestedCard", {
      card: { imageUrl: "https://cdn.example/hero.png", quote: "The launch was clear." },
    }), context)).not.toThrow();
  });

  it("enforces list cardinality declared by a template", () => {
    const validate = createTemplateSceneValidator({ kit });
    const context = { input: { input: "Three grounded facts." }, previousScenes: [] };

    expect(() => validate(scene("threeItems", { items: ["One", "Two"] }), context))
      .toThrow(/exactly 3 items/);
    expect(() => validate(scene("threeItems", { items: ["One", "Two", "Three", "Four"] }), context))
      .toThrow(/exactly 3 items/);
    expect(() => validate(scene("threeItems", { items: ["One", "Two", "Three"] }), context))
      .not.toThrow();
  });

  it("accepts any count inside a declared list range", () => {
    const validate = createTemplateSceneValidator({ kit });
    const context = { input: { input: "Two grounded facts." }, previousScenes: [] };

    expect(() => validate(scene("rangeItems", { items: ["One"] }), context))
      .toThrow(/at least 2 items/);
    expect(() => validate(scene("rangeItems", { items: ["One", "Two", "Three", "Four"] }), context))
      .toThrow(/at most 3 items/);
    expect(() => validate(scene("rangeItems", { items: ["One", "Two"] }), context))
      .not.toThrow();
    expect(() => validate(scene("rangeItems", { items: ["One", "Two", "Three"] }), context))
      .not.toThrow();
  });

  it("enforces every conditional presence group with meaningful non-empty values", () => {
    const validate = createTemplateSceneValidator({
      kit,
      allowMediaUrl: () => true,
    });
    const context = { input: { input: "A grounded action." }, previousScenes: [] };

    expect(() => validate(scene("conditional", {}), context)).toThrow(/action or url/i);
    expect(() => validate(scene("conditional", {
      action: " \t",
      url: "",
      mediaUrl: "https://cdn.example/clip.mp4",
      items: ["Ready"],
    }), context)).toThrow(/action or url/i);
    expect(() => validate(scene("conditional", {
      action: "Start now",
      mediaUrl: null,
      items: ["Ready"],
    }), context)).toThrow(/mediaUrl/i);
    expect(() => validate(scene("conditional", {
      action: "Start now",
      mediaUrl: "https://cdn.example/clip.mp4",
      items: [],
    }), context)).toThrow(/items/i);
    expect(() => validate(scene("conditional", {
      url: "example.com",
      mediaUrl: "https://cdn.example/clip.mp4",
      items: ["Ready"],
    }), context)).not.toThrow();
  });

  it("rejects conditional presence gates that reference undeclared fields", () => {
    const invalidKit = createRenderTemplateRegistry({ templates: [defineTemplate({
      id: "invalidConditional",
      schema: {
        type: "object",
        properties: { action: { type: "string" } },
        "x-vanillasky": { requiredAnyOf: [["action", "invented"]] },
      } as const,
      component: () => null,
    })] });
    const validate = createTemplateSceneValidator({ kit: invalidKit });

    expect(() => validate(scene("invalidConditional", { action: "Go" }), {
      input: { input: "Go" },
      previousScenes: [],
    })).toThrow(/requiredAnyOf.*invented.*not declared/i);
  });

  it("requires content that matches the eight cinematic contracts",()=>{
    const validate=createTemplateSceneValidator({kit:createServerTemplateRegistry({templates:BUILTIN_TEMPLATE_CATALOG}),allowMediaUrl:()=>true});
    const context={input:{input:"A rocky coast. Can we talk?"},previousScenes:[]};
    expect(()=>validate(scene("cinemaMedia",{}),context)).toThrow(/mediaKeyword|mediaUrl/);
    expect(()=>validate(scene("cinemaMedia",{mediaUrl:"https://cdn.example/coast.mp4",mediaType:"video"}),context)).not.toThrow();
    expect(()=>validate(scene("mobileMessage",{message:"Can we talk?"}),context)).not.toThrow();
    expect(()=>validate(scene("focusCards",{items:["One"]}),context)).toThrow();
    expect(()=>validate(scene("editorialTimeline",{events:[{label:"One",date:"2026"},{label:"Two"},{label:"Three"}]}),context)).toThrow();
  });
});
