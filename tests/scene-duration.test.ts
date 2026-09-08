import { describe, expect, it } from "vitest";
import { getSceneDuration, getSceneDurationBounds } from "../src/protocol/scene-duration";

/**
 * How long to hold a scene.
 *
 * Every template already declares what it needs - `minDuration`,
 * `preferredDuration`, and which fields hold the content - but the computation
 * that used those was internal, so consumers reached for `minDuration` instead.
 * That is the wrong number: it is the least a template survives being squeezed
 * to when a video must fit a fixed length, not the time it takes to read. It is
 * 1 second for `media` and 1.5 for `bigNumber`, and a narrated response built on
 * it flashes past.
 */
const steps = {
  id: "how",
  templateId: "steps",
  variables: { texts: "How it works", steps: ["Gravity pulls", "Spin slows", "Rotation locks"] },
  timing: { fixedDuration: 3 },
};

const stepsMetadata = {
  minDuration: 2,
  preferredDuration: 3.5,
  timing: { contentFields: ["steps"] as const, contentUnit: "items" as const },
  schema: { type: "object" as const, properties: {} },
};

describe("scene duration", () => {
  it("grows with the content, rather than sitting at a flat minimum", () => {
    const three = getSceneDuration(steps, stepsMetadata);
    const five = getSceneDuration(
      { ...steps, variables: { ...steps.variables, steps: ["a", "b", "c", "d", "e"] } },
      stepsMetadata,
    );
    expect(three).toBeGreaterThan(stepsMetadata.minDuration);
    expect(five).toBeGreaterThan(three);
  });

  it("holds for as long as the narration takes to say", () => {
    const spoken = "The Moon always shows the same face because its spin and its orbit are locked together by tides.";
    const held = getSceneDuration({ ...steps, narration: spoken }, stepsMetadata);
    // Twenty words is longer than three steps need to be read.
    expect(held).toBeGreaterThan(getSceneDuration(steps, stepsMetadata));
  });

  it("never cuts a scene shorter than it can be read, however brief the line", () => {
    const held = getSceneDuration({ ...steps, narration: "Watch." }, stepsMetadata);
    expect(held).toBe(getSceneDuration(steps, stepsMetadata));
  });

  it("reports both bounds, so a caller can see which one is binding", () => {
    const bounds = getSceneDurationBounds(steps, stepsMetadata);
    expect(bounds.minimum).toBe(2);
    expect(bounds.readable).toBeGreaterThan(bounds.minimum);
  });

  it("falls back sensibly for a template that declares nothing", () => {
    expect(getSceneDuration(steps, undefined)).toBeGreaterThan(0);
  });
});
