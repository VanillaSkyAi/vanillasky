import { describe, expect, it } from "vitest";

import { getVideoDuration } from "../src/protocol/timeline";
import { resolveVideoTimeline } from "../src/protocol/timeline";
import type { Video } from "../src/protocol/types";
import { TEST_VIDEO_STYLE as style } from "./helpers/video-style";

describe("React-free video timeline", () => {
  it("resolves explicit, beat-backed, and fallback timing deterministically", () => {
    const video: Video = {
      schemaVersion: "0.2",
      style,
      audio: {
        trackId: "track",
        audioUrl: "https://cdn.example/track.mp3",
        duration: 12,
        beatDetection: { sensitivity: 0.5 },
        beatMarkers: [{ time: 5 }, { time: 8 }],
      },
      scenes: [
        { id: "first", templateId: "notification", variables: {}, timing: { fixedDuration: 2 } },
        { id: "second", templateId: "notification", variables: {}, timing: { beatStart: 0, beatEnd: 1 } },
        { id: "third", templateId: "notification", variables: {}, timing: {} },
      ],
    };

    expect(resolveVideoTimeline(video).map(({ start, end }) => ({ start, end }))).toEqual([
      { start: 0, end: 2 },
      { start: 5, end: 8 },
      { start: 8, end: 13 },
    ]);
    expect(getVideoDuration(video)).toBe(13);
    expect(getVideoDuration({ schemaVersion: "0.2", style, scenes: [] })).toBe(0);
  });
});
