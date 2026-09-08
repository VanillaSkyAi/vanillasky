import { describe, expect, it } from "vitest";
import { prepareNarratedScene, preparedSceneDuration } from "../src/player/scene-readiness";
import type { VideoScene } from "../src/protocol/types";
const scene = (seconds: number): VideoScene => ({ id: String(seconds), templateId: "points", variables: { items: ["One", "Two", "Three", "Four"] }, timing: { fixedDuration: seconds } });
describe("cinematic preparation", () => {
  it("keeps measured narration within requested and reported footage budgets", () => {
    const footage: VideoScene = { id: "wave", templateId: "cinemaMedia", variables: { mediaUrl: "https://media.test/wave.mp4", mediaType: "video", mediaDurationSec: 5, fallbackText: "The wave rises" }, narration: "The wave rises near the shore.", timing: { fixedDuration: 6 } };
    expect(prepareNarratedScene(footage, 4).scene).toMatchObject({ templateId: "cinemaMedia", timing: { fixedDuration: 4.8 } });
    const recovered = prepareNarratedScene(footage, 5);
    expect(recovered.recovered).toBe(true);
    expect(recovered.scene).toMatchObject({ templateId: "chapterTitle", narration: footage.narration, variables: { title: "The wave rises" }, timing: { fixedDuration: 5.8 } });
    expect(footage.templateId).toBe("cinemaMedia");
  });
  it("short speech cannot erase the reading and authored minimum", () => {
    expect(preparedSceneDuration(scene(4), 1, { minDuration: 5, timing: { contentFields: ["items"], contentUnit: "items" } })).toBe(6);
  });
  it("preserves authored reveal, hold and exit even with short speech", () => {
    expect(preparedSceneDuration(scene(4), 1, { timing: {contentFields: [], contentUnit: "words", revealSeconds: 2, holdSeconds: 3, exitSeconds: 1} })).toBe(6);
  });
  it("measured speech can extend the reading floor", () => {
    expect(preparedSceneDuration(scene(4), 10, { minDuration: 5 })).toBe(10.8);
  });
});
