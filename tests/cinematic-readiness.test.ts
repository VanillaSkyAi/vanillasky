import { describe, expect, it } from "vitest";
import { preparedSceneDuration } from "../src/player/scene-readiness";
import type { VideoScene } from "../src/protocol/types";
const scene = (seconds: number): VideoScene => ({ id: String(seconds), templateId: "points", variables: { items: ["One", "Two", "Three", "Four"] }, timing: { fixedDuration: seconds } });
describe("cinematic preparation", () => {
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
