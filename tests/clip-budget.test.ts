import { describe, expect, it } from "vitest";
import { CLIP_NARRATION_TAIL_SEC, clipNarrationBudget, estimateNarrationSeconds, narrationFitsClip, speechFitsClip } from "../src/protocol/clip-budget";

describe("clip narration budget", () => {
  it.each([2, 5, 6, 8, 10, 20])("leaves authoring headroom for a voice 25%% slower than the estimate in a %ss clip", durationSec => {
    const budget = clipNarrationBudget(durationSec);
    const words = `${"word ".repeat(budget.targetWords).trim()}.`;
    const unspaced = `${"水".repeat(budget.targetUnspacedCharacters)}。`;
    expect(speechFitsClip(estimateNarrationSeconds(words) * 1.25, durationSec)).toBe(true);
    expect(speechFitsClip(estimateNarrationSeconds(unspaced) * 1.25, durationSec)).toBe(true);
  });
  it("reserves the complete narration tail at the measured boundary", () => {
    expect(CLIP_NARRATION_TAIL_SEC).toBe(.8);
    expect(speechFitsClip(5.2, 6)).toBe(true);
    expect(speechFitsClip(5.21, 6)).toBe(false);
    expect(speechFitsClip(Number.NaN, 6)).toBe(false);
    expect(speechFitsClip(5, Number.POSITIVE_INFINITY)).toBe(false);
    expect(speechFitsClip(-1, 6)).toBe(false);
  });

  it("rejects long narration before generation, including scripts without spaces", () => {
    expect(narrationFitsClip("Waves slow as they approach the shore.", 6)).toBe(true);
    expect(narrationFitsClip("Waves slow as they approach the shore. The sea floor pushes the wave upward until it breaks.", 6)).toBe(false);
    expect(narrationFitsClip("海水接近岸边时速度逐渐降低，海底将波浪向上推起，直到波浪最终破碎。", 6)).toBe(false);
    expect(estimateNarrationSeconds("你好世界")).toBeGreaterThan(1);
    expect(estimateNarrationSeconds("  ")).toBe(0);
  });
});
