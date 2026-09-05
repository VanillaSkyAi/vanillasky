import { describe, expect, it } from "vitest";
import { decodeVideoSse } from "../src/protocol/sse";

/**
 * A ceiling on how much media one request may resolve.
 *
 * Nothing bounded this. The planner decides how many scenes a video has, and
 * the base prompt encourages more of them for rich input, so a single request
 * could resolve a dozen. When media is searched for that is free; when it is
 * generated, every scene is a paid clip, and one careless request is several
 * dollars. The application that this was extracted from could be made to spend
 * by holding down a suggestion chip.
 *
 * Past the ceiling a scene falls back to the black background. The video is
 * poorer; it is not broken, and nobody is billed for the difference.
 */
function plan(sceneCount: number) {
  return async function* () {
    for (let index = 0; index < sceneCount; index += 1) {
      yield `${JSON.stringify({
        type: "scene.add",
        scene: {
          id: `scene-${index + 1}`,
          templateId: "cinemaMedia",
          variables: { fallbackText: `Beat ${index + 1}`, mediaKeyword: `subject ${index + 1}`, mediaType: "video" },
          timing: { fixedDuration: 3 },
        },
      })}\n`;
    }
    yield '{"type":"plan.complete"}\n';
  };
}

async function run(options: { scenes: number; maxResolvedMedia?: number; opening?: string | false }) {
  const { createVideoHandler } = await import("../src/server/create-video-handler");
  let calls = 0;
  const warnings: Array<{ code: string; message: string }> = [];
  const handler = createVideoHandler({
    authorize: "none",
    heartbeatMs: false,
    maxResolvedMedia: options.maxResolvedMedia,
    onWarning: (warning) => { warnings.push(warning); },
    resolveMedia: () => {
      calls += 1;
      return { url: `https://media.example.test/${calls}.mp4`, type: "video" as const };
    },
    streamText: plan(options.scenes),
  });
  const response = await handler(new Request("https://app.example/api/video", {
    method: "POST",
    body: JSON.stringify({
      protocolVersion: "0.6",
      requestId: "request-media-budget",
      input: { input: "A question whose answer runs to several beats.", ...(options.opening === undefined ? {} : { opening: options.opening }) },
      capabilities: { templates: ["cinemaMedia", "chapterTitle"] },
    }),
  }));
  const events = [];
  for await (const event of decodeVideoSse(response.body!)) events.push(event);
  // The handler adds its own opening scene; these assertions are about the
  // beats the planner wrote.
  const scenes = events
    .flatMap((event) => (event.type === "scene.add" ? [event.data.scene] : []))
    .filter((scene) => String(scene.id).startsWith("scene-"));
  return { calls, scenes, warnings };
}

describe("media budget", () => {
  it("resolves every scene when no ceiling is set", async () => {
    const { calls, scenes } = await run({ scenes: 6 });
    expect(scenes).toHaveLength(6);
    expect(calls).toBe(6);
  });

  it("stops resolving once the ceiling is reached", async () => {
    const { calls, scenes } = await run({ scenes: 6, maxResolvedMedia: 2 });
    expect(scenes).toHaveLength(6);
    expect(calls).toBe(2);
  });

  it("keeps the scenes it could not fill, as grounded chapter cards", async () => {
    const { scenes } = await run({ scenes: 5, maxResolvedMedia: 1 });
    expect(scenes).toHaveLength(5);
    const filled = scenes.filter((scene) => typeof scene.variables.mediaUrl === "string");
    expect(filled).toHaveLength(1);
    // A scene without footage still says its line, as grounded chapter cards.
    expect(scenes[4].templateId).toBe("chapterTitle");
    expect(scenes[4].variables.title).toBe("Beat 5");
  });

  // The ceiling is a spend policy, so it is reported to the application that
  // set it, not to the browser, which can do nothing about it.
  it("tells the application it stopped, rather than leaving it guessing", async () => {
    const { warnings } = await run({ scenes: 5, maxResolvedMedia: 1 });
    expect(warnings.some((warning) => warning.code === "media_budget_reached")).toBe(true);
  });

  it("warns once, however many scenes go without", async () => {
    const { warnings } = await run({ scenes: 8, maxResolvedMedia: 1 });
    expect(warnings.filter((warning) => warning.code === "media_budget_reached")).toHaveLength(1);
  });

  // Media resolution waits for the runtime's opening card to be on screen, so
  // that nothing is waiting on a provider with a blank frame showing. A host
  // that asked for no opening card owns that wait itself - and until this, its
  // first beat could never be filmed however much it was willing to spend.
  it("films the first scene when there is no opening card to wait for", async () => {
    const { calls, scenes } = await run({ scenes: 3, opening: false });
    expect(calls).toBe(3);
    expect(scenes).toHaveLength(3);
    expect(typeof scenes[0].variables.mediaUrl).toBe("string");
  });

  // The gate and the planner's brief have to agree. Letting the first scene
  // resolve media while still telling the planner to keep media off the
  // opening beat films nothing, which is exactly what happened.
  it("tells the planner the first scene may carry media, when it may", async () => {
    const { createVideoHandler } = await import("../src/server/create-video-handler");
    const prompts: string[] = [];
    const handler = createVideoHandler({
      authorize: "none",
      heartbeatMs: false,
      resolveMedia: () => ({ url: "https://media.example.test/a.mp4", type: "video" as const }),
      streamText: ({ systemPrompt }) => {
        prompts.push(systemPrompt);
        return plan(1)();
      },
    });
    const ask = (opening: string | false) => handler(new Request("https://app.example/api/video", {
      method: "POST",
      body: JSON.stringify({
        protocolVersion: "0.6",
        requestId: "request-first-scene-media",
        input: { input: "A question worth filming.", opening },
        capabilities: { templates: ["cinemaMedia", "chapterTitle"] },
      }),
    })).then(async (response) => {
      for await (const _event of decodeVideoSse(response.body!)) void _event;
    });

    await ask(false);
    expect(prompts[0]).not.toContain("The first generated body scene must be asset-free");
    expect(prompts[0]).not.toContain("forbidden as the first generated body template");

    await ask("Creating your video...");
    expect(prompts[1]).toContain("reserve external media templates");
    expect(prompts[1]).toContain("The first generated body scene must be asset-free");
  });

  // A narrated video otherwise costs a round trip per scene, chained, because
  // each line is written knowing the ones before it.
  it("asks the planner for the spoken line only when the host wants it", async () => {
    const { createVideoHandler } = await import("../src/server/create-video-handler");
    const prompts: string[] = [];
    const run = (narrate: boolean) => createVideoHandler({
      authorize: "none",
      heartbeatMs: false,
      narrate,
      streamText: ({ systemPrompt }) => {
        prompts.push(systemPrompt);
        return plan(1)();
      },
    })(new Request("https://app.example/api/video", {
      method: "POST",
      body: JSON.stringify({
        protocolVersion: "0.6",
        requestId: "request-narrate",
        input: { input: "A question worth saying something about." },
        capabilities: { templates: ["cinemaMedia", "chapterTitle"] },
      }),
    })).then(async (response) => {
      for await (const _event of decodeVideoSse(response.body!)) void _event;
    });

    await run(true);
    expect(prompts[0]).toContain('"narration"');
    expect(prompts[0]).toContain("Narration rules:");
    // After the catalogue, not only before it. The catalogue is the last and
    // largest thing the planner reads, and it lists variables only - said
    // once, early, the requirement loses to it and every scene comes back
    // silent, which is exactly what happened.
    expect(prompts[0].trimEnd().endsWith("A scene without it is incomplete.")).toBe(true);

    await run(false);
    expect(prompts[1]).not.toContain('"narration"');
    expect(prompts[1]).not.toContain("Narration rules:");
    expect(prompts[1]).not.toContain("A scene without it is incomplete.");
  });

  it("never resolves media when the ceiling is zero", async () => {
    const { calls, scenes } = await run({ scenes: 4, maxResolvedMedia: 0 });
    expect(calls).toBe(0);
    expect(scenes).toHaveLength(4);
  });
});
