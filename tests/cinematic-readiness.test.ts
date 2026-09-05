import { describe, expect, it } from "vitest";
import { canStartPreparedSequence, preparedSceneDuration } from "../src/player/scene-readiness";
import type { VideoScene } from "../src/protocol/types";
const scene = (seconds: number): VideoScene => ({ id: String(seconds), templateId: "points", variables: { items: ["One", "Two", "Three", "Four"] }, timing: { fixedDuration: seconds } });
describe("cinematic preparation", () => {
  it("never counts ready scenes past a gap", () => {
    expect(canStartPreparedSequence([scene(4), undefined, scene(8)], false)).toBe(false);
  });
  it("starts a contiguous eight-second window without waiting for the whole stream", () => {
    expect(canStartPreparedSequence([scene(4), scene(4)], false)).toBe(true);
  });
  it("allows a completed short sequence, but not an empty or gapped sequence", () => {
    expect(canStartPreparedSequence([scene(3)], true)).toBe(true);
    expect(canStartPreparedSequence([], true)).toBe(false);
    expect(canStartPreparedSequence([undefined, scene(3)], true)).toBe(false);
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
