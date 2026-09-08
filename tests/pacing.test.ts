import { describe, expect, it } from "vitest";

import type { VideoScene, VideoTemplatePacing } from "../src/protocol/types";
import {
  getCloserReserve,
  getReadableSceneDuration,
  paceScene,
} from "../src/protocol/pacing";

function scene(variables: Record<string, unknown>, fixedDuration = 4): VideoScene {
  return { id: "scene", templateId: "template", variables, timing: { fixedDuration } };
}

describe("deterministic scene pacing", () => {
  it("does not stretch explicitly timed footage to a chapter's display floor", () => {
    const result = paceScene({ id: "short", templateId: "cinemaMedia", variables: { mediaType: "video", mediaUrl: "https://app.test/short.mp4" }, timing: { fixedDuration: 2 } }, {
      previousScenes: [], maxDurationSec: 10, closerReserveSec: 0,
      getTemplatePacing: () => ({ minDuration: 3 }),
    });
    expect(result.scene?.timing).toEqual({ startTime: 0, endTime: 2, fixedDuration: 2 });
  });
  it("holds a short opening beat for at least three seconds when the budget permits", () => {
    const opening = paceScene(scene({ message: "Ready" }, 1), {
      previousScenes: [],
      maxDurationSec: 10,
      closerReserveSec: 0,
      getTemplatePacing: () => ({ minDuration: 1, preferredDuration: 1 }),
    });
    const followUp = paceScene(scene({ message: "Next" }, 1), {
      previousScenes: opening.scene ? [opening.scene] : [],
      maxDurationSec: 10,
      closerReserveSec: 0,
      getTemplatePacing: () => ({ minDuration: 1, preferredDuration: 1 }),
    });

    expect(opening.scene?.timing).toMatchObject({ startTime: 0, endTime: 3, fixedDuration: 3 });
    expect(followUp.scene?.timing).toMatchObject({ startTime: 3, endTime: 4, fixedDuration: 1 });
  });

  it.each([
    [
      "words",
      { headline: "One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen" },
      { contentFields: ["headline"], contentUnit: "words" as const },
      5,
    ],
    [
      "characters",
      { body: "1234567890123456789012345" },
      { contentFields: ["body"], contentUnit: "characters" as const },
      3,
    ],
    [
      "items",
      { items: ["one", "two", "three"] },
      { contentFields: ["items"], contentUnit: "items" as const },
      5,
    ],
    [
      "multiple data points",
      { bars: [{ label: "A", value: 10 }, { label: "B", value: 20 }, { label: "C", value: 30 }, { label: "D", value: 40 }] },
      { contentFields: ["bars"], contentUnit: "items" as const },
      6,
    ],
  ])("calculates a quarter-second readable minimum for %s", (_name, variables, timing, expected) => {
    expect(getReadableSceneDuration(scene(variables), {
      minDuration: 2,
      timing,
    })).toBe(expected);
  });

  it("merges trusted schema defaults before measuring content", () => {
    const metadata: VideoTemplatePacing = {
      minDuration: 1,
      schema: { properties: { body: { default: "1234567890123456789012345" } } },
      timing: { contentFields: ["body"], contentUnit: "characters" },
    };

    expect(getReadableSceneDuration(scene({}), metadata)).toBe(3);
  });

  it("uses the highest negotiated ask minimum for its closer reserve", () => {
    const metadata: Record<string, VideoTemplatePacing> = {
      body: { jobs: ["claim"], minDuration: 2 },
      logo: { jobs: ["ask"], minDuration: 3, preferredDuration: 3.5 },
      media: { jobs: ["ask"], minDuration: 4.5 },
    };

    expect(getCloserReserve(["body", "logo"], (id) => metadata[id])).toBe(3.5);
    expect(getCloserReserve(["body", "logo", "media"], (id) => metadata[id])).toBe(4.5);
    expect(getCloserReserve(["body"], (id) => metadata[id])).toBe(0);
  });

  it("normalizes sequential scenes without overlap and returns identical output", () => {
    const metadata: VideoTemplatePacing = {
      minDuration: 2,
      preferredDuration: 4,
      timing: { contentFields: ["message"], contentUnit: "words" },
    };
    const first = paceScene(scene({ message: "One grounded message" }, 6), {
      previousScenes: [],
      maxDurationSec: 12,
      closerReserveSec: 0,
      getTemplatePacing: () => metadata,
    }).scene!;
    const options = {
      previousScenes: [first],
      maxDurationSec: 12,
      closerReserveSec: 0,
      getTemplatePacing: () => metadata,
    };
    const second = paceScene(scene({ message: "Another grounded message" }, 4), options);

    expect(second.scene?.timing).toMatchObject({ startTime: 6, endTime: 10 });
    expect(paceScene(scene({ message: "Another grounded message" }, 4), options)).toEqual(second);
  });

  it("warns when explicit positioning is normalized onto the sequential timeline", () => {
    const prior = { ...scene({}), timing: { startTime: 0, endTime: 4, fixedDuration: 4 } };
    const result = paceScene({
      ...scene({ message: "Grounded" }),
      timing: { startTime: 10, endTime: 14, fixedDuration: 4 },
    }, {
      previousScenes: [prior],
      maxDurationSec: 12,
      closerReserveSec: 0,
      getTemplatePacing: () => ({ minDuration: 2 }),
    });

    expect(result.scene?.timing).toMatchObject({ startTime: 4, endTime: 8, fixedDuration: 4 });
    expect(result.warnings).toMatchObject([{
      code: "scene_duration_adjusted",
      category: "readability",
      sceneId: "scene",
    }]);
  });

  it("omits a scene that cannot fit its readable minimum", () => {
    const result = paceScene(scene({ items: ["one", "two", "three"] }), {
      previousScenes: [{ ...scene({}), timing: { startTime: 0, endTime: 4, fixedDuration: 4 } }],
      maxDurationSec: 6,
      closerReserveSec: 0,
      getTemplatePacing: () => ({
        minDuration: 2,
        timing: { contentFields: ["items"], contentUnit: "items" },
      }),
    });

    expect(result.scene).toBeUndefined();
    expect(result.warnings).toMatchObject([{
      code: "scene_omitted_unreadable",
      category: "readability",
      recoverable: true,
    }]);
  });
});
