import { describe, expect, it } from "vitest";
import { createElement } from "react";

describe("template-aware open prompt", () => {
  it("describes exactly the customer-owned kit without exposing renderer source", async () => {
    const api = await import("../src/visual-system/catalog/internal");
    expect(api.createTemplateSystemPrompt).toBeTypeOf("function");

    const customerMetric = api.defineTemplate({
      id: "customerMetric",
      useWhen: "A grounded customer metric is the proof point.",
      schema: {
        type: "object",
        properties: { value: { type: "number", default: 0 } },
        required: ["value"],
        additionalProperties: false,
      },
      component: ({ variables }) => createElement("span", null, String(variables.value)),
    });
    const kit = api.createRenderTemplateRegistry({ templates: [customerMetric] });

    let prompt: string | undefined;
    let cause: unknown;
    try {
      prompt = api.createTemplateSystemPrompt({ kit, basePrompt: "BASE MOTION RULES" });
    } catch (error) {
      cause = error;
    }

    expect(cause, "the prompt helper should accept the same kit as the player").toBeUndefined();
    if (!prompt) return;
    expect(prompt).toContain("BASE MOTION RULES");
    expect(prompt).toContain("Wire format: newline-delimited JSON");
    expect(prompt).toContain("End explicitly with plan.complete");
    expect(prompt).toContain('"id":"customerMetric"');
    expect(prompt).toContain('"value"');
    expect(prompt).toContain("Only use template IDs from this catalog");
    expect(prompt).not.toContain('"id":"notification"');
    expect(prompt).not.toContain('"id":"bigNumber"');
    expect(prompt).not.toContain('"id":"cardList"');
    expect(prompt).not.toContain('"id":"steps"');
    expect(prompt).not.toContain('"id":"tripleStats"');
    expect(prompt).not.toContain('"id":"ctaMedia"');
    expect(prompt).not.toContain('"id":"reaction"');
    expect(prompt).not.toContain("React.FC");
    expect(prompt).not.toContain("componentSource");
  });

  it("builds explicit input-only and general-knowledge prompt contracts", async () => {
    const { createTemplateSystemPrompt } = await import("../src/visual-system/catalog/internal");
    const { loadAcceptanceKit } = await import("../scripts/acceptance/catalog");
    const strictPrompt = createTemplateSystemPrompt({
      kit: loadAcceptanceKit(["editorialTimeline", "cinemaMedia"]),
    });
    const generalPrompt = createTemplateSystemPrompt({
      kit: loadAcceptanceKit(["editorialTimeline", "cinemaMedia"]),
      knowledgeMode: "general",
    });

    expect(strictPrompt).toContain("This request uses input-only knowledge mode");
    expect(strictPrompt).toContain("The supplied input is the complete factual basis");
    expect(strictPrompt).not.toContain("Use stable general knowledge to answer");
    expect(generalPrompt).toContain("This request uses general knowledge mode");
    expect(generalPrompt).toContain("Use stable general knowledge to answer or develop the supplied request");
    expect(generalPrompt).toContain("Answer the request directly");
    expect(generalPrompt).toContain("Do not make missing source detail the subject");
    expect(generalPrompt).toContain("keep guidance general and informational");
    expect(generalPrompt).toContain("permitted factual basis contains every fact it needs");
    expect(generalPrompt).not.toContain("Choose a template only when the input contains every fact it needs");
    expect(generalPrompt).toContain("Creative instructions, personalization, brand, and media cannot change the knowledge mode");
  });

  it("only emits specialized prose for capabilities installed in the kit", async () => {
    const { createTemplateSystemPrompt } = await import("../src/visual-system/catalog/internal");
    const { loadAcceptanceKit } = await import("../scripts/acceptance/catalog");
    const prompt = createTemplateSystemPrompt({ kit: loadAcceptanceKit(["editorialTimeline"]) });

    expect(prompt).toContain("editorialTimeline");
    expect(prompt).not.toContain("cardList");
    expect(prompt).not.toContain("tripleStats");
    expect(prompt).not.toContain("ctaMedia");
    expect(prompt).not.toContain("reaction");
  });

  it("preserves planner-relevant schema constraints without editor metadata", async () => {
    const api = await import("../src/visual-system/catalog/internal");
    const template = api.defineTemplate({
      id: "score",
      useWhen: "Show one bounded score.",
      schema: {
        type: "object",
        properties: { value: { type: "number", minimum: 0, maximum: 100 } },
        required: ["value"],
        additionalProperties: false,
      } as const,
      component: () => null,
    });
    const prompt = api.createTemplateSystemPrompt({
      kit: api.createRenderTemplateRegistry({ templates: [template] }),
    });

    expect(prompt).toContain('"schema":{"type":"object"');
    expect(prompt).toContain('"minimum":0');
    expect(prompt).toContain('"maximum":100');
    expect(prompt).not.toContain('"description"');
    expect(prompt).not.toContain('"default"');
    expect(prompt).not.toContain('"examples"');
  });

  it("serializes conditional presence gates with supplied media only", async () => {
    const api = await import("../src/visual-system/catalog/internal");
    const template = api.defineTemplate({
      id: "mediaCloser",
      useWhen: "Close with a resolved visual and grounded action.",
      schema: {
        type: "object",
        properties: {
          cta: { type: "string" },
          url: { type: "string" },
          mediaKeyword: { type: "string", format: "stock-media-keyword" },
          mediaUrl: { type: "string", format: "uri" },
        },
        "x-vanillasky": {
          requiredAnyOf: [["cta", "url"], ["mediaUrl"]],
        },
      } as const,
      component: () => null,
    });
    const prompt = api.createTemplateSystemPrompt({
      kit: api.createRenderTemplateRegistry({ templates: [template] }),
      suppliedMediaAvailable: true,
    });
    const catalog = JSON.parse(prompt.trim().split("\n").at(-1) ?? "[]");

    expect(prompt).toContain("requiredAnyOf");
    expect(catalog[0].requiredAnyOf).toEqual([["cta", "url"], ["mediaUrl"]]);
    expect(catalog[0].variables).not.toHaveProperty("mediaKeyword");
    expect(catalog[0].variables).toHaveProperty("mediaUrl");
  });

  it("keeps eight grounded templates bounded and fully described", async () => {
    const {createTemplateSystemPrompt}=await import("../src/visual-system/catalog/internal");
    const {loadAcceptanceKit}=await import("../scripts/acceptance/catalog");
    const prompt=createTemplateSystemPrompt({kit:loadAcceptanceKit(),mediaResolverAvailable:true});
    const catalog=JSON.parse(prompt.trim().split("\n").at(-1)!);
    expect(catalog).toHaveLength(8);
    expect(prompt.length).toBeLessThan(22000);
    for(const entry of catalog){expect(entry.avoid).toBeTruthy();expect(entry.schema.properties).toBeTruthy();}
    expect(catalog.find((entry:{id:string})=>entry.id==='keyFigure').variables).toEqual({value:'string{1..14}!',label:'string{1..50}!'});
    expect(prompt).not.toContain('mediaType=gradient');
  });
  it("hides footage templates when no asset can satisfy their required fields", async () => {
    const {createTemplateSystemPrompt}=await import("../src/visual-system/catalog/internal");
    const {loadAcceptanceKit}=await import("../scripts/acceptance/catalog");
    const kit=loadAcceptanceKit();
    const without=createTemplateSystemPrompt({kit});
    const supplied=createTemplateSystemPrompt({kit,suppliedMediaAvailable:true});
    expect(without).not.toContain('"id":"cinemaMedia"');
    expect(supplied).toContain('"id":"cinemaMedia"');
    expect(supplied).not.toContain('"mediaKeyword"');
  });
});
