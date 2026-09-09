import { expect, it } from "vitest";
import { measuredClipPlayback } from "../src/player/clip-repeat";

it.each([
  [4, 5, 4.8, 0], [4.8, 5, 5, 0], [5, 5, 5, 0],
  [7, 5, 7, 1], [10, 5, 10, 1], [12, 5, 12, 2], [22, 5, 22, 4],
  [10, 4, 10, 2], [12, 3, 12, 3],
])("covers %ss speech with %ss clips and no extra repeated quiet tail", (speech, clip, durationSec, repeatCount) => {
  expect(measuredClipPlayback(speech, clip)).toEqual({ durationSec, repeatCount });
});

it.each([undefined, "12", NaN, Infinity, -1, 0])("rejects an invalid speech measurement: %s", speech => {
  expect(measuredClipPlayback(speech, 5)).toBeUndefined();
});
it.each([NaN, Infinity, -1, 0, Number.MIN_VALUE])("rejects unusable decoded durations: %s", clip => {
  expect(measuredClipPlayback(12, clip)).toBeUndefined();
});
