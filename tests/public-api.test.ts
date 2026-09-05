import { describe, expect, expectTypeOf, it } from "vitest";

describe("public API", () => {
  it("limits chat options to the supported conversation contract", () => {
    type Options = import("../src/server").VideoChatHandlerOptions;
    expectTypeOf<Extract<keyof Options,
      "selectAudio" | "snapshotRetention" | "replay" | "createRunId" |
      "allowMediaUrl" | "basePrompt" | "maxResolvedMedia" | "narrate" | "resolveMedia"
    >>().toEqualTypeOf<never>();
  });
  it("keeps the root limited to universal runtime helpers", async () => {
    expect(Object.keys(await import("../src/index"))).toEqual([
      "VideoValidationError",
      "getVideoDuration",
      "parseVideo",
      "getSceneDuration",
      "getSceneDurationBounds",
      "getSpokenDuration",
    ]);
  });
  it("exposes one obvious server path", async () => {
    const api = await import("../src/server");
    expect(Object.keys(api).sort()).toEqual([
      "createServerTemplateRegistry",
      "createVideoChatHandler",
    ]);
  });

  it("exposes one obvious React path", async () => {
    const api = await import("../src/react");
    expect(Object.keys(api).sort()).toEqual([
      "VideoChat",
      "VideoError",
      "VideoPlayer",
      "createVideoChatVoice",
      "useVideoChat",
    ]);
    const error = new api.VideoError("safe", { code: "video_failed" });
    expect(error).not.toHaveProperty("cause");
    // @ts-expect-error Raw internal causes are not part of the browser-safe public error API.
    new api.VideoError("unsafe", { code: "video_failed", cause: new Error("provider secret") });
  });

  it("keeps template authoring small", async () => {
    const api = await import("../src/templates");
    expect(Object.keys(api).sort()).toEqual(["createTemplateRegistry", "defineTemplate"]);
  });

  it("exposes the serializable built-in catalog separately from authoring", async () => {
    const api = await import("../src/template-catalog");
    expect(Object.keys(api)).toEqual(["builtinTemplates"]);
    expect(api.builtinTemplates).toHaveLength(8);
  });

  it("exposes only the deterministic public test kit", async () => {
    const api = await import("../src/test");
    expect(Object.keys(api).sort()).toEqual([
      "createMockVideoPlanner",
      "simulateVideoStream",
      "videoFixtures",
    ]);
  });
});
