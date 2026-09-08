import { describe, expect, it, vi } from "vitest";

describe("video response core", () => {
  it("carries optional global visual direction into the deterministic video style", async () => {
    const { createVideo } = await import("../src/server/compose-video");
    const response = createVideo({
      input: "A calm customer update.",
      style: {
        density: "airy",
        motion: "calm",
        textArchetype: "cinematic",
        backgroundEffect: "slow-zoom-out",
      },
    }, {
      generate: async function* () {
        yield {
          type: "scene.add" as const,
          scene: { id: "one", templateId: "notification", variables: { message: "Update" }, timing: { fixedDuration: 2 } },
        };
        yield { type: "plan.complete" as const };
      },
    });

    for await (const _event of response.stream) { /* consume */ }
    expect((await response.result).config?.style).toMatchObject({
      density: "airy",
      motion: "calm",
      defaultTextArchetype: "cinematic",
      defaultBackgroundEffect: "slow-zoom-out",
    });
    expect((await response.result).config?.style).not.toHaveProperty("preset");
  });

  it("provides typed planner-part helpers distinct from emitted events", async () => {
    const { addScene, completePlan } = await import("../src/protocol/types");
    const scene = { id: "result", templateId: "bigNumber", variables: { value: 42 }, timing: { fixedDuration: 4 } };

    expect(addScene(scene)).toEqual({ type: "scene.add", scene });
    expect(completePlan()).toEqual({ type: "plan.complete" });
    expect(completePlan("length")).toEqual({ type: "plan.complete", finishReason: "length" });
  });

  it("parses a planner-only closer placement without persisting it into the scene", async () => {
    const { parseVideoPlanPart } = await import("../src/protocol/validation");
    const part = parseVideoPlanPart({
      type: "scene.add",
      placement: "closer",
      scene: {
        id: "ending",
        templateId: "media",
        variables: { texts: "Work now moves faster across every surface" },
        timing: { fixedDuration: 3 },
      },
    });

    expect(part).toMatchObject({ type: "scene.add", placement: "closer" });
    expect(part.type).toBe("scene.add");
    if (part.type !== "scene.add") throw new Error("expected scene.add");
    expect(part.scene).not.toHaveProperty("placement");
    expect(() => parseVideoPlanPart({ ...part, placement: "ending" })).toThrow(
      "plan part.placement is unsupported",
    );
  });

  it("keeps raw input and supplied-media URLs out of snapshots unless bounded fields are explicitly retained", async () => {
    const { createVideo } = await import("../src/server/compose-video");
    const generate = async function* () {
      yield {
        type: "scene.add" as const,
        scene: {
          id: "summary",
          templateId: "notification",
          variables: { message: "Safe summary" },
          timing: { fixedDuration: 3 },
        },
      };
      yield { type: "plan.complete" as const };
    };
    const input = {
      input: `Customer-confidential source ${"s".repeat(20_000)}`,
      instructions: `Private creative direction ${"i".repeat(5_000)}`,
      suppliedMedia: Array.from({ length: 20 }, (_, index) => ({
        id: `media-${index}`,
        type: "image" as const,
        url: `https://media.example.test/${index}/${"u".repeat(1_900)}`,
      })),
    };

    const privateByDefault = createVideo(input, { generate });
    for await (const _event of privateByDefault.stream) { /* consume */ }
    const privateState = await privateByDefault.result;
    expect(privateState.config?.schemaVersion).toBe("0.2");
    expect(privateState.config?.meta).not.toHaveProperty("source");
    expect(privateState.config?.meta).not.toHaveProperty("prompt");
    expect(privateState.config?.meta).not.toHaveProperty("uploadedMediaUrls");

    const retained = createVideo(input, {
      generate,
      snapshotRetention: {
        source: true,
        instructions: true,
        suppliedMediaUrls: true,
      },
    });
    for await (const _event of retained.stream) { /* consume */ }
    const retainedState = await retained.result;
    expect(retainedState.config?.meta?.source).toHaveLength(16_384);
    expect(retainedState.config?.meta?.prompt).toHaveLength(4_096);
    expect(retainedState.config?.meta?.uploadedMediaUrls).toHaveLength(16);
    expect(retainedState.config?.meta?.uploadedMediaUrls?.every((url) => url.length <= 2_048))
      .toBe(true);
  });

  it("resolves supplied-media opaque references before validation", async () => {
    const { createVideo } = await import("../src/server/compose-video");
    const privateUrl = "data:image/png;base64,private-customer-bytes";
    let validatedUrl = "";
    const response = createVideo({
      input: "Show the supplied product image.",
      suppliedMedia: [{ id: "product-shot", type: "image", url: privateUrl, role: "product" }],
    }, {
      validateScene: (scene) => { validatedUrl = String(scene.variables.mediaUrl); },
      generate: async function* () {
        const reference = "https://vanillasky.invalid/supplied/media-1";
        yield {
          type: "scene.add" as const,
          scene: {
            id: "media",
            templateId: "media",
            variables: { mediaUrl: reference },
            timing: { fixedDuration: 4 },
          },
        };
        yield { type: "plan.complete" as const };
      },
    });

    for await (const _event of response.stream) { /* consume */ }
    const state = await response.result;
    expect(validatedUrl).toBe(privateUrl);
    expect(state.config?.scenes.find(({ id }) => id === "media")?.variables.mediaUrl).toBe(privateUrl);
  });

  it("recovers content held for a closer when the planner emits no closer", async () => {
    const { createVideo } = await import("../src/server/compose-video");
    const response = createVideo({ input: "Two grounded points.", maxDurationSec: 10 }, {
      capabilities: { templates: ["body", "close"] },
      getTemplatePacing: (id) => id === "close"
        ? { jobs: ["ask"], minDuration: 3, preferredDuration: 3 }
        : { jobs: ["claim"], minDuration: 2, preferredDuration: 7 },
      generate: async function* () {
        yield {
          type: "scene.add" as const,
          scene: { id: "body-1", templateId: "body", variables: {}, timing: { fixedDuration: 7 } },
        };
        yield {
          type: "scene.add" as const,
          scene: { id: "body-2", templateId: "body", variables: {}, timing: { fixedDuration: 2 } },
        };
        yield { type: "plan.complete" as const };
      },
    });

    const events = [];
    for await (const event of response.stream) events.push(event);
    expect(events.filter(({ type }) => type === "scene.add").map((event) =>
      event.type === "scene.add" ? event.data.scene.id : ""
    )).toEqual(["supplied-opening", "body-1", "body-2"]);
    expect(events.some((event) => event.type === "response.warning" &&
      event.data.warning.code === "scene_omitted_for_closer")).toBe(false);
    expect(events.at(-1)).toMatchObject({
      type: "response.complete",
      data: {
        finishReason: "stop",
        snapshot: { scenes: [{ id: "supplied-opening" }, { id: "body-1" }, { id: "body-2" }] },
      },
    });
  });

  it("preserves planner order while recovering multiple scenes held for a missing closer", async () => {
    const { createVideo } = await import("../src/server/compose-video");
    const durations: Record<string, number> = {
      "body-1": 7,
      "body-2": 4,
      "body-3": 1,
      close: 3,
    };
    const response = createVideo({ input: "Three ordered grounded points.", maxDurationSec: 15 }, {
      capabilities: { templates: Object.keys(durations) },
      getTemplatePacing: (id) => ({
        jobs: id === "close" ? ["ask"] : ["claim"],
        minDuration: durations[id],
        preferredDuration: durations[id],
      }),
      generate: async function* () {
        for (const id of ["body-1", "body-2", "body-3"]) {
          yield {
            type: "scene.add" as const,
            scene: { id, templateId: id, variables: {}, timing: { fixedDuration: durations[id] } },
          };
        }
        yield { type: "plan.complete" as const };
      },
    });

    for await (const _event of response.stream) { /* consume */ }
    expect((await response.result).config?.scenes.map(({ id }) => id))
      .toEqual(["supplied-opening", "body-1", "body-2", "body-3"]);
  });

  it("treats supplied media as an optional approved pool", async () => {
    const { createVideo } = await import("../src/server/compose-video");
    const privateUrl = "https://private.example/customer-proof.png";
    const response = createVideo({
      input: "Grounded update.",
      suppliedMedia: [{ id: "proof", type: "image", role: "proof", url: privateUrl }],
    }, {
      generate: async function* () {
        yield {
          type: "scene.add" as const,
          scene: { id: "body", templateId: "notification", variables: { message: "Update" }, timing: { fixedDuration: 4 } },
        };
        yield { type: "plan.complete" as const };
      },
    });

    const events = [];
    for await (const event of response.stream) events.push(event);
    expect(JSON.stringify(events)).not.toContain("supplied_media_unused");
    expect(JSON.stringify(events)).not.toContain(privateUrl);
  });

  it("caps the emitted timeline at maxDurationSec", async () => {
    const { createVideo } = await import("../src/server/compose-video");
    const response = createVideo({
      input: "A concise update.",
      maxDurationSec: 10,
      opening: "Opening",
    }, {
      generate: async function* () {
        yield {
          type: "scene.add" as const,
          scene: {
            id: "body",
            templateId: "notification",
            variables: { message: "Body" },
            timing: { fixedDuration: 8 },
          },
        };
        yield { type: "plan.complete" as const };
      },
    });

    for await (const _event of response.stream) { /* consume */ }
    const state = await response.result;
    expect(state.status).toBe("complete");
    expect(state.config?.scenes.at(-1)?.timing).toMatchObject({ startTime: 3, endTime: 10 });
  });

  it("buffers an early ask while later body scenes continue and appends it last", async () => {
    const { createVideo } = await import("../src/server/compose-video");
    const response = createVideo({ input: "Two points and a grounded next action.", maxDurationSec: 12 }, {
      capabilities: { templates: ["body", "close"] },
      getTemplatePacing: (id) => id === "close"
        ? { jobs: ["ask"], minDuration: 3, preferredDuration: 3 }
        : { jobs: ["claim"], minDuration: 2, preferredDuration: 3 },
      generate: async function* () {
        yield { type: "scene.add" as const, scene: { id: "body-1", templateId: "body", variables: { message: "First" }, timing: { fixedDuration: 3 } } };
        yield { type: "scene.add" as const, scene: { id: "close", templateId: "close", variables: { cta: "Read more" }, timing: { fixedDuration: 3 } } };
        yield { type: "scene.add" as const, scene: { id: "body-2", templateId: "body", variables: { message: "Second" }, timing: { fixedDuration: 3 } } };
        yield { type: "plan.complete" as const };
      },
    });

    const events = [];
    for await (const event of response.stream) events.push(event);
    expect(events.filter(({ type }) => type === "scene.add").map((event) =>
      event.type === "scene.add" ? event.data.scene.id : ""
    )).toEqual(["supplied-opening", "body-1", "body-2", "close"]);
    expect((await response.result).config?.scenes.at(-1)?.templateId).toBe("close");
  });

  it("completes the partial response with length when the next scene starts at the ceiling", async () => {
    const { createVideo } = await import("../src/server/compose-video");
    const response = createVideo({
      input: "Update",
      maxDurationSec: 8,
    }, {
      generate: async function* () {
        yield {
          type: "scene.add" as const,
          scene: {
            id: "full-duration",
            templateId: "notification",
            variables: { message: "Complete scene" },
            timing: { fixedDuration: 5 },
          },
        };
        yield {
          type: "scene.add" as const,
          scene: {
            id: "too-late",
            templateId: "notification",
            variables: { message: "Too late" },
            timing: { fixedDuration: 3 },
          },
        };
        yield { type: "plan.complete" as const };
      },
    });

    const events = [];
    for await (const event of response.stream) events.push(event);
    expect(events.map(({ type }) => type)).toEqual([
      "response.start",
      "scene.add",
      "scene.add",
      "response.warning",
      "response.complete",
    ]);
    expect(events[3]).toMatchObject({
      type: "response.warning",
      data: { warning: { code: "scene_omitted_unreadable", sceneId: "too-late" } },
    });
    expect(events.at(-1)).toMatchObject({
      type: "response.complete",
      data: { finishReason: "length" },
    });
    await expect(response.result).resolves.toMatchObject({ status: "complete", finishReason: "length" });
  });

  it("keeps the fallback opening in the error snapshot when no generated scene can fit", async () => {
    const { createVideo } = await import("../src/server/compose-video");
    const response = createVideo({ input: "Grounded but too long", maxDurationSec: 5 }, {
      getTemplatePacing: (id) => id === "body"
        ? { minDuration: 6, preferredDuration: 6 }
        : undefined,
      generate: async function* () {
        yield {
          type: "scene.add" as const,
          scene: { id: "impossible", templateId: "body", variables: {}, timing: { fixedDuration: 6 } },
        };
        yield { type: "plan.complete" as const };
      },
    });

    const events = [];
    for await (const event of response.stream) events.push(event);
    expect(events.map(({ type }) => type)).toEqual([
      "response.start",
      "scene.add",
      "response.warning",
      "response.error",
    ]);
    expect(events[2]).toMatchObject({
      data: { warning: { code: "scene_omitted_unreadable", sceneId: "impossible" } },
    });
    expect(events.at(-1)).toMatchObject({
      type: "response.error",
      data: { terminal: true, snapshot: { scenes: [{ id: "supplied-opening" }] } },
    });
    await expect(response.result).resolves.toMatchObject({
      status: "error",
      warnings: [{ code: "scene_omitted_unreadable" }],
    });
  });

  it("fails instead of completing an empty video when the host disables the opening", async () => {
    const { createVideo } = await import("../src/server/compose-video");
    const response = createVideo({
      input: "A grounded answer is required.",
      opening: false,
    }, {
      generate: async function* () {
        yield { type: "plan.complete" as const };
      },
    });

    const events = [];
    for await (const event of response.stream) events.push(event);
    expect(events.map(({ type }) => type)).toEqual(["response.start", "response.error"]);
    expect(events.at(-1)).toMatchObject({
      type: "response.error",
      data: { terminal: true, error: { code: "generation_failed" } },
    });
    await expect(response.result).resolves.toMatchObject({ status: "error" });
  });

  it("allocates or omits content-heavy scenes deterministically through the protocol", async () => {
    const { createVideo } = await import("../src/server/compose-video");
    const cases = [
      {
        id: "headline",
        maxDurationSec: 11,
        variables: { headline: "One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen" },
        timing: { contentFields: ["headline"], contentUnit: "words" as const },
        expectedDuration: 5,
      },
      {
        id: "body",
        maxDurationSec: 11,
        variables: { body: "One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twenty-one twenty-two twenty-three twenty-four twenty-five twenty-six twenty-seven" },
        timing: { contentFields: ["body"], contentUnit: "words" as const },
        expectedDuration: 7,
      },
      {
        id: "list",
        maxDurationSec: 10,
        variables: { items: ["one", "two", "three", "four", "five", "six"] },
        timing: { contentFields: ["items"], contentUnit: "items" as const },
        expectedDuration: undefined,
      },
      {
        id: "data",
        maxDurationSec: 11,
        variables: { bars: [{ label: "A" }, { label: "B" }, { label: "C" }, { label: "D" }] },
        timing: { contentFields: ["bars"], contentUnit: "items" as const },
        expectedDuration: 6,
      },
    ];

    for (const fixture of cases) {
      const run = async () => {
        const response = createVideo({ input: "Grounded fixture", maxDurationSec: fixture.maxDurationSec }, {
          requestId: `request-${fixture.id}`,
          runId: `run-${fixture.id}`,
          getTemplatePacing: (id) => id === fixture.id
            ? { minDuration: 2, preferredDuration: 2, timing: fixture.timing }
            : undefined,
          generate: async function* () {
            yield {
              type: "scene.add" as const,
              scene: {
                id: fixture.id,
                templateId: fixture.id,
                variables: fixture.variables,
                timing: { fixedDuration: 2 },
              },
            };
            yield { type: "plan.complete" as const };
          },
        });
        const events = [];
        for await (const event of response.stream) events.push(event);
        return { events, state: await response.result };
      };

      const first = await run();
      const second = await run();
      expect(second.events, fixture.id).toEqual(first.events);
      expect(second.state, fixture.id).toEqual(first.state);
      expect(first.events.find((event) => event.type === "response.warning" &&
        event.data.warning.sceneId === fixture.id), fixture.id).toMatchObject({
        type: "response.warning",
        data: { warning: { sceneId: fixture.id, category: "readability" } },
      });
      if (fixture.expectedDuration == null) {
        expect(first.state.status, fixture.id).toBe("error");
        expect(first.state.config?.scenes.map(({ id }) => id), fixture.id)
          .toEqual(["supplied-opening"]);
      } else {
        expect(first.state.status, fixture.id).toBe("complete");
        expect(first.state.config?.scenes.find(({ id }) => id === fixture.id)?.timing, fixture.id).toMatchObject({
          startTime: 3,
          endTime: fixture.expectedDuration + 3,
          fixedDuration: fixture.expectedDuration,
        });
        expect(first.state.config?.scenes.find(({ id }) => id === fixture.id)?.timing.endTime, fixture.id)
          .toBeLessThanOrEqual(fixture.maxDurationSec);
      }
    }
  });

  it("streams a complete provider-neutral response without a hosted service", async () => {
    const { createVideo } = await import("../src/server/compose-video");
    const response = createVideo(
      {
        input: "Activation increased from 41% to 58%.",
        opening: "Your activation update is ready.",
      },
      {
        requestId: "request-test",
        runId: "run-test",
        generate: async function* () {
          yield {
            type: "scene.add" as const,
            scene: {
              id: "metric",
              templateId: "bigNumber",
              variables: { value: 58, unit: "%", label: "activation" },
              timing: { fixedDuration: 4 },
            },
          };
          yield { type: "plan.complete" as const, finishReason: "stop" as const };
        },
      },
    );

    const events = [];
    for await (const event of response.stream) events.push(event);

    expect(events.map((event) => event.type)).toEqual([
      "response.start",
      "scene.add",
      "scene.add",
      "response.complete",
    ]);
    const sceneEvents = events.filter((event) => event.type === "scene.add");
    expect(sceneEvents[0]?.type === "scene.add" && sceneEvents[0].data.scene.timing)
      .toEqual({ fixedDuration: 3, startTime: 0, endTime: 3 });
    expect(sceneEvents[1]?.type === "scene.add" && sceneEvents[1].data.scene.timing)
      .toEqual({ fixedDuration: 4, startTime: 3, endTime: 7 });
    await expect(response.result).resolves.toMatchObject({
      status: "complete",
      config: { scenes: [{ timing: { startTime: 0, endTime: 3 } }, { timing: { startTime: 3, endTime: 7 } }] },
    });
  });

  it("keeps the runtime-owned opening outside planner template selection", async () => {
    const { createVideo } = await import("../src/server/compose-video");
    const response = createVideo({
      input: "Activation update",
      opening: "Your video is getting ready.",
    }, {
      capabilities: { templates: ["bigNumber"] },
      generate: async function* () { yield { type: "plan.complete" as const }; },
    });

    expect(response.initialConfig.scenes[0]).toMatchObject({
      id: "supplied-opening",
      templateId: "chapterTitle",
      variables: { title: "Your video is getting ready." },
    });
    expect(response.request.capabilities).toEqual({ templates: ["bigNumber"] });
  });

  it("validates the deterministic opening before streaming starts", async () => {
    const { createVideo } = await import("../src/server/compose-video");
    const validateScene = vi.fn(() => { throw new Error("opening schema rejected"); });

    expect(() => createVideo({
      input: "Activation update",
      opening: "Your video is getting ready.",
    }, {
      capabilities: { templates: ["media"] },
      validateScene,
      generate: async function* () { yield { type: "plan.complete" as const }; },
    })).toThrow("opening schema rejected");
    expect(validateScene).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "supplied-opening",
        templateId: "chapterTitle",
        variables: { title: "Your video is getting ready." },
      }),
      { input: expect.objectContaining({ opening: "Your video is getting ready." }), previousScenes: [] },
    );
  });

  it("validates a generated scene before emitting it", async () => {
    const { createVideo } = await import("../src/server/compose-video");
    const response = createVideo({ input: "Grounded facts" }, {
      validateScene: (scene) => {
        if (scene.id === "invalid") throw new Error("scene rejected");
      },
      generate: async function* () {
        yield {
          type: "scene.add" as const,
          scene: {
            id: "invalid",
            templateId: "testimonial",
            variables: { quote: "Invented" },
            timing: { fixedDuration: 4 },
          },
        };
        yield { type: "plan.complete" as const };
      },
    });

    const events = [];
    for await (const event of response.stream) events.push(event);
    expect(events.map(({ type }) => type)).toEqual(["response.start", "scene.add", "response.error"]);
    expect(events.at(-1)).toMatchObject({
      type: "response.error",
      data: { error: { code: "generation_failed", message: "Video response generation failed" } },
    });
    expect(JSON.stringify(events)).not.toContain("scene rejected");
  });

  it("errors when truncation lands no generated scenes beyond the opening", async () => {
    const { createVideo } = await import("../src/server/compose-video");
    const response = createVideo({
      input: "Grounded facts",
      opening: "Opening",
    }, {
      generate: async function* () {
        yield { type: "plan.complete" as const, finishReason: "length" as const };
      },
    });

    const events = [];
    for await (const event of response.stream) events.push(event);
    expect(events.map(({ type }) => type)).toEqual(["response.start", "scene.add", "response.error"]);
    expect(await response.result).toMatchObject({ status: "error" });
  });

  it("keeps a truncated response playable when a generated scene landed", async () => {
    const { createVideo } = await import("../src/server/compose-video");
    const response = createVideo({
      input: "Grounded facts",
      opening: "Opening",
    }, {
      generate: async function* () {
        yield {
          type: "scene.add" as const,
          scene: {
            id: "body",
            templateId: "notification",
            variables: { message: "Useful partial result" },
            timing: { fixedDuration: 4 },
          },
        };
        yield { type: "plan.complete" as const, finishReason: "length" as const };
      },
    });

    const events = [];
    for await (const event of response.stream) events.push(event);
    expect(events.at(-2)).toMatchObject({
      type: "response.warning",
      data: {
        warning: {
          code: "plan_incomplete",
          category: "provider",
          recoverable: true,
        },
      },
    });
    expect(events.at(-1)).toMatchObject({
      type: "response.complete",
      data: { finishReason: "length" },
    });
    expect(await response.result).toMatchObject({ status: "complete", finishReason: "length" });
  });

  it("rejects a generated template outside negotiated capabilities", async () => {
    const { createVideo } = await import("../src/server/compose-video");
    const response = createVideo({ input: "Grounded facts" }, {
      capabilities: { templates: ["notification"] },
      generate: async function* () {
        yield {
          type: "scene.add" as const,
          scene: {
            id: "outside-kit",
            templateId: "testimonial",
            variables: {},
            timing: { fixedDuration: 4 },
          },
        };
        yield { type: "plan.complete" as const };
      },
    });

    const events = [];
    for await (const event of response.stream) events.push(event);
    expect(events.map(({ type }) => type)).toEqual(["response.start", "scene.add", "response.error"]);
    expect(events.at(-1)).toMatchObject({
      type: "response.error",
      data: { error: { code: "generation_failed", message: "Video response generation failed" } },
    });
    expect(JSON.stringify(events)).not.toContain("not negotiated");
  });
});
