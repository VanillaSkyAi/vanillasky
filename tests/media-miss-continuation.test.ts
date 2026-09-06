import { describe, expect, it } from "vitest";
import { createVideoHandler } from "../src/server/create-video-handler";
import { decodeVideoSse } from "../src/protocol/sse";
import type { VideoGenerationSummary } from "../src/server/lifecycle";

async function run(mediaConcurrency: number, invalidPartBehavior: "drop" | "fail", fallbackText?: string) {
  let summary: VideoGenerationSummary | undefined;
  const errors: string[] = [];
  const handler = createVideoHandler({
    authorize: "none", heartbeatMs: false, mediaConcurrency, invalidPartBehavior,
    resolveMedia: query => query === "robot planting seed" ? { type: "video", url: "https://media.example/seed.mp4" } : null,
    onComplete: value => { summary = value; },
    onError: error => { errors.push(error.message); },
    streamText: async function* () {
      yield JSON.stringify({type:"scene.add",scene:{id:"fixture-first-shot",templateId:"cinemaMedia",variables:{mediaKeyword:"robot planting seed",mediaType:"video",fallbackText:"Seeds take root"},narration:"A robot plants a seed beside the garden wall.",timing:{fixedDuration:5}}}) + "\n";
      yield JSON.stringify({ type: "scene.add", scene: { id: "missing-media", templateId: "cinemaMedia", variables: {
        mediaKeyword: "robot watering seed", mediaSource: "stock", mediaType: "video", ...(fallbackText ? { fallbackText } : {}),
      }, timing: { fixedDuration: 5 }, narration: "The seed needs water before its first leaves can unfurl." } }) + "\n";
      yield JSON.stringify({ type: "scene.add", scene: { id: "later", templateId: "chapterTitle", variables: { title: "The first leaves" },
        timing: { fixedDuration: 4 }, narration: "Two tiny leaves emerge as the robot watches in wonder." } }) + "\n";
      yield JSON.stringify({ type: "scene.add", placement: "closer", scene: { id: "ending", templateId: "chapterTitle", variables: { title: "A garden awakens" },
        timing: { fixedDuration: 4 }, narration: "At sunrise the whole garden answers with new leaves." } }) + "\n";
      yield '{"type":"plan.complete"}\n';
    },
  });
  const response = await handler(new Request("https://app.example/api?action=response", {
    method: "POST", body: JSON.stringify({ protocolVersion:"0.6", requestId:"fixture", input:{input:"Tell a story about a robot garden",opening:false,knowledgeMode:"general"} }),
  }));
  const events = [];
  for await (const event of decodeVideoSse(response.body!)) events.push(event);
  return { events, summary, errors, scenes: events.flatMap(event => event.type === "scene.add" ? [event.data.scene] : []) };
}

describe("media miss plan continuation", () => {
  it.each([1, 3, 5])("keeps later scenes and closer after an unrepresentable shot with concurrency %i", async concurrency => {
    const result = await run(concurrency, "drop");
    expect(result.scenes.map(scene => scene.id.replace(/^.*-first-shot$/, "first-shot"))).toEqual(["first-shot", "later", "ending"]);
    expect(result.events.at(-1)).toMatchObject({ type: "response.complete", data: { finishReason: "stop" } });
    expect(result.summary).toMatchObject({ acceptedSceneCount: 3, rejectedSceneCount: 1 });
    expect(result.errors).toEqual(["A media scene without a usable asset requires grounded fallbackText (1–65 characters)"]);
    const warnings = result.events.flatMap(event => event.type === "response.warning" ? [event.data.warning.code] : []);
    expect(warnings).toContain("provider_warning");
    expect(warnings).not.toContain("plan_missing_closer");
    expect(warnings).not.toContain("plan_incomplete");
  });
  it.each([1, 3])("keeps strict resolution errors terminal with concurrency %i", async concurrency => {
    const result = await run(concurrency, "fail");
    expect(result.events.at(-1)?.type).toBe("response.error");
    expect(result.scenes).toHaveLength(1);
  });
  it.each([1, 3])("uses authored fallback without dropping its narration with concurrency %i", async concurrency => {
    const result = await run(concurrency, "drop", "Water reaches the roots");
    expect(result.scenes).toHaveLength(4);
    expect(result.scenes[1]).toMatchObject({ id: "missing-media", templateId: "chapterTitle", variables: { title: "Water reaches the roots" },
      narration: "The seed needs water before its first leaves can unfurl." });
    expect(result.summary).toMatchObject({ acceptedSceneCount: 4, rejectedSceneCount: 0 });
  });
});
