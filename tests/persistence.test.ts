import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { getVideoDuration } from "../src/protocol/timeline";
import { VideoValidationError, parseVideo, type VideoValidationErrorCode } from "../src/protocol/persistence";
import { type Video } from "../src/protocol/types";
import { TEST_VIDEO_STYLE } from "./helpers/video-style";
import { checksumVideo } from "../src/protocol/checksum";

function minimalVideo(): Video {
  return {
    schemaVersion: "0.2",
    scenes: [{
      id: "saved-scene",
      templateId: "mobileMessage",
      variables: { message: "Stored safely" },
      timing: { fixedDuration: 4 },
    }],
    style: TEST_VIDEO_STYLE,
  };
}

function completeVideo(): Video {
  return {
    schemaVersion: "0.2",
    orientation: "landscape",
    audio: {
      trackId: "retained-track",
      audioUrl: "https://media.example.test/audio.mp3",
      sourceDuration: 14,
      duration: 12,
      beatDetection: { sensitivity: 0.7, targetBeats: 2, minInterval: 0.5 },
      beatMarkers: [
        { time: 0.5, manual: true, energy: "high" },
        { time: 4.5, manual: false, energy: "low" },
      ],
      volume: 0.8,
      fadeOutMs: 1_500,
    },
    scenes: [
      {
        id: "first",
        templateId: "mobileMessage",
        variables: {
          message: "Complete shape",
          nested: { enabled: true, amount: 3, empty: null },
          list: ["safe", 2, false],
        },
        textArchetype: "cinematic",
        backgroundEffect: "drift",
        timing: { startTime: 0, endTime: 4, fixedDuration: 4, durationWeight: 1 },
      },
      {
        id: "second",
        templateId: "keyFigure",
        variables: { value: 42 },
        timing: { beatStart: 1, fixedDuration: 3 },
      },
    ],
    style: {
      ...TEST_VIDEO_STYLE,
      preset: "editorial",
      defaultBackgroundEffect: "slow-zoom-in",
      defaultTextArchetype: "subtle",
      defaultTransition: "crossfade",
      density: "airy",
      motion: "calm",
    },
    meta: {
      name: "Stored result",
      prompt: "Bounded creative direction",
      source: "Bounded source",
      uploadedMediaUrls: ["https://media.example.test/image.webp"],
    },
  };
}

function invalidError(value: unknown): VideoValidationError {
  try {
    parseVideo(value);
  } catch (error) {
    expect(error).toBeInstanceOf(VideoValidationError);
    expect((error as VideoValidationError).code).toBe("invalid_video");
    return error as VideoValidationError;
  }
  throw new Error("Expected parseVideo to reject the value");
}

function setNull(path: readonly string[]): unknown {
  const value = JSON.parse(JSON.stringify(completeVideo())) as Record<string, unknown>;
  let parent = value;
  for (const key of path.slice(0, -1)) {
    parent = parent[key] as Record<string, unknown>;
  }
  parent[path.at(-1)!] = null;
  return value;
}

describe("persisted Video contract", () => {
  it("rejects the previous release fixture rather than silently rewriting brand and template semantics",()=>{
    const fixturePath=resolve(import.meta.dirname,"fixtures/persisted-video-0.1.0.json");
    expect(existsSync(fixturePath)).toBe(true);
    expect(()=>parseVideo(JSON.parse(readFileSync(fixturePath,"utf8")))).toThrow(/schemaVersion/);
  });
  it("rejects a brand object even when a caller stamps the new version on it",()=>{
    expect(()=>parseVideo({...minimalVideo(),style:{brand:{font:"Custom"}}})).toThrow(/unsupported field brand/);
  });

  it("parses only the current persisted schema and exposes typed failures", () => {
    expect(parseVideo(minimalVideo())).toEqual(minimalVideo());

    let future: unknown;
    try {
      future = parseVideo({ ...minimalVideo(), schemaVersion: "9.0" });
    } catch (error) {
      future = error;
    }
    expect(future).toBeInstanceOf(VideoValidationError);
    expect((future as VideoValidationError).code satisfies VideoValidationErrorCode)
      .toBe("unsupported_video_version");

    expect(() => parseVideo({ scenes: [], style: TEST_VIDEO_STYLE })).toThrowError(
      expect.objectContaining<Partial<VideoValidationError>>({ code: "invalid_video" }),
    );
  });

  it("round-trips every optional field into a detached deeply frozen Video", () => {
    const stored = JSON.parse(JSON.stringify(completeVideo())) as unknown;
    const parsed = parseVideo(stored);

    expect(parsed).toEqual(completeVideo());
    expect(parsed).not.toBe(stored);
    expect(parsed.scenes).not.toBe((stored as Video).scenes);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.scenes)).toBe(true);
    expect(Object.isFrozen(parsed.scenes[0].variables.nested)).toBe(true);
    expect(() => {
      (parsed.scenes[0].variables.nested as { amount: number }).amount = 99;
    }).toThrow(TypeError);
    expect((stored as Video).scenes[0].variables.nested).toEqual({
      enabled: true,
      amount: 3,
      empty: null,
    });
  });

  it("rejects an unsupported version before reading any renderable field", () => {
    const future: Record<string, unknown> = { schemaVersion: "99.0" };
    Object.defineProperty(future, "scenes", {
      enumerable: true,
      get: () => { throw new Error("renderer-visible fields were inspected"); },
    });

    expect(() => parseVideo(future)).toThrowError(
      expect.objectContaining<Partial<VideoValidationError>>({
        code: "unsupported_video_version",
      }),
    );
  });

  it.each([false, true])("never invokes a schemaVersion getter (throws: %s)", (throws) => {
    let reads = 0;
    const value = { ...minimalVideo() } as Record<string, unknown>;
    Object.defineProperty(value, "schemaVersion", {
      enumerable: true,
      get: () => {
        reads += 1;
        if (throws) throw new Error("schema getter ran");
        return "0.2";
      },
    });

    invalidError(value);
    expect(reads).toBe(0);
  });

  it("requires schemaVersion to be an enumerable own data field", () => {
    const nonEnumerable = { ...minimalVideo() } as Record<string, unknown>;
    Object.defineProperty(nonEnumerable, "schemaVersion", {
      enumerable: false,
      value: "0.2",
    });

    invalidError(nonEnumerable);
    invalidError({ ...minimalVideo(), schemaVersion: null });
    invalidError({ ...minimalVideo(), schemaVersion: { toString: () => "9.0" } });
  });

  it("normalizes reflection failures even when the thrown value is hostile", () => {
    const hostileError = Proxy.revocable({}, {});
    hostileError.revoke();
    const value = new Proxy({}, {
      getOwnPropertyDescriptor: () => { throw hostileError.proxy; },
    });

    invalidError(value);
  });

  it("reads caller schemaVersion only for the early gate and detached snapshot", () => {
    let descriptorReads = 0;
    const value = new Proxy(minimalVideo() as unknown as Record<string, unknown>, {
      getOwnPropertyDescriptor: (target, key) => {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
        if (key !== "schemaVersion" || !descriptor) return descriptor;
        descriptorReads += 1;
        return {
          ...descriptor,
          value: descriptorReads <= 2 ? "0.2" : "9.0",
        };
      },
    });

    const parsed = parseVideo(value);

    expect(descriptorReads).toBe(2);
    expect(parsed.schemaVersion).toBe("0.2");
    expect(Object.isFrozen(parsed)).toBe(true);
  });

  it("rejects when the detached snapshot version differs from the early gate", () => {
    let descriptorReads = 0;
    const value = new Proxy(minimalVideo() as unknown as Record<string, unknown>, {
      getOwnPropertyDescriptor: (target, key) => {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
        if (key !== "schemaVersion" || !descriptor) return descriptor;
        descriptorReads += 1;
        return {
          ...descriptor,
          value: descriptorReads === 1 ? "0.2" : "9.0",
        };
      },
    });

    expect(() => parseVideo(value)).toThrowError(
      expect.objectContaining<Partial<VideoValidationError>>({
        code: "unsupported_video_version",
      }),
    );
    expect(descriptorReads).toBe(2);
  });

  it("returns the orientation captured by the detached snapshot without caller re-reads", () => {
    let descriptorReads = 0;
    const source = { ...minimalVideo(), orientation: "portrait" };
    const value = new Proxy(source as unknown as Record<string, unknown>, {
      getOwnPropertyDescriptor: (target, key) => {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
        if (key !== "orientation" || !descriptor) return descriptor;
        descriptorReads += 1;
        return {
          ...descriptor,
          value: descriptorReads === 1 ? "portrait" : null,
        };
      },
    });

    const parsed = parseVideo(value);

    expect(descriptorReads).toBe(1);
    expect(parsed.orientation).toBe("portrait");
    expect(getVideoDuration(parsed)).toBe(4);
  });

  it("returns nested values captured once from stateful descriptors", () => {
    let descriptorReads = 0;
    const variables = new Proxy({ message: "Captured once" } as Record<string, unknown>, {
      getOwnPropertyDescriptor: (target, key) => {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
        if (key !== "message" || !descriptor) return descriptor;
        descriptorReads += 1;
        return {
          ...descriptor,
          value: descriptorReads === 1 ? "Captured once" : undefined,
        };
      },
    });
    const value = {
      ...minimalVideo(),
      scenes: [{ ...minimalVideo().scenes[0], variables }],
    };

    const parsed = parseVideo(value);

    expect(descriptorReads).toBe(1);
    expect(parsed.scenes[0].variables).toEqual({ message: "Captured once" });
    expect(Object.isFrozen(parsed.scenes[0].variables)).toBe(true);
  });

  it("does not revisit a caller descriptor that changes from data to accessor", () => {
    let descriptorReads = 0;
    let getterReads = 0;
    const variables = new Proxy({ message: "Data descriptor" } as Record<string, unknown>, {
      getOwnPropertyDescriptor: (target, key) => {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
        if (key !== "message" || !descriptor) return descriptor;
        descriptorReads += 1;
        if (descriptorReads === 1) return descriptor;
        return {
          configurable: true,
          enumerable: true,
          get: () => {
            getterReads += 1;
            return "Accessor descriptor";
          },
        };
      },
    });
    const value = {
      ...minimalVideo(),
      scenes: [{ ...minimalVideo().scenes[0], variables }],
    };

    const parsed = parseVideo(value);

    expect(descriptorReads).toBe(1);
    expect(getterReads).toBe(0);
    expect(parsed.scenes[0].variables).toEqual({ message: "Data descriptor" });
  });

  it("normalizes a stateful cycle discovered while creating the snapshot", () => {
    const cyclic: Record<string, unknown> = new Proxy({}, {
      ownKeys: () => ["self"],
      getOwnPropertyDescriptor: (_target, key) => key === "self"
        ? { configurable: true, enumerable: true, writable: true, value: cyclic }
        : undefined,
    });
    const value = {
      ...minimalVideo(),
      scenes: [{ ...minimalVideo().scenes[0], variables: cyclic }],
    };

    invalidError(value);
  });

  it("normalizes stateful excessive depth discovered while creating the snapshot", () => {
    let descriptorReads = 0;
    const nested = (level: number): Record<string, unknown> => new Proxy({}, {
      ownKeys: () => [level < 60 ? "next" : "value"],
      getOwnPropertyDescriptor: (_target, key) => {
        descriptorReads += 1;
        return {
          configurable: true,
          enumerable: true,
          writable: true,
          value: key === "next" ? nested(level + 1) : "end",
        };
      },
    });
    const value = {
      ...minimalVideo(),
      scenes: [{ ...minimalVideo().scenes[0], variables: nested(0) }],
    };

    invalidError(value);
    expect(descriptorReads).toBeGreaterThan(0);
  });

  it("rejects sparse, accessor-backed, extended, and method-overridden arrays without running them", () => {
    const sparse = { ...minimalVideo(), scenes: Array(1) };
    invalidError(sparse);

    let elementReads = 0;
    const accessorScenes: unknown[] = [];
    Object.defineProperty(accessorScenes, "0", {
      enumerable: true,
      get: () => {
        elementReads += 1;
        throw new Error("array element getter ran");
      },
    });
    accessorScenes.length = 1;
    invalidError({ ...minimalVideo(), scenes: accessorScenes });
    expect(elementReads).toBe(0);

    let methodCalls = 0;
    const overriddenScenes = [...minimalVideo().scenes];
    Object.defineProperty(overriddenScenes, "forEach", {
      enumerable: false,
      value: () => {
        methodCalls += 1;
        throw new Error("caller array method ran");
      },
    });
    invalidError({ ...minimalVideo(), scenes: overriddenScenes });
    expect(methodCalls).toBe(0);

    const extendedScenes = [...minimalVideo().scenes] as unknown[] & Record<string, unknown>;
    extendedScenes.extra = "not JSON";
    invalidError({ ...minimalVideo(), scenes: extendedScenes });

    const symbolScenes = [...minimalVideo().scenes];
    Object.defineProperty(symbolScenes, Symbol("private"), { value: true });
    invalidError({ ...minimalVideo(), scenes: symbolScenes });
  });

  it.each([
    ["orientation", ["orientation"]],
    ["audio", ["audio"]],
    ["meta", ["meta"]],
    ["scene textArchetype", ["scenes", "0", "textArchetype"]],
    ["scene backgroundEffect", ["scenes", "0", "backgroundEffect"]],
    ["timing beatStart", ["scenes", "0", "timing", "beatStart"]],
    ["timing beatEnd", ["scenes", "0", "timing", "beatEnd"]],
    ["timing startTime", ["scenes", "0", "timing", "startTime"]],
    ["timing endTime", ["scenes", "0", "timing", "endTime"]],
    ["timing fixedDuration", ["scenes", "0", "timing", "fixedDuration"]],
    ["timing durationWeight", ["scenes", "0", "timing", "durationWeight"]],
    ["style preset", ["style", "preset"]],
    ["style defaultBackgroundEffect", ["style", "defaultBackgroundEffect"]],
    ["style defaultTextArchetype", ["style", "defaultTextArchetype"]],
    ["style defaultTransition", ["style", "defaultTransition"]],
    ["style density", ["style", "density"]],
    ["style motion", ["style", "motion"]],
    ["audio sourceDuration", ["audio", "sourceDuration"]],
    ["audio volume", ["audio", "volume"]],
    ["audio fadeOutMs", ["audio", "fadeOutMs"]],
    ["beat targetBeats", ["audio", "beatDetection", "targetBeats"]],
    ["beat minInterval", ["audio", "beatDetection", "minInterval"]],
    ["beat manual", ["audio", "beatMarkers", "0", "manual"]],
    ["beat energy", ["audio", "beatMarkers", "0", "energy"]],
    ["meta name", ["meta", "name"]],
    ["meta prompt", ["meta", "prompt"]],
    ["meta source", ["meta", "source"]],
    ["meta uploadedMediaUrls", ["meta", "uploadedMediaUrls"]],
  ] as const)("rejects explicit null for optional %s", (_label, path) => {
    invalidError(setNull(path));
  });

  it("returns values that downstream duration logic can consume without raw boundary errors", () => {
    const parsed = parseVideo(JSON.parse(JSON.stringify(completeVideo())));

    expect(() => getVideoDuration(parsed)).not.toThrow();
    expect(getVideoDuration(parsed)).toBe(7.5);
  });

  it.each([
    ["unknown top-level fields", { ...minimalVideo(), providerPayload: {} }],
    ["an empty completed timeline", { ...minimalVideo(), scenes: [] }],
    ["duplicate scene IDs", {
      ...minimalVideo(),
      scenes: [minimalVideo().scenes[0], { ...minimalVideo().scenes[0] }],
    }],
    ["unknown metadata fields", {
      ...minimalVideo(),
      meta: { name: "Stored", provider: "private" },
    }],
    ["unknown style fields", {
      ...minimalVideo(),
      style: { ...TEST_VIDEO_STYLE, privateTheme: "unsafe" },
    }],
    ["unknown scene fields", {
      ...minimalVideo(),
      scenes: [{ ...minimalVideo().scenes[0], html: "<script />" }],
    }],
    ["non-JSON template variables", {
      ...minimalVideo(),
      scenes: [{
        ...minimalVideo().scenes[0],
        variables: { message: "unsafe", missing: undefined },
      }],
    }],
    ["non-JSON brand objects", {
      ...minimalVideo(),
      style: {
        brand: Object.assign(Object.create({ inherited: true }), {}),
      },
    }],
    ["overlapping scene timing", {
      ...minimalVideo(),
      scenes: [
        { ...minimalVideo().scenes[0], timing: { startTime: 0, endTime: 4 } },
        { ...minimalVideo().scenes[0], id: "second", timing: { startTime: 3, endTime: 6 } },
      ],
    }],
    ["out-of-range beat timing", {
      ...minimalVideo(),
      audio: completeVideo().audio,
      scenes: [{ ...minimalVideo().scenes[0], timing: { beatStart: 9, fixedDuration: 2 } }],
    }],
    ["unordered audio markers", {
      ...minimalVideo(),
      audio: {
        ...completeVideo().audio!,
        beatMarkers: [{ time: 3 }, { time: 2 }],
      },
    }],
  ])("rejects %s", (_label, value) => {
    expect(() => parseVideo(value)).toThrowError(
      expect.objectContaining<Partial<VideoValidationError>>({ code: "invalid_video" }),
    );
  });

  it("rejects cyclic template variables as invalid Video JSON", () => {
    const variables: Record<string, unknown> = {};
    variables.self = variables;
    const value = {
      ...minimalVideo(),
      scenes: [{ ...minimalVideo().scenes[0], variables }],
    };

    expect(() => parseVideo(value)).toThrowError(
      expect.objectContaining<Partial<VideoValidationError>>({ code: "invalid_video" }),
    );
  });

  it("pins the internal drift checksum across key order and content mutation", () => {
    const canonical = minimalVideo();
    const reordered = {
      style: canonical.style,
      scenes: canonical.scenes.map((scene) => ({
        timing: scene.timing,
        variables: scene.variables,
        templateId: scene.templateId,
        id: scene.id,
      })),
      schemaVersion: canonical.schemaVersion,
    } satisfies Video;

    expect(checksumVideo(canonical)).toBe("fnv1a32:fc88e1e2");
    expect(checksumVideo(reordered)).toBe("fnv1a32:fc88e1e2");
    expect(checksumVideo({
      ...canonical,
      scenes: [{
        ...canonical.scenes[0],
        variables: { message: "Stored differently" },
      }],
    })).not.toBe("fnv1a32:fc88e1e2");

    expect(checksumVideo({
      schemaVersion: "0.2",
      scenes: [{
        id: "unicode",
        templateId: "mobileMessage",
        variables: { "ä": 1, z: 2, A: 3 },
        timing: { fixedDuration: 1 },
      }],
      style: {},
    })).toBe("fnv1a32:629854a1");
  });

  it("parses a generated terminal snapshot after native JSON serialization", async () => {
    const { createVideo } = await import("../src/server/compose-video");
    const response = createVideo({ input: "Grounded persistence fixture" }, {
      generate: async function* () {
        yield {
          type: "scene.add" as const,
          scene: {
            id: "generated",
            templateId: "mobileMessage",
            variables: { message: "Generated and stored" },
            timing: { fixedDuration: 3 },
          },
        };
        yield { type: "plan.complete" as const };
      },
    });
    for await (const _event of response.stream) { /* consume */ }
    const completed = (await response.result).config;

    expect(completed?.schemaVersion).toBe("0.2");
    expect(parseVideo(JSON.parse(JSON.stringify(completed)))).toEqual(completed);
  });
});

describe("scene narration", () => {
  it("round-trips the line spoken over a scene", () => {
    const value = completeVideo();
    value.scenes[0].narration = "Tidal locking is why the Moon shows one face.";
    const parsed = parseVideo(value);
    expect(parsed.scenes[0].narration).toBe("Tidal locking is why the Moon shows one face.");
    // A narrated video that survives a round trip is a video whose script can be
    // replayed without the model that wrote it.
    expect(parseVideo(JSON.parse(JSON.stringify(parsed))).scenes[0].narration)
      .toBe(parsed.scenes[0].narration);
  });

  it("stays optional", () => {
    expect(parseVideo(completeVideo()).scenes[1].narration).toBeUndefined();
  });

  it("rejects narration that is not a string", () => {
    const value = completeVideo();
    (value.scenes[0] as unknown as Record<string, unknown>).narration = 42;
    expect(invalidError(value).message).toContain("scenes[0].narration");
  });

  it("bounds narration, since it is a spoken line and not a document", () => {
    const value = completeVideo();
    value.scenes[0].narration = "a".repeat(4_001);
    expect(invalidError(value).message).toContain("scenes[0].narration");
  });
});
