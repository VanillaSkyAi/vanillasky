import { describe, expect, it } from "vitest";
import { prepareNarratedScene, preparedSceneDuration } from "../src/player/scene-readiness";
import type { VideoScene } from "../src/protocol/types";
const scene = (seconds: number): VideoScene => ({ id: String(seconds), templateId: "points", variables: { items: ["One", "Two", "Three", "Four"] }, timing: { fixedDuration: seconds } });
describe("cinematic preparation", () => {
  it.each([
    { requested: 2, actual: undefined },
    { requested: 6, actual: 2 },
  ])("keeps fitting narration as footage for a two-second budget ($requested requested, $actual actual)", ({ requested, actual }) => {
    const footage: VideoScene = { id: "wave", templateId: "cinemaMedia", variables: { mediaUrl: "https://media.test/wave.mp4", mediaType: "video", ...(actual === undefined ? {} : { mediaDurationSec: actual }) }, narration: "Waves rise.", timing: { fixedDuration: requested } };
    const prepared = prepareNarratedScene(footage, 1.2);
    expect(prepared).toMatchObject({ recovered: false, clipDurationSec: 2, scene: { templateId: "cinemaMedia", narration: footage.narration } });
    expect(prepared.scene.timing.fixedDuration).toBeCloseTo(2);
    expect(prepared.scene.timing.fixedDuration).toBeLessThanOrEqual(2);
    const oversized = prepareNarratedScene(footage, 1.21);
    expect(oversized).toMatchObject({ recovered: true, scene: { templateId: "chapterTitle", narration: footage.narration } });
    expect(oversized.scene.timing.fixedDuration).toBeCloseTo(3.1);
  });
  it.each([5, 6, 8])("retains the complete speech tail within a %s-second clip", seconds => {
    const footage: VideoScene = { id: "wave", templateId: "cinemaMedia", variables: { mediaDurationSec: seconds }, narration: "The wave rises near the shore.", timing: { fixedDuration: seconds } };
    const prepared = prepareNarratedScene(footage, seconds - .8);
    expect(prepared.recovered).toBe(false);
    expect(prepared.scene.timing.fixedDuration).toBeCloseTo(seconds);
  });
  it.each([
    { requested: 5, actual: 12, speech: 8 },
    { requested: 2, actual: 3, speech: 2.2 },
  ])("uses delivered footage rather than its requested estimate ($requested requested, $actual actual)", ({ requested, actual, speech }) => {
    const footage: VideoScene = { id: "wave", templateId: "cinemaMedia", variables: { mediaDurationSec: actual }, narration: "The wave rises near the shore.", timing: { fixedDuration: requested } };
    const prepared = prepareNarratedScene(footage, speech);
    expect(prepared).toMatchObject({ recovered: false, clipDurationSec: actual, scene: { templateId: "cinemaMedia", narration: footage.narration } });
    expect(prepared.scene.timing.fixedDuration).toBeCloseTo(speech + .8);
  });
  it("does not cap unmeasured narration to the footage display budget", () => {
    const footage: VideoScene = { id: "wave", templateId: "cinemaMedia", variables: {}, narration: "The wave rises near the shore and carries energy through the water.", timing: { fixedDuration: 2 } };
    expect(prepareNarratedScene(footage, undefined).scene.timing.fixedDuration).toBeGreaterThan(2);
  });
  it("recovers complete narration when reported footage is shorter than requested", () => {
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
