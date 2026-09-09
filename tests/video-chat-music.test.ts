import { describe, expect, it, vi } from "vitest";
import { createVideoChatHandler } from "../src/server/create-video-chat-handler";
import type { VideoChatVideoGenerator } from "../src/server/video-chat-options";
import { parseResponseRequest } from "../src/server/video-chat-input";
import { decodeVideoSse } from "../src/protocol/sse";
import { applyVideoEvent, createVideoState } from "../src/protocol/state";
import { parseVideo } from "../src/protocol/persistence";
import { createMusicAudio, getMusicTrack } from "../src/music-catalog";
import { createChatShotPlanner } from "../src/server/chat-shot-planner";
import { createVideo } from "../src/server/compose-video";
import { validateBuiltinScene } from "../src/server/scene-validation";
import { getGenerationLifecycleSink } from "../src/server/lifecycle";

function answer(musicMood?: unknown) {
  return { type: "answer", musicMood, intent: "explanation", visualStyle: "realistic",
    opening: "Plants turn sunlight into sugar.", subject: "Plants", development: "",
    visualDirection: "A green leaf in sunlight.",
    ending: { title: "Stored energy", narration: "The sugar stores energy for growth.",
      subject: "Green leaf", action: "Sunlight reaches a leaf.", durationSec: 5, continuity: "cut" } };
}

async function response(briefMood?: unknown, requestOptions: Record<string, unknown> = {}, generateVideo?: VideoChatVideoGenerator) {
  const streamText = vi.fn(() => (async function* () { yield JSON.stringify(answer(briefMood)) + "\n"; })());
  const generateText = vi.fn(() => "unused");
  const handler = createVideoChatHandler({ authorize: "none", streamText, generateText, generateVideo, heartbeatMs: false });
  const result = await handler(new Request("https://app.example/api/video-chat?action=response", {
    method: "POST", body: JSON.stringify({ prompt: "Explain plants", ...requestOptions }),
  }));
  expect(result.status).toBe(200);
  const events = [];
  for await (const event of decodeVideoSse(result.body!)) events.push(event);
  expect(streamText).toHaveBeenCalledTimes(1);
  expect(generateText).not.toHaveBeenCalled();
  expect(events.at(-1)?.type).toBe("response.complete");
  return events;
}

describe("chat soundtrack selection", () => {
  it.each(["focused", "upbeat", "calm"] as const)("selects %s from the existing answer brief before its first scene", async mood => {
    const events = await response(mood);
    const audioEvents = events.filter(event => event.type === "audio.set");
    expect(audioEvents).toHaveLength(1);
    const selected = audioEvents[0].data.audio;
    expect(getMusicTrack(selected.trackId)?.mood).toBe(mood);
    expect(events.findIndex(event => event.type === "audio.set")).toBeLessThan(events.findIndex(event => event.type === "scene.add"));
    let state = createVideoState();
    for (const event of events) state = applyVideoEvent(state, event);
    const saved = parseVideo(JSON.parse(JSON.stringify(state.config)));
    expect(saved.audio).toEqual(selected);
    expect(parseVideo(saved).audio).toEqual(selected);
    expect(saved.scenes[0].narration).toBe("The sugar stores energy for growth.");
  });

  it.each([undefined, "unknown", { mood: "upbeat" }, 1])("falls back to calm for absent or invalid model mood %j", async mood => {
    const events = await response(mood);
    const selected = events.find(event => event.type === "audio.set");
    expect(selected?.type === "audio.set" && getMusicTrack(selected.data.audio.trackId)?.mood).toBe("calm");
  });

  it("honors the viewer's mood and avoids their previous eligible track", async () => {
    const events = await response("calm", { musicMood: "focused", previousTrackId: "cue" });
    expect(events.find(event => event.type === "audio.set")?.data).toMatchObject({ audio: { trackId: "bartender" } });
  });

  it.each([
    { model: "calm", preference: "auto", initial: "florist" },
    { model: "off", preference: "focused", initial: "bartender" },
    { model: "upbeat", preference: undefined, initial: "oceanside" },
    { model: "unknown", preference: "auto", initial: "florist" },
  ])("keeps an already playing catalog track when the resolved mood agrees: %j", async ({ model, preference, initial }) => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const events = await response(model, { musicMood: preference, initialTrackId: initial });
      expect(events.find(event => event.type === "audio.set")?.data).toMatchObject({ audio: { trackId: initial, volume: 0.20 } });
    } finally { random.mockRestore(); }
  });

  it.each(["focused", "upbeat", "off"] as const)("keeps Auto's initial track through the first footage scene when the brief asks for %s", async model => {
    const initial = createMusicAudio(getMusicTrack("florist")!);
    const generateVideo = vi.fn(() => ({ type: "video" as const, url: "https://media.example/leaf.mp4", durationSec: 5 }));
    const events = await response(model, { musicMood: "auto", initialTrackId: initial.trackId }, generateVideo);
    const audioEvents = events.filter(event => event.type === "audio.set");
    expect(audioEvents).toHaveLength(1);
    expect(audioEvents[0].data.audio).toEqual(initial);
    const firstSceneIndex = events.findIndex(event => event.type === "scene.add");
    const openingIndex = events.findIndex(event => event.type === "data.video-chat-opening");
    expect(events.findIndex(event => event.type === "audio.set")).toBeLessThan(firstSceneIndex);
    expect(openingIndex).toBeGreaterThanOrEqual(0);
    expect(openingIndex).toBeLessThan(firstSceneIndex);
    expect(generateVideo).toHaveBeenCalledTimes(1);
    const scene = events[firstSceneIndex];
    expect(scene?.type === "scene.add" && scene.data.scene).toMatchObject({
      templateId: "cinemaMedia", variables: { mediaUrl: "https://media.example/leaf.mp4" },
    });
    let state = createVideoState();
    for (const event of events) {
      state = applyVideoEvent(state, event);
      if (event.type === "scene.add") expect(state.config?.audio).toEqual(initial);
    }
    expect(parseVideo(JSON.parse(JSON.stringify(state.config))).audio).toEqual(initial);
  });

  it("keeps the initial track when the caller omits the Auto preference", async () => {
    const events = await response("focused", { initialTrackId: "florist" });
    expect(events.find(event => event.type === "audio.set")?.data).toMatchObject({ audio: { trackId: "florist" } });
  });

  it("lets a manual mood replace an initial track from another mood", async () => {
    const events = await response("calm", { musicMood: "focused", initialTrackId: "florist", previousTrackId: "cue" });
    expect(events.find(event => event.type === "audio.set")?.data).toMatchObject({ audio: { trackId: "bartender" } });
  });

  it.each(["retired-track", "https://untrusted.example/track.mp3"])("does not let unknown initial track %s override the trusted catalog", async initialTrackId => {
    const events = await response("focused", { musicMood: "auto", initialTrackId, previousTrackId: "cue" });
    expect(events.find(event => event.type === "audio.set")?.data).toMatchObject({
      audio: { trackId: "bartender", audioUrl: "/audio-library/bartender.mp3" },
    });
  });

  it("stops provisional music when the viewer chooses Off", async () => {
    const events = await response("focused", { musicMood: "off", initialTrackId: "bartender" });
    expect(events.some(event => event.type === "audio.set")).toBe(false);
  });

  it.each([null, 5, {}, [], "", "x".repeat(81)].map(initialTrackId => ({ initialTrackId })))("rejects malformed initial track identifier %j", ({ initialTrackId }) => {
    expect(() => parseResponseRequest({ prompt: "Explain plants", initialTrackId })).toThrow();
  });

  it.each([{ model: "off", request: "auto" }, { model: "upbeat", request: "off" }])("allows silence through %j", async ({ model, request }) => {
    const events = await response(model, { musicMood: request });
    expect(events.some(event => event.type === "audio.set")).toBe(false);
    const complete = events.at(-1);
    expect(complete?.type === "response.complete" && complete.data.snapshot.audio).toBeUndefined();
  });

  it.each([{ musicMood: "loud" }, { musicMood: [] }, { previousTrackId: "x".repeat(81) }, { previousTrackId: "" }, { previousTrackId: 5 }])("rejects invalid request music settings %j", settings => {
    expect(() => parseResponseRequest({ prompt: "Explain plants", ...settings })).toThrow();
  });

  it("commits the first brief selection once, preserving it across stream replay and late metadata", async () => {
    let generations = 0;
    const first = createMusicAudio(getMusicTrack("cue")!);
    const another = createMusicAudio(getMusicTrack("bartender")!);
    const run = createVideo({ input: "Explain plants", opening: false }, {
      generate: async function* (context) {
        generations++;
        const sink = getGenerationLifecycleSink(context)!;
        sink.setPlannedAudio!(first);
        sink.setPlannedAudio!(another);
        yield { type: "scene.add", scene: { id: "leaf", templateId: "chapterTitle", variables: { title: "Green leaf" }, timing: { fixedDuration: 5 } } };
        sink.setPlannedAudio!(another);
        yield { type: "plan.complete" };
      },
    });
    const original = [], replay = [];
    for await (const event of run.stream) original.push(event);
    for await (const event of run.stream) replay.push(event);
    expect(generations).toBe(1);
    expect(replay).toEqual(original);
    expect(original.filter(event => event.type === "audio.set")).toHaveLength(1);
    expect((await run.result).config?.audio).toEqual(first);
  });

  it.each([false, { src: "/custom-music.mp3" }] as const)("preserves explicit input audio %j over planned music", async audio => {
    const run = createVideo({ input: "Explain plants", opening: false, audio }, {
      generate: createChatShotPlanner({ publishOpening: () => undefined, mediaConcurrency: 1,
        streamText: () => (async function* () { yield JSON.stringify(answer("focused")) + "\n"; })(),
      }),
    });
    for await (const event of run.stream) expect(event.type).not.toBe("response.error");
    expect((await run.result).config?.audio?.audioUrl).toBe(audio === false ? undefined : audio.src);
  });
});

describe("generated footage ambience", () => {
  it("allows environmental sound throughout the planner-to-provider request without permitting voices or music", async () => {
    const planningPrompts: string[] = [], shotDirections: string[] = [];
    const handler = createVideoChatHandler({
      authorize: "none", heartbeatMs: false, generatedVideoAudio: true, generateText: () => "unused",
      streamText: context => (async function* () {
        planningPrompts.push(context.systemPrompt);
        yield JSON.stringify(answer("off")) + "\n";
      })(),
      generateVideo: (_query, context) => {
        shotDirections.push(context.shotDirection);
        return { type: "video", url: "https://media.example/leaf.mp4", durationSec: 5, audio: "ambient" };
      },
    });
    const result = await handler(new Request("https://app.example/api/video-chat?action=response", {
      method: "POST", body: JSON.stringify({ prompt: "Explain plants" }),
    }));
    const events = [];
    for await (const event of decodeVideoSse(result.body!)) events.push(event);
    expect(events.at(-1)?.type).toBe("response.complete");
    expect(shotDirections).toHaveLength(1);
    expect(planningPrompts[0]).toMatch(/environmental ambience and action sounds/i);
    for (const prompt of [...planningPrompts, ...shotDirections]) {
      expect(prompt).not.toMatch(/\bsilent\b|\bsilence\b|\bno (?:sound|audio)\b/i);
      expect(prompt).toMatch(/(?:no|never include) [^.]*voices[^.]*music/i);
    }
    expect(shotDirections[0]).toMatch(/no [^.]*written words[^.]*subtitles/i);
  });

  it.each([{ mediaType: "video", mediaAudio: "speech" }, { mediaType: "photo", mediaAudio: "ambient" }])("rejects unsupported scene sound metadata %j", variables => {
    expect(() => validateBuiltinScene({ templateId: "cinemaMedia", variables: { mediaUrl: "https://media.example/scene.mp4", ...variables } })).toThrow();
  });
  it.each([undefined, "ambient"] as const)("preserves only the trusted provider's %s marker", async audio => {
    const run = createVideo({ input: "Explain plants", opening: false, maxDurationSec: 40 }, {
      validateScene: validateBuiltinScene,
      generate: createChatShotPlanner({
        publishOpening: () => undefined, mediaConcurrency: 1,
        streamText: () => (async function* () { yield JSON.stringify(answer("off")) + "\n"; })(),
        resolveMedia: () => ({ type: "video", url: "https://media.example/plant.mp4", durationSec: 5, ...(audio ? { audio } : {}) }),
      }),
    });
    const events = [];
    for await (const event of run.stream) events.push(event);
    expect(events.at(-1)?.type).toBe("response.complete");
    const state = await run.result;
    expect(state.config?.scenes[0].templateId).toBe("cinemaMedia");
    expect(state.config?.scenes[0].variables.mediaAudio).toBe(audio);
  });
});
