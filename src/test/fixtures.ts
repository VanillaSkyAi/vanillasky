import { deepFreeze } from "./clone.js";
import type { MockVideoStreamPart, VideoGenerationFixture } from "./types.js";

const portrait: VideoGenerationFixture = {
  input: {
    input: "VanillaSky summarizes a grounded product update.",
    orientation: "portrait",
  },
  parts: [
    {
      type: "scene.add",
      scene: {
        id: "portrait-summary",
        templateId: "chapterTitle",
        variables: { title: "Grounded product update" },
        timing: { fixedDuration: 4 },
      },
    },
    { type: "plan.complete" },
  ],
};

const landscape: VideoGenerationFixture = {
  input: {
    input: "Revenue reached 42 million.",
    orientation: "landscape",
  },
  parts: [
    {
      type: "scene.add",
      scene: {
        id: "landscape-metric",
        templateId: "chapterTitle",
        variables: { title: "Revenue reached 42 million" },
        timing: { fixedDuration: 4 },
      },
    },
    { type: "plan.complete" },
  ],
};

const delayed: readonly MockVideoStreamPart[] = [
  { type: "mock.delay", durationMs: 25 },
  ...portrait.parts,
];

const truncated: readonly MockVideoStreamPart[] = [
  {
    type: "scene.add",
    scene: {
      id: "truncated-partial",
      templateId: "chapterTitle",
      variables: { title: "Playable partial result" },
      timing: { fixedDuration: 4 },
    },
  },
  { type: "mock.raw", text: "{\"type\":\"scene.add\",\"scene\":{\"id\":\"unfinished" },
];

const invalidScene: readonly MockVideoStreamPart[] = [
  {
    type: "scene.add",
    scene: {
      id: "invalid-scene",
      templateId: "not-installed",
      variables: {},
      timing: { fixedDuration: 3 },
    },
  },
  {
    type: "scene.add",
    scene: {
      id: "valid-after-invalid",
      templateId: "chapterTitle",
      variables: { title: "Recovered after invalid content" },
      timing: { fixedDuration: 4 },
    },
  },
  { type: "plan.complete" },
];

const providerFailure: readonly MockVideoStreamPart[] = [
  {
    type: "mock.error",
    message: "Provider failed with authorization=fixture-private-value",
  },
];

const contentFilter: readonly MockVideoStreamPart[] = [
  {
    type: "scene.add",
    scene: {
      id: "content-filter-partial",
      templateId: "chapterTitle",
      variables: { title: "Safe partial result" },
      timing: { fixedDuration: 4 },
    },
  },
  { type: "plan.complete", finishReason: "content-filter" },
];

const abort: readonly MockVideoStreamPart[] = [
  {
    type: "scene.add",
    scene: {
      id: "abort-partial",
      templateId: "chapterTitle",
      variables: { title: "Partial result before cancellation" },
      timing: { fixedDuration: 4 },
    },
  },
  { type: "mock.wait-for-abort" },
];

const timeout: readonly MockVideoStreamPart[] = [
  {
    type: "scene.add",
    scene: {
      id: "timeout-partial",
      templateId: "chapterTitle",
      variables: { title: "Partial result before timeout" },
      timing: { fixedDuration: 4 },
    },
  },
  { type: "mock.wait-for-abort" },
];

export const videoFixtures = deepFreeze({
  portrait,
  landscape,
  scenarios: {
    success: portrait.parts,
    delayed,
    truncated,
    invalidScene,
    providerFailure,
    contentFilter,
    abort,
    timeout,
  },
});
