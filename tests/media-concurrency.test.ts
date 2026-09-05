import { describe, expect, it } from "vitest";
import { decodeVideoSse } from "../src/protocol/sse";

/**
 * Media that is generated rather than searched changes what serial costs.
 *
 * Resolving a stock photo takes a couple of hundred milliseconds, so doing it
 * one scene at a time is invisible. Generating a video clip takes seconds, and
 * five scenes in a row is half a minute of nothing - which is why the scene
 * director in the VanillaSky site had to plan the shots first and generate them
 * outside the plan stream, rebuilding the planner to do it.
 */
const SLOW_MS = 60;

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

async function run(options: { mediaConcurrency?: number; scenes: number }) {
  const { createVideoHandler } = await import("../src/server/create-video-handler");
  const started: number[] = [];
  const handler = createVideoHandler({
    authorize: "none",
    heartbeatMs: false,
    mediaConcurrency: options.mediaConcurrency,
    resolveMedia: async (query: string) => {
      started.push(Date.now());
      await new Promise((resolve) => setTimeout(resolve, SLOW_MS));
      return { url: `https://media.example.test/${encodeURIComponent(query)}.mp4`, type: "video" as const };
    },
    streamText: plan(options.scenes),
  });
  const begin = Date.now();
  const response = await handler(new Request("https://app.example/api/video", {
    method: "POST",
    body: JSON.stringify({
      protocolVersion: "0.6",
      requestId: "request-media-concurrency",
      input: { input: "Three beats that each need a generated clip.", opening: false },
      capabilities: { templates: ["cinemaMedia"] },
    }),
  }));
  const events = [];
  for await (const event of decodeVideoSse(response.body!)) events.push(event);
  const scenes = events.flatMap((event) => (event.type === "scene.add" ? [event.data.scene] : []));
  return { scenes, elapsed: Date.now() - begin, started };
}

describe("media resolution concurrency", () => {
  // These requests set `opening: false`, so every scene resolves - including
  // the first. The wait the opening gate protects is the host's to own once it
  // has declined the runtime's card.
  it("resolves one scene at a time by default", async () => {
    const { scenes, elapsed, started } = await run({ scenes: 4 });
    expect(scenes).toHaveLength(4);
    expect(started).toHaveLength(4);
    expect(elapsed).toBeGreaterThanOrEqual(SLOW_MS * 4);
  });

  it("overlaps resolution when the host allows it", async () => {
    const { scenes, elapsed, started } = await run({ scenes: 4, mediaConcurrency: 4 });
    expect(scenes).toHaveLength(4);
    expect(started).toHaveLength(4);
    // Four at once costs about one, not four.
    expect(elapsed).toBeLessThan(SLOW_MS * 2.5);
  });

  it("emits the first resolved scene while the planner is still producing the rest", async () => {
    const { createVideoHandler } = await import("../src/server/create-video-handler");
    let releaseRemainder!: () => void;
    const remainder = new Promise<void>((resolve) => { releaseRemainder = resolve; });
    let sawFirstScene!: () => void;
    const firstScene = new Promise<void>((resolve) => { sawFirstScene = resolve; });
    const handler = createVideoHandler({
      authorize: "none",
      heartbeatMs: false,
      mediaConcurrency: 5,
      resolveMedia: async (query: string) => ({
        url: `https://media.example.test/${encodeURIComponent(query)}.mp4`,
        type: "video" as const,
      }),
      streamText: async function* () {
        yield '{"type":"scene.add","scene":{"id":"scene-1","templateId":"cinemaMedia","variables":{"mediaType":"video","mediaKeyword":"first subject","fallbackText":"First beat"},"timing":{"fixedDuration":3}}}\n';
        await remainder;
        yield '{"type":"scene.add","placement":"closer","scene":{"id":"closer","templateId":"cinemaMedia","variables":{"mediaType":"video","mediaKeyword":"final subject","fallbackText":"Final beat"},"timing":{"fixedDuration":3}}}\n';
        yield '{"type":"plan.complete"}\n';
      },
    });
    const response = await handler(new Request("https://app.example/api/video", {
      method: "POST",
      body: JSON.stringify({
        protocolVersion: "0.6",
        requestId: "request-first-scene-streaming",
        input: { input: "A response whose later scenes are still being planned.", opening: false },
        capabilities: { templates: ["cinemaMedia"] },
      }),
    }));
    const consuming = (async () => {
      for await (const event of decodeVideoSse(response.body!)) {
        if (event.type === "scene.add" && event.data.scene.id === "scene-1") sawFirstScene();
      }
    })();

    const emittedBeforeRemainder = await Promise.race([
      firstScene.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 250)),
    ]);
    releaseRemainder();
    await consuming;

    expect(emittedBeforeRemainder).toBe(true);
  });

  it("keeps scenes in the order the planner wrote them", async () => {
    const { scenes } = await run({ scenes: 5, mediaConcurrency: 5 });
    expect(scenes.map((scene) => scene.id)).toEqual([
      "scene-1", "scene-2", "scene-3", "scene-4", "scene-5",
    ]);
    expect(scenes.map((scene) => scene.variables.mediaUrl)).toEqual([
      "https://media.example.test/subject%201.mp4",
      "https://media.example.test/subject%202.mp4",
      "https://media.example.test/subject%203.mp4",
      "https://media.example.test/subject%204.mp4",
      "https://media.example.test/subject%205.mp4",
    ]);
  });

  it("never runs more than the host allowed at once", async () => {
    const { started } = await run({ scenes: 7, mediaConcurrency: 2 });
    expect(started).toHaveLength(7);
    // With two in flight, the third can only start once the first has returned.
    expect(started[2] - started[0]).toBeGreaterThanOrEqual(SLOW_MS - 15);
  });
});
