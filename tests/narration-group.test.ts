import { describe, expect, it } from "vitest";
import { validateNarrationGroups } from "../src/protocol/narration-group.js";
import type { VideoScene } from "../src/protocol/types.js";
const scenes = (): VideoScene[] => ["First thought.", "Second thought."].map((narration, index) => ({
  id: String(index), templateId: "cinemaMedia", variables: {}, timing: { fixedDuration: 3 }, narration,
  narrationGroup: { id: "paragraph", text: "First thought. Second thought.", offsetSeconds: index * 3, durationSeconds: 3, totalSeconds: 6 },
}));
describe("host-authored narration groups", () => {
  it("accepts one complete paragraph with aligned scene cuts", () => expect(() => validateNarrationGroups(scenes())).not.toThrow());
  it.each(["offset", "duration", "text", "missing", "reused"])("rejects %s corruption before playback", (kind) => {
    const value = scenes();
    if (kind === "offset") value[1]!.narrationGroup!.offsetSeconds = 2;
    if (kind === "duration") value[1]!.timing.fixedDuration = 4;
    if (kind === "text") value[1]!.narration = "Something else.";
    if (kind === "missing") value.pop();
    if (kind === "reused") value.push(...scenes());
    expect(() => validateNarrationGroups(value)).toThrow();
  });
});
