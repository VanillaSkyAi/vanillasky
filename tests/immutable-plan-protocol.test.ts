import { describe, expect, it } from "vitest";

import {
  createVideoSystemPrompt,
  parseVideoEvent,
  parseVideoPlanPart,
  VIDEO_PLAN_INSTRUCTION,
  VIDEO_PROTOCOL_VERSION,
} from "../src/internal";

describe("immutable planning protocol", () => {
  it("uses protocol version 0.6 for the breaking wire contract", () => {
    expect(VIDEO_PROTOCOL_VERSION).toBe("0.6");
  });

  it.each(["scene.patch", "asset.patch", "plan.error"])(
    "rejects removed %s plan operations",
    (type) => {
      expect(() => parseVideoPlanPart({ type })).toThrow(
        `plan part.type ${type} is unsupported`,
      );
    },
  );

  it("instructs planners to emit only complete scenes and completion", () => {
    expect(VIDEO_PLAN_INSTRUCTION).toContain('"type":"scene.add"');
    expect(VIDEO_PLAN_INSTRUCTION).toContain('"type":"plan.complete"');
    expect(VIDEO_PLAN_INSTRUCTION).not.toContain("scene.patch");
    expect(VIDEO_PLAN_INSTRUCTION).not.toContain("asset.patch");
    expect(VIDEO_PLAN_INSTRUCTION).not.toContain("plan.error");
  });

  it("describes scenes as immutable throughout the system prompt", () => {
    const prompt = createVideoSystemPrompt();

    expect(prompt).toContain("Emit every scene once as a complete scene.add");
    expect(prompt).not.toContain("patch");
  });

  it.each([
    ["scene.patch", { sceneId: "scene", revision: 1, patch: { variables: { message: "Later" } } }],
    ["asset.patch", { sceneId: "scene", revision: 1, variables: { mediaUrl: "https://example.test/image.png" } }],
  ])("rejects removed %s stream events", (type, data) => {
    expect(() => parseVideoEvent({
      protocolVersion: VIDEO_PROTOCOL_VERSION,
      runId: "run",
      sequence: 1,
      eventId: "run:1",
      type,
      data,
    })).toThrow(`event.type ${type} is unsupported`);
  });

  it("emits immutable scenes without a revision counter", () => {
    const event = {
      protocolVersion: VIDEO_PROTOCOL_VERSION,
      runId: "run",
      sequence: 1,
      eventId: "run:1",
      type: "scene.add",
      data: {
        scene: {
          id: "scene",
          templateId: "notification",
          variables: { message: "Complete" },
          timing: { fixedDuration: 3 },
        },
        position: 0,
      },
    };

    expect(parseVideoEvent(event)).toEqual(event);
    expect(() => parseVideoEvent({
      ...event,
      data: { ...event.data, revision: 0 },
    })).toThrow("event.data contains unsupported field revision");
  });
});
