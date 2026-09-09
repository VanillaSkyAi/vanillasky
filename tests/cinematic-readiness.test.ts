import { describe, expect, it } from "vitest";
import { prepareNarratedScene, preparedSceneDuration } from "../src/player/scene-readiness";
import type { VideoScene } from "../src/protocol/types";
const scene = (seconds: number): VideoScene => ({ id: String(seconds), templateId: "points", variables: { items: ["One", "Two", "Three", "Four"] }, timing: { fixedDuration: seconds } });
describe("cinematic preparation", () => {
  it("retains estimated footage only when live narration will own its completion", () => {
    const footage: VideoScene = { id: "browser", templateId: "cinemaMedia", variables: { mediaDurationSec: 5, measuredSpeechDurationSec: 99 }, narration: "The complete browser-spoken line.", timing: { fixedDuration: 5 } };
    const prepared = prepareNarratedScene(footage, 10, false, true);
    expect(prepared.recovered).toBe(false);
    expect(prepared.scene.templateId).toBe("cinemaMedia");
    expect(prepared.scene.variables.measuredSpeechDurationSec).toBeUndefined();
    expect(prepareNarratedScene(footage, 10, false).recovered).toBe(true);
  });
  it("does not certify an estimated duration or use it for exceptional repeat or a shorter tail", () => {
    const footage: VideoScene = { id: "estimated", templateId: "cinemaMedia", variables: { mediaDurationSec: 5 }, narration: "The whole line is preserved.", timing: { fixedDuration: 5 } };
    for (const seconds of [4.5, 5.5]) {
      const prepared = prepareNarratedScene(footage, seconds);
      expect(prepared).toMatchObject({ recovered: true, scene: { templateId: "chapterTitle", narration: footage.narration } });
      expect(prepared.scene.variables.measuredSpeechDurationSec).toBeUndefined();
      expect(prepared.scene.timing.fixedDuration).toBeCloseTo(seconds + .8);
    }
  });
  it.each([
    { clip: 2, speech: 2.5 },
    { clip: 5, speech: 7 },
    { clip: 5, speech: 10 },
    { clip: 5, speech: 12 },
    { clip: 5, speech: 22 },
  ])("retains footage for the complete measured narration ($clip seconds, $speech spoken)", ({ clip, speech }) => {
    const footage: VideoScene = { id: "repeat", templateId: "cinemaMedia", variables: { mediaUrl: "/clip.mp4", mediaType: "video", mediaDurationSec: clip }, narration: "The complete recorded line.", timing: { fixedDuration: clip } };
    const prepared = prepareNarratedScene(footage, speech, true);
    expect(prepared).toMatchObject({ recovered: false, scene: { templateId: "cinemaMedia", narration: footage.narration } });
    expect(prepared.scene.timing.fixedDuration).toBeCloseTo(speech);
    expect(prepared.scene.variables.measuredSpeechDurationSec).toBe(speech);
  });
  it.each([
    { requested: 2, actual: undefined },
    { requested: 6, actual: 2 },
  ])("keeps fitting narration as footage for a two-second budget ($requested requested, $actual actual)", ({ requested, actual }) => {
    const footage: VideoScene = { id: "wave", templateId: "cinemaMedia", variables: { mediaUrl: "https://media.test/wave.mp4", mediaType: "video", ...(actual === undefined ? {} : { mediaDurationSec: actual }) }, narration: "Waves rise.", timing: { fixedDuration: requested } };
    const prepared = prepareNarratedScene(footage, 1.2, true);
    expect(prepared).toMatchObject({ recovered: false, clipDurationSec: 2, scene: { templateId: "cinemaMedia", narration: footage.narration } });
    expect(prepared.scene.timing.fixedDuration).toBeCloseTo(2);
    expect(prepared.scene.timing.fixedDuration).toBeLessThanOrEqual(2);
    const repeated = prepareNarratedScene(footage, 2.51, true);
    expect(repeated).toMatchObject({ recovered: false, scene: { templateId: "cinemaMedia", narration: footage.narration } });
    expect(repeated.scene.timing.fixedDuration).toBeCloseTo(2.51);
  });
  it.each([1.7, 2])("does not extend footage just to fill a quiet tail after %s seconds of measured speech", speech => {
    const footage: VideoScene = { id: "tail", templateId: "cinemaMedia", variables: { mediaDurationSec: 2 }, narration: "Waves rise.", timing: { fixedDuration: 2 } };
    const prepared = prepareNarratedScene(footage, speech, true);
    expect(prepared.recovered).toBe(false);
    expect(prepared.scene.timing.fixedDuration).toBe(2);
  });
  it.each([undefined, NaN, Infinity, 0, -1])("does not trust persisted speech measurement when current speech is %s", speech => {
    const footage: VideoScene = { id: "unknown", templateId: "cinemaMedia", variables: { mediaDurationSec: 2, measuredSpeechDurationSec: 2.1 }, narration: "The wave rises near the shore and carries energy through the water.", timing: { fixedDuration: 2 } };
    const prepared = prepareNarratedScene(footage, speech, true);
    expect(prepared).toMatchObject({ recovered: true, scene: { templateId: "chapterTitle", narration: footage.narration } });
    expect(prepared.scene.variables.measuredSpeechDurationSec).toBeUndefined();
    expect(prepareNarratedScene(footage, 1, true).scene.variables.measuredSpeechDurationSec).toBe(1);
  });
  it.each([5, 6, 8])("retains the complete speech tail within a %s-second clip", seconds => {
    const footage: VideoScene = { id: "wave", templateId: "cinemaMedia", variables: { mediaDurationSec: seconds }, narration: "The wave rises near the shore.", timing: { fixedDuration: seconds } };
    const prepared = prepareNarratedScene(footage, seconds - .8, true);
    expect(prepared.recovered).toBe(false);
    expect(prepared.scene.timing.fixedDuration).toBeCloseTo(seconds);
  });
  it.each([
    { requested: 5, actual: 12, speech: 8 },
    { requested: 2, actual: 3, speech: 2.2 },
  ])("uses delivered footage rather than its requested estimate ($requested requested, $actual actual)", ({ requested, actual, speech }) => {
    const footage: VideoScene = { id: "wave", templateId: "cinemaMedia", variables: { mediaDurationSec: actual }, narration: "The wave rises near the shore.", timing: { fixedDuration: requested } };
    const prepared = prepareNarratedScene(footage, speech, true);
    expect(prepared).toMatchObject({ recovered: false, clipDurationSec: actual, scene: { templateId: "cinemaMedia", narration: footage.narration } });
    expect(prepared.scene.timing.fixedDuration).toBeCloseTo(speech + .8);
  });
  it("does not cap unmeasured narration to the footage display budget", () => {
    const footage: VideoScene = { id: "wave", templateId: "cinemaMedia", variables: {}, narration: "The wave rises near the shore and carries energy through the water.", timing: { fixedDuration: 2 } };
    expect(prepareNarratedScene(footage, undefined).scene.timing.fixedDuration).toBeGreaterThan(2);
  });
  it("repeats delivered footage when it is shorter than measured narration", () => {
    const footage: VideoScene = { id: "wave", templateId: "cinemaMedia", variables: { mediaUrl: "https://media.test/wave.mp4", mediaType: "video", mediaDurationSec: 5, fallbackText: "The wave rises" }, narration: "The wave rises near the shore.", timing: { fixedDuration: 6 } };
    expect(prepareNarratedScene(footage, 4, true).scene).toMatchObject({ templateId: "cinemaMedia", timing: { fixedDuration: 4.8 } });
    const repeated = prepareNarratedScene(footage, 6.01, true);
    expect(repeated.recovered).toBe(false);
    expect(repeated.scene).toMatchObject({ templateId: "cinemaMedia", narration: footage.narration });
    expect(repeated.scene.timing.fixedDuration).toBeCloseTo(6.01);
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
