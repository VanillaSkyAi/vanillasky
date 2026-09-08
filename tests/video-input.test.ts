import type { VideoInput } from "../src/protocol/types";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import type { VideoStyle } from "../src/index";
import type { VideoAudio } from "../src/internal";

const complete = async function* () {
  yield { type: "plan.complete" as const };
};

describe("VideoInput", () => {
  it("uses a deterministic chapter opening when opening is omitted", async () => {
    const { createVideo } = await import("../src/internal");
    const response = createVideo({
      input: "Activation increased to 58%.",
      maxDurationSec: 12,
    }, {
      capabilities: { templates: ["bigNumber"] },
      generate: complete,
    });

    expect(response.request.input.opening).toBe("Creating your video...");
    expect(response.initialConfig.scenes).toEqual([{
      id: "supplied-opening",
      templateId: "chapterTitle",
      variables: { title: "Creating your video..." },
      timing: { fixedDuration: 3, startTime: 0, endTime: 3 },
    }]);
  });

  it("lets the host replace the deterministic opening with application loading UI", async () => {
    const { createVideo } = await import("../src/internal");
    const response = createVideo({
      input: "Activation increased to 58%.",
      opening: false,
      maxDurationSec: 12,
    }, {
      capabilities: { templates: ["bigNumber"] },
      generate: async function* () {
        yield {
          type: "scene.add" as const,
          scene: {
            id: "activation",
            templateId: "bigNumber",
            variables: { texts: "Activation", value: 58, label: "percent" },
            timing: { fixedDuration: 3 },
          },
        };
        yield { type: "plan.complete" as const };
      },
    });

    expect(response.request.input.opening).toBe(false);
    expect(response.initialConfig.scenes).toEqual([]);

    const events = [];
    for await (const event of response.stream) events.push(event);
    expect(events.filter((event) => event.type === "scene.add").map((event) =>
      event.type === "scene.add" ? event.data.scene.id : undefined
    )).toEqual(["activation"]);
    expect(events[0]).toMatchObject({
      type: "response.start",
      data: { capabilities: { templates: ["bigNumber"] } },
    });
  });

  it("turns an intent-level opening into the deterministic opening scene", async () => {
    const { createVideo } = await import("../src/internal");
    const response = createVideo({
      input: "Activation increased to 58%.",
      opening: "  Your activation update is ready.  ",
      maxDurationSec: 12,
    }, {
      capabilities: { templates: ["media"] },
      generate: complete,
    });

    expect(response.initialConfig.scenes).toEqual([{
      id: "supplied-opening",
      templateId: "chapterTitle",
      variables: { title: "Your activation update is ready." },
      timing: { fixedDuration: 3, startTime: 0, endTime: 3 },
    }]);
    expect(response.request.input.opening).toBe("Your activation update is ready.");
  });

  it("infers deterministic output audio metadata from a supplied src", async () => {
    const { createVideo } = await import("../src/internal");
    const selectAudio = vi.fn(() => undefined);
    const response = createVideo({
      input: "A concise update.",
      maxDurationSec: 24,
      audio: { src: "https://cdn.example.com/calm.mp3" },
    }, { generate: complete, selectAudio });

    expect(selectAudio).not.toHaveBeenCalled();
    expect(response.initialConfig.audio).toEqual({
      trackId: "soundtrack",
      audioUrl: "https://cdn.example.com/calm.mp3",
      duration: 24,
      beatDetection: { sensitivity: 0.5 },
      beatMarkers: [],
      volume: 1,
      fadeOutMs: 3000,
    });
  });

  it("uses host audio by default and lets audio false disable it", async () => {
    const { createVideo } = await import("../src/internal");
    const selected: VideoAudio = {
      trackId: "catalog-calm",
      audioUrl: "https://cdn.example.com/catalog-calm.mp3",
      duration: 30,
      beatDetection: { sensitivity: 0.4 },
      beatMarkers: [],
    };
    const selectAudio = vi.fn(() => selected);

    const automatic = createVideo({ input: "Use the catalog default." }, {
      generate: complete,
      selectAudio,
    });
    expect(automatic.initialConfig.audio).toBe(selected);

    const silent = createVideo({ input: "No soundtrack.", audio: false }, {
      generate: complete,
      selectAudio,
    });
    expect(silent.initialConfig.audio).toBeUndefined();
    expect(selectAudio).toHaveBeenCalledTimes(1);
  });

  it("never emits a completed snapshot that parseVideo rejects", async () => {
    const { createVideo } = await import("../src/internal");
    const response = createVideo({ input: "Reject an unreplayable host soundtrack." }, {
      selectAudio: () => ({
        trackId: "oversized",
        audioUrl: `https://cdn.example/${"a".repeat(2_048)}`,
        duration: 30,
        beatDetection: { sensitivity: 0.5 },
        beatMarkers: [],
      }),
      generate: async function* () {
        yield {
          type: "scene.add" as const,
          scene: { id: "one", templateId: "notification", variables: { message: "Grounded" }, timing: { fixedDuration: 4 } },
        };
        yield { type: "plan.complete" as const };
      },
    });

    const events = [];
    for await (const event of response.stream) events.push(event);
    expect(events.some(({ type }) => type === "response.complete")).toBe(false);
    expect(events.at(-1)).toMatchObject({
      type: "response.error",
      data: { terminal: true, error: { code: "generation_failed" } },
    });
  });

  it("does not expose or persist a configurable brand", async () => {
    const {createVideo,createVideoRequest,parseVideoRequest}=await import("../src/internal");
    const response=createVideo({input:"A grounded story."},{generate:complete});
    expect(response.initialConfig.style).not.toHaveProperty("brand");
    const request=createVideoRequest({input:"A grounded story."},{requestId:"brand-rejection"});
    expect(()=>parseVideoRequest({...request,input:{...request.input,brand:{font:"Custom"}}})).toThrow(/unsupported field brand/);
  });

  it("validates only the simplified opening and audio request shapes", async () => {
    const {
      createVideoRequest,
      parseVideoRequest,
    } = await import("../src/internal");
    const valid = createVideoRequest({
      input: "Grounded source.",
      knowledgeMode: "general",
      opening: "A grounded opening.",
      audio: { src: "https://cdn.example.com/audio.mp3" },
    }, { requestId: "request-1" });

    expect(parseVideoRequest(valid)).toEqual(valid);
    const loadingOnly = createVideoRequest({
      input: "Grounded source.",
      opening: false,
    }, { requestId: "request-loading-only" });
    expect(parseVideoRequest(loadingOnly)).toEqual(loadingOnly);
    expect(() => parseVideoRequest({
      ...valid,
      input: { input: "Grounded source.", knowledgeMode: "outside-web" },
    })).toThrow("request.input.knowledgeMode must be input-only or general");
    expect(() => parseVideoRequest({
      ...valid,
      input: { input: "Grounded source.", firstScene: { text: "Old shape" } },
    })).toThrow("request.input contains unsupported field firstScene");
    expect(() => parseVideoRequest({
      ...valid,
      input: { input: "Grounded source.", type: "daily_briefing" },
    })).toThrow("request.input contains unsupported field type");
    expect(() => parseVideoRequest({
      ...valid,
      input: { input: "Grounded source.", audio: { mode: "auto" } },
    })).toThrow("request.input.audio contains unsupported field mode");
    expect(() => parseVideoRequest({
      ...valid,
      input: { input: "Grounded source.", audio: { src: " " } },
    })).toThrow("request.input.audio.src must be a non-empty string");
    expect(() => parseVideoRequest({
      ...valid,
      input: { input: "Grounded source.", audio: { src: `https://cdn.example/${"a".repeat(2_048)}` } },
    })).toThrow("request.input.audio.src must be at most 2048 characters");
    expect(() => parseVideoRequest({
      ...valid,
      input: {
        input: "Grounded source.",
        suppliedMedia: [{
          id: "oversized",
          type: "image",
          url: `https://cdn.example/${"m".repeat(2_048)}`,
        }],
      },
    })).toThrow("request.input.suppliedMedia[0].url must be at most 2048 characters");
    expect(() => parseVideoRequest({
      ...valid,
      input: { input: "Grounded source.", style: { preset: "editorial" } },
    })).toThrow("request.input.style contains unsupported field preset");
  });

  it.each([
    [{ instructions: 42 }, "request.input.instructions must be a non-empty string"],
    [{ orientation: "square" }, "request.input.orientation must be portrait or landscape"],
    [{ maxDurationSec: "30" }, "request.input.maxDurationSec must be a number between 5 and 120"],
    [{ maxDurationSec: 4 }, "request.input.maxDurationSec must be a number between 5 and 120"],
    [{ maxDurationSec: 121 }, "request.input.maxDurationSec must be a number between 5 and 120"],
  ])("rejects malformed intent-level input option %j", async (option, message) => {
    const { createVideoRequest, parseVideoRequest } = await import("../src/internal");
    const valid = createVideoRequest({ input: "Grounded source." }, { requestId: "request-options" });

    expect(() => parseVideoRequest({
      ...valid,
      input: { input: "Grounded source.", ...option },
    })).toThrow(message);
  });

  it.each([
    ["density", "dense", "airy, normal, or packed"],
    ["motion", "fast", "calm, normal, or punchy"],
    ["textArchetype", "bounce", "subtle, typewriter, wordStagger, slam, cinematic, or heroWord"],
    ["backgroundEffect", "spin", "static, slow-zoom-in, slow-zoom-out, ken-burns, drift, pulse, breathe, slow-tilt, or camera-shake"],
  ])("rejects an unsupported style %s", async (field, value, choices) => {
    const { createVideoRequest, parseVideoRequest } = await import("../src/internal");
    const valid = createVideoRequest({ input: "Grounded source." }, { requestId: "request-style" });

    expect(() => parseVideoRequest({
      ...valid,
      input: { input: "Grounded source.", style: { [field]: value } },
    })).toThrow(`request.input.style.${field} must be ${choices}`);
  });

  it.each([
    ["focalPoint", "middle", "center, top, bottom, left, or right"],
    ["treatment", "loud", "subtle, cinematic, or text-safe"],
    ["role", "hero", "product, proof, background, or logo"],
  ])("rejects an unsupported supplied-media %s", async (field, value, choices) => {
    const { createVideoRequest, parseVideoRequest } = await import("../src/internal");
    const valid = createVideoRequest({ input: "Grounded source." }, { requestId: "request-media" });

    expect(() => parseVideoRequest({
      ...valid,
      input: {
        input: "Grounded source.",
        suppliedMedia: [{
          id: "media-1",
          type: "image",
          url: "https://cdn.example.com/media.jpg",
          [field]: value,
        }],
      },
    })).toThrow(`request.input.suppliedMedia[0].${field} must be ${choices}`);
  });

  it("has the small intent-level type surface", () => {
    expectTypeOf<VideoInput["knowledgeMode"]>().toEqualTypeOf<"input-only" | "general" | undefined>();
    expectTypeOf<VideoInput["opening"]>().toEqualTypeOf<string | false | undefined>();
    expectTypeOf<VideoInput["audio"]>().toEqualTypeOf<false | { src: string } | undefined>();
    expectTypeOf<Extract<keyof VideoStyle,"brand">>().toEqualTypeOf<never>();
    expectTypeOf<Extract<keyof VideoInput,"brand">>().toEqualTypeOf<never>();
  });
});

// @ts-expect-error VideoInput no longer accepts a response-type taxonomy.
type _RemovedResponseType = VideoInput["type"];
// @ts-expect-error VideoInput no longer accepts scene-level opening configuration.
type _RemovedFirstScene = VideoInput["firstScene"];
// @ts-expect-error VideoOpening is intentionally absent from the package root.
type _RemovedOpeningAlias = import("../src/index").VideoOpening;
// @ts-expect-error VideoTiming is intentionally absent from the package root.
type _RemovedTimingAlias = import("../src/index").VideoTiming;
// @ts-expect-error Resolved style no longer exposes a duplicate font path.
type _RemovedStyleFont = VideoStyle["font"];
// @ts-expect-error Resolved style no longer exposes brandKit.
type _RemovedBrandKit = VideoStyle["brandKit"];
// @ts-expect-error Scene-level visual background overrides are not planner-authored.
type _RemovedBackgroundOverride = import("../src/index").VideoScene["backgroundOverride"];
