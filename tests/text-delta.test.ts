import { describe, expect, it } from "vitest";
import { createTextDeltaVideoPlanner } from "../src/internal";
import { TEST_VIDEO_STYLE } from "./semantic-brand-fixture";

const context = {
  request: {
    protocolVersion: "0.6" as const,
    requestId: "request-1",
    input: { input: "Grounded facts" },
  },
  systemPrompt: "system",
  userPrompt: "user",
  initialConfig: { schemaVersion: "0.2" as const, scenes: [], style: TEST_VIDEO_STYLE },
  signal: new AbortController().signal,
};

describe("text-delta planner", () => {
  it("accepts an enriched provider source while preserving plain text iterables", async () => {
    const planner = createTextDeltaVideoPlanner({
      streamText: () => ({
        textStream: (async function* () {
          yield '{"type":"scene.add","scene":{"id":"one","templateId":"notification","variables":{},"timing":{"fixedDuration":4}}}\n';
        })(),
        finishReason: Promise.resolve("length"),
        rawFinishReason: Promise.resolve("max_tokens"),
      }),
    });
    const parts = [];
    for await (const part of planner(context)) parts.push(part);
    expect(parts.map(({ type }) => type)).toEqual(["scene.add", "plan.complete"]);
    expect(parts.at(-1)).toEqual({ type: "plan.complete", finishReason: "length" });
  });

  it("lets explicit plan.complete win over abnormal provider metadata", async () => {
    const planner = createTextDeltaVideoPlanner({
      streamText: () => ({
        textStream: (async function* () { yield '{"type":"plan.complete","finishReason":"stop"}\n'; })(),
        finishReason: "length",
        rawFinishReason: "max_tokens",
      }),
    });
    const parts = [];
    for await (const part of planner(context)) parts.push(part);
    expect(parts).toEqual([{ type: "plan.complete", finishReason: "stop" }]);
  });

  it("does not let provider stop hide a missing protocol completion", async () => {
    const planner = createTextDeltaVideoPlanner({
      streamText: () => ({
        textStream: (async function* () {
          yield '{"type":"scene.add","scene":{"id":"one","templateId":"notification","variables":{},"timing":{"fixedDuration":4}}}\n';
        })(),
        finishReason: "stop",
      }),
    });
    const parts = [];
    for await (const part of planner(context)) parts.push(part);
    expect(parts.map(({ type }) => type)).toEqual(["scene.add"]);
  });

  it("normalizes abnormal raw provider reasons when the standard reason is absent", async () => {
    const planner = createTextDeltaVideoPlanner({
      streamText: () => ({
        textStream: (async function* () { yield ""; })(),
        rawFinishReason: Promise.resolve("content_filter"),
      }),
    });
    const parts = [];
    for await (const part of planner(context)) parts.push(part);
    expect(parts).toEqual([{ type: "plan.complete", finishReason: "content-filter" }]);
  });

  it("accepts NDJSON wrapped in standalone provider markdown fences", async () => {
    const planner = createTextDeltaVideoPlanner({
      streamText: async function* () {
        yield "```json\n";
        yield '{"type":"scene.add","scene":{"id":"one","templateId":"notification","variables":{},"timing":{"fixedDuration":4}}}\n';
        yield '{"type":"plan.complete"}\n```';
      },
    });

    const parts = [];
    for await (const part of planner(context)) parts.push(part);
    expect(parts.map(({ type }) => type)).toEqual(["scene.add", "plan.complete"]);
  });

  it("skips prose around plan parts", async () => {
    const planner = createTextDeltaVideoPlanner({
      streamText: async function* () {
        yield "Here is the result:\n";
        yield '{"type":"plan.complete"}\n';
      },
    });

    const parts = [];
    for await (const part of planner(context)) parts.push(part);
    expect(parts).toEqual([{ type: "plan.complete" }]);
  });

  it("turns a confidently truncated final object into a length completion", async () => {
    const planner = createTextDeltaVideoPlanner({
      streamText: async function* () {
        yield '{"type":"scene.add","scene":{"id":"one"';
      },
    });
    const parts = [];
    for await (const part of planner(context)) parts.push(part);
    expect(parts).toEqual([{ type: "plan.complete", finishReason: "length" }]);
  });

  it("does not mask malformed complete JSON lines", async () => {
    const planner = createTextDeltaVideoPlanner({ streamText: async function* () { yield '{"type": nope}\n'; } });
    await expect(async () => { for await (const part of planner(context)) void part; }).rejects.toThrow();
  });

  it("repairs a provider that places scene timing beside the scene", async () => {
    const planner = createTextDeltaVideoPlanner({
      streamText: async function* () {
        yield '{"type":"scene.add","scene":{"id":"one","templateId":"notification","variables":{}},"timing":{"fixedDuration":4}}\n';
        yield '{"type":"plan.complete"}\n';
      },
    });

    const parts = [];
    for await (const part of planner(context)) parts.push(part);
    expect(parts[0]).toMatchObject({
      type: "scene.add",
      scene: { timing: { fixedDuration: 4 } },
    });
  });

  it("repairs a provider that places scene narration beside the scene", async () => {
    const planner = createTextDeltaVideoPlanner({
      streamText: async function* () {
        yield '{"type":"scene.add","scene":{"id":"one","templateId":"notification","variables":{},"timing":{"fixedDuration":4}},"narration":"This line should stay with the scene."}\n';
        yield '{"type":"plan.complete"}\n';
      },
    });

    const parts = [];
    for await (const part of planner(context)) parts.push(part);
    expect(parts[0]).toMatchObject({
      type: "scene.add",
      scene: { narration: "This line should stay with the scene." },
    });
  });

  it("drops redundant top-level narration when the scene already owns it", async () => {
    const planner = createTextDeltaVideoPlanner({
      streamText: async function* () {
        yield '{"type":"scene.add","narration":"Redundant provider copy.","scene":{"id":"one","templateId":"media","variables":{},"timing":{"fixedDuration":4},"narration":"This canonical line stays with the scene."}}\n';
        yield '{"type":"plan.complete"}\n';
      },
    });

    const parts = [];
    for await (const part of planner(context)) parts.push(part);
    expect(parts[0]).toEqual({
      type: "scene.add",
      scene: {
        id: "one",
        templateId: "media",
        variables: {},
        timing: { fixedDuration: 4 },
        narration: "This canonical line stays with the scene.",
      },
    });
  });

  it("drops a provider's body placement label from an otherwise valid scene", async () => {
    const planner = createTextDeltaVideoPlanner({
      streamText: async function* () {
        yield '{"type":"scene.add","placement":"body","scene":{"id":"one","templateId":"notification","variables":{},"timing":{"fixedDuration":4}}}\n';
        yield '{"type":"plan.complete"}\n';
      },
    });

    const parts = [];
    for await (const part of planner(context)) parts.push(part);
    expect(parts[0]).toEqual({
      type: "scene.add",
      scene: {
        id: "one",
        templateId: "notification",
        variables: {},
        timing: { fixedDuration: 4 },
      },
    });
  });
});
